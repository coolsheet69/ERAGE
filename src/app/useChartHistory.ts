'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// Backing-ratio history, used only for the 48H / 30D / 90D APR figures.
//
// The price-efficiency chart (and its price history) was removed: it was the bulk
// of the Redis storage. The backing ratio only ever ratchets up slowly, so the
// server keeps one point per 30 minutes for 92 days (~4,400 points).
// This client sends at most one point every 10 minutes; the server drops anything
// closer than 30 minutes to the previous point.

type HistoryPoint = { time: number; ratio: number }

const HISTORY_TIMEOUT_MS = 8000
const POST_INTERVAL_MS = 10 * 60 * 1000

export function useChartHistory() {
  const [backingRatioHistory, setBackingRatioHistory] = useState<HistoryPoint[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const lastPostRef = useRef(0)

  // Load history. A cold server (first request after a deploy or idle period) can
  // take a few seconds to boot and connect to Redis, so allow 8s and retry up to
  // twice instead of giving up — a single timed-out request used to leave all
  // APRs stuck on "collecting…" for the whole visit.
  useEffect(() => {
    let cancelled = false
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const attempt = (n: number) => {
      controller = new AbortController()
      timer = setTimeout(() => controller?.abort(), HISTORY_TIMEOUT_MS)
      fetch('/api/chart-history', { signal: controller.signal, cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(({ backingHistory }: { backingHistory?: HistoryPoint[] }) => {
          if (cancelled) return
          const list = Array.isArray(backingHistory) ? backingHistory : []
          // An empty answer can also mean Redis was briefly unreachable — retry once more
          if (list.length === 0 && n < 2) { setTimeout(() => !cancelled && attempt(n + 1), 3000); return }
          setBackingRatioHistory(list)
          setHistoryLoaded(true)
        })
        .catch(() => {
          if (cancelled) return
          if (n < 2) setTimeout(() => !cancelled && attempt(n + 1), 3000)
          else setHistoryLoaded(true)
        })
        .finally(() => clearTimeout(timer))
    }
    attempt(0)

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller?.abort()
    }
  }, [])

  // Heartbeat: while the page is open and visible, nudge the server every 10 min.
  // (The server decides whether a point is due and reads the value on-chain itself.)
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return
      fetch('/api/chart-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'backing' }),
      }).catch(() => {})
    }, POST_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  const addBackingRatioPoint = useCallback((ratio: number) => {
    if (!(ratio > 1)) return
    const now = Date.now()
    if (now - lastPostRef.current < POST_INTERVAL_MS) return
    lastPostRef.current = now
    fetch('/api/chart-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'backing', point: { time: now, ratio } }),
    }).catch(() => {})
  }, [])

  return { backingRatioHistory, historyLoaded, addBackingRatioPoint }
}
