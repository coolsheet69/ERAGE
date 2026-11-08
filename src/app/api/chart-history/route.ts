import { NextResponse } from 'next/server'
import { createClient } from 'redis'
import { createPublicClient, http, fallback, formatUnits } from 'viem'
import { base } from 'viem/chains'

// ===== SECURITY =====
// The history was once poisoned: someone posted a fake point dated 2099 with a
// ratio of 10,000, which blocked every real point from being saved afterwards.
// Now the server never trusts what a browser sends. On POST it reads the backing
// ratio straight from the ERAGE contract itself and stamps it with server time,
// so the only data that can ever be stored is the real on-chain value.
const ERAGE = '0x328f20857c19cC72b5AeD37b301C129fC2CD8f0A' as const
const BACKING_RATIO_ABI = [
  { name: 'getBackingRatio', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'esharePerGGX', type: 'uint256' }, { name: 'ragePerGGX', type: 'uint256' }] },
] as const
const chain = createPublicClient({
  chain: base,
  transport: fallback([http('https://base-rpc.publicnode.com'), http('https://mainnet.base.org')]),
})

async function readOnchainRatio(): Promise<number> {
  const [es, ra] = await chain.readContract({ address: ERAGE, abi: BACKING_RATIO_ABI, functionName: 'getBackingRatio' })
  return parseFloat(formatUnits(es + ra, 18))
}

// Backing-ratio history for the 48H / 30D APRs — the only thing stored now.
//
// The price-efficiency chart was removed from the site. Its price series was what
// kept filling Redis, so on startup this route deletes those old keys, and any
// price points still sent by old cached copies of the site are ignored.
//
// Storage is kept tiny: one backing point per 30 minutes, 92 days retained
// (~4,400 points, well under 200 KB). Existing dense history is thinned to that on the next write.
const BACKING_KEY = 'erage:backingRatio'
const RETIRED_KEYS = ['erage:priceEfficiency', 'erage:priceEfficiency:p03']
const SPACING_MS = 30 * 60 * 1000
const RETENTION_MS = 92 * 24 * 60 * 60 * 1000 // enough for the 90D APR

type Point = { time: number; ratio: number }

// Plausible backing ratio range (it starts at 2.0 and only ratchets up slowly)
const isValidBacking = (r: unknown): r is number =>
  typeof r === 'number' && Number.isFinite(r) && r >= 1 && r <= 100

// ===== Redis (fails fast) =====
let client: ReturnType<typeof createClient> | null = null
let connecting: Promise<ReturnType<typeof createClient>> | null = null
let retiredCleared = false

async function getClient() {
  if (client?.isReady) return client
  // A client that dropped and gave up reconnecting is dead — close it before making
  // a new one, so long-running servers don't pile up stale connections.
  if (client && !client.isReady) {
    try { client.destroy() } catch { /* already closed */ }
    client = null
  }
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
      .then(async () => {
        client = c
        if (!retiredCleared) {
          retiredCleared = true
          // Free the space used by the old price-efficiency chart
          await c.del(RETIRED_KEYS).catch(() => {})
        }
        return c
      })
      .finally(() => { connecting = null })
  }
  return connecting
}

// Sort, drop invalid/expired points, and keep at most one point per 30 minutes
function compact(points: Point[]): Point[] {
  const now = Date.now()
  const cutoff = now - RETENTION_MS
  const sorted = points
    // no points from the future (that's how the history was poisoned), none expired
    .filter((p) => p && typeof p.time === 'number' && p.time > cutoff && p.time <= now + 60_000 && isValidBacking(p.ratio))
    .sort((a, b) => a.time - b.time)
  const out: Point[] = []
  for (const p of sorted) {
    const last = out[out.length - 1]
    if (!last || p.time - last.time >= SPACING_MS) out.push(p)
  }
  return out
}

function parse(raw: string | null): Point[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

// Append a fresh on-chain point if the last one is 30+ minutes old.
// Called from GET as well as POST, so the history keeps growing whenever ANYONE
// loads the site — not only when the backing ratio happens to change.
async function recordIfDue(redis: Awaited<ReturnType<typeof getClient>>, history: Point[]): Promise<Point[]> {
  const now = Date.now()
  const last = history[history.length - 1]
  if (last && now - last.time < SPACING_MS) return history
  try {
    const ratio = await readOnchainRatio()
    if (!isValidBacking(ratio)) return history
    const next = [...history, { time: now, ratio }]
    await redis.set(BACKING_KEY, JSON.stringify(next))
    return next
  } catch (err) {
    console.error('recordIfDue error:', (err as Error)?.message ?? err)
    return history
  }
}

export async function GET() {
  try {
    const redis = await getClient()
    const backingHistory = await recordIfDue(redis, compact(parse(await redis.get(BACKING_KEY))))
    // priceHistory kept (empty) so old cached copies of the site don't break
    return NextResponse.json({ priceHistory: [], backingHistory })
  } catch (err) {
    console.error('GET chart-history error:', (err as Error)?.message ?? err)
    return NextResponse.json({ priceHistory: [], backingHistory: [] })
  }
}

export async function POST(req: Request) {
  try {
    const { type } = await req.json().catch(() => ({ type: undefined }))
    if (type !== 'backing') {
      // Price series retired — accept silently so old clients don't retry
      return NextResponse.json({ ok: true, ignored: true })
    }
    const redis = await getClient()
    await recordIfDue(redis, compact(parse(await redis.get(BACKING_KEY))))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST chart-history error:', (err as Error)?.message ?? err)
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}

// PUT — admin only: restore / merge backing history from a backup.
// Header `x-admin-key` must match CHART_ADMIN_KEY. Body: { backingHistory: [{ time, ratio }, ...] }
// (the exact shape GET returns, so a saved GET response can be sent back as-is).
// Points are merged with what's already stored, then thinned to 30-minute spacing.
export async function PUT(req: Request) {
  const adminKey = process.env.CHART_ADMIN_KEY
  if (!adminKey || req.headers.get('x-admin-key') !== adminKey) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
    const incoming: Point[] = Array.isArray(body?.backingHistory) ? body.backingHistory : []
    const redis = await getClient()
    const existing = parse(await redis.get(BACKING_KEY))
    const merged = compact([...existing, ...incoming])
    await redis.set(BACKING_KEY, JSON.stringify(merged))
    return NextResponse.json({ ok: true, before: existing.length, received: incoming.length, stored: merged.length })
  } catch (err) {
    console.error('PUT chart-history error:', (err as Error)?.message ?? err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// DELETE — admin only: header `x-admin-key` must match the CHART_ADMIN_KEY env var
// (DELETE is disabled if that variable isn't set).
//   DELETE /api/chart-history  → clears the backing history
export async function DELETE(req: Request) {
  const adminKey = process.env.CHART_ADMIN_KEY
  if (!adminKey || req.headers.get('x-admin-key') !== adminKey) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const redis = await getClient()
    await redis.del([BACKING_KEY, ...RETIRED_KEYS])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE chart-history error:', (err as Error)?.message ?? err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
