/**
 * POST /api/culture/fetch
 *
 * Triggers a full Culture Radar refresh:
 *   1. Loads active sources from `culture_sources`.
 *   2. Scrapes each via Firecrawl (concurrency-limited).
 *   3. For each source, asks Gemini to extract trends.
 *   4. Merges trends across sources (multi-source = higher validation).
 *   5. Upserts into `culture_trends` for the current ISO week.
 *   6. Recomputes daily + weekly ranks.
 *   7. Archives trends older than 7 days.
 *   8. Logs the run in `culture_fetch_runs`.
 *
 * Body (all optional):
 *   {
 *     "sourceIds":     [1, 2, 3],     // subset; default = all active
 *     "categories":    ["food"],       // filter sources by category
 *     "maxSources":    null,           // hard cap (debugging)
 *     "skipAi":        false,          // dry-run scrape only
 *     "triggeredBy":   "manual",
 *     "lookbackDays":  7               // widen window for backfill
 *   }
 *
 * Returns: { runId, status, summary, failures }
 *
 * Storage: Neon / Vercel Postgres (via lib/culture-db.ts). No Supabase.
 */

import { NextResponse } from 'next/server'
import FirecrawlApp from '@mendable/firecrawl-js'
import { analyzeSourceContent } from '@/lib/culture-ai'
import { CULTURE_GEMINI_MODEL } from '@/lib/constants'
import { fetchGoogleTrends, type GoogleTrendItem } from '@/lib/google-trends'
import { perplexitySearch, perplexityToMarkdown } from '@/lib/perplexity'
import {
  fetchCreativeCenterHashtags,
  industryToCategory,
  popularityFromPostCount,
  type CreativeCenterHashtag,
} from '@/lib/tiktok-cc'
import {
  freshnessScore,
  isoDate,
  isoWeek,
  mergeTrends,
  rankingScore,
  slugify,
  validationScore,
  type MergedTrend,
} from '@/lib/culture-radar'
import {
  applyTrendRanks,
  archiveStaleTrends,
  createFetchRun,
  findTrendForUpsert,
  finishFetchRun,
  insertTrend,
  listSources,
  loadActiveTrendsForRanking,
  updateSourceScrapeStatus,
  updateTrend,
} from '@/lib/culture-db'
import type {
  AIIdentifiedTrend,
  CultureCategory,
  ScrapeResult,
} from '@/types/culture'

export const maxDuration = 300

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY ?? '' })

const SCRAPE_CONCURRENCY = 8
const AI_CONCURRENCY = 4
const MAX_TRENDS_PER_SOURCE = 8

// ───────────────────────────────────────────────────────────────────────────

interface FetchBody {
  sourceIds?: number[]
  categories?: CultureCategory[]
  maxSources?: number | null
  skipAi?: boolean
  triggeredBy?: string
  /** Widen the lookback window when scraping + prompting. 0 = current only. */
  lookbackDays?: number
}

export interface SourceRow {
  id: number
  name: string
  url: string
  category: CultureCategory
  source_type: string
  reliability: number
  active: boolean
  notes?: string | null
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as FetchBody

  // ── 1. Load sources ─────────────────────────────────────────────────────
  let sources: SourceRow[]
  try {
    const rows = await listSources({
      activeOnly: true,
      ids: body.sourceIds,
      categories: body.categories,
    })
    sources = rows as unknown as SourceRow[]
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }

  if (body.maxSources) sources = sources.slice(0, body.maxSources)
  if (sources.length === 0) {
    return NextResponse.json({ error: 'No active sources matched filters' }, { status: 400 })
  }

