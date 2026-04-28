'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ============ Chart History Storage Hook ============
// Separates chart data persistence from page.tsx so that
// updating page.tsx won't accidentally break or reset chart data.
//
// Data is stored in localStorage with versioned keys.
// If you need to reset all stored data, bump STORAGE_VERSION.
//
// IMPORTANT: Uses a ref (historyLoadedRef) as a synchronous guard to prevent
// the add functions from writing to localStorage before the loaded data is
// applied. Without this, a hot reload could wipe historical data.

const STORAGE_VERSION = 'v5'
const MAX_PRICE_EFFICIENCY_POINTS = 20000  // ~7 days at 30s intervals
const MAX_BACKING_RATIO_POINTS = 6000       // ~24hr at 15s intervals
const DATA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

type HistoryPoint = { time: number; ratio: number }

interface ChartHistoryState {
  priceEfficiencyHistory: HistoryPoint[]
  backingRatioHistory: HistoryPoint[]
  historyLoaded: boolean
  addPriceEfficiencyPoint: (ratio: number) => void
  addBackingRatioPoint: (ratio: number) => void
}

// localStorage keys — change STORAGE_VERSION to force a data reset
const PRICE_EFFICIENCY_KEY = `ggx-${STORAGE_VERSION}-priceEfficiencyHistory`
const BACKING_RATIO_KEY = `ggx-${STORAGE_VERSION}-backingRatioHistory`

function loadFromStorage(key: string): HistoryPoint[] {
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      const parsed = JSON.parse(saved)
      const cutoff = Date.now() - DATA_RETENTION_MS
      return parsed.filter((h: HistoryPoint) => h.time > cutoff)
    }
  } catch {}
  return []
}

function saveToStorage(key: string, data: HistoryPoint[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {}
  // localStorage full — silently ignore
}

function clearOldVersions(): void {
  // Remove old version keys to free space
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('ggx-') && key !== PRICE_EFFICIENCY_KEY && key !== BACKING_RATIO_KEY) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
  } catch {}
}

export function useChartHistory(): ChartHistoryState {
  const [priceEfficiencyHistory, setPriceEfficiencyHistory] = useState<HistoryPoint[]>([])
  const [backingRatioHistory, setBackingRatioHistory] = useState<HistoryPoint[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Synchronous ref — set to true immediately after loading from localStorage.
  // This prevents the add functions from writing empty/single-point data to
  // localStorage before the historical data has been loaded into state.
  const historyLoadedRef = useRef(false)

  // Load from localStorage on mount
  useEffect(() => {
    const priceData = loadFromStorage(PRICE_EFFICIENCY_KEY)
    setPriceEfficiencyHistory(priceData)

    const ratioData = loadFromStorage(BACKING_RATIO_KEY)
    setBackingRatioHistory(ratioData)

    // Mark as loaded BEFORE setting state, so the synchronous ref is true
    // even before React processes the batched state updates
    historyLoadedRef.current = true
    setHistoryLoaded(true)

    clearOldVersions()
  }, [])

  // Add a price efficiency data point
  // Throttled: won't add if last point was < 10 seconds ago
  // Guard: won't write to localStorage until loaded data is applied
  const addPriceEfficiencyPoint = useCallback((ratio: number) => {
    if (ratio <= 0) return
    // Synchronous guard — prevents overwriting localStorage before data is loaded
    if (!historyLoadedRef.current) return

    setPriceEfficiencyHistory(prev => {
      const now = Date.now()
      const lastEntry = prev[prev.length - 1]

      // Safety: never overwrite a large dataset with a tiny one
      // If prev is empty but localStorage has data, something went wrong
      if (prev.length === 0) {
        const existing = loadFromStorage(PRICE_EFFICIENCY_KEY)
        if (existing.length > 0) {
          // localStorage has data but state doesn't — use localStorage data
          return existing
        }
      }

      // Add if no data or if more than 10 seconds since last entry
      if (!lastEntry || (now - lastEntry.time) >= 10000) {
        const newHistory = [...prev, { time: now, ratio }]
        const trimmed = newHistory.slice(-MAX_PRICE_EFFICIENCY_POINTS)
        saveToStorage(PRICE_EFFICIENCY_KEY, trimmed)
        return trimmed
      }
      return prev
    })
  }, [])

  // Add a backing ratio data point
  // Throttled: won't add if last point was < 15 seconds ago
  // Guard: won't write to localStorage until loaded data is applied
  const addBackingRatioPoint = useCallback((ratio: number) => {
    if (ratio <= 1) return
    // Synchronous guard — prevents overwriting localStorage before data is loaded
    if (!historyLoadedRef.current) return

    setBackingRatioHistory(prev => {
      const now = Date.now()
      const lastEntry = prev[prev.length - 1]

      // Safety: never overwrite a large dataset with a tiny one
      if (prev.length === 0) {
        const existing = loadFromStorage(BACKING_RATIO_KEY)
        if (existing.length > 0) {
          return existing
        }
      }

      // Add if no data or if more than 15 seconds since last entry
      if (!lastEntry || (now - lastEntry.time) >= 15000) {
        const newHistory = [...prev, { time: now, ratio }]
        const trimmed = newHistory.slice(-MAX_BACKING_RATIO_POINTS)
        saveToStorage(BACKING_RATIO_KEY, trimmed)
        return trimmed
      }
      return prev
    })
  }, [])

  return {
    priceEfficiencyHistory,
    backingRatioHistory,
    historyLoaded,
    addPriceEfficiencyPoint,
    addBackingRatioPoint,
  }
}
