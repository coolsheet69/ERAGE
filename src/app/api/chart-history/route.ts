import { NextResponse } from 'next/server'
import { createClient } from 'redis'

// ===== KEYS =====
// The price-efficiency chart moved its ERAGE price feed from the 1% pool to the
// 0.3% pool. Those two pools differ by a few percent, and the history is built
// from points that EVERY visitor's browser posts. Browsers still running the old
// site kept posting 1%-pool values into the same series, so the chart zig-zagged
// between two levels (e.g. 0.96 ↔ 1.04).
//
// Fix: the 0.3%-pool series lives under its own key and its own type ('price03').
// Old clients still post type 'price' → they write to the OLD key, which nothing
// reads anymore, so they can't pollute the chart. GET serves the new series to
// everyone (as `priceHistory`, the field name both old and new clients read).
const PRICE_KEY_LEGACY = 'erage:priceEfficiency'      // 1% pool feed — retired, write-only for old clients
const PRICE_KEY = 'erage:priceEfficiency:p03'          // 0.3% pool feed — current
const BACKING_KEY = 'erage:backingRatio'
const MAX_POINTS = 20000
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MIN_SPACING_MS = 10_000

type PointType = 'price' | 'price03' | 'backing'
type Point = { time: number; ratio: number }

// ===== VALIDATION =====
// Price efficiency is kept near 1.0 by arbitrage; anything outside 0.5–2.0 is a
// bad read. (Legacy series keeps its old loose bounds — nothing reads it.)
function isInvalid(type: PointType, ratio: number): boolean {
  if (!Number.isFinite(ratio)) return true
  if (type === 'price03') return ratio < 0.5 || ratio > 2.0
  if (type === 'price') return ratio < 0.01 || ratio > 100
  if (type === 'backing') return ratio < 1.0 || ratio > 10000
  return true
}

function keyFor(type: PointType) {
  if (type === 'price03') return PRICE_KEY
  if (type === 'price') return PRICE_KEY_LEGACY
  return BACKING_KEY
}

// ===== REDIS (fails fast) =====
// Previously an unreachable Redis made requests hang for minutes while the client
// retried forever. Now: 3s connect timeout, 2 retries, then give up and let the
// route answer with an empty history.
let client: ReturnType<typeof createClient> | null = null
let connecting: Promise<ReturnType<typeof createClient>> | null = null

async function getClient() {
  if (client?.isReady) return client
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL not set')
  if (!connecting) {
    const c = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => (retries > 2 ? new Error('Redis unreachable') : 500),
      },
    })
    c.on('error', (err) => console.error('Redis error:', err?.code ?? err?.message ?? err))
    connecting = c.connect()
      .then(() => { client = c; return c })
      .finally(() => { connecting = null })
  }
  return connecting
}

function cleanSeries(raw: string | null, type: PointType): Point[] {
  if (!raw) return []
  const cutoff = Date.now() - RETENTION_MS
  let parsed: Point[] = []
  try { parsed = JSON.parse(raw) } catch { return [] }
  return parsed
    .filter((p) => p && p.time > cutoff && !isInvalid(type, p.ratio))
    .sort((a, b) => a.time - b.time)
}

export async function GET() {
  try {
    const redis = await getClient()
    const [priceRaw, backingRaw] = await Promise.all([redis.get(PRICE_KEY), redis.get(BACKING_KEY)])
    return NextResponse.json({
      priceHistory: cleanSeries(priceRaw, 'price03'),
      backingHistory: cleanSeries(backingRaw, 'backing'),
    })
  } catch (err) {
    console.error('GET chart-history error:', (err as Error)?.message ?? err)
    return NextResponse.json({ priceHistory: [], backingHistory: [] })
  }
}

export async function POST(req: Request) {
  try {
    const { type, point } = await req.json()
    if (!point || typeof point.ratio !== 'number') {
      return NextResponse.json({ ok: false, error: 'invalid_shape' }, { status: 400 })
    }
    if (type !== 'price' && type !== 'price03' && type !== 'backing') {
      return NextResponse.json({ ok: false, error: 'invalid_type' }, { status: 400 })
    }
    if (isInvalid(type, point.ratio)) {
      return NextResponse.json({ ok: false, rejected: 'out_of_bounds' })
    }

    const redis = await getClient()
    const key = keyFor(type)
    // Server time, not the browser's clock: visitors with a skewed clock used to
    // insert points out of order, which also made the line jagged.
    const now = Date.now()
    const cutoff = now - RETENTION_MS

    const raw = await redis.get(key)
    let history: Point[] = []
    try { history = raw ? JSON.parse(raw) : [] } catch { history = [] }
    history = history.filter((p) => p.time > cutoff)

    const last = history[history.length - 1]
    if (!last || now - last.time >= MIN_SPACING_MS) {
      history.push({ time: now, ratio: point.ratio })
      if (history.length > MAX_POINTS) history = history.slice(-MAX_POINTS)
      await redis.set(key, JSON.stringify(history))
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST chart-history error:', (err as Error)?.message ?? err)
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}

// DELETE — admin only. Previously anyone on the internet could wipe the chart
// history with a single request. Now it requires the header
//   x-admin-key: <CHART_ADMIN_KEY>
// matching a CHART_ADMIN_KEY environment variable in Vercel. If that variable
// isn't set, DELETE is disabled entirely.
//   DELETE /api/chart-history                 → clears current price + backing
//   DELETE /api/chart-history?type=price      → current price series only
//   DELETE /api/chart-history?type=backing    → backing only
//   DELETE /api/chart-history?type=legacy     → old 1%-pool series
export async function DELETE(req: Request) {
  const adminKey = process.env.CHART_ADMIN_KEY
  if (!adminKey || req.headers.get('x-admin-key') !== adminKey) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const type = new URL(req.url).searchParams.get('type')
    const keys =
      type === 'price' ? [PRICE_KEY]
      : type === 'backing' ? [BACKING_KEY]
      : type === 'legacy' ? [PRICE_KEY_LEGACY]
      : [PRICE_KEY, BACKING_KEY]
    const redis = await getClient()
    for (const k of keys) await redis.del(k)
    return NextResponse.json({ ok: true, cleared: keys })
  } catch (err) {
    console.error('DELETE chart-history error:', (err as Error)?.message ?? err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