  // ── 2. Create run row ───────────────────────────────────────────────────
  let runId: string
  try {
    runId = await createFetchRun({
      triggeredBy: body.triggeredBy ?? 'manual',
      sourcesAttempted: sources.length,
      aiModel: CULTURE_GEMINI_MODEL,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to create run: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  // ── 3. Scrape (concurrency-limited) ─────────────────────────────────────
  const lookbackDays = Math.max(0, Math.min(30, body.lookbackDays ?? 0))
  console.log(`[culture/fetch:${runId}] start scraping ${sources.length} sources, lookback=${lookbackDays}d`)
  const scrapeResults = await runConcurrent(sources, SCRAPE_CONCURRENCY, (s) =>
    scrapeSource(s, lookbackDays),
  )
  const okScrapes = scrapeResults.filter((r) => r.ok)
  const failedScrapes = scrapeResults.filter((r) => !r.ok)
  console.log(`[culture/fetch:${runId}] scrape done: ${okScrapes.length} ok, ${failedScrapes.length} failed`)

  // Persist last_scraped_at + status per source.
  await Promise.all(
    scrapeResults.map((r) =>
      updateSourceScrapeStatus({
        id: r.sourceId,
        fetchedAt: r.fetchedAt,
        status: r.ok ? 'ok' : 'error',
        error: r.error ?? null,
      }).catch((err) => console.error(`[culture/fetch] status update failed for ${r.sourceId}`, err)),
    ),
  )

  // ── 4. AI analyze (skippable for dry runs) ──────────────────────────────
  let tokensIn = 0
  let tokensOut = 0
  let identified: Array<AIIdentifiedTrend & { sourceId: number; sourceName: string }> = []

  if (!body.skipAi && okScrapes.length > 0) {
    const aiResults = await runConcurrent(okScrapes, AI_CONCURRENCY, async (scrape) => {
      try {
        // ── Shortcut for pre-structured sources (TikTok Creative Center) ──
        // These already produce structured trend data — skip the Gemini step.
        if (scrape.textSnippet.startsWith('{"__tiktok_cc_hashtags":')) {
          try {
            const parsed = JSON.parse(scrape.textSnippet) as {
              __tiktok_cc_hashtags: CreativeCenterHashtag[]
            }
            const trends = convertCCHashtagsToTrends(
              parsed.__tiktok_cc_hashtags,
              scrape.sourceCategory,
            )
            return trends.map((t) => ({
              ...t,
              sourceId: scrape.sourceId,
              sourceName: scrape.sourceName,
            }))
          } catch (err) {
            console.error(`[culture/fetch] CC conversion failed for ${scrape.sourceName}`, err)
            return []
          }
        }

        const ai = await analyzeSourceContent({
          sourceName: scrape.sourceName,
          sourceCategory: scrape.sourceCategory,
          sourceUrl: scrape.url,
          contentMarkdown: scrape.textSnippet,
          maxTrends: MAX_TRENDS_PER_SOURCE,
          lookbackDays,
        })
        tokensIn += ai.tokensIn ?? 0
        tokensOut += ai.tokensOut ?? 0
        return ai.trends.map((t) => ({
          ...t,
          sourceId: scrape.sourceId,
          sourceName: scrape.sourceName,
        }))
      } catch (err) {
        console.error(`[culture/fetch] AI failed for ${scrape.sourceName}`, err)
        return []
      }
    })
    identified = aiResults.flat()
  }
  console.log(`[culture/fetch:${runId}] AI done: ${identified.length} raw trends identified, tokens=${tokensIn}/${tokensOut}`)

  // ── 5. Merge across sources, write to DB ────────────────────────────────
  const merged = mergeTrends(identified)
  const week = isoWeek()
  const today = isoDate()
  const now = new Date()
  console.log(`[culture/fetch:${runId}] merged → ${merged.length} unique trends, week=${week}`)

  let inserted = 0
  let updated = 0

  for (const m of merged) {
    try {
      const result = await upsertTrend(m, week, now)
      if (result === 'inserted') inserted++
      else if (result === 'updated') updated++
    } catch (err) {
      console.error(`[culture/fetch:${runId}] upsertTrend threw for "${m.name}":`, err)
    }
  }
  console.log(`[culture/fetch:${runId}] upsert done: ${inserted} inserted, ${updated} updated`)

  // ── 6. Recompute daily + weekly ranks ───────────────────────────────────
  try {
    await recomputeRanks(week, today)
    console.log(`[culture/fetch:${runId}] ranks recomputed`)
  } catch (err) {
    console.error(`[culture/fetch:${runId}] recomputeRanks threw:`, err)
  }

  // ── 7. Archive trends older than 7 days ─────────────────────────────────
  try {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    await archiveStaleTrends(cutoff)
    console.log(`[culture/fetch:${runId}] stale trends archived`)
  } catch (err) {
    console.error(`[culture/fetch:${runId}] archiveStaleTrends threw:`, err)
  }

  // ── 8. Close out run row ────────────────────────────────────────────────
  const status =
    failedScrapes.length === 0
      ? 'ok'
      : okScrapes.length === 0
        ? 'failed'
        : 'partial'

  console.log(`[culture/fetch:${runId}] calling finishFetchRun, status=${status}`)
  try {
    await finishFetchRun({
      id: runId,
      finishedAt: new Date().toISOString(),
      sourcesOk: okScrapes.length,
      sourcesFailed: failedScrapes.length,
      trendsInserted: inserted,
      trendsUpdated: updated,
      status,
      aiTokensIn: tokensIn,
      aiTokensOut: tokensOut,
    })
    console.log(`[culture/fetch:${runId}] finishFetchRun OK`)
  } catch (err) {
    console.error(`[culture/fetch:${runId}] finishFetchRun threw:`, err)
  }

  return NextResponse.json({
    runId,
    status,
    summary: {
      sourcesAttempted: sources.length,
      sourcesOk: okScrapes.length,
      sourcesFailed: failedScrapes.length,
      identifiedRaw: identified.length,
      mergedTrends: merged.length,
      inserted,
      updated,
      week,
      tokensIn,
      tokensOut,
    },
    failures: failedScrapes.map((f) => ({ source: f.sourceName, error: f.error })),
  })
}

// ───────────────────────────────────────────────────────────────────────────
// Scraping helpers
// ───────────────────────────────────────────────────────────────────────────

export async function scrapeSource(source: SourceRow, lookbackDays: number): Promise<ScrapeResult> {
  // Dispatch on source_type:
  //   - google_trends_api      → direct API call, no Firecrawl
  //   - perplexity_query       → ask Perplexity, use answer + citations as content
  //   - tiktok_cc_hashtag      → scrape TikTok Creative Center SSR, real metrics
  //   - everything else        → Firecrawl markdown scrape
  if (source.source_type === 'google_trends_api') {
    return scrapeGoogleTrends(source)
  }
  if (source.source_type === 'perplexity_query') {
    return scrapePerplexity(source)
  }
  if (source.source_type === 'tiktok_cc_hashtag') {
    return scrapeTikTokCC(source)
  }
  // Reddit subreddits: bypass Firecrawl (it doesn't support reddit.com)
  // and use Reddit's free public JSON API instead. No auth needed.
  if (source.source_type === 'reddit') {
    return scrapeRedditJson(source)
  }
  // TikTok /discover/{slug} pages get a dedicated structured parser
  // that extracts video + creator data directly from the rendered HTML.
  // Bypasses Gemini hallucination for the video list.
  if (source.url.includes('/discover/')) {
    return scrapeTikTokDiscover(source)
  }

  const scrapeUrl = widenUrlForLookback(source.url, source.source_type, lookbackDays)
  const fetchedAt = new Date().toISOString()
  try {
    const result = await firecrawl.scrape(scrapeUrl, {
      formats: ['markdown'],
      waitFor: 3000,
      timeout: 30_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
      },
    })
    const markdown = (result.markdown ?? '').trim()
    if (!markdown) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceCategory: source.category,
        url: source.url,
        ok: false,
        fetchedAt,
        textSnippet: '',
        topLinks: [],
        error: 'empty_markdown',
      }
    }
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      url: source.url,
      ok: true,
      fetchedAt,
      textSnippet: markdown.slice(0, 12_000),
      topLinks: extractLinks(markdown).slice(0, 20),
    }
  } catch (err) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      url: source.url,
      ok: false,
      fetchedAt,
      textSnippet: '',
      topLinks: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Convert the structured Google Trends payload into a markdown-flavored
 * "scrape result" so the rest of the pipeline (Gemini analysis, merging,
 * upsert) doesn't have to know there's a special source.
 *
 * Geo defaults to NL/BE based on the URL.
 */
