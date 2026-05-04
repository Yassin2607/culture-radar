'use client'

import { useRef, useState } from 'react'
import { parseWeekFile } from '@/lib/product-extractor'
import { weekKey } from '@/lib/product-extractor'

interface UploadItem {
  id: string
  filename: string
  products: string[]
  detectedWeek: number | null
  week: string
  year: number
  productsByWeek?: Record<number, string[]>
  productNames?: Record<string, string>
}

interface Props {
  onConfirm: (uploads: Array<{ products: string[]; week: number; year: number; filename: string }>) => void
  existingWeekKeys: string[]
  onConfirmMultiWeek?: (productsByWeek: Record<number, string[]>, year: number, filename: string, productNames?: Record<string, string>) => void
}

type State = 'idle' | 'parsing' | 'preview'

export default function UploadCard({ onConfirm, existingWeekKeys, onConfirmMultiWeek }: Props) {
  const [uiState, setUiState] = useState<State>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<UploadItem[]>([])

  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    const valid = arr.filter((f) => f.name.match(/\.(xlsx|xls)$/i))
    if (valid.length === 0) {
      setError('Only Excel files (.xlsx or .xls) are supported')
      return
    }
    if (valid.length < arr.length) {
      setError(`${arr.length - valid.length} non-Excel file(s) skipped`)
    } else {
      setError(null)
    }

    setUiState('parsing')
    try {
      const results = await Promise.all(valid.map((f) => parseWeekFile(f)))
      const items: UploadItem[] = results.map((r, i) => ({
        id: `${Date.now()}-${i}`,
        filename: r.filename,
        products: r.products,
        detectedWeek: r.week,
        week: r.week ? String(r.week) : '',
        year: r.year,
        productsByWeek: r.productsByWeek,
        productNames: r.productNames,
      }))
      setPending(items)
      setUiState('preview')
    } catch {
      setError('Failed to parse one or more Excel files.')
      setUiState('idle')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  const updateItem = (id: string, patch: Partial<Pick<UploadItem, 'week' | 'year'>>) => {
    setPending((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeItem = (id: string) => {
    setPending((prev) => {
      const next = prev.filter((item) => item.id !== id)
      if (next.length === 0) setUiState('idle')
      return next
    })
  }

  const handleConfirm = () => {
    // Check if any item has multi-week data
    const multiWeekItem = pending.find((item) => item.productsByWeek && Object.keys(item.productsByWeek).length > 0)
    if (multiWeekItem && multiWeekItem.productsByWeek && onConfirmMultiWeek) {
      onConfirmMultiWeek(multiWeekItem.productsByWeek, multiWeekItem.year, multiWeekItem.filename, multiWeekItem.productNames)
      setUiState('idle')
      setPending([])
      setError(null)
      return
    }

    // Validate all rows
    for (const item of pending) {
      const w = parseInt(item.week, 10)
      if (!w || w < 1 || w > 53) {
        setError(`Enter a valid week number (1–53) for "${item.filename}"`)
        return
      }
    }
    const uploads = pending.map((item) => ({
      products: item.products,
      week: parseInt(item.week, 10),
      year: item.year,
      filename: item.filename,
    }))
    onConfirm(uploads)
    setUiState('idle')
    setPending([])
    setError(null)
  }

  const allValid = pending.length > 0 && pending.every((item) => {
    if (item.productsByWeek && Object.keys(item.productsByWeek).length > 0) return true
    const w = parseInt(item.week, 10)
    return w >= 1 && w <= 53
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-bold text-gray-900 text-sm mb-4">Upload new week</h3>

      {uiState === 'idle' && (
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            isDragging ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-400'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files) }}
          />
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700">Drop .xlsx files here or click to browse</p>
          <p className="text-xs text-gray-400 mt-1">Multiple files supported · Week number read from filename</p>
          {error && (
            <p className="text-sm text-red-600 mt-3 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>
      )}

      {uiState === 'parsing' && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Scanning for product numbers…</p>
        </div>
      )}

      {uiState === 'preview' && (
        <div className="space-y-3">
          {/* File list */}
          <div className="space-y-2">
            {pending.map((item) => {
              const wNum = parseInt(item.week, 10)
              const isReUpload = item.week && existingWeekKeys.includes(weekKey(wNum, item.year))
              const weekMissing = !item.detectedWeek

              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-gray-200 px-4 py-3 space-y-2.5"
                >
                  {/* Filename + product count */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.filename}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {item.products.length} product{item.products.length !== 1 ? 's' : ''} found
                      </p>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="flex-shrink-0 text-xs text-gray-400 hover:text-red-500 transition-colors px-1.5 py-1 rounded hover:bg-red-50 mt-0.5"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Week inputs */}
                  {item.productsByWeek && Object.keys(item.productsByWeek).length > 0 ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600">
                        ✓ {Object.keys(item.productsByWeek).length} weeks detected from sheet (W{Math.min(...Object.keys(item.productsByWeek).map(Number))}–W{Math.max(...Object.keys(item.productsByWeek).map(Number))})
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={53}
                        value={item.week}
                        onChange={(e) => updateItem(item.id, { week: e.target.value })}
                        placeholder="Week"
                        className="w-20 text-sm font-bold border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-400"
                      />
                      <span className="text-sm text-gray-400">·</span>
                      <input
                        type="number"
                        min={2020}
                        max={2040}
                        value={item.year}
                        onChange={(e) => updateItem(item.id, { year: parseInt(e.target.value, 10) })}
                        className="w-24 text-sm font-bold border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-400"
                      />
                      {weekMissing ? (
                        <span className="text-xs text-orange-500">not detected — enter manually</span>
                      ) : (
                        <span className="text-xs text-green-600">✓ from filename</span>
                      )}
                    </div>
                  )}

                  {isReUpload && (
                    <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
                      W{item.week} {item.year} already in radar — will be replaced
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleConfirm}
              disabled={!allValid}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--action-red)' }}
            >
              Add {pending.length > 1 ? `${pending.length} weeks` : 'to Radar'}
            </button>
            <button
              onClick={() => { setUiState('idle'); setPending([]); setError(null) }}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 border border-gray-300 hover:border-gray-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
