'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { CultureSource, CultureTrend } from '@/types/culture'
import { styleFor, LIFECYCLE_VISUAL } from './category-style'
import { CompactTrend } from './trend-cards'

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
  const [vibe, setVibe] = useState<string>('')
  const [subculture, setSubculture] = useState<string>('')
  const [minGrowth, setMinGrowth] = useState<number>(0)
  const [search, setSearch] = useState<string>('')
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
      if (vibe) params.set('vibe', vibe)
      if (subculture) params.set('subculture', subculture)
      if (minGrowth > 0) params.set('minGrowth', String(minGrowth))
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
  }, [view, category, country, vibe, subculture, minGrowth])

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

  // Free-text filter (name, hashtags, sourceNames, brief.contentAngle)
  const filteredTrends = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return trends
    return trends.filter((t) => {
      if (t.name.toLowerCase().includes(q)) return true
      if (t.description.toLowerCase().includes(q)) return true
      if (t.hashtags.some((h) => h.toLowerCase().includes(q))) return true
      if (t.sourceNames.some((n) => n.toLowerCase().includes(q))) return true
      if (t.brandBrief?.contentAngle.toLowerCase().includes(q)) return true
      return false
    })
  }, [trends, search])

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
            <div style={{ marginTop: 14, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <HeaderStat label="Week" value={week || '—'} />
              <HeaderStat label="Active trends" value={trends.length} />
              <HeaderStat label="Multi-source" value={stats.multiSource} hint={`${Math.round((stats.multiSource / Math.max(trends.length, 1)) * 100)}%`} />
              <HeaderStat label="Sources" value={`${stats.okSources}/${stats.activeSources}`} />
              <HeaderStat label="Spotted manually" value={manualTrends.length} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <a
              href="/culture-radar/report"
              target="_blank"
              rel="noreferrer"
              className="jai-btn jai-btn-outline"
              style={{ borderColor: '#FFFDF3', color: '#FFFDF3', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              📰 Today&apos;s magazine →
            </a>
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

        {/* Sticky filter bar */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            background: '#FFFDF3',
            margin: '0 -32px',
            padding: '12px 32px',
            borderBottom: '1px solid #00000015',
            boxShadow: '0 2px 8px #00000008',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Unified red tabs */}
            <div style={{ display: 'inline-flex', border: '1px solid #00000020', background: '#FFFDF3' }}>
              {(['daily', 'weekly', 'inspiration', 'emerging', 'all'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  title={
                    v === 'emerging'
                      ? 'Rising trends — low popularity but very fresh'
                      : v === 'inspiration'
                        ? 'Format-led inspiration — ways to MAKE content'
                        : undefined
                  }
                  style={{
                    fontFamily: 'var(--font-jai-display)',
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    padding: '8px 14px',
                    textTransform: 'uppercase',
                    background: view === v ? '#000' : 'transparent',
                    color: view === v ? '#FFFDF3' : '#1a1a1a',
                    border: 'none',
                    cursor: 'pointer',
                    position: 'relative',
                    borderRight: '1px solid #00000010',
                  }}
                >
                  {view === v && (
                    <span style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#FF1300',
                    }} />
                  )}
                  {v === 'daily' ? 'Today' : v === 'weekly' ? 'This week' : v === 'inspiration' ? 'Inspiration' : v === 'emerging' ? 'Emerging' : 'All'}
                </button>
              ))}
            </div>

            {/* Search */}
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200, maxWidth: 360 }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search trends, hashtags, brands…"
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 30px',
                  border: '1px solid #00000020',
                  background: '#FFFDF3',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  color: '#1a1a1a',
                  outline: 'none',
                }}
              />
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b6b6b', fontSize: 14, padding: 4 }}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            {/* Country select */}
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              style={{
                padding: '8px 10px',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                border: '1px solid #00000020',
                background: '#FFFDF3',
                color: '#1a1a1a',
                cursor: 'pointer',
              }}
            >
              <option value="">🇪🇺 All EU</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
              ))}
            </select>

            {/* Category select */}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                padding: '8px 10px',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                border: '1px solid #00000020',
                background: '#FFFDF3',
                color: '#1a1a1a',
                cursor: 'pointer',
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.value === '' ? 'All categories' : c.label}</option>
              ))}
            </select>

            {/* Vibe select — unhinged / aesthetic / humor / etc */}
            <select
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              title="Vibe filter — unhinged covers brainrot, italian brainrot, skibidi, gen alpha slop"
              style={{
                padding: '8px 10px',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                border: vibe ? '1px solid #FF1300' : '1px solid #00000020',
                background: vibe ? '#FFE4E0' : '#FFFDF3',
                color: vibe ? '#FF1300' : '#1a1a1a',
                cursor: 'pointer',
                fontWeight: vibe ? 600 : 400,
              }}
            >
              <option value="">All vibes</option>
              <option value="unhinged">💀 Unhinged / brainrot</option>
              <option value="aesthetic">✨ Aesthetic</option>
              <option value="humor">😂 Humor</option>
              <option value="wholesome">🌱 Wholesome</option>
              <option value="emotional">💔 Emotional</option>
              <option value="informational">📰 Informational</option>
              <option value="product">🛒 Product</option>
              <option value="sport">⚽ Sport</option>
            </select>

            {/* Subculture select */}
            <select
              value={subculture}
              onChange={(e) => setSubculture(e.target.value)}
              title="Subculture — the corner of the internet this trend lives in"
              style={{
                padding: '8px 10px',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                border: subculture ? '1px solid #FF1300' : '1px solid #00000020',
                background: subculture ? '#FFE4E0' : '#FFFDF3',
                color: subculture ? '#FF1300' : '#1a1a1a',
                cursor: 'pointer',
                fontWeight: subculture ? 600 : 400,
              }}
            >
              <option value="">All subcultures</option>
              <optgroup label="Aesthetics">
                <option value="cottagecore">Cottagecore</option>
                <option value="dark_academia">Dark Academia</option>
                <option value="clean_girl">Clean Girl</option>
                <option value="mob_wife">Mob Wife</option>
                <option value="coquette">Coquette</option>
                <option value="balletcore">Balletcore</option>
                <option value="weirdcore">Weirdcore</option>
                <option value="y2k">Y2K</option>
                <option value="alt_fashion">Alt Fashion</option>
                <option value="gorpcore">Gorpcore</option>
                <option value="kidcore">Kidcore</option>
              </optgroup>
              <optgroup label="Internet chaos">
                <option value="italian_brainrot">Italian Brainrot</option>
                <option value="gen_alpha_brainrot">Gen Alpha Brainrot</option>
                <option value="ohio_culture">Ohio Culture</option>
                <option value="ironic_seriousness">Ironic Seriousness</option>
              </optgroup>
              <optgroup label="-Tok verticals">
                <option value="foodtok">FoodTok</option>
                <option value="beautytok">BeautyTok</option>
                <option value="fittok">FitTok</option>
                <option value="hometok">HomeTok</option>
                <option value="booktok">BookTok</option>
                <option value="traveltok">TravelTok</option>
                <option value="gaming_fandom">Gaming</option>
                <option value="kpop_fandom">K-Pop</option>
                <option value="anime_otaku">Anime</option>
                <option value="stan_culture">Stan</option>
              </optgroup>
              <optgroup label="Counter / lifestyle">
                <option value="tradwife">Tradwife</option>
                <option value="that_girl">That Girl</option>
                <option value="sleepmaxxing">Sleepmaxxing</option>
                <option value="lookmax">Lookmaxxing</option>
                <option value="dimes_square">Dimes Square</option>
              </optgroup>
              <optgroup label="Music">
                <option value="hyperpop">Hyperpop</option>
                <option value="indie_sleaze_revival">Indie Sleaze</option>
                <option value="sad_girl_pop">Sad Girl Pop</option>
              </optgroup>
            </select>

            {/* Growth filter */}
            <select
              value={minGrowth}
              onChange={(e) => setMinGrowth(Number(e.target.value))}
              title="Growth potential — predictive score that this trend will grow in the next 14 days"
              style={{
                padding: '8px 10px',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                border: minGrowth > 0 ? '1px solid #FF1300' : '1px solid #00000020',
                background: minGrowth > 0 ? '#FFE4E0' : '#FFFDF3',
                color: minGrowth > 0 ? '#FF1300' : '#1a1a1a',
                cursor: 'pointer',
                fontWeight: minGrowth > 0 ? 600 : 400,
              }}
            >
              <option value={0}>All growth</option>
              <option value={5}>↗ Growing (5+)</option>
              <option value={6.5}>↗ Climbing (6.5+)</option>
              <option value={8}>★ Breakout (8+)</option>
            </select>

            <button
              onClick={() => setShowSources((s) => !s)}
              style={{
                marginLeft: 'auto',
                fontFamily: 'var(--font-jai-display)',
                fontSize: 10,
                letterSpacing: '0.1em',
                color: '#6b6b6b',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {showSources ? 'Hide sources' : 'Show sources'}
            </button>
          </div>
        </div>

        {/* Trends list */}
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <p className="jai-mono-label" style={{ color: '#FF1300', margin: 0 }}>Loading…</p>
            <p className="jai-serif" style={{ margin: '8px 0 0 0', fontSize: 18 }}>Pulling fresh signals from the culture firehose.</p>
          </div>
        ) : filteredTrends.length === 0 ? (
          <div className="jai-card" style={{ padding: 48, textAlign: 'center', background: '#FAF6E6' }}>
            <p className="jai-mono-label" style={{ color: '#FF1300', margin: 0 }}>Empty state</p>
            <p style={{ fontFamily: 'var(--font-jai-display)', fontSize: 28, margin: '12px 0 8px 0', textTransform: 'uppercase', color: '#000' }}>
              {search ? 'No matches.' : 'No trends yet.'}<span style={{ color: '#FF1300' }}>.</span>
            </p>
            <p style={{ fontSize: 14, color: '#6b6b6b', margin: 0 }}>
              {search
                ? <>Try a different search, or <button onClick={() => setSearch('')} style={{ textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: '#FF1300', padding: 0 }}>clear it</button>.</>
                : <>Hit <strong>Refresh from sources</strong> for the first scrape, or <strong>Report trend</strong> to add manually.</>
              }
            </p>
          </div>
        ) : (() => {
          const bundledTrends = bundleTrends(filteredTrends)
          const grouped = groupByCategory(bundledTrends)
          // Per-country pulse — top 3 in each major Action market.
          // Only render when no country filter is active and not searching.
          const showPulse = !country && !search && !vibe && !subculture && minGrowth === 0
          return (
            <div>
              {showPulse && <GoogleTrendsPulse />}
              {showPulse && <CountryPulse trends={bundledTrends} />}
              {showPulse && <BreakoutPulse trends={bundledTrends} />}
              {grouped.map(({ category: cat, items }) => (
                <div key={cat} style={{ marginBottom: 24 }}>
                  <CategoryDivider label={cat} count={items.length} />
                  {items.map((t) => <CompactTrend key={t.id} trend={t} />)}
                </div>
              ))}
            </div>
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
  // Legacy — kept for SourceTable references, not used in new header
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

function HeaderStat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div>
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-jai-display)',
          fontSize: 9,
          letterSpacing: '0.15em',
          color: '#FFFDF3',
          opacity: 0.5,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: '2px 0 0 0',
          fontFamily: 'var(--font-jai-display)',
          fontSize: 22,
          letterSpacing: '-0.02em',
          color: '#FFFDF3',
          lineHeight: 1,
        }}
      >
        {value}
        {hint && <span style={{ fontSize: 11, color: '#FF1300', marginLeft: 6, letterSpacing: 0 }}>{hint}</span>}
      </p>
    </div>
  )
}

