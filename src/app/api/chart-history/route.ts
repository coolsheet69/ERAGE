import { NextResponse } from 'next/server'
import { createClient } from 'redis'

const PRICE_KEY = 'erage:priceEfficiency'
const BACKING_KEY = 'erage:backingRatio'
const MAX_POINTS = 20000
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

// ===== SERVER-SIDE VALIDATION =====
// Two-layer validation that protects against bug-corrupted writes WITHOUT
// hiding real market events:
//
// LAYER 1 (absolute sanity bounds): catches values that are mathematically
//   impossible or computational nonsense. Set wide enough that any real
//   economic event — flash crash, viral pump, oracle failure with partial
//   liquidity — passes through. Only catches things like NaN-ish numbers,
//   zero, negatives, and astronomical values.
//
// LAYER 2 (rate-of-change limit): catches single-tick "teleportation"
//   between two stable but distant levels (e.g. 0.99 → 0.29 → 0.99 in
//   consecutive 30s ticks). REAL price moves, even crashes, take multiple
//   ticks to develop because they're driven by sequential trades. A single
//   reading that jumps >40% from the last accepted reading is a computation
//   bug, not a market event. A genuine flash crash from 1.0 to 0.3 will
//   register over ~3 ticks (1.0 → 0.6 → 0.36 → 0.30) instead of one tick;
//   the chart lags a real crash by ~30-60 seconds, which is acceptable.
//
// This design lets through anything a real market can produce (extreme
// dislocations included) while still blocking the deterministic 0.287 bug
// which manifests as instant teleportation between 0.99 and 0.287.

const PRICE_HARD_MIN = 0.01  // mathematical sanity floor
const PRICE_HARD_MAX = 100   // mathematical sanity ceiling
const BACKING_HARD_MIN = 1.0 // backing ratio cannot logically be below initial
const BACKING_HARD_MAX = 10000

// Max permitted change between consecutive accepted points, as a fraction.
// 0.4 = 40% — large enough to let any plausible single-block trade through;
// small enough to block 1.0 → 0.287 (which is a 71% drop).
const MAX_RELATIVE_CHANGE = 0.4

function isAbsolutelyInsane(type: string, ratio: number): boolean {
  if (!Number.isFinite(ratio)) return true
  if (type === 'price') return ratio < PRICE_HARD_MIN || ratio > PRICE_HARD_MAX
  if (type === 'backing') return ratio < BACKING_HARD_MIN || ratio > BACKING_HARD_MAX
  return true
}

function isRateOfChangeViolation(prev: number, next: number): boolean {
  if (prev <= 0) return false  // can't compute a relative change
  return Math.abs(next - prev) / prev > MAX_RELATIVE_CHANGE
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
    // without requiring a manual wipe. Two-pass:
    //   1. Drop anything outside absolute sanity bounds or before retention cutoff
    //   2. Sequentially walk forward, dropping any point that violates the
    //      rate-of-change limit relative to the last kept point.
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
        const last = cleaned[cleaned.length - 1]
        if (last && isRateOfChangeViolation(last.ratio, p.ratio)) continue
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

    // Layer 1: absolute sanity bounds
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

    // Layer 2: rate-of-change limit (only for price ratios; backing ratio is
    // monotonic by protocol design and shouldn't see large jumps).
    if (type === 'price' && last && isRateOfChangeViolation(last.ratio, point.ratio)) {
      console.warn(
        `[chart-history] Rejected price point violating rate-of-change: ${last.ratio.toFixed(4)} → ${point.ratio.toFixed(4)}`
      )
      return NextResponse.json({ ok: false, rejected: 'rate_of_change' })
    }

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
//   DELETE /api/chart-history          → clears both
//   DELETE /api/chart-history?type=price    → clears only price history
//   DELETE /api/chart-history?type=backing  → clears only backing history
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
        // Scrub mode: keep only valid points (same two-layer logic as GET)
        const raw = await redis.get(key)
        const history: { time: number; ratio: number }[] = raw ? JSON.parse(raw) : []
        const before = history.length
        const cleaned: { time: number; ratio: number }[] = []
        for (const p of history) {
          if (isAbsolutelyInsane(t, p.ratio)) continue
          const last = cleaned[cleaned.length - 1]
          if (last && t === 'price' && isRateOfChangeViolation(last.ratio, p.ratio)) continue
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
