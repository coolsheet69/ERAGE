import { NextResponse } from 'next/server'
import { createClient } from 'redis'

const PRICE_KEY = 'erage:priceEfficiency'
const BACKING_KEY = 'erage:backingRatio'
const MAX_POINTS = 20000
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

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

    const priceHistory = priceRaw
      ? JSON.parse(priceRaw).filter((p: { time: number }) => p.time > cutoff)
      : []

    const backingHistory = backingRaw
      ? JSON.parse(backingRaw).filter((p: { time: number }) => p.time > cutoff)
      : []

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
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    const redis = await getClient()
    const key = type === 'price' ? PRICE_KEY : BACKING_KEY
    const cutoff = Date.now() - RETENTION_MS

    const raw = await redis.get(key)
    let history: { time: number; ratio: number }[] = raw ? JSON.parse(raw) : []

    // Filter old points
    history = history.filter((p) => p.time > cutoff)

    // Throttle: don't add if last point was < 10s ago
    const last = history[history.length - 1]
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
