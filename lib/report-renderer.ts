/**
 * Daily Culture Radar report renderer.
 *
 * Generates a newsletter-style HTML report from the current state of the
 * culture_trends + culture_moments tables. Designed to feel like a daily
 * briefing email — clean typography, big sections, embedded thumbnails,
 * actionable content angles.
 *
 * Used by:
 *   - /culture-radar/report page (server-rendered, public, shareable)
 *   - /api/culture/report.html (raw HTML download for email forwarding)
 */

import { sql } from '@/lib/culture-db'
import { isoWeek } from '@/lib/culture-radar'
import { getTodaysCohort } from '@/lib/creator-radar'
import { generateHeroImagesForReport } from '@/lib/trend-image'
import type { ActionBrief, CultureTrend, CultureMoment } from '@/types/culture'

interface CreatorForReport {
  handle: string
  platform: string
  profile_url: string | null
  name: string | null
  niche: string | null
  why_relevant: string | null
  follower_count: number | null
  country_relevance: string[] | null
  example_video_urls: string[] | null
  tags: string[] | null
  cohort_date: string
}

interface TrendForReport {
  id: string
  name: string
  description: string
  category: string
  popularity_score: number
  daily_rank: number | null
  weekly_rank: number | null
  hashtags: string[] | null
  example_urls: string[] | null
  thumbnail_url: string | null
  thumbnail_meta: { authorName?: string } | null
  brand_brief: ActionBrief | null
  source_names: string[] | null
  estimated_views: string | null
  country_relevance: string[] | null
  first_seen_at: string
  content_type: string | null
  mindmap: CultureTrend['mindmap']
  subculture?: string | null
  vibe?: string | null
  growth_score?: number | null
}

interface MomentForReport {
  id: string
  name: string
  description: string
  category: string
  tier: string
  cultural_relevance: number
  country_dates: Array<{ country: string; date: string; localName?: string }>
  next_occurrence: string | null
  brand_brief: ActionBrief | null
  related_topics: CultureMoment['relatedTopics']
}

export interface GtMultiCountryForReport {
  title: string
  countryCount: number
  geos: string[]
  whyNow: string | null
  category: string | null
  actionRelevance: string | null
  actionAngle: string | null
  topArticle: { title: string; url: string; source: string | null } | null
}

export interface GtCountrySpikeForReport {
  geo: string
  flag: string
  title: string
  traffic: string | null
  whyNow: string | null
  category: string | null
  actionRelevance: string | null
  actionAngle: string | null
  topArticle: { title: string; url: string; source: string | null } | null
}

interface SnapshotForReport {
  trend_id: string
  snapshot_date: string
  popularity_score: number
}

export interface MagazineNumbers {
  trendsTrackedToday: number
  trendsFreshLast24h: number
  subculturesActive: number
  subculturesRising: number
  multiCountryTrends: number
  predictedToBreak: number
  creatorsInCohort: number
  momentsNext3Weeks: number
}

export interface PullQuote {
  text: string
  attribution: string
}

export interface EditorPick {
  trend: TrendForReport
  reason: string
}

export interface ReportData {
  generatedAt: string
  week: string
  issueNumber: number
  dailyTop10: TrendForReport[]
  weeklyTop20: TrendForReport[]
  inspiration: TrendForReport[]
  emerging: TrendForReport[]
  upcomingMoments: MomentForReport[]
  creators: CreatorForReport[]
  breakout: TrendForReport[]
  bySubculture: Array<{ subculture: string; trends: TrendForReport[] }>
  byCountry: Array<{ code: string; flag: string; label: string; trends: TrendForReport[] }>
  gtMultiCountry: GtMultiCountryForReport[]
  gtCountrySpikes: GtCountrySpikeForReport[]
  numbers: MagazineNumbers
  pullQuote: PullQuote | null
  editorPicks: EditorPick[]
  snapshotsByTrendId: Record<string, SnapshotForReport[]>
}

export async function fetchReportData(): Promise<ReportData> {
  const week = isoWeek()

  const dailyTop10 = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap,
            subculture, vibe, growth_score
       FROM culture_trends
      WHERE rank_week = $1 AND status = 'active' AND daily_rank IS NOT NULL
      ORDER BY daily_rank ASC LIMIT 10`,
    [week],
  )) as TrendForReport[]

  const weeklyTop20 = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap,
            subculture, vibe, growth_score
       FROM culture_trends
      WHERE rank_week = $1 AND status = 'active' AND weekly_rank IS NOT NULL
        AND (daily_rank IS NULL OR daily_rank > 10)
      ORDER BY weekly_rank ASC LIMIT 20`,
    [week],
  )) as TrendForReport[]

  const inspiration = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap,
            subculture, vibe, growth_score
       FROM culture_trends
      WHERE status = 'active'
        AND content_type IN ('format','meme','aesthetic','behavior')
        AND freshness_score >= 5
      ORDER BY first_seen_at DESC, popularity_score DESC
      LIMIT 8`,
  )) as TrendForReport[]

  const emerging = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap,
            subculture, vibe, growth_score
       FROM culture_trends
      WHERE status = 'active' AND popularity_score < 7 AND freshness_score >= 7
      ORDER BY first_seen_at DESC LIMIT 6`,
  )) as TrendForReport[]

  const upcomingMoments = (await sql().query(
    `SELECT id, name, description, category, tier, cultural_relevance,
            country_dates, next_occurrence::TEXT AS next_occurrence,
            brand_brief, related_topics
       FROM culture_moments
      WHERE status <> 'archived'
        AND next_occurrence IS NOT NULL
        AND next_occurrence >= CURRENT_DATE
        AND next_occurrence <= CURRENT_DATE + INTERVAL '21 days'
      ORDER BY next_occurrence ASC, cultural_relevance DESC
      LIMIT 8`,
  )) as MomentForReport[]

  const creators = (await getTodaysCohort()) as CreatorForReport[]

  // Breakout: highest growth_score, sorted desc
  const breakout = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap,
            subculture, vibe, growth_score
       FROM culture_trends
      WHERE status = 'active' AND growth_score >= 7
      ORDER BY growth_score DESC, popularity_score DESC
      LIMIT 8`,
  )) as TrendForReport[]

  // By subculture: group trends with subculture tag
  const subTrends = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap,
            subculture, vibe, growth_score
       FROM culture_trends
      WHERE status = 'active' AND subculture IS NOT NULL
      ORDER BY popularity_score DESC, growth_score DESC NULLS LAST
      LIMIT 80`,
  )) as TrendForReport[]
  const subBuckets = new Map<string, TrendForReport[]>()
  for (const t of subTrends) {
    if (!t.subculture) continue
    const list = subBuckets.get(t.subculture) ?? []
    if (list.length < 4) list.push(t)
    subBuckets.set(t.subculture, list)
  }
  // Only keep subcultures with 2+ trends
  const bySubculture = Array.from(subBuckets.entries())
    .filter(([, ts]) => ts.length >= 2)
    .map(([subculture, trends]) => ({ subculture, trends }))
    .sort((a, b) => b.trends.length - a.trends.length)
    .slice(0, 6)

  // By country: top 4 trends per major Action market that's country-specific
  const REPORT_COUNTRIES: Array<{ code: string; flag: string; label: string }> = [
    { code: 'NL', flag: '🇳🇱', label: 'Netherlands' },
    { code: 'BE', flag: '🇧🇪', label: 'Belgium' },
    { code: 'FR', flag: '🇫🇷', label: 'France' },
    { code: 'DE', flag: '🇩🇪', label: 'Germany' },
    { code: 'IT', flag: '🇮🇹', label: 'Italy' },
    { code: 'ES', flag: '🇪🇸', label: 'Spain' },
  ]
  const byCountry = await Promise.all(
    REPORT_COUNTRIES.map(async (c) => {
      const trends = (await sql().query(
        `SELECT id, name, description, category, popularity_score, daily_rank,
                weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
                brand_brief, source_names, estimated_views, country_relevance,
                first_seen_at::TEXT AS first_seen_at, content_type, mindmap,
                subculture, vibe, growth_score
           FROM culture_trends
          WHERE status = 'active'
            AND country_relevance IS NOT NULL
            AND cardinality(country_relevance) BETWEEN 1 AND 6
            AND $1::text = ANY(country_relevance)
          ORDER BY COALESCE(daily_rank, 999) ASC,
                   COALESCE(growth_score, 0) DESC,
                   popularity_score DESC
          LIMIT 4`,
        [c.code],
      )) as TrendForReport[]
      return { ...c, trends }
    }),
  )

  // GT pulse: multi-country interpreted trends + per-country spikes
  const { gtMultiCountry, gtCountrySpikes } = await fetchGtForReport()

  // Editorial extras
  const numbers = await fetchMagazineNumbers(week, dailyTop10.length, breakout.length, bySubculture.length, gtMultiCountry.length, creators.length, upcomingMoments.length)
  const pullQuote = derivePullQuote(dailyTop10, breakout)
  const editorPicks = deriveEditorPicks(dailyTop10, breakout, bySubculture)
  const snapshotsByTrendId = await fetchTopTrendSnapshots(dailyTop10.slice(0, 5).map((t) => t.id))

  // AI-generated cinematic hero images for the top 10 daily trends +
  // the breakout section + editor picks that lack a real thumbnail.
  // Cached per (trend_id, day), 3-way concurrent — cost-bounded.
  const imageCandidates: TrendForReport[] = []
  const seen = new Set<string>()
  const addIfNeedsImage = (t: TrendForReport | undefined) => {
    if (!t || !t.id || seen.has(t.id) || t.thumbnail_url) return
    seen.add(t.id)
    imageCandidates.push(t)
  }
  for (const t of dailyTop10.slice(0, 10)) addIfNeedsImage(t)
  for (const t of breakout.slice(0, 3)) addIfNeedsImage(t)
  for (const p of editorPicks) addIfNeedsImage(p.trend)

  if (imageCandidates.length > 0 && process.env.GOOGLE_API_KEY) {
    try {
      const heroImages = await generateHeroImagesForReport(
        imageCandidates.map((t) => ({
          trendId: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          vibe: t.vibe,
          subculture: t.subculture,
        })),
        3,
      )
      for (const t of imageCandidates) {
        const url = heroImages.get(t.id)
        if (url) t.thumbnail_url = url
      }
    } catch (err) {
      console.error('[report-renderer] hero image generation failed', err)
    }
  }

  // Issue number: epoch-day / 7 since 2026-01-01 → weekly increment
  const epoch = new Date('2026-01-01').getTime()
  const issueNumber = Math.max(1, Math.floor((Date.now() - epoch) / (7 * 86_400_000)) + 1)

  return {
    generatedAt: new Date().toISOString(),
    week,
    issueNumber,
    dailyTop10,
    weeklyTop20,
    inspiration,
    emerging,
    upcomingMoments,
    creators,
    breakout,
    bySubculture,
    byCountry: byCountry.filter((c) => c.trends.length > 0),
    gtMultiCountry,
    gtCountrySpikes,
    numbers,
    pullQuote,
    editorPicks,
    snapshotsByTrendId,
  }
}

