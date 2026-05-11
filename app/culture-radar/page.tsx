'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { CultureSource, CultureTrend } from '@/types/culture'
import { styleFor, LIFECYCLE_VISUAL } from './category-style'
import { HeroTrend, FeaturedTrend, CompactTrend } from './trend-cards'

type View = 'daily' | 'weekly' | 'all' | 'emerging' | 'inspiration'

interface TrendsResponse {
  week: string
  view: string
  count: number
  trends: CultureTrend[]
}

interface SourcesResponse {
  count: number
  sources: CultureSource[]
}

interface FetchResponse {
  runId: string
  status: 'ok' | 'partial' | 'failed'
  summary: {
    sourcesAttempted: number
    sourcesOk: number
    sourcesFailed: number
    identifiedRaw: number
    mergedTrends: number
    inserted: number
    updated: number
    week: string
    tokensIn: number
    tokensOut: number
  }
  failures: Array<{ source: string; error: string }>
}

interface SubmitResponse {
  ok: boolean
  slug: string
  week: string
  action: 'inserted' | 'updated'
}

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'food', label: 'Food' },
  { value: 'beauty', label: 'Beauty' },
  { value: 'fashion', label: 'Fashion' },
  { value: 'home', label: 'Home' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'tech', label: 'Tech' },
  { value: 'meme', label: 'Meme' },
  { value: 'culture', label: 'Culture' },
  { value: 'platform', label: 'Platform' },
  { value: 'sound', label: 'Sound' },
] as const

const SUBMIT_CATEGORIES = CATEGORIES.filter((c) => c.value !== '')

const CONTENT_TYPES = [
  { value: 'format', label: 'Content format' },
  { value: 'hashtag', label: 'Hashtag / challenge' },
  { value: 'meme', label: 'Meme' },
  { value: 'sound', label: 'Sound / audio' },
  { value: 'aesthetic', label: 'Aesthetic' },
  { value: 'behavior', label: 'Behavior / ritual' },
] as const

// ── Default submit form state ──────────────────────────────────────────────

