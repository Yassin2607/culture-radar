'use client'

import { useState, useMemo } from 'react'
import ResultRow from './ResultRow'
import type { ImageResult, ScanSummary } from '@/types/scanner'

type Filter = 'all' | 'pass' | 'fail' | 'warning' | 'error'

interface Props {
  results: ImageResult[]
  summary: ScanSummary | null
  isScanning: boolean
}

export default function ResultsTable({ results, summary, isScanning }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    return results.filter((r) => {
      const matchesFilter = filter === 'all' || r.status === filter
      const matchesSearch = search === '' || r.filename.toLowerCase().includes(search.toLowerCase())
      return matchesFilter && matchesSearch
    })
  }, [results, filter, search])

  const counts = useMemo(() => ({
    all: results.length,
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    warning: results.filter((r) => r.status === 'warning').length,
    error: results.filter((r) => r.status === 'error').length,
  }), [results])

  const exportCSV = () => {
    const headers = ['Filename', 'Status', 'Language', 'Language Issues', 'Price Found', 'Price Format OK', 'Brand Quality', 'Offensive Content', 'Quality Issues', 'Summary']
    const rows = results.map((r) => [
      r.filename,
      r.status,
      r.languageCheck?.detected_languages.join('; ') ?? '',
      r.languageCheck?.language_issues.join('; ') ?? '',
      r.priceCheck?.price_in_image ?? '',
      r.priceCheck?.price_format_correct?.toString() ?? '',
      r.brandCheck?.overall_quality ?? '',
      r.brandCheck?.offensive_content?.toString() ?? '',
      r.brandCheck?.quality_issues.join('; ') ?? '',
      r.summary,
    ])
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `action-scan-results-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (results.length === 0 && !isScanning) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">
            Results {isScanning && <span className="text-sm font-normal text-gray-500">(live)</span>}
          </h3>
          {summary && (
            <p className="text-sm text-gray-500 mt-0.5">
              {summary.total} images &bull; {Math.round(summary.durationMs / 1000)}s total
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Filter tabs */}
          {(['all', 'pass', 'fail', 'warning', 'error'] as Filter[]).map((f) => {
            const colors: Record<Filter, string> = {
              all: 'bg-gray-100 text-gray-700',
              pass: 'bg-green-100 text-green-700',
              fail: 'bg-red-100 text-red-700',
              warning: 'bg-yellow-100 text-yellow-700',
              error: 'bg-gray-100 text-gray-500',
            }
            const activeColors: Record<Filter, string> = {
              all: 'bg-gray-800 text-white',
              pass: 'bg-green-600 text-white',
              fail: 'bg-red-600 text-white',
              warning: 'bg-yellow-500 text-white',
              error: 'bg-gray-500 text-white',
            }
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === f ? activeColors[f] : colors[f]} hover:opacity-80`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
              </button>
            )
          })}

          {/* Search */}
          <input
            type="text"
            placeholder="Search filename..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-40 focus:outline-none focus:border-gray-400"
          />

          {/* Export */}
          {!isScanning && results.length > 0 && (
            <button
              onClick={exportCSV}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left border-b border-gray-100 bg-gray-50">
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">Image</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Filename</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Overall</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Language</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Price</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Brand</th>
              <th className="py-2.5 px-4 w-10" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((result) => (
              <ResultRow key={result.id} result={result} />
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && results.length > 0 && (
          <div className="py-12 text-center text-gray-400 text-sm">
            No results match the current filter
          </div>
        )}

        {results.length === 0 && isScanning && (
          <div className="py-12 text-center text-gray-400 text-sm">
            Results will appear here as images are scanned...
          </div>
        )}
      </div>
    </div>
  )
}