async function fetchMagazineNumbers(
  week: string,
  topCount: number,
  breakoutCount: number,
  subcultureCount: number,
  multiCountryCount: number,
  creatorsCount: number,
  momentsCount: number,
): Promise<MagazineNumbers> {
  // Single-roundtrip aggregations for the cover sidebar
  const rows = (await sql().query(
    `WITH stats AS (
       SELECT
         (SELECT COUNT(*)::int FROM culture_trends WHERE status = 'active' AND rank_week = $1) AS trends_today,
         (SELECT COUNT(*)::int FROM culture_trends WHERE status = 'active' AND first_seen_at >= NOW() - INTERVAL '24 hours') AS trends_fresh,
         (SELECT COUNT(DISTINCT subculture)::int FROM culture_trends WHERE status = 'active' AND subculture IS NOT NULL) AS subs_active
     ) SELECT * FROM stats`,
    [week],
  )) as Array<{ trends_today: number; trends_fresh: number; subs_active: number }>
  const s = rows[0] ?? { trends_today: 0, trends_fresh: 0, subs_active: 0 }

  return {
    trendsTrackedToday: s.trends_today,
    trendsFreshLast24h: s.trends_fresh,
    subculturesActive: s.subs_active,
    subculturesRising: subcultureCount,
    multiCountryTrends: multiCountryCount,
    predictedToBreak: breakoutCount,
    creatorsInCohort: creatorsCount,
    momentsNext3Weeks: momentsCount,
  }
}