async function scrapeGoogleTrends(source: SourceRow): Promise<ScrapeResult> {
  const fetchedAt = new Date().toISOString()
  const geo = extractGeoFromUrl(source.url) ?? 'NL'
  const hl = geo === 'BE' ? 'nl-BE' : 'nl-NL'

  try {
    const items = await fetchGoogleTrends({ geo, hl, maxItems: 30 })
    if (items.length === 0) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceCategory: source.category,
        url: source.url,
        ok: false,
        fetchedAt,
        textSnippet: '',
        topLinks: [],
        error: 'no_google_trends_returned',
      }
    }
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      url: source.url,
      ok: true,
      fetchedAt,
      textSnippet: formatGoogleTrendsAsMarkdown(items, geo),
      topLinks: items.flatMap((i) => i.articles.map((a) => a.url)).slice(0, 20),
    }
  } catch (err) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      url: source.url,
      ok: false,
      fetchedAt,
      textSnippet: '',
      topLinks: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * TikTok Creative Center scraper: hits the SSR HTML, parses out the
 * embedded JSON, gets REAL post counts + view counts + rank per hashtag.
 *
 * Returns trends pre-formatted so the downstream pipeline can insert them
 * without going through Gemini (the data is already structured).
 *
 * The source's `notes` field can contain a country code override
 * (e.g. "NL", "FR"). Defaults to the country implied by source name.
 */
