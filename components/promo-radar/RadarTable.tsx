'use client'

import { useState, useMemo } from 'react'
import { weekLabel, parseWeekKey, getCurrentWeekKey } from '@/lib/product-extractor'

interface Props {
  products: Record<string, string[]>  // productNumber → weekKeys[]
  productNames: Record<string, string> // productNumber → name
  allWeeks: string[]                  // sorted list of all week keys
}

type ProductStatus = 'active' | 'upcoming' | 'finished'

function getStatus(weekKeys: string[], currentKey: string): ProductStatus {
  if (weekKeys.includes(currentKey)) return 'active'
  if (weekKeys.some((wk) => wk > currentKey)) return 'upcoming'
  return 'finished'
}

const STATUS_CONFIG: Record<ProductStatus, { label: string; className: string; dot: string }> = {
  active:   { label: 'Active',   className: 'bg-green-100 text-green-800',  dot: 'bg-green-500' },
  upcoming: { label: 'Upcoming', className: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-400' },
  finished: { label: 'Finished', className: 'bg-red-100 text-red-700',      dot: 'bg-red-400' },
}

export default function RadarTable({ products, productNames, allWeeks }: Props) {
  const [search, setSearch] = useState('')
  const [filterWeek, setFilterWeek] = useState('')
  const [filterStatus, setFilterStatus] = useState<ProductStatus | ''>('')

  const currentWeekKey = getCurrentWeekKey()

  const rows = useMemo(() => {
    return Object.entries(products)
      .filter(([pn]) => {
        if (!search) return true
        const q = search.trim().toLowerCase()
        return pn.includes(q) || (productNames[pn] || '').toLowerCase().includes(q)
      })
      .filter(([, weeks]) => !filterWeek || weeks.includes(filterWeek))
      .filter(([, weeks]) => !filterStatus || getStatus(weeks, currentWeekKey) === filterStatus)
      .sort((a, b) => {
        const diff = b[1].length - a[1].length
        return diff !== 0 ? diff : a[0].localeCompare(b[0])
      })
  }, [products, search, filterWeek, filterStatus, currentWeekKey])

  const totalProducts = Object.keys(products).length

  if (totalProducts === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">
        No data yet. Upload an Excel sheet to start tracking.
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
        <h3 className="font-bold text-gray-900 text-sm mr-2">
          Product Radar
          <span className="ml-2 text-xs font-normal text-gray-400">
            {totalProducts} products
          </span>
        </h3>

        <input
          type="text"
          placeholder="Search product number or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 w-52 focus:outline-none focus:border-gray-400"
        />

        {allWeeks.length > 0 && (
          <select
            value={filterWeek}
            onChange={(e) => setFilterWeek(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-gray-400 bg-white"
          >
            <option value="">All weeks</option>
            {allWeeks.map((wk) => (
              <option key={wk} value={wk}>
                {weekLabel(wk)}
              </option>
            ))}
          </select>
        )}

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as ProductStatus | '')}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-gray-400 bg-white"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="upcoming">Upcoming</option>
          <option value="finished">Finished</option>
        </select>

        {(search || filterWeek || filterStatus) && (
          <span className="text-xs text-gray-400">{rows.length} results</span>
        )}

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
          {(['active', 'upcoming', 'finished'] as ProductStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${STATUS_CONFIG[s].dot}`} />
              {STATUS_CONFIG[s].label}
            </span>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left border-b border-gray-100 bg-gray-50">
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">
                Status
              </th>
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-36">
                Product #
              </th>
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Product Name
              </th>
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
                Weeks
              </th>
              <th className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Appeared in
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([productNumber, weeks]) => {
              const status = getStatus(weeks, currentWeekKey)
              const { label, className } = STATUS_CONFIG[status]
              return (
                <tr
                  key={productNumber}
                  className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <td className="py-2.5 px-4">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${className}`}>
                      {label}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="font-mono text-sm font-semibold text-gray-900">
                      {productNumber}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="text-sm text-gray-700">
                      {productNames[productNumber] || '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        weeks.length >= 4
                          ? 'bg-purple-100 text-purple-800'
                          : weeks.length >= 2
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {weeks.length}×
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex flex-wrap gap-1.5">
                      {weeks.map((wk) => {
                        const { week } = parseWeekKey(wk)
                        const isFiltered = filterWeek === wk
                        return (
                          <span
                            key={wk}
                            className={`text-xs px-2 py-0.5 rounded-full border font-medium cursor-pointer transition-colors ${
                              isFiltered
                                ? 'border-transparent text-white'
                                : 'border-gray-200 text-gray-600 hover:border-gray-400 bg-white'
                            }`}
                            style={isFiltered ? { backgroundColor: 'var(--action-red)' } : {}}
                            onClick={() => setFilterWeek(isFiltered ? '' : wk)}
                            title={weekLabel(wk)}
                          >
                            W{week}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="py-10 text-center text-gray-400 text-sm">
            No products match the current filter.
          </div>
        )}
      </div>
    </div>
  )
}