const CATEGORY_LABELS: Record<string, string> = {
  food: 'Food',
  beauty: 'Beauty',
  fashion: 'Fashion',
  home: 'Home',
  lifestyle: 'Lifestyle',
  tech: 'Tech',
  meme: 'Meme',
  culture: 'Culture',
  platform: 'Platform',
  sound: 'Sound',
  format: 'Format',
  sport: 'Sport',
}

// ── Google Trends pulse: live multi-country + new-today + rising-fast ─────

interface GtPulseData {
  snapshotDate?: string
  empty?: boolean
  multiCountry: Array<{
    title: string
    countryCount: number
    avgRank: number
    geos: Array<{ geo: string; rank: number }>
    relatedQueries: string[]
    articles: Array<{ title: string; url: string; source: string | null }>
  }>
  newToday: Array<{ title: string; geo: string; rank: number; articles: Array<{ title: string; url: string; source: string | null }> | null }>
  risingFast: Array<{ title: string; geo: string; rankToday: number; rankYesterday: number; delta: number }>
  topByCountry: Array<{ geo: string; items: Array<{ rank: number; title: string; traffic: string | null }> }>
}

function GoogleTrendsPulse() {
  const [data, setData] = useState<GtPulseData | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/culture/gt-pulse')
      .then((r) => r.json())
      .then((d: GtPulseData) => {
        if (!cancelled) {
          setData(d)
          setLoaded(true)
        }
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  if (!loaded) return null
  if (!data || data.empty) return null
  if (data.multiCountry.length === 0 && data.newToday.length === 0 && data.risingFast.length === 0) return null

  const flag = (g: string) => {
    const m: Record<string, string> = { NL: '🇳🇱', BE: '🇧🇪', FR: '🇫🇷', DE: '🇩🇪', AT: '🇦🇹', CH: '🇨🇭', ES: '🇪🇸', IT: '🇮🇹', PT: '🇵🇹', PL: '🇵🇱', CZ: '🇨🇿', SK: '🇸🇰', HU: '🇭🇺', RO: '🇷🇴' }
    return m[g] ?? g
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 12px 0' }}>
        <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 22, letterSpacing: '-0.01em', color: '#000', textTransform: 'uppercase', lineHeight: 1 }}>
          Live Google Trends<span style={{ color: '#FF1300' }}>.</span>
        </span>
        <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.15em', color: '#6b6b6b', textTransform: 'uppercase' }}>
          Cross-country search pulse · last 24h
        </span>
        <div style={{ flex: 1, height: 2, background: '#000' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        {/* Multi-country panel */}
        {data.multiCountry.length > 0 && (
          <div className="jai-card" style={{ padding: 14, background: '#000', color: '#FFFDF3', border: '1px solid #FF1300' }}>
            <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
              🌐 MULTI-COUNTRY · {data.multiCountry.length} TRENDS
            </p>
            <p style={{ margin: '4px 0 10px 0', fontSize: 11, opacity: 0.6 }}>
              Searches trending in 3+ Action markets right now
            </p>
            <ol style={{ margin: 0, padding: '0 0 0 18px' }}>
              {data.multiCountry.slice(0, 8).map((m, i) => (
                <li key={i} style={{ marginBottom: 8, fontSize: 13, lineHeight: 1.35 }}>
                  <strong>{m.title}</strong>
                  <span style={{ marginLeft: 6, fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em', color: '#FF1300' }}>
                    {m.countryCount}×
                  </span>
                  <div style={{ marginTop: 2, fontSize: 10, color: '#FFFDF3', opacity: 0.5, letterSpacing: '0.05em' }}>
                    {m.geos.slice(0, 8).map((g) => flag(g.geo)).join(' ')}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* New today panel */}
        {data.newToday.length > 0 && (
          <div className="jai-card" style={{ padding: 14, background: '#FFFDF3', border: '1px solid #000' }}>
            <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
              ✨ NEW TODAY · {data.newToday.length} signals
            </p>
            <p style={{ margin: '4px 0 10px 0', fontSize: 11, color: '#6b6b6b' }}>
              In today's top, not in yesterday's. Earliest catch.
            </p>
            <ol style={{ margin: 0, padding: '0 0 0 18px' }}>
              {data.newToday.slice(0, 10).map((n, i) => (
                <li key={i} style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.35, color: '#1a1a1a' }}>
                  <span style={{ marginRight: 4 }}>{flag(n.geo)}</span>
                  <strong>{n.title}</strong>
                  <span style={{ marginLeft: 6, fontSize: 10, color: '#6b6b6b' }}>#{n.rank}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Rising fast panel */}
        {data.risingFast.length > 0 && (
          <div className="jai-card" style={{ padding: 14, background: '#FFE4E0', border: '1px solid #FF1300' }}>
            <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
              ↗ RISING FAST · {data.risingFast.length}
            </p>
            <p style={{ margin: '4px 0 10px 0', fontSize: 11, color: '#6b6b6b' }}>
              Climbed 5+ ranks vs yesterday
            </p>
            <ol style={{ margin: 0, padding: '0 0 0 18px' }}>
              {data.risingFast.slice(0, 10).map((r, i) => (
                <li key={i} style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.35, color: '#1a1a1a' }}>
                  <span style={{ marginRight: 4 }}>{flag(r.geo)}</span>
                  <strong>{r.title}</strong>
                  <span style={{ marginLeft: 6, fontSize: 10, color: '#FF1300', fontFamily: 'var(--font-jai-display)', letterSpacing: '0.08em' }}>
                    #{r.rankYesterday}→#{r.rankToday}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Country pulse: top 3 trends per major Action market ────────────────────

const PULSE_COUNTRIES: Array<{ code: string; flag: string; label: string }> = [
  { code: 'NL', flag: '🇳🇱', label: 'Netherlands' },
  { code: 'BE', flag: '🇧🇪', label: 'Belgium' },
  { code: 'FR', flag: '🇫🇷', label: 'France' },
  { code: 'DE', flag: '🇩🇪', label: 'Germany' },
  { code: 'IT', flag: '🇮🇹', label: 'Italy' },
  { code: 'ES', flag: '🇪🇸', label: 'Spain' },
]

function CountryPulse({ trends }: { trends: CultureTrend[] }) {
  // Pick top 3 trends for each country where:
  //   - trend's countryRelevance contains the country, OR
  //   - countryRelevance is empty (treat as universal — but de-prioritize)
  // and the trend is not the SAME across countries (skip pure globals).
  const perCountry = PULSE_COUNTRIES.map((c) => {
    const specific = trends.filter((t) => {
      const cr = t.countryRelevance ?? []
      // A trend is "country-specific" if it lists 1-6 countries including this one
      return cr.length > 0 && cr.length <= 6 && cr.includes(c.code as CultureTrend['countryRelevance'][number])
    })
    // Rank by daily_rank, then growth, then popularity
    specific.sort((a, b) => {
      const ra = a.dailyRank ?? 999
      const rb = b.dailyRank ?? 999
      if (ra !== rb) return ra - rb
      const ga = a.growthScore ?? 0
      const gb = b.growthScore ?? 0
      if (ga !== gb) return gb - ga
      return b.popularityScore - a.popularityScore
    })
    return { ...c, top: specific.slice(0, 3) }
  })

  // Hide pulse if NO country has any specific trends
  if (perCountry.every((c) => c.top.length === 0)) return null

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 12px 0' }}>
        <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 22, letterSpacing: '-0.01em', color: '#000', textTransform: 'uppercase', lineHeight: 1 }}>
          Country pulse<span style={{ color: '#FF1300' }}>.</span>
        </span>
        <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.15em', color: '#6b6b6b', textTransform: 'uppercase' }}>
          Top trends per major Action market
        </span>
        <div style={{ flex: 1, height: 2, background: '#000' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {perCountry.map((c) => (
          <div key={c.code} className="jai-card" style={{ padding: 14, background: '#FFFDF3', border: '1px solid #000', minHeight: 140 }}>
            <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
              {c.flag} {c.label.toUpperCase()}
            </p>
            {c.top.length === 0 ? (
              <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9ca3af' }}>No country-specific trends yet.</p>
            ) : (
              <ol style={{ margin: '8px 0 0 0', padding: '0 0 0 18px' }}>
                {c.top.map((t) => (
                  <li key={t.id} style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.4, color: '#1a1a1a' }}>
                    <strong>{t.name}</strong>
                    {t.brandBrief?.contentAngle && (
                      <span style={{ display: 'block', color: '#6b6b6b', fontSize: 11, marginTop: 2 }}>
                        {t.brandBrief.contentAngle.slice(0, 80)}{t.brandBrief.contentAngle.length > 80 ? '…' : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Breakout pulse: highest growth-score trends regardless of country ─────

function BreakoutPulse({ trends }: { trends: CultureTrend[] }) {
  const top = trends
    .filter((t) => (t.growthScore ?? 0) >= 6.5)
    .sort((a, b) => (b.growthScore ?? 0) - (a.growthScore ?? 0))
    .slice(0, 6)
  if (top.length === 0) return null

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 12px 0' }}>
        <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 22, letterSpacing: '-0.01em', color: '#000', textTransform: 'uppercase', lineHeight: 1 }}>
          Likely to break<span style={{ color: '#FF1300' }}>.</span>
        </span>
        <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.15em', color: '#6b6b6b', textTransform: 'uppercase' }}>
          Predictive growth score 6.5+
        </span>
        <div style={{ flex: 1, height: 2, background: '#000' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {top.map((t) => (
          <div key={t.id} className="jai-card" style={{ padding: 12, background: '#000', color: '#FFFDF3', border: '1px solid #FF1300' }}>
            <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
              ↗ {Number(t.growthScore).toFixed(1)}/10 · GROWTH POTENTIAL
            </p>
            <p style={{ margin: '6px 0 4px 0', fontFamily: 'var(--font-jai-display)', fontSize: 15, lineHeight: 1.1, textTransform: 'uppercase', letterSpacing: '-0.01em' }}>
              {t.name}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: '#FFFDF3', opacity: 0.7, lineHeight: 1.4 }}>
              {t.description.slice(0, 110)}{t.description.length > 110 ? '…' : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function CategoryDivider({ label, count }: { label: string; count: number }) {
  const friendly = CATEGORY_LABELS[label] ?? label
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        margin: '20px 0 12px 0',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-jai-display)',
          fontSize: 22,
          letterSpacing: '-0.01em',
          color: '#000',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        {friendly}<span style={{ color: '#FF1300' }}>.</span>
      </span>
      <span
        style={{
          fontFamily: 'var(--font-jai-display)',
          fontSize: 10,
          letterSpacing: '0.15em',
          color: '#6b6b6b',
          textTransform: 'uppercase',
        }}
      >
        {count} {count === 1 ? 'trend' : 'trends'}
      </span>
      <div style={{ flex: 1, height: 2, background: '#000' }} />
    </div>
  )
}

function groupByCategory(
  trends: CultureTrend[],
): Array<{ category: string; items: CultureTrend[] }> {
  // Sort categories by the average daily_rank (or weekly_rank) of their members,
  // so the most relevant categories come first.
  const map = new Map<string, CultureTrend[]>()
  for (const t of trends) {
    const cat = (t.category as string) || 'other'
    const list = map.get(cat) ?? []
    list.push(t)
    map.set(cat, list)
  }
  const groups = Array.from(map.entries()).map(([category, items]) => {
    const bestRank = Math.min(...items.map((i) => i.dailyRank ?? i.weeklyRank ?? 999))
    return { category, items, bestRank }
  })
  groups.sort((a, b) => a.bestRank - b.bestRank)
  return groups.map(({ category, items }) => ({ category, items }))
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
/**
 * Group trends that share the same bundle_key. The highest-ranked /
 * highest-popularity trend in each bundle becomes the "primary" — the
 * other members are attached as `bundleVariants` so the row UI can show
 * them as extra hashtag chips on the same card.
 */
function bundleTrends(trends: CultureTrend[]): CultureTrend[] {
  const grouped = new Map<string, CultureTrend[]>()
  const orphans: CultureTrend[] = []
  for (const t of trends) {
    if (!t.bundleKey) {
      orphans.push(t)
      continue
    }
    const list = grouped.get(t.bundleKey) ?? []
    list.push(t)
    grouped.set(t.bundleKey, list)
  }

  const primaries: CultureTrend[] = []
  for (const [, members] of grouped) {
    // Sort: lowest daily_rank first (rank 1 wins), then highest popularity
    members.sort((a, b) => {
      const ra = a.dailyRank ?? 999
      const rb = b.dailyRank ?? 999
      if (ra !== rb) return ra - rb
      return b.popularityScore - a.popularityScore
    })
    const [primary, ...rest] = members
    if (rest.length > 0) {
      // Attach variants for UI rendering
      const withVariants: CultureTrend & { bundleVariants?: CultureTrend[] } = {
        ...primary,
        bundleVariants: rest,
      }
      primaries.push(withVariants)
    } else {
      primaries.push(primary)
    }
  }
  // Combine, then sort by original ordering (daily_rank ascending, then by index)
  const all = [...primaries, ...orphans]
  all.sort((a, b) => (a.dailyRank ?? 999) - (b.dailyRank ?? 999))
  return all
}

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
