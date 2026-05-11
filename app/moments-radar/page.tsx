'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type {
  ActionCountry,
  CountryDate,
  CultureMoment,
  MomentCategory,
  MomentTier,
} from '@/types/culture'

const COUNTRIES: { code: ActionCountry; flag: string; name: string }[] = [
  { code: 'NL', flag: '🇳🇱', name: 'Netherlands' },
  { code: 'BE', flag: '🇧🇪', name: 'Belgium' },
  { code: 'FR', flag: '🇫🇷', name: 'France' },
  { code: 'DE', flag: '🇩🇪', name: 'Germany' },
  { code: 'AT', flag: '🇦🇹', name: 'Austria' },
  { code: 'CH', flag: '🇨🇭', name: 'Switzerland' },
  { code: 'ES', flag: '🇪🇸', name: 'Spain' },
  { code: 'IT', flag: '🇮🇹', name: 'Italy' },
  { code: 'PT', flag: '🇵🇹', name: 'Portugal' },
  { code: 'PL', flag: '🇵🇱', name: 'Poland' },
  { code: 'CZ', flag: '🇨🇿', name: 'Czechia' },
  { code: 'SK', flag: '🇸🇰', name: 'Slovakia' },
  { code: 'HU', flag: '🇭🇺', name: 'Hungary' },
  { code: 'RO', flag: '🇷🇴', name: 'Romania' },
]

const CATEGORIES: { value: MomentCategory | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'national', label: 'National' },
  { value: 'sport', label: 'Sport' },
  { value: 'festival', label: 'Festival' },
  { value: 'religious', label: 'Religious' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'music', label: 'Music' },
  { value: 'celebrity', label: 'Celebrity' },
  { value: 'product_launch', label: 'Product launch' },
  { value: 'award_show', label: 'Award show' },
  { value: 'pop_culture', label: 'Pop culture' },
]

const HORIZONS = [
  { value: 30, label: 'Next 30 days' },
  { value: 60, label: 'Next 60 days' },
  { value: 90, label: 'Next 90 days' },
  { value: 180, label: 'Next 6 months' },
  { value: 365, label: 'Next year' },
]

