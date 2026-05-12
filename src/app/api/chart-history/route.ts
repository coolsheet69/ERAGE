import { NextResponse } from 'next/server'
import { createClient } from 'redis'

const PRICE_KEY = 'erage:priceEfficiency'
const BACKING_KEY = 'erage:backingRatio'
const MAX_POINTS = 20000
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

// ===== SERVER-SIDE VALIDATION =====
// The chart's price feed is now sourced from the 1% fee tier ERAGE-ETH pool.
// That pool's deeper, less-concentrated liquidity has eliminated the spike-
// down artifacts that the 0.3% pool produced, so the elaborate rate-of-change
// filter that was previously here is no longer needed. The only validation
// retained is absolute sanity bounds — values that are mathematically
// impossible or computational nonsense (NaN, Infinity, zero, negatives,
// astronomical values). Everything a real market can produce passes through.

const PRICE_HARD_MIN = 0.01  // mathematical sanity floor
const PRICE_HARD_MAX = 100   // mathematical sanity ceiling
const BACKING_HARD_MIN = 1.0 // backing ratio cannot logically be below initial
const BACKING_HARD_MAX = 10000

function isAbsolutelyInsane(type: string, ratio: number): boolean {
  if (!Number.isFinite(ratio)) return true
  if (type === 'price') return ratio < PRICE_HARD_MIN || ratio > PRICE_HARD_MAX
  if (type === 'backing') return ratio < BACKING_HARD_MIN || ratio > BACKING_HARD_MAX
  return true
}

let client: ReturnType<typeof createClient> | null = null

async function getClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL })
    client.on('error', (err) => console.error('Redis error:', err))
    await client.connect()
  }
  return client
}

export async function GET() {
  try {
    const redis = await getClient()
    const cutoff = Date.now() - RETENTION_MS

    const [priceRaw, backingRaw] = await Promise.all([
      redis.get(PRICE_KEY),
      redis.get(BACKING_KEY),
    ])

    // Scrub on read: drop pre-existing bad points so the chart renders clean
    // without requiring a manual wipe. Only absolute-sanity rejections —
    // anything a real market can produce is kept.
    const scrub = (
      raw: string | null,
      type: 'price' | 'backing'
    ): { time: number; ratio: number }[] => {
      if (!raw) return []
      const parsed: { time: number; ratio: number }[] = JSON.parse(raw)
      const cleaned: { time: number; ratio: number }[] = []
      for (const p of parsed) {
        if (p.time <= cutoff) continue
        if (isAbsolutelyInsane(type, p.ratio)) continue
        cleaned.push(p)
      }
      return cleaned
    }

    const priceHistory = scrub(priceRaw, 'price')
    const backingHistory = scrub(backingRaw, 'backing')

    return NextResponse.json({ priceHistory, backingHistory })
  } catch (err) {
    console.error('GET chart-history error:', err)
    return NextResponse.json({ priceHistory: [], backingHistory: [] })
  }
}

export async function POST(req: Request) {
  try {
    const { type, point } = await req.json()
    if (!type || !point || typeof point.time !== 'number' || typeof point.ratio !== 'number') {
      return NextResponse.json({ ok: false, error: 'invalid_shape' }, { status: 400 })
    }
    if (type !== 'price' && type !== 'backing') {
      return NextResponse.json({ ok: false, error: 'invalid_type' }, { status: 400 })
    }

    // Absolute sanity bounds — only catches NaN/Infinity/zero/negatives/astronomical
    if (isAbsolutelyInsane(type, point.ratio)) {
      console.warn(`[chart-history] Rejected absolutely-insane ${type} point:`, point.ratio)
      return NextResponse.json({ ok: false, rejected: 'absolutely_insane' })
    }

    const redis = await getClient()
    const key = type === 'price' ? PRICE_KEY : BACKING_KEY
    const cutoff = Date.now() - RETENTION_MS

    const raw = await redis.get(key)
    let history: { time: number; ratio: number }[] = raw ? JSON.parse(raw) : []

    // Filter old points
    history = history.filter((p) => p.time > cutoff)

    const last = history[history.length - 1]

    // Throttle: don't add if last point was < 10s ago
    if (!last || point.time - last.time >= 10000) {
      history.push(point)
      if (history.length > MAX_POINTS) history = history.slice(-MAX_POINTS)
      await redis.set(key, JSON.stringify(history))
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST chart-history error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// DELETE endpoint to clear history. Supports clearing one type or both.
//   DELETE /api/chart-history                → clears both
//   DELETE /api/chart-history?type=price     → clears only price history
//   DELETE /api/chart-history?type=backing   → clears only backing history
//
// Also supports scrubbing only out-of-bounds points (preserves valid history):
//   DELETE /api/chart-history?mode=scrub
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const type = url.searchParams.get('type')
    const mode = url.searchParams.get('mode')
    const redis = await getClient()

    const keysToProcess: { key: string; type: 'price' | 'backing' }[] = []
    if (!type || type === 'price') keysToProcess.push({ key: PRICE_KEY, type: 'price' })
    if (!type || type === 'backing') keysToProcess.push({ key: BACKING_KEY, type: 'backing' })

    const results: Record<string, { before: number; after: number }> = {}

    for (const { key, type: t } of keysToProcess) {
      if (mode === 'scrub') {
        // Scrub mode: keep only valid points (absolute sanity bounds only)
        const raw = await redis.get(key)
        const history: { time: number; ratio: number }[] = raw ? JSON.parse(raw) : []
        const before = history.length
        const cleaned: { time: number; ratio: number }[] = []
        for (const p of history) {
          if (isAbsolutelyInsane(t, p.ratio)) continue
          cleaned.push(p)
        }
        await redis.set(key, JSON.stringify(cleaned))
        results[t] = { before, after: cleaned.length }
      } else {
        // Full delete
        const raw = await redis.get(key)
        const before = raw ? JSON.parse(raw).length : 0
        await redis.del(key)
        results[t] = { before, after: 0 }
      }
    }

    return NextResponse.json({ ok: true, results })
  } catch (err) {
    console.error('DELETE chart-history error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
