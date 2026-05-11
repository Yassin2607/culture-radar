'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { CultureSource, CultureTrend } from '@/types/culture'

type View = 'daily' | 'weekly' | 'all' | 'emerging'

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

export default function CultureRadarPage() {
  const [view, setView] = useState<View>('daily')
  const [category, setCategory] = useState<string>('')
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
  }, [view, category])

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
        setRefreshStage(`Generated ${totalBriefed} Action briefs.`)
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
  const handleBackfill = () => runFetch(7, 'backfill-7d-ui')

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
    <div className="min-h-screen">
      {/* ── Header ── */}
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
              Culture Radar
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Real-time cultural trends across {stats.activeSources} curated sources. Week{' '}
              {week || '—'}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Report trend button */}
            <button
              onClick={openModal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all border"
              style={{
                fontFamily: 'var(--font-body)',
                borderColor: '#6b7280',
                color: '#374151',
                backgroundColor: '#ffffff',
              }}
              title="Spotted a trend in the wild? Add it manually."
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7 1v12M1 7h12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              Report trend
            </button>

            <button
              onClick={handleBackfill}
              disabled={refreshing}
              title="One-time backfill — pulls trends from the last 7 days. Higher credit cost."
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 border"
              style={{
                fontFamily: 'var(--font-body)',
                borderColor: 'var(--action-red)',
                color: 'var(--action-red)',
                backgroundColor: '#ffffff',
              }}
            >
              {refreshing ? '…' : 'Backfill 7d'}
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{
                fontFamily: 'var(--font-body)',
                backgroundColor: 'var(--action-red)',
                color: '#ffffff',
              }}
              title="Scrapes all sources + auto-generates Action briefs for top trends"
            >
              {refreshing ? (refreshStage ?? 'Working…') : 'Refresh from sources'}
            </button>
          </div>
        </div>
      </div>

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
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
            {(['daily', 'weekly', 'emerging', 'all'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-4 py-1.5 text-sm rounded-md transition-all"
                style={{
                  fontFamily: 'var(--font-body)',
                  backgroundColor:
                    view === v
                      ? v === 'emerging'
                        ? '#7c3aed'
                        : 'var(--action-red)'
                      : 'transparent',
                  color: view === v ? '#ffffff' : '#4a4f5c',
                  fontWeight: view === v ? 600 : 500,
                }}
                title={v === 'emerging' ? 'Rising trends — low popularity but very fresh' : undefined}
              >
                {v === 'daily'
                  ? 'Today (Top 10)'
                  : v === 'weekly'
                    ? 'This week (Top 50)'
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
          <p className="text-sm text-gray-500">Loading trends…</p>
        ) : trends.length === 0 ? (
          <div className="border border-dashed border-gray-300 bg-white rounded-lg px-6 py-12 text-center">
            <p className="text-sm text-gray-600">
              No trends yet for {week || 'this week'}. Click{' '}
              <strong>Refresh from sources</strong> to run the first scrape, or{' '}
              <strong>Report trend</strong> to add one manually.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {trends.map((t) => (
              <TrendRow key={t.id} trend={t} view={view} />
            ))}
          </div>
        )}

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

const LIFECYCLE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  emerging:   { label: 'Emerging',   color: '#065f46', bg: '#d1fae5' },
  growing:    { label: 'Growing',    color: '#1e40af', bg: '#dbeafe' },
  peak:       { label: 'Peak',       color: '#92400e', bg: '#fef3c7' },
  saturating: { label: 'Saturating', color: '#6b7280', bg: '#f3f4f6' },
}

function TrendRow({ trend, view }: { trend: CultureTrend; view: View }) {
  const rank =
    view === 'daily' ? trend.dailyRank : view === 'weekly' ? trend.weeklyRank : null
  const isManual = trend.sourceNames.includes('Spotted in the Wild')
  const brief = trend.brandBrief

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* Main row */}
      <div className="px-5 py-4 flex gap-4 items-start">
        {rank !== null && (
          <div
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: 'var(--action-red)', fontFamily: 'var(--font-display)' }}
          >
            {rank}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className="text-base font-semibold text-gray-900"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {trend.name}
            </h3>
            <CategoryPill category={trend.category} />
            {isManual && (
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}
              >
                spotted
              </span>
            )}
            {trend.validationScore >= 2 && (
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#ecfdf5', color: '#047857' }}
              >
                {trend.validationScore} sources
              </span>
            )}
            {brief?.lifecycleStage && (() => {
              const lc = LIFECYCLE_LABELS[brief.lifecycleStage]
              return lc ? (
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: lc.bg, color: lc.color }}
                >
                  {lc.label}
                </span>
              ) : null
            })()}
            <ScoreBadge label="pop" value={trend.popularityScore} />
            <ScoreBadge label="fresh" value={trend.freshnessScore} />
            {brief?.urgency != null && (
              <ScoreBadge label="urgency" value={brief.urgency} />
            )}
          </div>
          <p className="text-sm text-gray-700 mt-1">{trend.description}</p>
          {trend.hashtags.length > 0 && (
            <p className="text-xs text-gray-500 mt-1.5">{trend.hashtags.slice(0, 8).join(' ')}</p>
          )}
          <div className="flex items-center gap-3 mt-1">
            {trend.sourceNames.length > 0 && (
              <p className="text-xs text-gray-400">
                {trend.sourceNames.join(', ')}
                {trend.estimatedViews ? ` · ${trend.estimatedViews}` : ''}
              </p>
            )}
            {trend.exampleUrls.length > 0 && (
              <a
                href={trend.exampleUrls[0]}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-500 hover:underline"
              >
                View reference
              </a>
            )}
          </div>
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
    </div>
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