function blankForm() {
  return {
    name: '',
    description: '',
    category: 'culture',
    contentType: 'format',
    hashtags: '',
    url: '',
    brandExample: '',
    popularityScore: 7,
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

const COUNTRIES: { code: string; flag: string; name: string }[] = [
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

export default function CultureRadarPage() {
  const [view, setView] = useState<View>('daily')
  const [category, setCategory] = useState<string>('')
  const [country, setCountry] = useState<string>('')
  const [trends, setTrends] = useState<CultureTrend[]>([])
  const [sources, setSources] = useState<CultureSource[]>([])
  const [week, setWeek] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshStage, setRefreshStage] = useState<string | null>(null)
  const [refreshResult, setRefreshResult] = useState<FetchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(false)

  // Submit modal
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(blankForm())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<SubmitResponse | null>(null)

  const loadTrends = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ view })
      if (category) params.set('category', category)
      if (country) params.set('country', country)
      const res = await apiFetch(`/api/culture/trends?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: TrendsResponse = await res.json()
      setTrends(data.trends)
      setWeek(data.week)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [view, category, country])

  const loadSources = useCallback(async () => {
    try {
      const res = await apiFetch('/api/culture/sources')
      if (!res.ok) return
      const data: SourcesResponse = await res.json()
      setSources(data.sources)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadTrends()
  }, [loadTrends])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  const runFetch = async (lookbackDays: number, label: string) => {
    const note =
      lookbackDays > 0
        ? `Run a one-time backfill of the last ${lookbackDays} days? This pulls a wider window from each source and uses more Firecrawl + Gemini credits than a normal refresh.`
        : 'Run a fresh scrape of all sources? This costs Firecrawl + Gemini credits and may take a few minutes.'
    if (!confirm(note)) return
    setRefreshing(true)
    setRefreshResult(null)
    setError(null)
    setRefreshStage('Scraping sources + extracting trends…')
    try {
      const res = await apiFetch('/api/culture/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggeredBy: label, lookbackDays }),
      })
      const data: FetchResponse = await res.json()
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
      setRefreshResult(data)
      await loadTrends()
      await loadSources()

      // ── Auto-chain: generate Action briefs for new top trends ────────────
      // We do this in two batches of 15 (with rate-limit cooldowns between)
      // because Gemini occasionally rate-limits on bursts.
      if (data.summary.inserted > 0 || data.summary.updated > 0) {
        setRefreshStage('Generating Action briefs…')
        let totalBriefed = 0
        for (let pass = 0; pass < 2; pass++) {
          try {
            const briefRes = await apiFetch('/api/culture/backfill-briefs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ limit: 15 }),
            })
            if (briefRes.ok) {
              const briefData = (await briefRes.json()) as {
                briefed: number
                failed: number
                processed: number
              }
              totalBriefed += briefData.briefed
              if (briefData.processed === 0) break // nothing left
            }
          } catch {
            /* best-effort */
          }
        }
        setRefreshStage(`Generated ${totalBriefed} Action briefs. Verifying URLs…`)

        // Verify TikTok / IG / YouTube URLs and drop hallucinations
        try {
          await apiFetch('/api/culture/verify-urls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 30 }),
          })
        } catch {
          /* best-effort */
        }

        // Generate context mindmaps for top trends
        setRefreshStage('Building context mindmaps…')
        try {
          await apiFetch('/api/culture/enrich-mindmaps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 10 }),
          })
        } catch {
          /* best-effort */
        }

        setRefreshStage(`Done. ${totalBriefed} briefs + URLs + mindmaps ready.`)
        await loadTrends()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
      // Clear stage text after a moment
      setTimeout(() => setRefreshStage(null), 4000)
    }
  }

  const handleRefresh = () => runFetch(0, 'manual-ui')

  const openModal = () => {
    setForm(blankForm())
    setSubmitError(null)
    setSubmitSuccess(null)
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setSubmitError(null)
    setSubmitSuccess(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(null)
    try {
      const res = await apiFetch('/api/culture/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          hashtags: form.hashtags
            ? form.hashtags
                .split(',')
                .map((h) => h.trim())
                .filter(Boolean)
            : [],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setSubmitSuccess(data as SubmitResponse)
      await loadTrends()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const stats = useMemo(() => {
    const activeSources = sources.filter((s) => s.active).length
    const okSources = sources.filter((s) => s.lastScrapeStatus === 'ok').length
    const multiSource = trends.filter((t) => t.validationScore >= 2).length
    return { activeSources, okSources, multiSource }
  }, [sources, trends])

  const manualTrends = useMemo(
    () => trends.filter((t) => t.sourceNames.includes('Spotted in the Wild')),
    [trends],
  )

  return (
    <div className="jai-app" style={{ minHeight: '100vh' }}>
      {/* ── JackandAI hero header ── */}
      <div style={{ background: '#000', color: '#FFFDF3', padding: '40px 40px 28px', paddingRight: 240 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p className="jai-mono-label" style={{ color: '#FF1300', margin: 0 }}>JACK&amp;A! × ACTION</p>
            <h1 style={{
              fontFamily: 'var(--font-jai-display)',
              fontSize: 56,
              lineHeight: 0.92,
              margin: '12px 0 4px 0',
              color: '#FFFDF3',
              textTransform: 'uppercase',
              letterSpacing: '-0.025em',
            }}>
              Culture<br/>Radar<span style={{ color: '#FF1300' }}>.</span>
            </h1>
            <p style={{ margin: '8px 0 0 0', fontSize: 13, color: '#FFFDF3', opacity: 0.7 }}>
              {stats.activeSources} sources · week {week || '—'} · {trends.length} active trends
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={openModal} className="jai-btn jai-btn-outline" style={{ borderColor: '#FFFDF3', color: '#FFFDF3' }}>
              + Report trend
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="jai-btn jai-btn-red"
              style={{ opacity: refreshing ? 0.6 : 1 }}
            >
              {refreshing ? (refreshStage ?? 'Working…') : '↻ Refresh from sources'}
            </button>
          </div>
        </div>
      </div>
      {/* Red accent strip */}
      <div style={{ height: 6, background: '#FF1300' }} />

      {/* ── Body ── */}
      <div className="px-8 py-6 space-y-6">
        {error && (
          <div className="border border-red-200 bg-red-50 text-red-800 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {refreshResult && (
          <div className="border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm rounded-lg px-4 py-3">
            Run {refreshResult.status}. Sources: {refreshResult.summary.sourcesOk}/
            {refreshResult.summary.sourcesAttempted} ok.{' '}
            {refreshResult.summary.inserted} new trends, {refreshResult.summary.updated} updated.
            {refreshResult.failures.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs underline">
                  {refreshResult.failures.length} source failures
                </summary>
                <ul className="mt-1 text-xs space-y-0.5">
                  {refreshResult.failures.map((f) => (
                    <li key={f.source}>
                      <strong>{f.source}:</strong> {f.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <StatCard label="Trends this week" value={trends.length} />
          <StatCard
            label="Multi-source validated"
            value={stats.multiSource}
            hint="2+ sources confirmed"
          />
          <StatCard label="Active sources" value={stats.activeSources} />
          <StatCard
            label="Spotted in the wild"
            value={manualTrends.length}
            hint="Manually reported"
          />
        </div>

        {/* View tabs */}
        <div className="flex items-center justify-between">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 flex-wrap">
            {(['daily', 'weekly', 'inspiration', 'emerging', 'all'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-3 py-1.5 text-sm rounded-md transition-all"
                style={{
                  fontFamily: 'var(--font-body)',
                  backgroundColor:
                    view === v
                      ? v === 'emerging'
                        ? '#7c3aed'
                        : v === 'inspiration'
                          ? '#0891b2'
                          : 'var(--action-red)'
                      : 'transparent',
                  color: view === v ? '#ffffff' : '#4a4f5c',
                  fontWeight: view === v ? 600 : 500,
                }}
                title={
                  v === 'emerging'
                    ? 'Rising trends — low popularity but very fresh'
                    : v === 'inspiration'
                      ? 'Format-led inspiration — ways to MAKE content (editing tricks, video formats, visual signatures)'
                      : undefined
                }
              >
                {v === 'daily'
                  ? 'Today (Top 10)'
                  : v === 'weekly'
                    ? 'This week (Top 50)'
                    : v === 'inspiration'
                      ? '💡 Inspiration'
                      : v === 'emerging'
                        ? '✨ Emerging'
                        : 'All'}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowSources((s) => !s)}
            className="text-sm underline text-gray-600"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {showSources ? 'Hide' : 'Show'} sources
          </button>
        </div>

        {/* Country filter */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCountry('')}
            className="px-2.5 py-1 text-[11px] rounded-full border transition-all"
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
              className="px-2.5 py-1 text-[11px] rounded-full border transition-all"
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
              key={c.value}
              onClick={() => setCategory(c.value)}
              className="px-3 py-1.5 text-xs rounded-full border transition-all"
              style={{
                fontFamily: 'var(--font-body)',
                borderColor: category === c.value ? 'var(--action-red)' : '#e5e7eb',
                color: category === c.value ? 'var(--action-red)' : '#4a4f5c',
                backgroundColor: category === c.value ? '#fef2f2' : '#ffffff',
                fontWeight: category === c.value ? 600 : 500,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Trends list */}
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <p className="jai-mono-label" style={{ color: '#FF1300', margin: 0 }}>Loading…</p>
            <p className="jai-serif" style={{ margin: '8px 0 0 0', fontSize: 18 }}>Pulling fresh signals from the culture firehose.</p>
          </div>
        ) : trends.length === 0 ? (
          <div className="jai-card" style={{ padding: 48, textAlign: 'center', background: '#FAF6E6' }}>
            <p className="jai-mono-label" style={{ color: '#FF1300', margin: 0 }}>Empty state</p>
            <p style={{ fontFamily: 'var(--font-jai-display)', fontSize: 28, margin: '12px 0 8px 0', textTransform: 'uppercase', color: '#000' }}>
              No trends yet.<span style={{ color: '#FF1300' }}>.</span>
            </p>
            <p style={{ fontSize: 14, color: '#6b6b6b', margin: 0 }}>
              Hit <strong>Refresh from sources</strong> for the first scrape, or <strong>Report trend</strong> to add manually.
            </p>
          </div>
        ) : (() => {
          // Render with hierarchy for Daily view: hero (#1), featured (#2-3), compact (#4+)
          // Other views render compact for everything.
          const showHierarchy = view === 'daily'
          if (!showHierarchy) {
            return (
              <div>{trends.map((t) => <CompactTrend key={t.id} trend={t} />)}</div>
            )
          }
          const hero = trends.find((t) => t.dailyRank === 1)
          const featured = trends.filter((t) => t.dailyRank === 2 || t.dailyRank === 3)
          const rest = trends.filter((t) => (t.dailyRank ?? 999) > 3)
          return (
            <>
              {hero && <HeroTrend trend={hero} />}
              {featured.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 }}>
                  {featured.map((t) => <FeaturedTrend key={t.id} trend={t} />)}
                </div>
              )}
              <div>{rest.map((t) => <CompactTrend key={t.id} trend={t} />)}</div>
            </>
          )
        })()}

        {showSources && <SourceTable sources={sources} />}
      </div>

      {/* ── Submit modal ── */}
      {showModal && (
        <SubmitModal
          form={form}
          setForm={setForm}
          submitting={submitting}
          submitError={submitError}
          submitSuccess={submitSuccess}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

// ── SubmitModal ────────────────────────────────────────────────────────────

interface FormState {
  name: string
  description: string
  category: string
  contentType: string
  hashtags: string
  url: string
  brandExample: string
  popularityScore: number
}

function SubmitModal({
  form,
  setForm,
  submitting,
  submitError,
  submitSuccess,
  onSubmit,
  onClose,
}: {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  submitting: boolean
  submitError: string | null
  submitSuccess: SubmitResponse | null
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
}) {
  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 pb-8 px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2
              className="text-base font-bold text-gray-900"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Report a trend
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Spotted something at a brand, event, or in the wild? Add it here.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors text-xl leading-none ml-4"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Success state */}
        {submitSuccess ? (
          <div className="px-6 py-8 text-center">
            <div
              className="text-3xl mb-3"
              role="img"
              aria-label="success"
            >
              ✓
            </div>
            <p className="text-sm font-medium text-gray-900">
              Trend {submitSuccess.action} successfully.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Slug: <code className="font-mono">{submitSuccess.slug}</code> · Week{' '}
              {submitSuccess.week}
            </p>
            <div className="flex gap-2 justify-center mt-6">
              <button
                onClick={() => {
                  setForm(blankForm())
                  // Reset success to allow another submission
                  const syntheticReset = { target: { value: '' } } as React.ChangeEvent<HTMLInputElement>
                  void syntheticReset
                  // We'll just close and let parent reset
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700"
              >
                Add another
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--action-red)' }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* Form */
          <form onSubmit={onSubmit} className="px-6 py-5 space-y-4">
            {submitError && (
              <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg px-3 py-2">
                {submitError}
              </div>
            )}

            {/* Name */}
            <div>
              <label className={labelClass}>
                Trend name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={set('name')}
                required
                placeholder='e.g. "Crying in The Yacht" or "CE2026 meme format"'
                className={inputClass}
              />
            </div>

            {/* Category + content type row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.category}
                  onChange={set('category')}
                  required
                  className={inputClass}
                >
                  {SUBMIT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Content type</label>
                <select
                  value={form.contentType}
                  onChange={set('contentType')}
                  className={inputClass}
                >
                  {CONTENT_TYPES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className={labelClass}>
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={form.description}
                onChange={set('description')}
                required
                rows={3}
                placeholder="What is this trend? Why is it relevant right now? What did you observe?"
                className={`${inputClass} resize-none`}
              />
            </div>

            {/* Brand example */}
            <div>
              <label className={labelClass}>Brand / account where you spotted it</label>
              <input
                type="text"
                value={form.brandExample}
                onChange={set('brandExample')}
                placeholder='e.g. "NS Online" or "IKEA Nederland"'
                className={inputClass}
              />
            </div>

            {/* URL */}
            <div>
              <label className={labelClass}>Reference URL</label>
              <input
                type="url"
                value={form.url}
                onChange={set('url')}
                placeholder="https://instagram.com/p/..."
                className={inputClass}
              />
            </div>

            {/* Hashtags */}
            <div>
              <label className={labelClass}>Hashtags (comma-separated)</label>
              <input
                type="text"
                value={form.hashtags}
                onChange={set('hashtags')}
                placeholder="#CE2026, #NS, #examenmemes"
                className={inputClass}
              />
            </div>

            {/* Popularity */}
            <div>
              <label className={labelClass}>
                How big is this? {form.popularityScore}/10
              </label>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={form.popularityScore}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    popularityScore: Number(e.target.value),
                  }))
                }
                className="w-full accent-[var(--action-red)]"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>Niche</span>
                <span>Viral</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--action-red)', fontFamily: 'var(--font-body)' }}
              >
                {submitting ? 'Saving…' : 'Add trend'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Shared style strings ───────────────────────────────────────────────────

const labelClass =
  'block text-xs font-medium text-gray-700 mb-1' as const

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 bg-white' as const

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: number | string
  hint?: string
}) {
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

function TrendRow({ trend, view }: { trend: CultureTrend; view: View }) {
  const rank =
    view === 'daily' ? trend.dailyRank : view === 'weekly' ? trend.weeklyRank : null
  const isManual = trend.sourceNames.includes('Spotted in the Wild')
  const brief = trend.brandBrief
  const cat = styleFor(trend.category)
  const lc = brief?.lifecycleStage ? LIFECYCLE_VISUAL[brief.lifecycleStage] : null

  const [feedbackState, setFeedbackState] = useState<'idle' | 'useful' | 'generic' | 'archived'>('idle')
  const [mindmapOpen, setMindmapOpen] = useState(false)

  const sendFeedback = async (action: 'useful' | 'generic' | 'archive') => {
    setFeedbackState(action === 'archive' ? 'archived' : action)
    try {
      await apiFetch('/api/culture/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trendId: trend.id, action }),
      })
    } catch {
      /* fire and forget */
    }
  }

  if (feedbackState === 'archived') {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          <span className="line-through">{trend.name}</span> · archived
        </p>
        <button
          onClick={() => setFeedbackState('idle')}
          className="text-xs text-gray-400 underline"
        >
          undo
        </button>
      </div>
    )
  }

  return (
    <div
      className="bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow border"
      style={{ borderColor: '#e5e7eb', borderLeftWidth: 5, borderLeftColor: cat.accent }}
    >
      {/* Main card: thumbnail / icon on left, content on right */}
      <div className="flex gap-4">
        {/* Visual block — thumbnail OR category emoji */}
        <div
          className="flex-shrink-0 relative flex items-center justify-center"
          style={{
            width: 140,
            minHeight: 140,
            backgroundColor: cat.bg,
            backgroundImage: trend.thumbnailUrl
              ? `url(${trend.thumbnailUrl})`
              : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {!trend.thumbnailUrl && (
            <span className="text-5xl select-none">{cat.emoji}</span>
          )}
          {rank !== null && (
            <div
              className="absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md"
              style={{ backgroundColor: 'var(--action-red)', fontFamily: 'var(--font-display)' }}
            >
              {rank}
            </div>
          )}
          {trend.thumbnailMeta?.authorName && (
            <div
              className="absolute bottom-1 left-1 right-1 text-[10px] text-white font-medium truncate px-1 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
            >
              {trend.thumbnailMeta.authorName}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 px-4 py-3">
          {/* Header row: title + lifecycle */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3
                className="text-base font-bold text-gray-900 leading-tight"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {trend.name}
              </h3>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span
                  className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: cat.bg, color: cat.fg, border: `1px solid ${cat.border}` }}
                >
                  {cat.emoji} {trend.category}
                </span>
                {isManual && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}
                  >
                    spotted
                  </span>
                )}
                {(trend.countryRelevance ?? []).slice(0, 4).map((c) => (
                  <span
                    key={c}
                    className="text-[10px] px-1 py-0.5 rounded font-medium"
                    style={{ backgroundColor: '#f3f4f6', color: '#4a4f5c' }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
            {/* Lifecycle progress bar */}
            {lc && (
              <div className="flex-shrink-0 w-24">
                <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5 text-right" style={{ color: lc.color }}>
                  {lc.label}
                </p>
                <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: '#f3f4f6' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${lc.progress}%`, backgroundColor: lc.color }}
                  />
                </div>
                {brief?.urgency != null && (
                  <p className="text-[9px] mt-0.5 text-right text-gray-500">
                    urgency {brief.urgency}/10
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Description */}
          <p className="text-sm text-gray-700 mt-2 leading-snug">{trend.description}</p>

          {/* Hashtags */}
          {trend.hashtags.length > 0 && (
            <p className="text-xs text-gray-500 mt-1.5">
              {trend.hashtags.slice(0, 6).join(' ')}
            </p>
          )}

          {/* Source + estimated views + when added */}
          <p className="text-[11px] text-gray-400 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {trend.sourceNames.length > 0 && (
              <span>{trend.sourceNames.slice(0, 2).join(', ')}</span>
            )}
            {trend.estimatedViews && (
              <>
                <span className="text-gray-300">·</span>
                <span>{trend.estimatedViews}</span>
              </>
            )}
            {trend.firstSeenAt && (
              <>
                <span className="text-gray-300">·</span>
                <span title={new Date(trend.firstSeenAt).toLocaleString('nl-NL')}>
                  📅 {formatRelativeDate(trend.firstSeenAt)}
                </span>
              </>
            )}
          </p>

          {/* URL chips */}
          {trend.exampleUrls.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {sortExampleUrls(trend.exampleUrls)
                .slice(0, 5)
                .map((url, i) => (
                  <ExampleLink key={`${url}-${i}`} url={url} />
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Action brief — shown when available */}
      {brief && (
        <div
          className="border-t px-5 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3"
          style={{ backgroundColor: '#fafafa', borderColor: '#f0f0f0' }}
        >
          {/* Relevance + why now */}
          <div className="sm:col-span-2 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400" style={{ fontFamily: 'var(--font-display)' }}>
              Voor Action
            </p>
            <p className="text-sm text-gray-800">{brief.actionRelevance}</p>
            {brief.whyNow && (
              <p className="text-xs text-gray-500 italic">{brief.whyNow}</p>
            )}
          </div>

          {/* Content angle + sound + products */}
          <div className="space-y-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5" style={{ fontFamily: 'var(--font-display)' }}>
                Content aanpak
              </p>
              <p className="text-xs text-gray-700">{brief.contentAngle}</p>
            </div>
            {brief.suggestedSound && (() => {
              const risk = brief.soundRisk
              const riskColor =
                risk === 'safe'
                  ? { bg: '#ecfdf5', text: '#047857', icon: '✓' }
                  : risk === 'risky'
                    ? { bg: '#fef2f2', text: '#b91c1c', icon: '⚠' }
                    : { bg: '#fefce8', text: '#a16207', icon: '?' }
              const riskLabel =
                risk === 'safe' ? 'safe' : risk === 'risky' ? 'risky' : 'check'
              return (
                <div className="space-y-1">
                  <div className="flex items-start gap-1.5 text-xs">
                    <span style={{ color: '#7c3aed' }}>♪</span>
                    <p className="text-gray-700 flex-1">
                      <span className="font-semibold text-gray-800">Sound:</span> {brief.suggestedSound}
                    </p>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: riskColor.bg, color: riskColor.text }}
                      title={brief.soundWarning ?? ''}
                    >
                      {riskColor.icon} {riskLabel}
                    </span>
                  </div>
                  {brief.soundWarning && risk !== 'safe' && (
                    <p
                      className="text-[11px] leading-snug px-2 py-1 rounded"
                      style={{ backgroundColor: riskColor.bg, color: riskColor.text }}
                    >
                      {brief.soundWarning}
                    </p>
                  )}
                </div>
              )
            })()}
            {brief.productCategories?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {brief.productCategories.map((cat) => (
                  <span
                    key={cat}
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: '#fef2f2', color: 'var(--action-red)', border: '1px solid #fecaca' }}
                  >
                    {cat}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mindmap (collapsible) */}
      {trend.mindmap && (
        <div
          className="border-t"
          style={{ borderColor: '#f0f0f0', backgroundColor: '#ffffff' }}
        >
          <button
            onClick={() => setMindmapOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs hover:bg-gray-50 transition-colors"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            <span className="font-semibold text-gray-700">
              🧠 Context &amp; connections
            </span>
            <span className="text-gray-400">{mindmapOpen ? '▾' : '▸'}</span>
          </button>
          {mindmapOpen && (
            <MindmapView mindmap={trend.mindmap} />
          )}
        </div>
      )}

      {/* Feedback bar */}
      <div
        className="border-t flex items-center justify-between px-4 py-2"
        style={{ borderColor: '#f0f0f0', backgroundColor: '#fcfcfd' }}
      >
        <div className="flex items-center gap-1 text-[11px] text-gray-400">
          {trend.feedbackUseful > 0 && (
            <span className="text-emerald-700">👍 {trend.feedbackUseful}</span>
          )}
          {trend.feedbackGeneric > 0 && (
            <span className="text-amber-700 ml-2">👎 {trend.feedbackGeneric}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <FeedbackButton
            label="👍 Useful"
            active={feedbackState === 'useful'}
            color="#047857"
            onClick={() => sendFeedback('useful')}
          />
          <FeedbackButton
            label="👎 Too generic"
            active={feedbackState === 'generic'}
            color="#92400e"
            onClick={() => sendFeedback('generic')}
          />
          <FeedbackButton
            label="🚫 Archive"
            active={false}
            color="#b91c1c"
            onClick={() => sendFeedback('archive')}
          />
        </div>
      </div>
    </div>
  )
}

interface MindmapData {
  origin: Array<{ label: string; detail?: string; url?: string }>
  spreading: Array<{ label: string; detail?: string; url?: string }>
  adjacent: Array<{ label: string; detail?: string; url?: string }>
  variations: Array<{ label: string; detail?: string; url?: string }>
  searches: Array<{ label: string; detail?: string; url?: string }>
  brandPlays: Array<{ label: string; detail?: string; url?: string }>
}

function MindmapView({ mindmap }: { mindmap: MindmapData }) {
  const sections: Array<{ key: keyof MindmapData; label: string; emoji: string; color: string }> = [
    { key: 'origin',     label: 'Origin',          emoji: '🌱', color: '#065f46' },
    { key: 'spreading',  label: 'Spreading via',   emoji: '📡', color: '#1e40af' },
    { key: 'adjacent',   label: 'Adjacent',        emoji: '🔗', color: '#7c3aed' },
    { key: 'variations', label: 'Variations',      emoji: '🌀', color: '#c2410c' },
    { key: 'searches',   label: 'People search',   emoji: '🔍', color: '#0891b2' },
    { key: 'brandPlays', label: 'Brand plays',     emoji: '💼', color: '#b91c1c' },
  ]

  return (
    <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ backgroundColor: '#fafafa' }}>
      {sections.map((s) => {
        const items = mindmap[s.key] ?? []
        if (items.length === 0) return null
        return (
          <div key={s.key} className="rounded-lg bg-white p-3" style={{ borderLeft: `3px solid ${s.color}` }}>
            <p
              className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
              style={{ color: s.color, fontFamily: 'var(--font-display)' }}
            >
              {s.emoji} {s.label}
            </p>
            <ul className="space-y-1">
              {items.slice(0, 5).map((it, i) => (
                <li key={i} className="text-[11px] text-gray-700 leading-snug">
                  <span className="font-medium">{it.label}</span>
                  {it.detail && (
                    <span className="text-gray-500"> — {it.detail}</span>
                  )}
                  {it.url && (
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 text-blue-500 hover:underline"
                    >
                      ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

/**
 * "Added X ago" formatter for the trend row.
 * Returns "today", "yesterday", "3 days ago", "2 weeks ago", or "12 May".
 */
function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays < 0) return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / 3_600_000)
    if (diffHours < 1) {
      const diffMin = Math.floor(diffMs / 60_000)
      return diffMin <= 1 ? 'just now' : `${diffMin}m ago`
    }
    return diffHours === 1 ? '1h ago' : `${diffHours}h ago`
  }
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 28) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function FeedbackButton({
  label,
  active,
  color,
  onClick,
}: {
  label: string
  active: boolean
  color: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] px-2 py-1 rounded-md transition-all hover:bg-gray-100"
      style={{
        color: active ? color : '#6b7280',
        fontWeight: active ? 600 : 400,
        backgroundColor: active ? '#f9fafb' : 'transparent',
      }}
    >
      {label}
    </button>
  )
}

/**
 * Classify a URL into a known platform and return display metadata.
 * Direct video platforms get distinct colours so the team can spot them
 * at a glance — those are the "watch the trend" links.
 */
function classifyUrl(url: string): {
  platform: string
  label: string
  bg: string
  fg: string
  border: string
  priority: number
} {
  const lower = url.toLowerCase()
  if (lower.includes('tiktok.com')) {
    return {
      platform: 'tiktok',
      label: '▶ TikTok',
      bg: '#000000',
      fg: '#ffffff',
      border: '#000000',
      priority: 1,
    }
  }
  if (lower.includes('instagram.com')) {
    return {
      platform: 'instagram',
      label: '◯ Reel',
      bg: 'linear-gradient(135deg, #fce4ec 0%, #ffe0b2 100%)',
      fg: '#c2185b',
      border: '#f8bbd0',
      priority: 2,
    }
  }
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return {
      platform: 'youtube',
      label: '▶ YouTube',
      bg: '#fef2f2',
      fg: '#b91c1c',
      border: '#fecaca',
      priority: 3,
    }
  }
  if (lower.includes('reddit.com')) {
    return {
      platform: 'reddit',
      label: 'Reddit',
      bg: '#fff7ed',
      fg: '#c2410c',
      border: '#fed7aa',
      priority: 5,
    }
  }
  if (lower.includes('pinterest.com')) {
    return {
      platform: 'pinterest',
      label: 'Pinterest',
      bg: '#fef2f2',
      fg: '#b91c1c',
      border: '#fecaca',
      priority: 4,
    }
  }
  return {
    platform: 'article',
    label: 'Article',
    bg: '#f3f4f6',
    fg: '#4a4f5c',
    border: '#e5e7eb',
    priority: 9,
  }
}

/** Sort example URLs by platform priority — video platforms first. */
function sortExampleUrls(urls: string[]): string[] {
  return [...urls].sort((a, b) => classifyUrl(a).priority - classifyUrl(b).priority)
}

function ExampleLink({ url }: { url: string }) {
  const c = classifyUrl(url)
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-[11px] px-2 py-0.5 rounded font-medium hover:opacity-80 transition-opacity inline-block"
      style={{
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
      }}
      title={url}
    >
      {c.label}
    </a>
  )
}

function CategoryPill({ category }: { category: string }) {
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: '#f3f4f6', color: '#4a4f5c', fontFamily: 'var(--font-body)' }}
    >
      {category}
    </span>
  )
}

function ScoreBadge({ label, value }: { label: string; value: number }) {
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-mono"
      style={{ backgroundColor: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb' }}
    >
      {label} {value.toFixed(1)}
    </span>
  )
}

function SourceTable({ sources }: { sources: CultureSource[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200">
        <h2
          className="text-sm font-semibold text-gray-900"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Sources ({sources.length})
        </h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="text-left px-5 py-2">Name</th>
            <th className="text-left px-5 py-2">Category</th>
            <th className="text-left px-5 py-2">Type</th>
            <th className="text-left px-5 py-2">Reliability</th>
            <th className="text-left px-5 py-2">Last run</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} className="border-t border-gray-100">
              <td className="px-5 py-2">
                <a
                  href={s.url.startsWith('internal://') ? undefined : s.url}
                  target={s.url.startsWith('internal://') ? undefined : '_blank'}
                  rel="noreferrer"
                  className={s.url.startsWith('internal://') ? 'text-gray-900' : 'text-gray-900 hover:underline'}
                >
                  {s.name}
                </a>
              </td>
              <td className="px-5 py-2 text-gray-600">{s.category}</td>
              <td className="px-5 py-2 text-gray-600">{s.sourceType}</td>
              <td className="px-5 py-2 text-gray-600">{'★'.repeat(s.reliability)}</td>
              <td className="px-5 py-2 text-xs">
                {s.lastScrapeStatus === 'ok' ? (
                  <span className="text-emerald-700">ok</span>
                ) : s.lastScrapeStatus === 'error' ? (
                  <span className="text-red-700" title={s.lastScrapeError ?? ''}>
                    error
                  </span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}{' '}
                <span className="text-gray-400">
                  {s.lastScrapedAt ? new Date(s.lastScrapedAt).toLocaleString() : 'never'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