function derivePullQuote(daily: TrendForReport[], breakout: TrendForReport[]): PullQuote | null {
  // Pull the most striking action_relevance sentence from the top trends
  const pool = [...daily.slice(0, 5), ...breakout.slice(0, 3)]
  for (const t of pool) {
    const rel = t.brand_brief?.actionRelevance
    if (rel && rel.length >= 60 && rel.length <= 220) {
      return { text: rel.replace(/^["']|["']$/g, ''), attribution: `On "${t.name}"` }
    }
  }
  return null
}

function deriveEditorPicks(
  daily: TrendForReport[],
  breakout: TrendForReport[],
  bySubculture: Array<{ subculture: string; trends: TrendForReport[] }>,
): EditorPick[] {
  const picks: EditorPick[] = []
  // 1. Best high-growth, fresh, with subculture
  const fresh = breakout.find((t) => t.subculture && (t.growth_score ?? 0) >= 6)
  if (fresh) picks.push({ trend: fresh, reason: `Hoogste growth-score (${Number(fresh.growth_score).toFixed(1)}) in een trackbare subcultuur. Pak nu.` })
  // 2. Best multi-country daily trend
  const multi = daily.find((t) => (t.country_relevance ?? []).length >= 5 && (t.country_relevance ?? []).length < 14)
  if (multi && !picks.find((p) => p.trend.id === multi.id)) picks.push({ trend: multi, reason: `Trending in ${(multi.country_relevance ?? []).length} markten. Cross-border opportunity.` })
  // 3. Best subculture with rising trajectory
  const subTrend = bySubculture[0]?.trends?.[0]
  if (subTrend && !picks.find((p) => p.trend.id === subTrend.id)) picks.push({ trend: subTrend, reason: `Anker-trend in een snelgroeiende subculture (${bySubculture[0]?.subculture}).` })

  return picks.slice(0, 3)
}

async function fetchTopTrendSnapshots(trendIds: string[]): Promise<Record<string, SnapshotForReport[]>> {
  if (trendIds.length === 0) return {}
  const rows = (await sql().query(
    `SELECT trend_id, snapshot_date::TEXT AS snapshot_date, popularity_score
       FROM culture_trend_snapshots
      WHERE trend_id = ANY($1::uuid[])
      ORDER BY trend_id, snapshot_date ASC`,
    [trendIds],
  )) as SnapshotForReport[]
  const out: Record<string, SnapshotForReport[]> = {}
  for (const r of rows) {
    const list = out[r.trend_id] ?? []
    list.push(r)
    out[r.trend_id] = list
  }
  return out
}

async function fetchGtForReport(): Promise<{
  gtMultiCountry: GtMultiCountryForReport[]
  gtCountrySpikes: GtCountrySpikeForReport[]
}> {
  const flags: Record<string, string> = {
    NL: '🇳🇱', BE: '🇧🇪', FR: '🇫🇷', DE: '🇩🇪', AT: '🇦🇹', CH: '🇨🇭',
    ES: '🇪🇸', IT: '🇮🇹', PT: '🇵🇹', PL: '🇵🇱', CZ: '🇨🇿', SK: '🇸🇰',
    HU: '🇭🇺', RO: '🇷🇴',
  }

  // Find latest snapshot date
  const dateRows = (await sql().query(
    `SELECT MAX(snapshot_date)::TEXT AS latest FROM culture_gt_snapshots`,
  )) as Array<{ latest: string | null }>
  const latest = dateRows[0]?.latest
  if (!latest) return { gtMultiCountry: [], gtCountrySpikes: [] }

  // Pull all of latest day with interpretations
  const rows = (await sql().query(
    `SELECT s.geo, s.rank, s.title, s.title_normalized, s.traffic,
            s.articles,
            i.why_now, i.category, i.action_relevance, i.action_angle
       FROM culture_gt_snapshots s
       LEFT JOIN culture_gt_interpretations i
         ON i.snapshot_date = s.snapshot_date
        AND i.title_normalized = s.title_normalized
      WHERE s.snapshot_date = $1
      ORDER BY s.geo, s.rank`,
    [latest],
  )) as Array<{
    geo: string; rank: number; title: string; title_normalized: string;
    traffic: string | null;
    articles: Array<{ title: string; url: string; source: string | null }> | null;
    why_now: string | null; category: string | null;
    action_relevance: string | null; action_angle: string | null;
  }>

  // Multi-country: group by title_normalized, count distinct geos
  const titleMap = new Map<string, {
    title: string
    geos: string[]
    whyNow: string | null
    category: string | null
    actionRelevance: string | null
    actionAngle: string | null
    topArticle: { title: string; url: string; source: string | null } | null
  }>()
  for (const r of rows) {
    const existing = titleMap.get(r.title_normalized) ?? {
      title: r.title,
      geos: [],
      whyNow: r.why_now,
      category: r.category,
      actionRelevance: r.action_relevance,
      actionAngle: r.action_angle,
      topArticle: (r.articles?.[0] ?? null) as { title: string; url: string; source: string | null } | null,
    }
    if (!existing.geos.includes(r.geo)) existing.geos.push(r.geo)
    titleMap.set(r.title_normalized, existing)
  }
  const gtMultiCountry: GtMultiCountryForReport[] = Array.from(titleMap.values())
    .filter((t) => t.geos.length >= 3)
    .sort((a, b) => b.geos.length - a.geos.length)
    .slice(0, 8)
    .map((t) => ({
      title: t.title,
      countryCount: t.geos.length,
      geos: t.geos,
      whyNow: t.whyNow,
      category: t.category,
      actionRelevance: t.actionRelevance,
      actionAngle: t.actionAngle,
      topArticle: t.topArticle,
    }))

  // Country spikes: #1 per country, sorted by action_relevance high→low
  const byGeo = new Map<string, typeof rows[number]>()
  for (const r of rows) {
    if (!byGeo.has(r.geo) || r.rank < (byGeo.get(r.geo)?.rank ?? 999)) {
      byGeo.set(r.geo, r)
    }
  }
  const relRank: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 }
  const gtCountrySpikes: GtCountrySpikeForReport[] = Array.from(byGeo.values())
    .map((r) => ({
      geo: r.geo,
      flag: flags[r.geo] ?? '🌐',
      title: r.title,
      traffic: r.traffic,
      whyNow: r.why_now,
      category: r.category,
      actionRelevance: r.action_relevance,
      actionAngle: r.action_angle,
      topArticle: (r.articles?.[0] ?? null) as { title: string; url: string; source: string | null } | null,
    }))
    .sort((a, b) => (relRank[a.actionRelevance ?? 'low'] ?? 2) - (relRank[b.actionRelevance ?? 'low'] ?? 2))

  return { gtMultiCountry, gtCountrySpikes }
}

// ── HTML rendering ──────────────────────────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  food: '🍴', beauty: '💄', fashion: '👗', home: '🏠', lifestyle: '✨',
  tech: '💻', meme: '😂', culture: '🎭', platform: '📱', sound: '🎵',
  sport: '⚽', festival: '🎪', religious: '🕊️', seasonal: '🌿',
  entertainment: '🎬', music: '🎤', celebrity: '⭐', product_launch: '📦',
  award_show: '🏆', political: '🏛️', pop_culture: '🌀', national: '🏳️',
  holiday: '🎉',
}

const CATEGORY_COLOR: Record<string, string> = {
  food: '#ea580c', beauty: '#db2777', fashion: '#9333ea', home: '#0891b2',
  lifestyle: '#ca8a04', tech: '#2563eb', meme: '#dc2626', culture: '#7c3aed',
  platform: '#16a34a', sound: '#0284c7',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// Cinematic full-bleed cover hero. Two layouts:
// - With thumbnail: massive image, gradient overlay, headline floats bottom
// - Without thumbnail: art-directed SVG poster with category palette,
//   geometric composition, and big typography
function renderCoverHero(t: TrendForReport): string {
  const palette = categoryArtPalette(t.category)
  const hasThumb = !!t.thumbnail_url

  // Art-directed SVG poster
  const cleanName = t.name.replace(/^#/, '').slice(0, 18)
  const svgPoster = !hasThumb
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 800 540" preserveAspectRatio="xMidYMid slice" style="display:block;">
         <defs>
           <linearGradient id="bg-${t.id.slice(0, 8)}" x1="0" y1="0" x2="1" y2="1">
             <stop offset="0%" stop-color="${palette.primary}" stop-opacity="0.95"/>
             <stop offset="100%" stop-color="${palette.secondary}" stop-opacity="0.9"/>
           </linearGradient>
           <radialGradient id="rg-${t.id.slice(0, 8)}" cx="80%" cy="20%" r="60%">
             <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.45"/>
             <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
           </radialGradient>
         </defs>
         <rect width="800" height="540" fill="url(#bg-${t.id.slice(0, 8)})"/>
         <rect width="800" height="540" fill="url(#rg-${t.id.slice(0, 8)})"/>
         <!-- Geometric accent bars -->
         <rect x="0" y="0" width="800" height="6" fill="${palette.accent}"/>
         <rect x="0" y="528" width="800" height="12" fill="${palette.accent}" opacity="0.6"/>
         <!-- Diagonal stripe -->
         <polygon points="0,0 280,0 220,540 0,540" fill="${palette.foreground}" opacity="0.04"/>
         <!-- Editorial frame ticks -->
         <line x1="40" y1="40" x2="100" y2="40" stroke="${palette.accent}" stroke-width="4"/>
         <line x1="40" y1="40" x2="40" y2="100" stroke="${palette.accent}" stroke-width="4"/>
         <line x1="760" y1="500" x2="700" y2="500" stroke="${palette.accent}" stroke-width="4"/>
         <line x1="760" y1="500" x2="760" y2="440" stroke="${palette.accent}" stroke-width="4"/>
         <!-- Background initial — big and bold -->
         <text x="700" y="480" text-anchor="end" font-family="Archivo Black,sans-serif" font-size="440" fill="${palette.foreground}" opacity="0.07" letter-spacing="-18">${escapeHtml(cleanName.charAt(0).toUpperCase())}</text>
       </svg>`
    : ''

  return `
<tr>
  <td style="padding:8px 40px 36px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#000;border:2px solid #FF1300;">
      <tr>
        <td style="position:relative;padding:0;${hasThumb ? `background-image:linear-gradient(180deg,rgba(0,0,0,0.1) 0%,rgba(0,0,0,0.6) 60%,rgba(0,0,0,0.96) 100%),url(${escapeHtml(t.thumbnail_url!)});background-size:cover;background-position:center;` : ''}">
          <div style="${hasThumb ? 'min-height:520px;' : ''}">
            ${!hasThumb ? `<div style="position:relative;width:100%;height:520px;overflow:hidden;">${svgPoster}<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.15) 0%,rgba(0,0,0,0.4) 50%,rgba(0,0,0,0.92) 100%);"></div></div>` : ''}
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="${hasThumb ? 'position:absolute;bottom:0;left:0;right:0;' : 'margin-top:-360px;position:relative;'}">
              <tr>
                <td style="padding:32px 40px 40px;">
                  <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.3em;color:#FF1300;text-transform:uppercase;">★ TODAY'S №1 · ${escapeHtml(t.category).toUpperCase()}${t.subculture ? ` · ◇ ${escapeHtml(t.subculture)}` : ''}</p>
                  <h2 style="margin:14px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:68px;line-height:0.86;color:#FFFDF3;text-transform:uppercase;letter-spacing:-0.03em;max-width:92%;">${escapeHtml(t.name)}<span style="color:#FF1300;">.</span></h2>
                  <p style="margin:22px 0 0 0;font-family:'Newsreader',Georgia,serif;font-size:21px;line-height:1.42;color:#FFFDF3;opacity:0.95;font-weight:300;max-width:78%;font-style:italic;">${escapeHtml(t.description.slice(0, 280))}${t.description.length > 280 ? '…' : ''}</p>
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;">
                    <tr>
                      <td valign="middle">
                        ${t.estimated_views ? `<span style="font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.15em;color:#FFFDF3;opacity:0.6;text-transform:uppercase;">📊 ${escapeHtml(t.estimated_views)}</span>` : ''}
                        ${t.estimated_views && t.hashtags && t.hashtags.length > 0 ? '<span style="color:#FFFDF3;opacity:0.3;margin:0 10px;">|</span>' : ''}
                        ${t.hashtags && t.hashtags.length > 0 ? `<span style="font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.1em;color:#FF1300;">${escapeHtml(t.hashtags.slice(0, 3).join(' '))}</span>` : ''}
                      </td>
                      <td valign="middle" align="right">
                        ${t.growth_score != null ? `<span style="display:inline-block;padding:5px 12px;background:#FF1300;color:#FFFDF3;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.12em;">↗ GROWTH ${Number(t.growth_score).toFixed(1)}/10</span>` : ''}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>`
}

// Category-driven art direction palette for SVG posters
function categoryArtPalette(category: string): { primary: string; secondary: string; accent: string; foreground: string } {
  const map: Record<string, { primary: string; secondary: string; accent: string; foreground: string }> = {
    food:      { primary: '#7c2d12', secondary: '#ea580c', accent: '#fde68a', foreground: '#fffbea' },
    beauty:    { primary: '#831843', secondary: '#db2777', accent: '#fce7f3', foreground: '#fffbf5' },
    fashion:   { primary: '#3b0764', secondary: '#9333ea', accent: '#f3e8ff', foreground: '#fefcff' },
    home:      { primary: '#164e63', secondary: '#0891b2', accent: '#cffafe', foreground: '#f0fdff' },
    lifestyle: { primary: '#713f12', secondary: '#ca8a04', accent: '#fef3c7', foreground: '#fffbeb' },
    tech:      { primary: '#1e3a8a', secondary: '#2563eb', accent: '#bfdbfe', foreground: '#eff6ff' },
    meme:      { primary: '#7f1d1d', secondary: '#dc2626', accent: '#fecaca', foreground: '#fff5f5' },
    culture:   { primary: '#4c1d95', secondary: '#7c3aed', accent: '#ede9fe', foreground: '#faf5ff' },
    platform:  { primary: '#064e3b', secondary: '#16a34a', accent: '#bbf7d0', foreground: '#f0fdf4' },
    sound:     { primary: '#0c4a6e', secondary: '#0284c7', accent: '#bae6fd', foreground: '#f0f9ff' },
    sport:     { primary: '#14532d', secondary: '#22c55e', accent: '#dcfce7', foreground: '#f7fef0' },
  }
  return map[category] ?? { primary: '#1f2937', secondary: '#000000', accent: '#FF1300', foreground: '#FFFDF3' }
}

function renderTrendCard(t: TrendForReport, opts: { showRank?: boolean } = {}): string {
  const emoji = CATEGORY_EMOJI[t.category] ?? '🔥'
  const color = CATEGORY_COLOR[t.category] ?? '#6b7280'
  const brief = t.brand_brief
  const countries = (t.country_relevance ?? []).slice(0, 4).join(' ')
  const videoUrls = (t.example_urls ?? []).filter(
    (u) => u.includes('tiktok.com') || u.includes('instagram.com') || u.includes('youtube.com'),
  )
  const otherUrls = (t.example_urls ?? []).filter(
    (u) => !videoUrls.includes(u),
  )

  return `
<tr><td style="padding:0 0 24px 0;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFDF3;border:1px solid #000;border-left:6px solid ${color};overflow:hidden;">
    <tr>
      ${t.thumbnail_url
        ? `<td width="180" valign="top" style="padding:0;background:#000;width:180px;">
            <img src="${escapeHtml(t.thumbnail_url)}" alt="" width="180" style="display:block;width:180px;height:180px;object-fit:cover;border:0;" />
          </td>`
        : `<td width="180" valign="middle" style="padding:0;background:#000;width:180px;height:180px;text-align:center;position:relative;">
            <table cellpadding="0" cellspacing="0" border="0" width="180" height="180" style="width:180px;height:180px;">
              <tr><td valign="middle" align="center" style="background-image:linear-gradient(135deg,${color}33 0%,${color}88 100%);width:180px;height:180px;">
                <div style="font-family:'Archivo Black',sans-serif;font-size:64px;line-height:1;color:#FFFDF3;opacity:0.4;">${emoji}</div>
                <p style="margin:6px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.18em;color:#FFFDF3;text-transform:uppercase;">${escapeHtml(t.category)}</p>
              </td></tr>
            </table>
          </td>`}
      <td valign="top" style="padding:16px 18px;">
        ${opts.showRank && t.daily_rank ? `<span style="display:inline-block;background:#E3000F;color:#fff;font-weight:700;font-size:12px;padding:2px 8px;border-radius:99px;margin-right:6px;">#${t.daily_rank}</span>` : ''}
        <span style="display:inline-block;background:${color}15;color:${color};font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:3px 8px;border-radius:4px;margin-right:6px;">${emoji} ${escapeHtml(t.category)}</span>
        ${countries ? `<span style="font-size:10px;color:#6b7280;">${escapeHtml(countries)}</span>` : ''}
        <h3 style="margin:6px 0 4px 0;font-family:Georgia,serif;font-size:18px;color:#111827;line-height:1.3;">${escapeHtml(t.name)}</h3>
        <p style="margin:6px 0 0 0;font-size:13px;color:#374151;line-height:1.5;">${escapeHtml(t.description.slice(0, 280))}${t.description.length > 280 ? '…' : ''}</p>
        ${t.hashtags && t.hashtags.length > 0 ? `<p style="margin:6px 0 0 0;font-size:11px;color:#6b7280;">${escapeHtml(t.hashtags.slice(0, 5).join(' '))}</p>` : ''}
        ${t.estimated_views ? `<p style="margin:4px 0 0 0;font-size:11px;color:#9ca3af;">📊 ${escapeHtml(t.estimated_views)}</p>` : ''}
        ${brief ? `
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;background:#fafafa;border-radius:4px;">
            <tr>
              <td style="padding:10px 12px;">
                <p style="margin:0 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#FF1300;">Waarom voor Action</p>
                <p style="margin:0 0 10px 0;font-size:13px;color:#1f2937;line-height:1.5;">${escapeHtml(brief.actionRelevance)}</p>
                <p style="margin:0 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#000;">Content angle</p>
                <p style="margin:0 0 6px 0;font-size:12px;color:#374151;line-height:1.5;">${escapeHtml(brief.contentAngle)}</p>
                ${brief.suggestedSound ? `<p style="margin:0;font-size:11px;color:#6b7280;">♪ <strong>${brief.soundRisk === 'safe' ? '✓' : brief.soundRisk === 'risky' ? '⚠' : '?'}</strong> ${escapeHtml(brief.suggestedSound)}</p>` : ''}
                ${brief.productCategories && brief.productCategories.length > 0 ? `
                <p style="margin:8px 0 0 0;font-size:11px;">
                  ${brief.productCategories.map((c) => `<span style="display:inline-block;background:#fef2f2;color:#E3000F;border:1px solid #fecaca;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600;margin-right:4px;">${escapeHtml(c)}</span>`).join('')}
                </p>` : ''}
                <p style="margin:6px 0 0 0;font-size:10px;color:#9ca3af;">⏱️ urgentie ${brief.urgency}/10 · ${escapeHtml(brief.lifecycleStage)}</p>
              </td>
            </tr>
          </table>
        ` : ''}
        ${videoUrls.length > 0 || otherUrls.length > 0 ? `
          <p style="margin:10px 0 0 0;font-size:11px;">
            ${videoUrls.slice(0, 3).map((u) => `<a href="${escapeHtml(u)}" style="display:inline-block;background:#000;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-weight:600;margin-right:4px;margin-bottom:4px;">▶ ${u.includes('tiktok.com') ? 'TikTok' : u.includes('instagram.com') ? 'Reel' : 'YouTube'}</a>`).join('')}
            ${otherUrls.slice(0, 2).map((u) => `<a href="${escapeHtml(u)}" style="display:inline-block;background:#f3f4f6;color:#4a4f5c;padding:4px 10px;border-radius:4px;text-decoration:none;margin-right:4px;margin-bottom:4px;border:1px solid #e5e7eb;">📄 Article</a>`).join('')}
          </p>
        ` : ''}
        ${t.mindmap && (t.mindmap.origin?.length > 0 || t.mindmap.brandPlays?.length > 0) ? `
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:10px;border-top:1px dashed #e5e7eb;">
            <tr>
              <td style="padding:8px 0 0 0;">
                ${t.mindmap.origin && t.mindmap.origin.length > 0 ? `<p style="margin:0 0 4px 0;font-size:10px;color:#6b7280;"><strong style="color:#065f46;">🌱 Origin:</strong> ${escapeHtml(t.mindmap.origin[0].label)}${t.mindmap.origin[0].detail ? ' — ' + escapeHtml(t.mindmap.origin[0].detail.slice(0, 110)) : ''}</p>` : ''}
                ${t.mindmap.brandPlays && t.mindmap.brandPlays.length > 0 ? `<p style="margin:0;font-size:10px;color:#6b7280;"><strong style="color:#b91c1c;">💼 Brand plays:</strong> ${escapeHtml(t.mindmap.brandPlays[0].label)}${t.mindmap.brandPlays[0].detail ? ' — ' + escapeHtml(t.mindmap.brandPlays[0].detail.slice(0, 110)) : ''}</p>` : ''}
              </td>
            </tr>
          </table>
        ` : ''}
      </td>
    </tr>
  </table>
</td></tr>`
}

function renderCreatorCard(c: CreatorForReport): string {
  const platformBg = c.platform === 'tiktok' ? '#000' : c.platform === 'instagram' ? '#E1306C' : '#FF0000'
  const platformLabel = c.platform === 'tiktok' ? 'TT' : c.platform === 'instagram' ? 'IG' : 'YT'
  const followerStr = c.follower_count
    ? c.follower_count >= 1_000_000
      ? `${(c.follower_count / 1_000_000).toFixed(1)}M`
      : c.follower_count >= 1_000
        ? `${Math.round(c.follower_count / 1_000)}K`
        : String(c.follower_count)
    : ''
  const videos = (c.example_video_urls ?? []).slice(0, 2)

  return `
<td valign="top" style="padding:0 6px 12px 0;width:50%;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFDF3;border:1px solid #000;border-left:4px solid #FF1300;">
    <tr>
      <td style="padding:12px 14px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td valign="middle">
              <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:14px;color:#000;letter-spacing:-0.01em;">${c.profile_url ? `<a href="${escapeHtml(c.profile_url)}" style="color:#000;text-decoration:none;">@${escapeHtml(c.handle)}</a>` : `@${escapeHtml(c.handle)}`}</p>
              ${c.name && c.name.replace(/^@/, '') !== c.handle ? `<p style="margin:1px 0 0 0;font-family:'Inter',sans-serif;font-size:11px;color:#000;opacity:0.6;">${escapeHtml(c.name)}</p>` : ''}
            </td>
            <td valign="middle" align="right" width="80">
              <span style="display:inline-block;background:${platformBg};color:#FFFDF3;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.1em;padding:2px 6px;">${platformLabel}</span>
              ${followerStr ? `<span style="display:inline-block;font-family:'Archivo Black',sans-serif;font-size:11px;color:#FF1300;margin-left:4px;">${followerStr}</span>` : ''}
            </td>
          </tr>
        </table>
        ${c.niche ? `<p style="margin:6px 0 0 0;font-family:'Inter',sans-serif;font-size:12px;color:#000;line-height:1.4;">${escapeHtml(c.niche)}</p>` : ''}
        ${c.why_relevant ? `<p style="margin:6px 0 0 0;font-family:'Inter',sans-serif;font-size:11px;color:#000;line-height:1.4;background:#FFFDF3;border-left:2px solid #FF1300;padding:4px 8px;"><strong style="color:#FF1300;">WAAROM:</strong> ${escapeHtml(c.why_relevant)}</p>` : ''}
        ${(c.country_relevance && c.country_relevance.length > 0) || (c.tags && c.tags.length > 0) ? `
          <p style="margin:6px 0 0 0;font-family:'Inter',sans-serif;font-size:10px;color:#000;">
            ${(c.country_relevance ?? []).slice(0, 3).map((cc) => `<span style="display:inline-block;background:#000;color:#FFFDF3;padding:1px 6px;margin-right:3px;font-family:'Archivo Black',sans-serif;font-size:9px;">${escapeHtml(cc)}</span>`).join('')}
            ${(c.tags ?? []).slice(0, 3).map((t) => `<span style="display:inline-block;background:#FFFDF3;color:#000;border:1px solid #000;padding:1px 6px;margin-right:3px;font-size:9px;">${escapeHtml(t)}</span>`).join('')}
          </p>` : ''}
        ${videos.length > 0 ? `
          <p style="margin:8px 0 0 0;">
            ${videos.map((u) => `<a href="${escapeHtml(u)}" style="display:inline-block;background:#000;color:#FFFDF3;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.08em;padding:3px 7px;text-decoration:none;margin-right:3px;">▶ VIDEO</a>`).join('')}
          </p>` : ''}
      </td>
    </tr>
  </table>
</td>`
}

function renderMomentRow(m: MomentForReport): string {
  const date = m.next_occurrence ? new Date(m.next_occurrence) : null
  const daysUntil = date ? Math.ceil((date.getTime() - Date.now()) / 86_400_000) : 0
  const countries = (m.country_dates ?? []).map((c) => c.country).join(' ')
  const brief = m.brand_brief
  return `
<tr>
  <td width="60" valign="top" style="padding:10px 0;text-align:center;">
    <div style="background:#E3000F;color:#fff;border-radius:6px;padding:6px 4px;">
      <div style="font-size:18px;font-weight:700;line-height:1;">${date ? date.getDate() : '?'}</div>
      <div style="font-size:10px;text-transform:uppercase;margin-top:2px;">${date ? date.toLocaleDateString('en-GB', { month: 'short' }) : ''}</div>
      <div style="font-size:9px;margin-top:2px;opacity:0.85;">over ${daysUntil}d</div>
    </div>
  </td>
  <td valign="top" style="padding:10px 0 10px 12px;border-bottom:1px solid #f0f0f0;">
    <p style="margin:0;font-size:14px;font-weight:600;color:#111827;">${escapeHtml(m.name)}</p>
    <p style="margin:2px 0 0 0;font-size:11px;color:#6b7280;">${escapeHtml(m.category)} · ${escapeHtml(countries)}</p>
    <p style="margin:4px 0 0 0;font-size:12px;color:#374151;line-height:1.4;">${escapeHtml(m.description.slice(0, 180))}${m.description.length > 180 ? '…' : ''}</p>
    ${brief ? `<p style="margin:4px 0 0 0;font-size:11px;color:#4a4f5c;"><strong>Voor Action:</strong> ${escapeHtml(brief.contentAngle.slice(0, 200))}</p>` : ''}
  </td>
</tr>`
}

// ── GT Multi-country: live search pulse across markets ────────────────

function renderGtMultiCountrySection(items: GtMultiCountryForReport[]): string {
  return `
<tr><td style="background:#FFFDF3;height:32px;"></td></tr>
<tr>
  <td style="padding:24px 40px 8px;background:#000;border-top:6px solid #FF1300;">
    <table cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:#FF1300;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">🌐</td>
        <td width="12">&nbsp;</td>
        <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#FFFDF3;">Live search · multi-country</p></td>
      </tr>
    </table>
    <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#FFFDF3;text-transform:uppercase;letter-spacing:-0.02em;">🌐 Trending across<br/><span style="color:#FF1300;">${items.length} markets.</span></h2>
    <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#FFFDF3;opacity:0.7;">Google searches spiking in 3+ Action countries simultaneously. Strongest signal of a continent-wide moment.</p>
  </td>
</tr>
<tr><td style="padding:0 40px 24px;background:#000;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    ${items.map((m) => {
      const isHigh = m.actionRelevance === 'high'
      return `
    <tr><td style="padding:0 0 14px 0;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${isHigh ? '#1a0000' : '#1a1a1a'};border:1px solid ${isHigh ? '#FF1300' : '#333'};">
        <tr>
          <td style="padding:14px 18px;">
            <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;color:#FF1300;text-transform:uppercase;">${m.countryCount}× · ${m.category ? escapeHtml(m.category).toUpperCase() : 'TRENDING'} ${m.actionRelevance && m.actionRelevance !== 'none' ? `· ACTION ${m.actionRelevance.toUpperCase()}` : ''}</p>
            <h3 style="margin:6px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:20px;line-height:1.1;color:#FFFDF3;text-transform:uppercase;letter-spacing:-0.01em;">${escapeHtml(m.title)}</h3>
            <p style="margin:6px 0 0 0;font-family:'Inter',sans-serif;font-size:10px;color:#FFFDF3;opacity:0.4;letter-spacing:0.05em;">${m.geos.slice(0, 14).join(' · ')}</p>
            ${m.whyNow ? `<p style="margin:10px 0 0 0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.45;color:#FFFDF3;opacity:0.9;">${escapeHtml(m.whyNow)}</p>` : ''}
            ${m.actionAngle ? `<p style="margin:8px 0 0 0;font-family:'Inter',sans-serif;font-size:12px;line-height:1.4;padding:8px 10px;background:#FF1300;color:#FFFDF3;"><strong style="font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.12em;">ACTION ANGLE: </strong>${escapeHtml(m.actionAngle)}</p>` : ''}
            ${m.topArticle?.url ? `<p style="margin:8px 0 0 0;"><a href="${escapeHtml(m.topArticle.url)}" style="color:#FF1300;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.12em;text-decoration:none;">→ ${escapeHtml(m.topArticle.source ?? 'SOURCE').toUpperCase()}</a></p>` : ''}
          </td>
        </tr>
      </table>
    </td></tr>`
    }).join('')}
  </table>
</td></tr>`
}

// ── GT Country spikes: top spike per market with article context ──────

function renderGtCountrySpikesSection(items: GtCountrySpikeForReport[]): string {
  return `
<tr><td style="background:#FFFDF3;height:32px;"></td></tr>
<tr>
  <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
    <table cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:#000;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">📊</td>
        <td width="12">&nbsp;</td>
        <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Live search · per country</p></td>
      </tr>
    </table>
    <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">📊 What's spiking<br/><span style="color:#FF1300;">in each market.</span></h2>
    <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Top Google search spike per Action country. Country-specifieke verhalen die alleen daar relevant zijn.</p>
  </td>
</tr>
<tr><td style="padding:0 40px;background:#FFFDF3;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    ${items.map((s) => {
      const isHigh = s.actionRelevance === 'high'
      return `
    <tr><td style="padding:0 0 12px 0;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFDF3;border:1px solid #000;border-left:6px solid ${isHigh ? '#FF1300' : '#000'};">
        <tr>
          <td width="100" valign="top" style="padding:14px;background:#000;text-align:center;">
            <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:28px;line-height:1;">${s.flag}</p>
            <p style="margin:6px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.15em;color:#FFFDF3;text-transform:uppercase;">${escapeHtml(s.geo)}</p>
            ${s.traffic ? `<p style="margin:4px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.1em;color:#FF1300;">${escapeHtml(s.traffic)}</p>` : ''}
          </td>
          <td valign="top" style="padding:12px 14px;">
            <div style="margin:0 0 4px 0;">
              ${s.category ? `<span style="display:inline-block;background:#000;color:#FFFDF3;padding:2px 7px;margin-right:4px;font-family:'Archivo Black',sans-serif;font-size:8px;letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(s.category)}</span>` : ''}
              ${s.actionRelevance && s.actionRelevance !== 'none' ? `<span style="display:inline-block;background:${isHigh ? '#FF1300' : '#FFE4E0'};color:${isHigh ? '#FFFDF3' : '#FF1300'};padding:2px 7px;font-family:'Archivo Black',sans-serif;font-size:8px;letter-spacing:0.1em;text-transform:uppercase;">ACTION ${escapeHtml(s.actionRelevance)}</span>` : ''}
            </div>
            <h3 style="margin:4px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:18px;line-height:1.1;color:#000;text-transform:uppercase;letter-spacing:-0.01em;">${escapeHtml(s.title)}</h3>
            ${s.whyNow ? `<p style="margin:8px 0 0 0;font-family:'Inter',sans-serif;font-size:12px;line-height:1.45;color:#1f2937;">${escapeHtml(s.whyNow)}</p>` : ''}
            ${s.actionAngle ? `<p style="margin:8px 0 0 0;font-family:'Inter',sans-serif;font-size:11px;line-height:1.4;padding:6px 10px;background:#FFE4E0;border-left:3px solid #FF1300;color:#000;"><strong style="font-family:'Archivo Black',sans-serif;font-size:8px;letter-spacing:0.12em;color:#FF1300;">ANGLE: </strong>${escapeHtml(s.actionAngle)}</p>` : ''}
            ${s.topArticle?.url ? `<p style="margin:8px 0 0 0;"><a href="${escapeHtml(s.topArticle.url)}" style="font-family:'Inter',sans-serif;font-size:11px;color:#000;text-decoration:none;padding:4px 8px;background:#FAF6E6;border-left:2px solid #000;display:inline-block;line-height:1.3;">→ ${escapeHtml(s.topArticle.title.slice(0, 80))}${s.topArticle.title.length > 80 ? '…' : ''}${s.topArticle.source ? ` <span style="color:#6b6b6b;">· ${escapeHtml(s.topArticle.source)}</span>` : ''}</a></p>` : ''}
          </td>
        </tr>
      </table>
    </td></tr>`
    }).join('')}
  </table>
</td></tr>`
}