/**
 * TikTok /discover/{slug} scraper. JS-render via Firecrawl, then
 * structured-parse for video links + creators. Returns a high-signal
 * markdown payload (no Gemini hallucination on the video list).
 */
async function scrapeTikTokDiscover(source: SourceRow): Promise<ScrapeResult> {
  const fetchedAt = new Date().toISOString()
  // Slug = last path segment of /discover/<slug>
  const slugMatch = source.url.match(/\/discover\/([^/?#]+)/)
  const slug = slugMatch ? slugMatch[1] : 'unknown'

  try {
    const { parseDiscoverHtml, discoverResultToMarkdown } = await import('@/lib/tiktok-discover')
    const result = await firecrawl.scrape(source.url, {
      formats: ['html'],
      waitFor: 4000,
      timeout: 45_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
      },
    })
    const html = (result as { html?: string }).html ?? ''
    if (!html) {
      return {
        sourceId: source.id, sourceName: source.name, sourceCategory: source.category,
        url: source.url, ok: false, fetchedAt, textSnippet: '', topLinks: [],
        error: 'empty_html_from_firecrawl',
      }
    }

    const parsed = parseDiscoverHtml(html, slug)
    if (parsed.videos.length === 0) {
      return {
        sourceId: source.id, sourceName: source.name, sourceCategory: source.category,
        url: source.url, ok: false, fetchedAt, textSnippet: '', topLinks: [],
        error: 'no_videos_parsed',
      }
    }

    const markdown = discoverResultToMarkdown(parsed)
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      url: source.url,
      ok: true,
      fetchedAt,
      textSnippet: markdown,
      topLinks: parsed.videos.slice(0, 20).map((v) => v.videoUrl),
    }
  } catch (err) {
    return {
      sourceId: source.id, sourceName: source.name, sourceCategory: source.category,
      url: source.url, ok: false, fetchedAt, textSnippet: '', topLinks: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function scrapeTikTokCC(source: SourceRow): Promise<ScrapeResult> {
  const fetchedAt = new Date().toISOString()
  // Country code is in source.notes (e.g. "NL"), fall back to scanning the
  // source name for a known country code.
  const countryCode =
    source.notes?.trim().toUpperCase() ||
    extractCountryFromName(source.name) ||
    ''

  try {
    const result = await fetchCreativeCenterHashtags(countryCode, 7)
    if (!result.ok || result.hashtags.length === 0) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceCategory: source.category,
        url: source.url,
        ok: false,
        fetchedAt,
        textSnippet: '',
        topLinks: [],
        error: result.error ?? 'no_hashtags',
      }
    }
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      url: source.url,
      ok: true,
      fetchedAt,
      // We attach the hashtag JSON as a side channel so the pipeline can
      // skip the AI step. The textSnippet is set to a small marker so the
      // existing code path doesn't choke on it.
      textSnippet: JSON.stringify({ __tiktok_cc_hashtags: result.hashtags }),
      topLinks: result.hashtags
        .slice(0, 10)
        .map((h) => `https://www.tiktok.com/tag/${encodeURIComponent(h.hashtagName)}`),
    }
  } catch (err) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      url: source.url,
      ok: false,
      fetchedAt,
      textSnippet: '',
      topLinks: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function extractCountryFromName(name: string): string {
  const m = name.match(/\b(NL|FR|DE|BE|ES|IT|PL|CZ|SK|HU|AT|CH|RO|PT)\b/)
  return m ? m[1] : ''
}

/**
 * Convert TikTok Creative Center hashtag list directly to AIIdentifiedTrend
 * format. Skips the Gemini extraction step — the data is already structured
 * and the numbers are real.
 */
export function convertCCHashtagsToTrends(
  hashtags: CreativeCenterHashtag[],
  sourceCategory: string,
): AIIdentifiedTrend[] {
  return hashtags.map((h) => {
    const popularity = popularityFromPostCount(h.publishCnt)
    const directionWord = h.rankDiff > 0 ? 'climbing' : h.rankDiff < 0 ? 'falling' : 'steady'
    const direction = h.rankDiff !== 0 ? ` (${directionWord} ${Math.abs(h.rankDiff)} positions)` : ''
    const viewsStr = h.videoViews >= 1_000_000
      ? `${(h.videoViews / 1_000_000).toFixed(1)}M`
      : h.videoViews >= 1_000
        ? `${(h.videoViews / 1_000).toFixed(0)}K`
        : String(h.videoViews)

    return {
      name: `#${h.hashtagName}`,
      description:
        `Trending hashtag on TikTok ${h.countryCode || 'globally'}. ` +
        `Currently ranked #${h.rank}${direction} with ${h.publishCnt.toLocaleString()} ` +
        `posts and ${viewsStr} total video views over the last 7 days. ` +
        (h.industry ? `Industry: ${h.industry}.` : ''),
      category: (industryToCategory(h.industry) ||
        sourceCategory) as AIIdentifiedTrend['category'],
      contentType: 'hashtag',
      hashtags: [`#${h.hashtagName}`],
      popularityScore: popularity,
      reasoning: `Real TikTok Creative Center data: rank #${h.rank}, ${h.publishCnt} posts, ${h.videoViews} views over 7 days. No AI inference.`,
      estimatedViews: `#${h.rank} TikTok ${h.countryCode || 'global'} · ${viewsStr} views · ${h.publishCnt.toLocaleString()} posts`,
      exampleUrls: [
        `https://www.tiktok.com/tag/${encodeURIComponent(h.hashtagName)}`,
      ],
    }
  })
}

/**
 * Reddit subreddit scrape via the free public JSON API.
 *
 * Firecrawl doesn't support reddit.com (blocked at their end), so we
 * hit the JSON endpoint directly. No auth or API key required — Reddit
 * publishes top-of-week posts as plain JSON at:
 *   https://www.reddit.com/r/SUBREDDIT/top.json?t=week
 *
 * We accept any URL pattern in the source row (some legacy entries
 * have `.json` already, others have the HTML `/top/?t=week` form) and
 * normalise to the JSON variant. Returns a markdown-ish summary of the
 * top posts so the downstream Gemini pipeline can extract trends.
 */
async function scrapeRedditJson(source: SourceRow): Promise<ScrapeResult> {
  const fetchedAt = new Date().toISOString()

  // Normalise the URL to the JSON endpoint with top-of-week scope.
  // Examples we accept:
  //   https://www.reddit.com/r/foo/.json
  //   https://www.reddit.com/r/foo/top/?t=week
  //   https://www.reddit.com/r/foo/
  const m = source.url.match(/reddit\.com\/r\/([^/?#]+)/i)
  const sub = m?.[1]
  if (!sub) {
    return {
      sourceId: source.id, sourceName: source.name, sourceCategory: source.category,
      url: source.url, ok: false, fetchedAt,
      textSnippet: '', topLinks: [], error: 'reddit_url_no_subreddit',
    }
  }
  const jsonUrl = `https://www.reddit.com/r/${sub}/top.json?t=week&limit=25`

  try {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 15_000)
    const res = await fetch(jsonUrl, {
      signal: ctrl.signal,
      headers: {
        // Reddit requires a non-empty UA that isn't a bare "Mozilla"
        // default; they 429 anything that looks like a scraper. Custom
        // identifier per their public API guidelines.
        'User-Agent': 'CultureRadarBot/1.0 (https://action-culture-radar.vercel.app)',
        Accept: 'application/json',
      },
    })
    clearTimeout(tid)
    if (!res.ok) {
      return {
        sourceId: source.id, sourceName: source.name, sourceCategory: source.category,
        url: source.url, ok: false, fetchedAt,
        textSnippet: '', topLinks: [], error: `reddit http ${res.status}`,
      }
    }
    const data = (await res.json()) as {
      data?: { children?: Array<{ data?: RedditPost }> }
    }
    const posts = (data.data?.children ?? [])
      .map((c) => c.data)
      .filter((p): p is RedditPost => !!p && !p.stickied)

    if (posts.length === 0) {
      return {
        sourceId: source.id, sourceName: source.name, sourceCategory: source.category,
        url: source.url, ok: false, fetchedAt,
        textSnippet: '', topLinks: [], error: 'reddit_empty',
      }
    }

    // Format top posts as a markdown digest. Includes title, score,
    // comment count, optional self-text excerpt, and the post URL —
    // enough signal for Gemini to spot recurring subjects + aesthetics.
    const lines: string[] = [`# r/${sub} — top of week`, '']
    for (const p of posts.slice(0, 25)) {
      lines.push(`## ${p.title}`)
      lines.push(`Score: ${p.score} · Comments: ${p.num_comments} · Flair: ${p.link_flair_text ?? '—'}`)
      const body = (p.selftext ?? '').trim().slice(0, 400)
      if (body) lines.push(body)
      lines.push(`Link: https://reddit.com${p.permalink}`)
      if (p.url && p.url !== `https://reddit.com${p.permalink}`) lines.push(`Media: ${p.url}`)
      lines.push('')
    }
    const markdown = lines.join('\n')
    const topLinks = posts.slice(0, 20).map((p) => `https://reddit.com${p.permalink}`)

    return {
      sourceId: source.id, sourceName: source.name, sourceCategory: source.category,
      url: source.url, ok: true, fetchedAt,
      textSnippet: markdown.slice(0, 12_000),
      topLinks,
    }
  } catch (err) {
    return {
      sourceId: source.id, sourceName: source.name, sourceCategory: source.category,
      url: source.url, ok: false, fetchedAt,
      textSnippet: '', topLinks: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

interface RedditPost {
  title: string
  score: number
  num_comments: number
  link_flair_text?: string | null
  selftext?: string
  permalink: string
  url?: string
  stickied?: boolean
}

/**
 * Perplexity-based discovery: ask the web a focused question, get a
 * synthesized answer with citations. The query lives in the source's
 * `notes` column (set up in sources.sql); if notes is empty we fall back
 * to a generic query.
 */
async function scrapePerplexity(source: SourceRow): Promise<ScrapeResult> {
  const fetchedAt = new Date().toISOString()
  // The "URL" for Perplexity sources is a sentinel like
  // "internal://perplexity/dutch-memes". The actual question lives in `notes`.
  const question =
    source.notes?.trim() ||
    `What specific named cultural trends are going viral on social media right now in the ${source.category} space? Give concrete named examples with sources.`

  try {
    const result = await perplexitySearch(question)
    if (!result.ok || !result.text) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceCategory: source.category,
        url: source.url,
        ok: false,
        fetchedAt,
        textSnippet: '',
        topLinks: [],
        error: result.error ?? 'perplexity_empty',
      }
    }
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      url: source.url,
      ok: true,
      fetchedAt,
      textSnippet: perplexityToMarkdown(result),
      topLinks: result.citations.slice(0, 20),
    }
  } catch (err) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      url: source.url,
      ok: false,
      fetchedAt,
      textSnippet: '',
      topLinks: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Best-effort widen of a source URL when we're doing a multi-day lookback.
 *
 * - Reddit .json: append ?t=week so the listing covers a 7-day window
 *   instead of just "hot right now".
 * - Everything else: returned as-is (most blogs always show the latest;
 *   the AI prompt is responsible for the time-window framing).
 */
function widenUrlForLookback(url: string, sourceType: string, lookbackDays: number): string {
  if (lookbackDays <= 0) return url
  if (sourceType === 'reddit' && url.includes('.json')) {
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}t=week`
  }
  return url
}

function extractGeoFromUrl(url: string): string | null {
  const m = /geo=([A-Z]{2})/i.exec(url)
  return m ? m[1].toUpperCase() : null
}

function formatGoogleTrendsAsMarkdown(items: GoogleTrendItem[], geo: string): string {
  const lines: string[] = []
  lines.push(`# Google Trends — daily trending searches (${geo})`)
  lines.push(`Fetched: ${new Date().toISOString()}`)
  lines.push('')
  for (const [i, item] of items.entries()) {
    lines.push(`## ${i + 1}. ${item.title}`)
    if (item.traffic) lines.push(`Traffic: ${item.traffic}`)
    if (item.relatedQueries.length > 0) {
      lines.push(`Related: ${item.relatedQueries.join(', ')}`)
    }
    for (const a of item.articles.slice(0, 3)) {
      lines.push(`- ${a.title}${a.source ? ` (${a.source})` : ''} — ${a.url}`)
    }
    lines.push('')
  }
  return lines.join('\n').slice(0, 12_000)
}

function extractLinks(markdown: string): string[] {
  const re = /\]\((https?:\/\/[^)\s]+)\)/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) out.push(m[1])
  return Array.from(new Set(out))
}

// ───────────────────────────────────────────────────────────────────────────
// Trend upsert
// ───────────────────────────────────────────────────────────────────────────

export async function upsertTrend(
  m: MergedTrend,
  week: string,
  now: Date,
): Promise<'inserted' | 'updated' | 'noop'> {
  const slug = slugify(m.name)
  if (!slug) return 'noop'

  const existing = await findTrendForUpsert(slug, week)
  const firstSeen = existing?.first_seen_at ? new Date(existing.first_seen_at) : now
  const fresh = freshnessScore(firstSeen, now)

  if (existing) {
    const mergedSources = unionInts(existing.source_ids ?? [], m.sourceIds)
    const mergedHashtags = unionStrings(existing.hashtags ?? [], m.hashtags)
    const mergedExamples = unionStrings(existing.example_urls ?? [], m.exampleUrls)
    const newPopularity = Math.max(existing.popularity_score ?? 0, m.popularityScore)

    const ok = await updateTrend({
      id: existing.id,
      name: m.name,
      description: m.description,
      category: m.category,
      contentType: m.contentType,
      hashtags: mergedHashtags,
      exampleUrls: mergedExamples,
      popularityScore: newPopularity,
      freshnessScore: fresh,
      validationScore: validationScore(mergedSources),
      reasoning: m.reasoning,
      sourceIds: mergedSources,
      sourceNames: m.sourceNames,
      estimatedViews: m.estimatedViews,
      now: now.toISOString(),
    })
    return ok ? 'updated' : 'noop'
  }

  const ok = await insertTrend({
    name: m.name,
    slug,
    description: m.description,
    category: m.category,
    contentType: m.contentType,
    hashtags: m.hashtags,
    exampleUrls: m.exampleUrls,
    popularityScore: m.popularityScore,
    freshnessScore: fresh,
    validationScore: validationScore(m.sourceIds),
    reasoning: m.reasoning,
    sourceIds: m.sourceIds,
    sourceNames: m.sourceNames,
    estimatedViews: m.estimatedViews,
    rankWeek: week,
    firstSeenAt: now.toISOString(),
  })
  return ok ? 'inserted' : 'noop'
}

/**
 * Pull all active trends for the given week, compute ranking score, then
 * write daily_rank (top 10 today) and weekly_rank (top 50 this week).
 *
 * Done in app code rather than SQL so we can iterate on the scoring formula
 * without migrations.
 */
export async function recomputeRanks(week: string, today: string): Promise<void> {
  const rows = await loadActiveTrendsForRanking(week)
  const ranked = rows
    .map((t) => ({
      id: t.id,
      score: rankingScore({
        popularity: Number(t.popularity_score) || 0,
        freshness: Number(t.freshness_score) || 0,
        validation: Number(t.validation_score) || 0,
        firstSeenAt: t.first_seen_at ?? null,
        verifyVerdict: t.verify_verdict ?? null,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      id: r.id,
      dailyRank: i < 10 ? i + 1 : null,
      weeklyRank: i < 50 ? i + 1 : null,
    }))

  await applyTrendRanks(ranked, today)
}

// ───────────────────────────────────────────────────────────────────────────
// Misc
// ───────────────────────────────────────────────────────────────────────────

function unionInts(a: number[], b: number[]): number[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]))
}

function unionStrings(a: string[], b: string[]): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]))
}

async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}
