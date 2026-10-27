'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

type HistoryPoint = { time: number; ratio: number }

interface ChartHistoryState {
  priceEfficiencyHistory: HistoryPoint[]
  backingRatioHistory: HistoryPoint[]
  historyLoaded: boolean
  addPriceEfficiencyPoint: (ratio: number) => void
  addBackingRatioPoint: (ratio: number) => void
}

// How long to wait for saved history before carrying on with live data only.
// The chart never waits on Redis longer than this.
const HISTORY_TIMEOUT_MS = 4000

// Minimum spacing between recorded points. While a series has fewer than 2 points
// (fresh start, or history unavailable) the gap is shortened so the chart can draw
// its first line within seconds instead of waiting a full interval.
const PRICE_INTERVAL_MS = 10_000
const BACKING_INTERVAL_MS = 15_000
const WARMUP_INTERVAL_MS = 2_000

// Combine saved history with points recorded live while it was loading:
// sorted by time, duplicates (same or earlier timestamp) dropped.
function mergeHistory(saved: HistoryPoint[], live: HistoryPoint[]): HistoryPoint[] {
  const all = [...saved, ...live].sort((a, b) => a.time - b.time)
  const out: HistoryPoint[] = []
  for (const p of all) {
    if (out.length === 0 || p.time > out[out.length - 1].time) out.push(p)
  }
  return out
}

export function useChartHistory(): ChartHistoryState {
  const [priceEfficiencyHistory, setPriceEfficiencyHistory] = useState<HistoryPoint[]>([])
  const [backingRatioHistory, setBackingRatioHistory] = useState<HistoryPoint[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Last accepted point time + series length, tracked in refs so the add functions
  // can decide synchronously whether to record (and POST) a point.
  const lastPriceRef = useRef<{ time: number; count: number }>({ time: 0, count: 0 })
  const lastBackingRef = useRef<{ time: number; count: number }>({ time: 0, count: 0 })

  // Load saved history on mount — with a timeout. Previously, live points were
  // ignored until this request finished, so a slow or unreachable Redis left the
  // chart stuck on "Waiting for Uniswap price data..." indefinitely.
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS)

    fetch('/api/chart-history', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(({ priceHistory, backingHistory }: { priceHistory?: HistoryPoint[]; backingHistory?: HistoryPoint[] }) => {
        setPriceEfficiencyHistory((live) => {
          const merged = mergeHistory(priceHistory ?? [], live)
          const last = merged[merged.length - 1]
          lastPriceRef.current = { time: last?.time ?? 0, count: merged.length }
          return merged
        })
        setBackingRatioHistory((live) => {
          const merged = mergeHistory(backingHistory ?? [], live)
          const last = merged[merged.length - 1]
          lastBackingRef.current = { time: last?.time ?? 0, count: merged.length }
          return merged
        })
      })
      .catch((err) => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[chart-history] saved history unavailable, using live data only:', err?.message ?? err)
        }
      })
      .finally(() => {
        clearTimeout(timer)
        setHistoryLoaded(true)
      })

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const addPriceEfficiencyPoint = useCallback((ratio: number) => {
    if (ratio <= 0) return
    const now = Date.now()
    const { time, count } = lastPriceRef.current
    const minGap = count < 2 ? WARMUP_INTERVAL_MS : PRICE_INTERVAL_MS
    if (now - time < minGap) return // also skips the POST, not just the local add

    const point = { time: now, ratio }
    lastPriceRef.current = { time: now, count: count + 1 }
    setPriceEfficiencyHistory((prev) => [...prev, point])

    // Fire-and-forget to server
    fetch('/api/chart-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'price', point }),
    }).catch(() => {})
  }, [])

  const addBackingRatioPoint = useCallback((ratio: number) => {
    if (ratio <= 1) return
    const now = Date.now()
    const { time, count } = lastBackingRef.current
    const minGap = count < 2 ? WARMUP_INTERVAL_MS : BACKING_INTERVAL_MS
    if (now - time < minGap) return

    const point = { time: now, ratio }
    lastBackingRef.current = { time: now, count: count + 1 }
    setBackingRatioHistory((prev) => [...prev, point])

    fetch('/api/chart-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'backing', point }),
    }).catch(() => {})
  }, [])

  return {
    priceEfficiencyHistory,
    backingRatioHistory,
    historyLoaded,
    addPriceEfficiencyPoint,
    addBackingRatioPoint,
  }
}