// ── Breakout section: highest growth_score, predictive ──────────────────

function renderBreakoutSection(trends: TrendForReport[]): string {
  return `
<tr><td style="background:#FFFDF3;height:32px;"></td></tr>
<tr>
  <td style="padding:24px 40px 8px;background:#000;border-top:6px solid #FF1300;">
    <table cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:#FF1300;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">↗</td>
        <td width="12">&nbsp;</td>
        <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#FFFDF3;">Predictive · growth score 7+</p></td>
      </tr>
    </table>
    <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#FFFDF3;text-transform:uppercase;letter-spacing:-0.02em;">↗ Likely to<br/><span style="color:#FF1300;">break next.</span></h2>
    <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#FFFDF3;opacity:0.7;">Trends our predictor thinks will grow in the next 14 days. Composite of freshness, cross-platform validation, age-window and subculture proximity.</p>
  </td>
</tr>
<tr><td style="padding:0 40px 24px;background:#000;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    ${trends.map(renderBreakoutCard).join('')}
  </table>
</td></tr>`
}

function renderBreakoutCard(t: TrendForReport): string {
  const color = CATEGORY_COLOR[t.category] ?? '#FF1300'
  const emoji = CATEGORY_EMOJI[t.category] ?? '🔥'
  const score = Number(t.growth_score ?? 0).toFixed(1)
  return `
<tr><td style="padding:0 0 14px 0;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#1a1a1a;border:1px solid #FF1300;">
    <tr>
      ${t.thumbnail_url
        ? `<td width="120" valign="top" style="padding:0;background:#000;">
            <img src="${escapeHtml(t.thumbnail_url)}" alt="" width="120" style="display:block;width:120px;height:120px;object-fit:cover;border:0;" />
          </td>`
        : `<td width="120" valign="middle" style="padding:0;width:120px;height:120px;background:linear-gradient(135deg,${color}55,${color}99);text-align:center;">
            <div style="font-family:'Archivo Black',sans-serif;font-size:54px;color:#FFFDF3;opacity:0.4;">${emoji}</div>
          </td>`}
      <td valign="top" style="padding:12px 16px;">
        <p style="margin:0 0 6px 0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.15em;color:#FF1300;text-transform:uppercase;">↗ ${score} / 10 · ${escapeHtml(t.category).toUpperCase()}</p>
        <h3 style="margin:0;font-family:'Archivo Black',sans-serif;font-size:18px;line-height:1.1;color:#FFFDF3;text-transform:uppercase;letter-spacing:-0.01em;">${escapeHtml(t.name)}</h3>
        <p style="margin:6px 0 0 0;font-family:'Inter',sans-serif;font-size:12px;line-height:1.4;color:#FFFDF3;opacity:0.7;">${escapeHtml(t.description.slice(0, 200))}${t.description.length > 200 ? '…' : ''}</p>
        ${t.brand_brief?.contentAngle ? `<p style="margin:8px 0 0 0;font-family:'Inter',sans-serif;font-size:11px;color:#FF1300;"><strong>ANGLE:</strong> <span style="color:#FFFDF3;opacity:0.85;">${escapeHtml(t.brand_brief.contentAngle.slice(0, 140))}</span></p>` : ''}
      </td>
    </tr>
  </table>
</td></tr>`
}

