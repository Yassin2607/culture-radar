'use client'

import { useState, useEffect, useMemo } from 'react'
import UploadCard from '@/components/promo-radar/UploadCard'
import RadarTable from '@/components/promo-radar/RadarTable'
import WeekHistoryPanel from '@/components/promo-radar/WeekHistoryPanel'
import { loadStore, addWeekToStore, deleteWeekFromStore, clearStore } from '@/lib/radar-store'
import { weekKey } from '@/lib/product-extractor'
import type { RadarStore } from '@/types/promo'

export default function PromoRadarPage() {
  const [store, setStore] = useState<RadarStore>({ products: {}, productNames: {}, uploads: [] })
  const [isLoaded, setIsLoaded] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    setStore(loadStore())
    setIsLoaded(true)
  }, [])

  const existingWeekKeys = useMemo(
    () => store.uploads.map((u) => weekKey(u.week, u.year)),
    [store.uploads],
  )

  const allWeeks = useMemo(
    () =>
      [...new Set(Object.values(store.products).flat())].sort((a, b) => a.localeCompare(b)),
    [store.products],
  )

  const totalProducts = Object.keys(store.products).length

  const handleConfirm = (uploads: Array<{ products: string[]; week: number; year: number; filename: string }>) => {
    let current = store
    for (const u of uploads) {
      current = addWeekToStore(current, u.products, u.week, u.year, u.filename)
    }
    setStore(current)
  }

  const handleConfirmMultiWeek = (productsByWeek: Record<number, string[]>, year: number, filename: string, productNames?: Record<string, string>) => {
    let current = store
    for (const [weekStr, products] of Object.entries(productsByWeek)) {
      const week = Number(weekStr)
      if (week < 1 || week > 53) continue
      current = addWeekToStore(current, products, week, year, filename, productNames)
    }
    setStore(current)
  }

  const handleDelete = (week: number, year: number) => {
    const updated = deleteWeekFromStore(store, week, year)
    setStore(updated)
  }

  const handleClear = () => {
    if (confirm('Reset all radar data? This cannot be undone.')) {
      setStore(clearStore())
    }
  }

  if (!isLoaded) return null

  return (
    <div className="min-h-screen">
      {/* Page header */}
      <div className="border-b border-gray-200 bg-white px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="font-bold text-gray-900"
              style={{ fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: '0.01em', lineHeight: 1.1 }}
            >
              Promo Radar
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Track which products appear in each weekly promo sheet
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {totalProducts > 0 && (
              <>
                <span className="text-gray-500">
                  <span className="font-bold text-gray-900">{totalProducts}</span> products
                </span>
                <span className="text-gray-300">|</span>
                <span className="text-gray-500">
                  <span className="font-bold text-gray-900">{store.uploads.length}</span> weeks tracked
                </span>
                <button
                  onClick={handleClear}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-50"
                >
                  Reset all
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-5">
        {/* Top row: upload + history */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2">
            <UploadCard
              onConfirm={handleConfirm}
              onConfirmMultiWeek={handleConfirmMultiWeek}
              existingWeekKeys={existingWeekKeys}
            />
          </div>
          <div>
            <WeekHistoryPanel uploads={store.uploads} onDelete={handleDelete} />
          </div>
        </div>

        {/* Product radar table */}
        <RadarTable products={store.products} productNames={store.productNames} allWeeks={allWeeks} />
      </div>
    </div>
  )
}
