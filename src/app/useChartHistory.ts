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

export function useChartHistory(): ChartHistoryState {
  const [priceEfficiencyHistory, setPriceEfficiencyHistory] = useState<HistoryPoint[]>([])
  const [backingRatioHistory, setBackingRatioHistory] = useState<HistoryPoint[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const historyLoadedRef = useRef(false)

  // Load history from server on mount
  useEffect(() => {
    fetch('/api/chart-history')
      .then((r) => r.json())
      .then(({ priceHistory, backingHistory }) => {
        setPriceEfficiencyHistory(priceHistory ?? [])
        setBackingRatioHistory(backingHistory ?? [])
        historyLoadedRef.current = true
        setHistoryLoaded(true)
      })
      .catch(() => {
        historyLoadedRef.current = true
        setHistoryLoaded(true)
      })
  }, [])

  const addPriceEfficiencyPoint = useCallback((ratio: number) => {
    if (ratio <= 0 || !historyLoadedRef.current) return
    const point = { time: Date.now(), ratio }

    setPriceEfficiencyHistory((prev) => {
      const last = prev[prev.length - 1]
      if (last && point.time - last.time < 10000) return prev
      return [...prev, point]
    })

    // Fire-and-forget to server
    fetch('/api/chart-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'price', point }),
    }).catch(() => {})
  }, [])

  const addBackingRatioPoint = useCallback((ratio: number) => {
    if (ratio <= 1 || !historyLoadedRef.current) return
    const point = { time: Date.now(), ratio }

    setBackingRatioHistory((prev) => {
      const last = prev[prev.length - 1]
      if (last && point.time - last.time < 15000) return prev
      return [...prev, point]
    })

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