// ── Country pulse: top 4 per major Action market ────────────────────────

function renderCountryPulseSection(byCountry: ReportData['byCountry']): string {
  return `
<tr><td style="background:#FFFDF3;height:32px;"></td></tr>
<tr>
  <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
    <table cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:#000;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">🌍</td>
        <td width="12">&nbsp;</td>
        <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Country pulse</p></td>
      </tr>
    </table>
    <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">🌍 What's<br/><span style="color:#FF1300;">trending where.</span></h2>
    <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Country-specifieke trends per Action markt. Sluit globale trends uit.</p>
  </td>
</tr>
<tr><td style="padding:0 40px;background:#FFFDF3;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    ${byCountry.map((c) => `
    <tr>
      <td style="padding:0 0 12px 0;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAF6E6;border:1px solid #000;border-left:6px solid #FF1300;">
          <tr>
            <td width="120" valign="top" style="padding:14px;background:#000;text-align:center;">
              <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1;">${c.flag}</p>
              <p style="margin:6px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.15em;color:#FFFDF3;text-transform:uppercase;">${escapeHtml(c.code)}</p>
              <p style="margin:2px 0 0 0;font-family:'Inter',sans-serif;font-size:9px;color:#FFFDF3;opacity:0.6;">${escapeHtml(c.label)}</p>
            </td>
            <td valign="top" style="padding:10px 14px;">
              <ol style="margin:0;padding:0 0 0 18px;">
                ${c.trends.map((t) => `
                  <li style="margin-bottom:8px;font-size:12px;line-height:1.4;color:#1a1a1a;">
                    <strong>${escapeHtml(t.name)}</strong>
                    ${t.brand_brief?.contentAngle ? `<span style="display:block;color:#6b6b6b;font-size:11px;margin-top:2px;">${escapeHtml(t.brand_brief.contentAngle.slice(0, 110))}${t.brand_brief.contentAngle.length > 110 ? '…' : ''}</span>` : ''}
                  </li>
                `).join('')}
              </ol>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('')}
  </table>
</td></tr>`
}

// ── Subculture pulse: trends grouped by subculture ──────────────────────

const SUBCULTURE_LABELS_REPORT: Record<string, string> = {
  cottagecore: '🌾 Cottagecore', dark_academia: '📚 Dark Academia',
  clean_girl: '✨ Clean Girl', mob_wife: '💎 Mob Wife',
  coquette: '🎀 Coquette', balletcore: '🩰 Balletcore',
  weirdcore: '🌀 Weirdcore', kidcore: '🧸 Kidcore', y2k: '💿 Y2K',
  alt_fashion: '⛓ Alt Fashion', gorpcore: '🥾 Gorpcore',
  italian_brainrot: '🍝 Italian Brainrot',
  gen_alpha_brainrot: '🧠 Gen Alpha Brainrot',
  ohio_culture: '🌽 Ohio Culture',
  ironic_seriousness: '🤔 Ironic Seriousness',
  foodtok: '🍴 FoodTok', beautytok: '💄 BeautyTok',
  fittok: '💪 FitTok', hometok: '🏠 HomeTok',
  booktok: '📖 BookTok', traveltok: '✈️ TravelTok',
  gaming_fandom: '🎮 Gaming', kpop_fandom: '💖 K-Pop',
  anime_otaku: '🌸 Anime', stan_culture: '⭐ Stan',
  tradwife: '🥧 Tradwife', that_girl: '🌅 That Girl',
  sleepmaxxing: '😴 Sleepmaxxing', lookmax: '💪 Lookmaxxing',
  dimes_square: '🗽 Dimes Square',
  hyperpop: '🎵 Hyperpop', indie_sleaze_revival: '🍷 Indie Sleaze',
  sad_girl_pop: '🥀 Sad Girl Pop',
}

function renderSubcultureSection(bySubculture: ReportData['bySubculture']): string {
  return `