export default function MomentsRadarPage() {
  const [country, setCountry] = useState<ActionCountry | ''>('')
  const [category, setCategory] = useState<MomentCategory | ''>('')
  const [tier, setTier] = useState<MomentTier | ''>('')
  const [horizon, setHorizon] = useState<number>(90)

  const [moments, setMoments] = useState<CultureMoment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshStage, setRefreshStage] = useState<string | null>(null)
  const [refreshResult, setRefreshResult] = useState<{ momentsUpserted: number; briefed: number } | null>(null)

  const loadMoments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (country) params.set('country', country)
      if (category) params.set('category', category)
      if (tier) params.set('tier', tier)
      params.set('horizonDays', String(horizon))
      const res = await apiFetch(`/api/moments/list?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { moments: CultureMoment[] }
      setMoments(data.moments)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [country, category, tier, horizon])

  useEffect(() => {
    loadMoments()
  }, [loadMoments])

  const runRefresh = async () => {
    if (!confirm('Run Perplexity discovery for new cultural moments? Takes ~2 min and uses Gemini + Perplexity credits.')) return
    setRefreshing(true)
    setRefreshResult(null)
    setError(null)
    setRefreshStage('Discovering moments via Perplexity…')
    try {
      const res = await apiFetch('/api/moments/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggeredBy: 'manual-ui' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const momentsUpserted = (data.momentsUpserted ?? 0) as number

      setRefreshStage('Generating Action briefs…')
      let totalBriefed = 0
      for (let pass = 0; pass < 2; pass++) {
        try {
          const briefRes = await apiFetch('/api/moments/backfill-briefs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 10 }),
          })
          if (briefRes.ok) {
            const briefData = (await briefRes.json()) as { briefed: number; processed: number }
            totalBriefed += briefData.briefed
            if (briefData.processed === 0) break
          }
        } catch {
          /* best-effort */
        }
      }

      setRefreshResult({ momentsUpserted, briefed: totalBriefed })
      await loadMoments()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshStage(null), 5000)
    }
  }

  const stats = useMemo(() => {
    const standardCount = moments.filter((m) => m.tier === 'standard').length
    const culturalCount = moments.filter((m) => m.tier === 'cultural').length
    return { standardCount, culturalCount }
  }, [moments])

  // Group moments by month for the timeline view
  const monthGroups = useMemo(() => {
    const groups: Record<string, CultureMoment[]> = {}
    for (const m of moments) {
      const date = m.nextOccurrence ? new Date(m.nextOccurrence) : null
      const key = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : 'no-date'
      ;(groups[key] ??= []).push(m)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [moments])

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="font-bold text-gray-900"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 26,
                letterSpacing: '0.01em',
                lineHeight: 1.1,
              }}
            >
              Moments Radar
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Upcoming cultural moments and events to plan content around. {moments.length} active
              in the next {horizon} days.
            </p>
          </div>
          <button
            onClick={runRefresh}
            disabled={refreshing}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            style={{
              fontFamily: 'var(--font-body)',
              backgroundColor: 'var(--action-red)',
              color: '#ffffff',
            }}
            title="Discover new cultural moments via Perplexity + generate Action briefs"
          >
            {refreshing ? (refreshStage ?? 'Working…') : 'Refresh from sources'}
          </button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-5">
        {error && (
          <div className="border border-red-200 bg-red-50 text-red-800 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {refreshResult && (
          <div className="border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm rounded-lg px-4 py-3">
            Discovery complete. {refreshResult.momentsUpserted} moments added/updated, {refreshResult.briefed} Action briefs generated.
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <StatCard label="Moments shown" value={moments.length} />
          <StatCard label="Standard tier" value={stats.standardCount} hint="Calendar-based" />
          <StatCard label="Cultural tier" value={stats.culturalCount} hint="Zeitgeist" />
          <StatCard label="Time horizon" value={`${horizon}d`} />
        </div>

        {/* Tier + horizon */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
            {(['', 'standard', 'cultural'] as const).map((t) => (
              <button
                key={t || 'all-tier'}
                onClick={() => setTier(t)}
                className="px-4 py-1.5 text-sm rounded-md transition-all"
                style={{
                  fontFamily: 'var(--font-body)',
                  backgroundColor:
                    tier === t
                      ? t === 'cultural'
                        ? '#7c3aed'
                        : 'var(--action-red)'
                      : 'transparent',
                  color: tier === t ? '#ffffff' : '#4a4f5c',
                  fontWeight: tier === t ? 600 : 500,
                }}
              >
                {t === '' ? 'All tiers' : t === 'standard' ? 'Standard' : 'Cultural'}
              </button>
            ))}
          </div>

          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {HORIZONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </div>

        {/* Country filter */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCountry('')}
            className="px-3 py-1.5 text-xs rounded-full border transition-all"
            style={{
              fontFamily: 'var(--font-body)',
              borderColor: country === '' ? 'var(--action-red)' : '#e5e7eb',
              color: country === '' ? 'var(--action-red)' : '#4a4f5c',
              backgroundColor: country === '' ? '#fef2f2' : '#ffffff',
              fontWeight: country === '' ? 600 : 500,
            }}
          >
            🇪🇺 All EU
          </button>
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              onClick={() => setCountry(c.code)}
              className="px-3 py-1.5 text-xs rounded-full border transition-all"
              style={{
                fontFamily: 'var(--font-body)',
                borderColor: country === c.code ? 'var(--action-red)' : '#e5e7eb',
                color: country === c.code ? 'var(--action-red)' : '#4a4f5c',
                backgroundColor: country === c.code ? '#fef2f2' : '#ffffff',
                fontWeight: country === c.code ? 600 : 500,
              }}
              title={c.name}
            >
              {c.flag} {c.code}
            </button>
          ))}
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value || 'all'}
              onClick={() => setCategory(c.value)}
              className="px-3 py-1 text-[11px] rounded-full border transition-all"
              style={{
                fontFamily: 'var(--font-body)',
                borderColor: category === c.value ? '#4a4f5c' : '#e5e7eb',
                color: category === c.value ? '#1f2937' : '#6b7280',
                backgroundColor: category === c.value ? '#f3f4f6' : '#ffffff',
                fontWeight: category === c.value ? 600 : 500,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Timeline */}
        {loading ? (
          <p className="text-sm text-gray-500">Loading moments…</p>
        ) : moments.length === 0 ? (
          <div className="border border-dashed border-gray-300 bg-white rounded-lg px-6 py-12 text-center">
            <p className="text-sm text-gray-600">
              No moments match these filters. Widen the time horizon or clear the filters.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {monthGroups.map(([monthKey, items]) => (
              <MonthSection key={monthKey} monthKey={monthKey} moments={items} country={country} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── MonthSection ──────────────────────────────────────────────────────────

function MonthSection({
  monthKey,
  moments,
  country,
}: {
  monthKey: string
  moments: CultureMoment[]
  country: ActionCountry | ''
}) {
  const label = useMemo(() => {
    if (monthKey === 'no-date') return 'No date'
    const [year, mm] = monthKey.split('-')
    const date = new Date(Number(year), Number(mm) - 1, 1)
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  }, [monthKey])

  return (
    <div>
      <h2
        className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {label}
      </h2>
      <div className="space-y-2">
        {moments.map((m) => (
          <MomentRow key={m.id} moment={m} filterCountry={country} />
        ))}
      </div>
    </div>
  )
}

// ── MomentRow ─────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  holiday:        { bg: '#fef3c7', text: '#92400e' },
  national:       { bg: '#dbeafe', text: '#1e40af' },
  sport:          { bg: '#dcfce7', text: '#15803d' },
  festival:       { bg: '#fce7f3', text: '#9d174d' },
  religious:      { bg: '#f3e8ff', text: '#6b21a8' },
  seasonal:       { bg: '#ecfeff', text: '#155e75' },
  entertainment:  { bg: '#fed7aa', text: '#9a3412' },
  music:          { bg: '#e0e7ff', text: '#3730a3' },
  celebrity:      { bg: '#fce7f3', text: '#831843' },
  product_launch: { bg: '#e5e7eb', text: '#1f2937' },
  award_show:     { bg: '#fef3c7', text: '#78350f' },
  political:      { bg: '#e5e7eb', text: '#374151' },
  pop_culture:    { bg: '#fae8ff', text: '#86198f' },
}

function MomentRow({ moment, filterCountry }: { moment: CultureMoment; filterCountry: ActionCountry | '' }) {
  const brief = moment.brandBrief
  const isCultural = moment.tier === 'cultural'

  // If a country filter is set, prefer that country's date
  const relevantDate: CountryDate | null = useMemo(() => {
    if (moment.scope === 'global') return moment.countryDates[0] ?? null
    if (filterCountry) {
      const m = moment.countryDates.find((d) => d.country === filterCountry)
      if (m) return m
    }
    // Otherwise next upcoming
    const today = new Date().toISOString().slice(0, 10)
    return moment.countryDates.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
      ?? moment.countryDates[0] ?? null
  }, [moment, filterCountry])

  const daysUntil = useMemo(() => {
    if (!relevantDate) return null
    const d = new Date(relevantDate.date)
    const diff = Math.ceil((d.getTime() - Date.now()) / 86_400_000)
    return diff
  }, [relevantDate])

  const cat = CATEGORY_COLORS[moment.category] ?? CATEGORY_COLORS.pop_culture

  return (
    <div
      className="bg-white border rounded-lg overflow-hidden"
      style={{
        borderColor: isCultural ? '#ddd6fe' : '#e5e7eb',
        borderLeftWidth: 4,
        borderLeftColor: isCultural ? '#7c3aed' : 'var(--action-red)',
      }}
    >
      <div className="px-5 py-4 flex gap-4 items-start">
        {/* Date column */}
        <div className="flex-shrink-0 w-20 text-center">
          {relevantDate ? (
            <>
              <p
                className="text-2xl font-bold leading-none"
                style={{
                  fontFamily: 'var(--font-display)',
                  color: isCultural ? '#7c3aed' : 'var(--action-red)',
                }}
              >
                {new Date(relevantDate.date).getDate()}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mt-0.5">
                {new Date(relevantDate.date).toLocaleDateString('en-GB', { month: 'short' })}
              </p>
              {daysUntil !== null && daysUntil >= 0 && (
                <p className="text-[10px] text-gray-400 mt-0.5">in {daysUntil}d</p>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-400">no date</p>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-gray-900" style={{ fontFamily: 'var(--font-display)' }}>
              {moment.name}
            </h3>
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide"
              style={{ backgroundColor: cat.bg, color: cat.text }}
            >
              {moment.category.replace('_', ' ')}
            </span>
            {isCultural && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#7c3aed', color: '#ffffff' }}
              >
                CULTURAL
              </span>
            )}
            {moment.culturalRelevance >= 8 && (
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}
              >
                ★ high relevance
              </span>
            )}
          </div>
          <p className="text-sm text-gray-700 mt-1">{moment.description}</p>

          {/* Countries */}
          {moment.countryDates.length > 0 && (() => {
            const today = new Date().toISOString().slice(0, 10)
            return (
              <div className="flex flex-wrap gap-1 mt-2">
                {moment.countryDates.map((cd) => {
                  const country = COUNTRIES.find((c) => c.code === cd.country)
                  if (!country) return null
                  const isHighlighted = filterCountry === cd.country
                  const isPast = cd.date < today
                  return (
                    <span
                      key={cd.country}
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{
                        backgroundColor: isPast
                          ? '#f9fafb'
                          : isHighlighted
                            ? '#fef2f2'
                            : '#f3f4f6',
                        color: isPast
                          ? '#9ca3af'
                          : isHighlighted
                            ? 'var(--action-red)'
                            : '#4a4f5c',
                        border: isHighlighted ? '1px solid #fecaca' : '1px solid transparent',
                        textDecoration: isPast ? 'line-through' : 'none',
                      }}
                      title={`${country.name}: ${cd.localName ?? moment.name} · ${cd.date}${isPast ? ' (passed)' : ''}`}
                    >
                      {country.flag} {cd.country}{' '}
                      <span className={isPast ? 'text-gray-300' : 'text-gray-400'}>
                        {cd.date.slice(5)}
                      </span>
                    </span>
                  )
                })}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Action brief */}
      {brief && (
        <div
          className="border-t px-5 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3"
          style={{ backgroundColor: '#fafafa', borderColor: '#f0f0f0' }}
        >
          <div className="sm:col-span-2 space-y-1">
            <p
              className="text-xs font-semibold uppercase tracking-wide text-gray-400"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Voor Action
            </p>
            <p className="text-sm text-gray-800">{brief.actionRelevance}</p>
            {brief.whyNow && <p className="text-xs text-gray-500 italic">{brief.whyNow}</p>}
          </div>

          <div className="space-y-2">
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Content aanpak
              </p>
              <p className="text-xs text-gray-700">{brief.contentAngle}</p>
            </div>
            {brief.suggestedSound && (
              <div className="flex items-start gap-1.5 text-xs">
                <span style={{ color: '#7c3aed' }}>♪</span>
                <p className="text-gray-700 flex-1">{brief.suggestedSound}</p>
                {brief.soundRisk && (
                  <span
                    className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor:
                        brief.soundRisk === 'safe'
                          ? '#ecfdf5'
                          : brief.soundRisk === 'risky'
                            ? '#fef2f2'
                            : '#fefce8',
                      color:
                        brief.soundRisk === 'safe'
                          ? '#047857'
                          : brief.soundRisk === 'risky'
                            ? '#b91c1c'
                            : '#a16207',
                    }}
                    title={brief.soundWarning ?? ''}
                  >
                    {brief.soundRisk === 'safe' ? '✓' : brief.soundRisk === 'risky' ? '⚠' : '?'}
                  </span>
                )}
              </div>
            )}
            {brief.productCategories?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {brief.productCategories.map((c) => (
                  <span
                    key={c}
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      backgroundColor: '#fef2f2',
                      color: 'var(--action-red)',
                      border: '1px solid #fecaca',
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
      <p
        className="text-xs uppercase tracking-wide text-gray-500"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {label}
      </p>
      <p
        className="text-2xl font-bold text-gray-900 mt-1"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}