<tr><td style="background:#FFFDF3;height:32px;"></td></tr>
<tr>
  <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
    <table cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:#000;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">◇</td>
        <td width="12">&nbsp;</td>
        <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Subculture pulse</p></td>
      </tr>
    </table>
    <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">◇ This week<br/><span style="color:#FF1300;">in subcultures.</span></h2>
    <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Wat er gebeurt in de hoeken van het internet die we volgen.</p>
  </td>
</tr>
<tr><td style="padding:0 40px;background:#FFFDF3;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    ${bySubculture.map((b) => `
    <tr>
      <td style="padding:0 0 14px 0;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFDF3;border:1px solid #000;">
          <tr>
            <td style="background:#000;padding:8px 14px;">
              <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:14px;color:#FFFDF3;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(SUBCULTURE_LABELS_REPORT[b.subculture] ?? b.subculture)}<span style="color:#FF1300;"> · ${b.trends.length}</span></p>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 14px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${b.trends.map((t) => `
                <tr>
                  <td valign="top" style="padding:6px 0;border-bottom:1px solid #00000010;">
                    <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:13px;color:#000;line-height:1.2;">${escapeHtml(t.name)}</p>
                    <p style="margin:3px 0 0 0;font-family:'Inter',sans-serif;font-size:11px;color:#6b6b6b;line-height:1.4;">${escapeHtml(t.description.slice(0, 140))}${t.description.length > 140 ? '…' : ''}</p>
                  </td>
                </tr>
                `).join('')}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('')}
  </table>
</td></tr>`
}

// ── Editorial features ────────────────────────────────────────────────

function renderDropCapLetter(): string {
  // Match the first letter of the body text. In Dutch "De brief..." → "D".
  return 'D'
}

function renderByTheNumbers(n: MagazineNumbers): string {
  const items: Array<{ value: number | string; label: string; emphasis?: boolean }> = [
    { value: n.trendsTrackedToday,   label: 'Trends tracked', emphasis: true },
    { value: n.trendsFreshLast24h,   label: 'New last 24h' },
    { value: n.multiCountryTrends,   label: 'Multi-country' },
    { value: n.predictedToBreak,     label: 'Predicted breakout' },
    { value: n.subculturesActive,    label: 'Active subcultures' },
    { value: n.creatorsInCohort,     label: "Today's creators" },
    { value: n.momentsNext3Weeks,    label: 'Moments next 3w' },
  ]
  return `
<tr>
  <td style="padding:0 40px 36px;background:#000;color:#FFFDF3;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #FFFDF330;border-bottom:1px solid #FFFDF330;">
      <tr>
        <td style="padding:18px 0 8px;">
          <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FF1300;text-transform:uppercase;">By the numbers</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 18px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              ${items.map((it) => `
              <td valign="top" align="center" style="padding:0 6px;">
                <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:${it.emphasis ? 38 : 28}px;line-height:1;color:${it.emphasis ? '#FF1300' : '#FFFDF3'};letter-spacing:-0.02em;">${it.value}</p>
                <p style="margin:6px 0 0;font-family:'Archivo Black',sans-serif;font-size:8px;letter-spacing:0.15em;text-transform:uppercase;color:#FFFDF3;opacity:0.6;">${it.label}</p>
              </td>`).join('')}
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>`
}

function renderPullQuote(q: PullQuote | null): string {
  if (!q) return ''
  return `
<tr>
  <td style="padding:8px 40px 32px;background:#FFFDF3;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding:36px 44px;background:#FFE4E0;border-left:10px solid #FF1300;position:relative;">
          <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:140px;line-height:0.5;color:#FF1300;opacity:0.25;height:48px;overflow:hidden;">"</p>
          <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FF1300;text-transform:uppercase;">▼ Quote of the day</p>
          <p style="margin:16px 0 0;font-family:'Newsreader',Georgia,serif;font-size:32px;line-height:1.25;font-style:italic;font-weight:400;color:#000;">${escapeHtml(q.text)}</p>
          <p style="margin:18px 0 0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.15em;color:#FF1300;text-transform:uppercase;">— ${escapeHtml(q.attribution)}</p>
        </td>
      </tr>
    </table>
  </td>
</tr>`
}

function renderTableOfContents(data: ReportData): string {
  // Build a TOC from the sections we know will render
  const sections: Array<{ chapter: string; label: string; subtitle: string }> = [
    { chapter: '01', label: "The features", subtitle: `Top ${data.dailyTop10.length} trends · feature spreads on the top three` },
  ]
  if (data.gtMultiCountry.length > 0) sections.push({ chapter: '02', label: 'Live · Multi-country', subtitle: `${data.gtMultiCountry.length} Google searches across 3+ markets` })
  if (data.gtCountrySpikes.length > 0) sections.push({ chapter: '03', label: 'Live · Per country', subtitle: `Top spike per Action market with interpretation` })
  if (data.breakout.length > 0) sections.push({ chapter: '04', label: 'Predicted to break', subtitle: `${data.breakout.length} signals our predictor expects to grow` })
  if (data.byCountry.length > 0) sections.push({ chapter: '05', label: 'Country pulse', subtitle: `Country-specific trends per Action market` })
  if (data.bySubculture.length > 0) sections.push({ chapter: '06', label: 'Subculture spotlight', subtitle: `${data.bySubculture.length} active subcultures` })
  if (data.inspiration.length > 0) sections.push({ chapter: '07', label: 'Steal these formats', subtitle: `${data.inspiration.length} formats to copy directly` })
  if (data.emerging.length > 0) sections.push({ chapter: '08', label: 'Emerging signals', subtitle: `${data.emerging.length} early-stage trends to watch` })
  if (data.creators.length > 0) sections.push({ chapter: '09', label: 'Creators of the day', subtitle: `${data.creators.length} new niche creators` })
  if (data.upcomingMoments.length > 0) sections.push({ chapter: '10', label: 'Calendar', subtitle: `${data.upcomingMoments.length} moments in the next three weeks` })

  return `
<tr>
  <td style="padding:32px 40px 8px;background:#FFFDF3;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:4px solid #000;">
      <tr>
        <td style="padding:18px 0 14px;">
          <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FF1300;text-transform:uppercase;">Inside this issue</p>
          <p style="margin:6px 0 0;font-family:'Archivo Black',sans-serif;font-size:36px;line-height:1.0;text-transform:uppercase;letter-spacing:-0.02em;color:#000;">Contents<span style="color:#FF1300;">.</span></p>
        </td>
      </tr>
      ${sections.map((s) => `
      <tr>
        <td style="padding:10px 0;border-top:1px solid #00000020;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="60" valign="top" style="padding-top:3px;">
                <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:18px;color:#FF1300;letter-spacing:0;">${s.chapter}</p>
              </td>
              <td valign="top">
                <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:18px;color:#000;text-transform:uppercase;letter-spacing:-0.01em;">${escapeHtml(s.label)}</p>
                <p style="margin:2px 0 0;font-family:'Inter',sans-serif;font-size:12px;color:#6b6b6b;line-height:1.4;">${escapeHtml(s.subtitle)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`).join('')}
    </table>
  </td>
</tr>`
}

function renderContentIdeasSection(daily: TrendForReport[]): string {
  // Surface the 6 most actionable content angles from top trends as
  // a "today's content ideas" sidebar
  const ideas = daily
    .filter((t) => t.brand_brief?.contentAngle && t.brand_brief.contentAngle.length >= 20)
    .slice(0, 6)
  if (ideas.length === 0) return ''
  return `
<tr>
  <td style="padding:24px 40px 32px;background:#FFFDF3;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#000;color:#FFFDF3;">
      <tr>
        <td style="padding:28px 32px 16px;">
          <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FF1300;text-transform:uppercase;">▶ Today's content ideas</p>
          <h2 style="margin:8px 0 0;font-family:'Archivo Black',sans-serif;font-size:34px;line-height:1.0;text-transform:uppercase;letter-spacing:-0.02em;">Six angles<br/><span style="color:#FF1300;">to film today.</span></h2>
          <p style="margin:12px 0 0;font-family:'Newsreader',Georgia,serif;font-size:15px;line-height:1.45;color:#FFFDF3;opacity:0.7;font-style:italic;">Geëxtraheerd uit de Action briefs van de top trends. Pak één, draai vanmiddag.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 28px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${ideas.map((t, i) => `
            <tr>
              <td style="padding:14px 0;border-top:1px solid #FFFDF320;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td width="40" valign="top" style="padding-top:3px;">
                      <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:16px;color:#FF1300;">${String(i + 1).padStart(2, '0')}</p>
                    </td>
                    <td valign="top">
                      <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.12em;color:#FFFDF3;text-transform:uppercase;opacity:0.7;">${escapeHtml(t.name).slice(0, 50)}</p>
                      <p style="margin:6px 0 0;font-family:'Newsreader',Georgia,serif;font-size:17px;line-height:1.4;color:#FFFDF3;">${escapeHtml(t.brand_brief!.contentAngle.slice(0, 240))}${t.brand_brief!.contentAngle.length > 240 ? '…' : ''}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`).join('')}
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>`
}

/**
 * Detect a usable TikTok video URL in the example list.
 * TikTok videos look like https://www.tiktok.com/@user/video/12345...
 * Returns the first match, or null if none found.
 */
function pickTikTokEmbed(urls: string[] | null): { url: string; videoId: string; creator: string } | null {
  if (!urls) return null
  for (const u of urls) {
    const m = u.match(/https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._-]+)\/video\/(\d+)/i)
    if (m) {
      return { url: u, videoId: m[2], creator: m[1] }
    }
  }
  return null
}

/**
 * TikTok blockquote embed — exactly what oEmbed returns. The TikTok
 * embed.js script auto-loads each blockquote into a player. We include
 * the script once per page (via renderReportHtml head).
 */
function renderTikTokEmbed(emb: { url: string; videoId: string; creator: string }): string {
  return `
<blockquote class="tiktok-embed" cite="${escapeHtml(emb.url)}" data-video-id="${escapeHtml(emb.videoId)}" style="max-width:605px;min-width:325px;margin:0 auto;">
  <section>
    <a target="_blank" rel="noreferrer" href="${escapeHtml(emb.url)}">@${escapeHtml(emb.creator)}</a>
  </section>
</blockquote>`
}

function renderSparklineSvg(points: number[], color: string = '#FF1300'): string {
  if (points.length < 2) return ''
  const w = 280; const h = 50
  const max = Math.max(...points, 10)
  const min = Math.min(...points, 0)
  const range = max - min || 1
  const step = w / (points.length - 1)
  const path = points.map((p, i) => {
    const x = (i * step).toFixed(1)
    const y = (h - ((p - min) / range) * (h - 6) - 3).toFixed(1)
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
  const lastPoint = points[points.length - 1]
  const lastX = w
  const lastY = h - ((lastPoint - min) / range) * (h - 6) - 3
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + 6} ${h}" width="${w + 6}" height="${h}" style="display:block;">
  <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
  <circle cx="${lastX}" cy="${lastY}" r="3" fill="${color}"/>
</svg>`
}

function renderFeatureSpread(t: TrendForReport, rank: number, snapshots: SnapshotForReport[]): string {
  const palette = categoryArtPalette(t.category)
  const brief = t.brand_brief
  const hasThumb = !!t.thumbnail_url
  const cleanInitial = (t.name.replace(/^#/, '').charAt(0).toUpperCase())
  const sparkData = snapshots.map((s) => s.popularity_score)
  const hasSparkline = sparkData.length >= 2
  const tiktokEmbed = pickTikTokEmbed(t.example_urls ?? null)

  // Big art-directed visual (image-or-poster) on top, content below
  const visual = hasThumb
    ? `<div style="height:340px;background-image:linear-gradient(180deg,rgba(0,0,0,0.05),rgba(0,0,0,0.6) 80%,rgba(0,0,0,0.85)),url(${escapeHtml(t.thumbnail_url!)});background-size:cover;background-position:center;"></div>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="340" viewBox="0 0 760 340" preserveAspectRatio="xMidYMid slice" style="display:block;">
         <defs>
           <linearGradient id="fs-${t.id.slice(0, 8)}" x1="0" y1="0" x2="1" y2="1">
             <stop offset="0%" stop-color="${palette.primary}" stop-opacity="1"/>
             <stop offset="100%" stop-color="${palette.secondary}" stop-opacity="0.92"/>
           </linearGradient>
         </defs>
         <rect width="760" height="340" fill="url(#fs-${t.id.slice(0, 8)})"/>
         <text x="700" y="310" text-anchor="end" font-family="Archivo Black,sans-serif" font-size="280" fill="${palette.foreground}" opacity="0.1" letter-spacing="-12">${cleanInitial}</text>
         <rect x="0" y="0" width="760" height="4" fill="${palette.accent}"/>
         <rect x="40" y="280" width="80" height="3" fill="${palette.accent}"/>
       </svg>`

  return `
<tr>
  <td style="padding:24px 40px 0;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFDF3;border:1px solid #000;">
      <tr>
        <td style="padding:0;background:#000;color:#FFFDF3;position:relative;">
          ${visual}
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="position:absolute;bottom:0;left:0;right:0;">
            <tr>
              <td style="padding:24px 32px 28px;">
                <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.25em;color:#FF1300;text-transform:uppercase;">№${String(rank).padStart(2, '0')} · ${escapeHtml(t.category).toUpperCase()}${t.subculture ? ` · ◇ ${escapeHtml(t.subculture)}` : ''}</p>
                <h3 style="margin:10px 0 0;font-family:'Archivo Black',sans-serif;font-size:46px;line-height:0.9;color:#FFFDF3;text-transform:uppercase;letter-spacing:-0.025em;max-width:88%;">${escapeHtml(t.name)}<span style="color:#FF1300;">.</span></h3>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 12px;">
          <p style="margin:0;font-family:'Newsreader',Georgia,serif;font-size:18px;line-height:1.5;color:#000;">${escapeHtml(t.description)}</p>
          ${t.hashtags && t.hashtags.length > 0 ? `<p style="margin:14px 0 0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.1em;color:#FF1300;">${escapeHtml(t.hashtags.slice(0, 6).join(' '))}</p>` : ''}
        </td>
      </tr>
      ${tiktokEmbed ? `
      <tr>
        <td style="padding:0 32px 16px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAF6E6;border:1px solid #000;">
            <tr>
              <td style="padding:14px 18px 8px;">
                <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FF1300;text-transform:uppercase;">▶ Live TikTok · @${escapeHtml(tiktokEmbed.creator)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 18px 18px;text-align:center;">
                ${renderTikTokEmbed(tiktokEmbed)}
              </td>
            </tr>
          </table>
        </td>
      </tr>` : ''}
      ${brief ? `
      <tr>
        <td style="padding:0 32px 16px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#000;color:#FFFDF3;">
            <tr>
              <td style="padding:18px 22px;">
                <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FF1300;text-transform:uppercase;">For Action · Why now</p>
                <p style="margin:8px 0 14px;font-family:'Newsreader',Georgia,serif;font-size:16px;line-height:1.5;color:#FFFDF3;">${escapeHtml(brief.actionRelevance)}</p>

                <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FFFDF3;text-transform:uppercase;">Content angle</p>
                <p style="margin:8px 0 14px;font-family:'Inter',sans-serif;font-size:14px;line-height:1.5;color:#FFFDF3;opacity:0.92;">${escapeHtml(brief.contentAngle)}</p>

                ${brief.suggestedSound ? `
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:10px;background:${brief.soundRisk === 'safe' ? '#FF1300' : '#1a1a1a'};">
                  <tr><td style="padding:12px 16px;">
                    <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;color:#FFFDF3;text-transform:uppercase;">♪ Sound · ${brief.soundRisk === 'safe' ? '✓ Safe to use' : brief.soundRisk === 'risky' ? '⚠ Risky' : '? Check rights'}</p>
                    <p style="margin:6px 0 0;font-family:'Inter',sans-serif;font-size:13px;color:#FFFDF3;line-height:1.45;">${escapeHtml(brief.suggestedSound)}</p>
                  </td></tr>
                </table>` : ''}

                ${brief.productCategories && brief.productCategories.length > 0 ? `
                <p style="margin:14px 0 0;">
                  ${brief.productCategories.map((c) => `<span style="display:inline-block;background:#FFFDF3;color:#000;padding:3px 10px;margin:0 4px 4px 0;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(c)}</span>`).join('')}
                </p>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>` : ''}

      ${hasSparkline || t.estimated_views ? `
      <tr>
        <td style="padding:0 32px 22px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #00000020;">
            <tr>
              <td valign="middle" style="padding:14px 0 0;">
                ${t.estimated_views ? `<p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;color:#000;text-transform:uppercase;">📊 ${escapeHtml(t.estimated_views)}</p>` : ''}
                ${t.growth_score != null ? `<p style="margin:4px 0 0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;color:#FF1300;">↗ Growth ${Number(t.growth_score).toFixed(1)}/10</p>` : ''}
              </td>
              ${hasSparkline ? `<td align="right" style="padding:14px 0 0;">
                <p style="margin:0 0 4px;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.15em;color:#6b6b6b;text-transform:uppercase;">Popularity · ${sparkData.length}d</p>
                ${renderSparklineSvg(sparkData)}
              </td>` : ''}
            </tr>
          </table>
        </td>
      </tr>` : ''}
    </table>
  </td>
</tr>`
}

function renderEditorPicksSection(picks: EditorPick[]): string {
  if (picks.length === 0) return ''
  return `
<tr>
  <td style="padding:8px 40px 32px;background:#FFFDF3;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding:0 0 16px;border-bottom:2px solid #000;">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background:#FF1300;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;">★</td>
              <td width="12">&nbsp;</td>
              <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Editor's picks · ${picks.length}</p></td>
            </tr>
          </table>
          <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:36px;line-height:1.0;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">Action vandaag<br/><span style="color:#FF1300;">drie keuzes.</span></h2>
        </td>
      </tr>
      ${picks.map((p, i) => `
      <tr>
        <td style="padding:24px 0;border-bottom:1px solid #00000020;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="80" valign="top">
                <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:60px;line-height:0.9;color:#FF1300;letter-spacing:-0.04em;">${String(i + 1).padStart(2, '0')}</p>
              </td>
              <td valign="top" style="padding-left:20px;">
                <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.2em;color:#FF1300;text-transform:uppercase;">${escapeHtml(p.trend.category).toUpperCase()}${p.trend.subculture ? ` · ◇ ${p.trend.subculture}` : ''}</p>
                <h3 style="margin:6px 0 8px;font-family:'Archivo Black',sans-serif;font-size:26px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.015em;">${escapeHtml(p.trend.name)}</h3>
                <p style="margin:0;font-family:'Newsreader',Georgia,serif;font-size:16px;line-height:1.5;color:#1a1a1a;font-weight:400;">${escapeHtml(p.reason)}</p>
                ${p.trend.brand_brief?.contentAngle ? `<p style="margin:10px 0 0;font-family:'Inter',sans-serif;font-size:12px;color:#000;background:#FAF6E6;border-left:3px solid #000;padding:8px 12px;line-height:1.4;"><strong style="font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.15em;color:#FF1300;text-transform:uppercase;">Angle · </strong>${escapeHtml(p.trend.brand_brief.contentAngle.slice(0, 220))}${p.trend.brand_brief.contentAngle.length > 220 ? '…' : ''}</p>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>`).join('')}
    </table>
  </td>
</tr>`
}

export function renderReportHtml(data: ReportData): string {
  const dateLabel = formatDate(data.generatedAt)
  const totalTrends = data.dailyTop10.length + data.weeklyTop20.length + data.inspiration.length + data.emerging.length

  // JackandAI brand palette
  // - Primary red: #FF1300
  // - Black: #000000
  // - Cream: #FFFDF3
  // Fonts: Benzin-style display (Archivo Black as approximation) + clean sans (Inter)

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Culture Radar Daily — ${dateLabel}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&family=Newsreader:ital,wght@0,300..700;1,300..700&display=swap" rel="stylesheet" />
<!-- TikTok embed script — picks up any .tiktok-embed blockquote and renders the player -->
<script async src="https://www.tiktok.com/embed.js"></script>
<style>
  body { margin: 0; padding: 0; background: #FFFDF3; font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #000000; }
  h1, h2, h3 { font-family: 'Archivo Black', 'Archivo', sans-serif; letter-spacing: -0.01em; }
  a { color: inherit; }
  .display { font-family: 'Archivo Black', sans-serif; }
  @media print {
    body { background: #FFFDF3; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#FFFDF3;font-family:'Inter',sans-serif;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFDF3;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table cellpadding="0" cellspacing="0" border="0" width="760" style="max-width:760px;background:#FFFDF3;">
        <!-- Magazine cover: bold masthead with issue # + date + dek -->
        <tr>
          <td style="padding:0;background:#000000;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="padding:24px 40px 12px;color:#FFFDF3;border-bottom:1px solid #FFFDF330;">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td valign="middle">
                        <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#FF1300;">JACK&amp;A! × ACTION</p>
                      </td>
                      <td valign="middle" align="right">
                        <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FFFDF3;opacity:0.6;text-transform:uppercase;">ISSUE №${String(data.issueNumber).padStart(3, '0')} · ${data.week}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:36px 40px 8px;color:#FFFDF3;">
                  <h1 style="margin:0;font-family:'Archivo Black',sans-serif;font-size:110px;line-height:0.82;font-weight:900;text-transform:uppercase;letter-spacing:-0.04em;color:#FFFDF3;">Culture<br/>Radar<span style="color:#FF1300;">.</span></h1>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 40px 28px;">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td valign="middle" style="border-top:2px solid #FF1300;padding-top:14px;">
                        <p style="margin:0;font-family:'Newsreader',Georgia,serif;font-size:20px;color:#FFFDF3;font-style:italic;font-weight:300;">${dateLabel}</p>
                      </td>
                      <td valign="middle" align="right" style="border-top:2px solid #FF1300;padding-top:14px;">
                        <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.18em;color:#FF1300;text-transform:uppercase;">Daily intelligence · ${totalTrends}+ signals</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              ${data.dailyTop10[0] ? renderCoverHero(data.dailyTop10[0]) : ''}
              ${renderByTheNumbers(data.numbers)}
            </table>
          </td>
        </tr>
        <!-- Red accent strip -->
        <tr><td style="background:#FF1300;height:8px;line-height:0;font-size:0;">&nbsp;</td></tr>

        <!-- Editor's letter — drop cap + signature -->
        <tr>
          <td style="padding:48px 40px 24px;background:#FFFDF3;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td valign="top">
                  <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FF1300;text-transform:uppercase;">From the editor · Brief №${String(data.issueNumber).padStart(3, '0')}</p>
                  <h2 style="margin:14px 0 24px;font-family:'Archivo Black',sans-serif;font-size:42px;line-height:0.95;text-transform:uppercase;letter-spacing:-0.025em;color:#000;">
                    What's hot today<span style="color:#FF1300;">.</span>
                  </h2>
                  <p style="margin:0;font-family:'Newsreader',Georgia,serif;font-size:20px;line-height:1.5;color:#000;font-weight:400;">
                    <span style="float:left;font-family:'Archivo Black',sans-serif;font-size:78px;line-height:0.78;color:#FF1300;padding:6px 12px 0 0;margin-top:6px;">${renderDropCapLetter()}</span>
                    e brief van vandaag staat in het teken van ${data.numbers.trendsFreshLast24h} nieuwe signalen die we de afgelopen 24 uur uit het culturele veld haalden. <strong>${data.dailyTop10.length} trends</strong> bovenaan, <strong>${data.numbers.multiCountryTrends} verhalen</strong> die in 3+ Action markten tegelijk popten, <strong>${data.numbers.predictedToBreak} signalen</strong> die onze predictor verwacht binnen 14 dagen door te breken, en <strong>${data.numbers.subculturesActive} actieve subcultures</strong> waarvan ${data.numbers.subculturesRising} in stijgende lijn.
                  </p>
                  <p style="margin:18px 0 0;font-family:'Newsreader',Georgia,serif;font-size:18px;line-height:1.55;color:#000;font-weight:400;">
                    Plus <strong>${data.inspiration.length} formats</strong> om direct over te nemen, <strong>${data.creators.length} creators</strong> die het waard zijn om vandaag te volgen, en <strong>${data.upcomingMoments.length} kalendermomenten</strong> die in de komende drie weken vallen.
                  </p>
                  <p style="margin:24px 0 0;font-family:'Inter',sans-serif;font-size:13px;color:#6b6b6b;letter-spacing:0.02em;">
                    Een trend met <strong style="color:#FF1300;">✓ SAFE</strong> sound is rechtenvrij voor Action's TikTok Business Account. Een <strong style="color:#FF1300;">↗ BREAKOUT</strong> badge betekent dat onze predictor groei verwacht. Klik op een trend voor de bron.
                  </p>
                  <p style="margin:24px 0 0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;color:#000;text-transform:uppercase;">— De redactie</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${renderTableOfContents(data)}

        ${renderPullQuote(data.pullQuote)}

        ${renderEditorPicksSection(data.editorPicks)}

        ${renderContentIdeasSection(data.dailyTop10)}

        <!-- DAILY TOP 10 -->
        <tr>
          <td style="padding:40px 40px 8px;background:#FFFDF3;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#FF1300;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">01</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">The features · ${data.dailyTop10.length} trends</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:38px;line-height:1.0;color:#000;text-transform:uppercase;letter-spacing:-0.025em;">🔥 What's hot<br/><span style="color:#FF1300;">right now.</span></h2>
            <p style="margin:10px 0 6px 0;font-family:'Newsreader',Georgia,serif;font-size:17px;line-height:1.4;color:#000;font-style:italic;font-weight:300;">De trends die Action's team vandaag moet kennen. De top drie krijgen een feature-spread. De rest staat in compact format.</p>
          </td>
        </tr>

        <!-- Top 3 as feature spreads -->
        ${data.dailyTop10.slice(0, 3).map((t, i) =>
          renderFeatureSpread(t, t.daily_rank ?? i + 1, data.snapshotsByTrendId[t.id] ?? [])
        ).join('')}

        <!-- #4-10 as standard cards -->
        ${data.dailyTop10.length > 3 ? `
        <tr><td style="padding:24px 40px 8px;">
          <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Top ${data.dailyTop10.length - 3} more</p>
          <div style="height:2px;background:#000;margin:8px 0 16px;"></div>
        </td></tr>
        <tr><td style="padding:0 40px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${data.dailyTop10.slice(3).map((t) => renderTrendCard(t, { showRank: true })).join('')}
          </table>
        </td></tr>` : ''}

        ${data.gtMultiCountry.length > 0 ? renderGtMultiCountrySection(data.gtMultiCountry) : ''}

        ${data.gtCountrySpikes.length > 0 ? renderGtCountrySpikesSection(data.gtCountrySpikes) : ''}

        ${data.breakout.length > 0 ? renderBreakoutSection(data.breakout) : ''}

        ${data.byCountry.length > 0 ? renderCountryPulseSection(data.byCountry) : ''}

        ${data.bySubculture.length > 0 ? renderSubcultureSection(data.bySubculture) : ''}

        ${data.inspiration.length > 0 ? `
        <!-- INSPIRATION -->
        <tr><td style="background:#FFFDF3;height:32px;"></td></tr>
        <tr>
          <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#000;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">02</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Inspiration formats</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">💡 Steal these<br/><span style="color:#FF1300;">formats.</span></h2>
            <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Manieren om content te MAKEN: edit-tricks, visuele signaturen, format-templates.</p>
          </td>
        </tr>
        <tr><td style="padding:0 40px;background:#FFFDF3;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${data.inspiration.map((t) => renderTrendCard(t)).join('')}
          </table>
        </td></tr>` : ''}

        ${data.emerging.length > 0 ? `
        <!-- EMERGING -->
        <tr><td style="background:#FFFDF3;height:32px;"></td></tr>
        <tr>
          <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#000;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">03</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Emerging signals</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">✨ Get in<br/><span style="color:#FF1300;">early.</span></h2>
            <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Klein maar stijgend: claim de trend voor hij mainstream wordt.</p>
          </td>
        </tr>
        <tr><td style="padding:0 40px;background:#FFFDF3;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${data.emerging.map((t) => renderTrendCard(t)).join('')}
          </table>
        </td></tr>` : ''}

        ${data.creators.length > 0 ? `
        <!-- CREATORS — 25 of the day -->
        <tr><td style="background:#FFFDF3;height:32px;"></td></tr>
        <tr>
          <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#000;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">04</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">${data.creators.length} creators of the day</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">📺 New creators<br/><span style="color:#FF1300;">to watch.</span></h2>
            <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Niche creators, elke dag gerouleerd vanuit een andere invalshoek. Vandaag ${data.creators.length} nieuwe namen.</p>
          </td>
        </tr>
        <tr><td style="padding:0 40px;background:#FFFDF3;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${(() => {
              // Render as 2-col grid: 2 creators per <tr>
              const rows: string[] = []
              for (let i = 0; i < data.creators.length; i += 2) {
                rows.push(
                  `<tr>${renderCreatorCard(data.creators[i])}${
                    data.creators[i + 1] ? renderCreatorCard(data.creators[i + 1]) : '<td style="width:50%"></td>'
                  }</tr>`,
                )
              }
              return rows.join('')
            })()}
          </table>
        </td></tr>` : ''}

        ${data.upcomingMoments.length > 0 ? `
        <!-- MOMENTS -->
        <tr><td style="background:#FFFDF3;height:32px;"></td></tr>
        <tr>
          <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#FF1300;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">05</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Upcoming moments</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">📅 Coming<br/><span style="color:#FF1300;">next 3 weeks.</span></h2>
            <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Bouw campagnes en content rond deze momenten.</p>
          </td>
        </tr>
        <tr><td style="padding:0 40px 40px;background:#FFFDF3;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${data.upcomingMoments.map(renderMomentRow).join('')}
          </table>
        </td></tr>` : ''}

        <!-- Footer in JackandAI black -->
        <tr>
          <td style="padding:40px 40px;background:#000000;text-align:center;">
            <p style="margin:0 0 12px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:0.95;letter-spacing:-0.02em;color:#FFFDF3;text-transform:uppercase;">Jack<span style="color:#FF1300;">&amp;</span>A<span style="color:#FF1300;">!</span></p>
            <p style="margin:0 0 4px 0;font-family:'Inter',sans-serif;font-size:11px;color:#FFFDF3;opacity:0.5;">Samengesteld op ${new Date(data.generatedAt).toLocaleString('nl-NL')} · Dagelijkse briefing van je AI agency</p>
            <p style="margin:12px 0 0 0;font-family:'Inter',sans-serif;font-size:12px;">
              <a href="https://action-culture-radar.vercel.app/culture-radar" style="color:#FF1300;text-decoration:none;font-weight:700;">→ Live dashboard</a>
              <span style="color:#FFFDF3;opacity:0.3;">&nbsp;·&nbsp;</span>
              <a href="https://action-culture-radar.vercel.app/moments-radar" style="color:#FF1300;text-decoration:none;font-weight:700;">→ Moments Radar</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}
