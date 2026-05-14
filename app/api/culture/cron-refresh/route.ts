/**
 * GET /api/culture/cron-refresh
 *
 * Daily cron endpoint. Triggered by Vercel cron at 05:00 UTC (07:00 NL
 * during summertime, 06:00 NL in winter). Runs the full Culture Radar
 * pipeline:
 *   1. Scrape all active sources (Firecrawl + Google Trends + Perplexity)
 *   2. Extract trends via Gemini
 *   3. Rank daily + weekly
 *   4. Generate Action briefs for the new top trends
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. We set
 * CRON_SECRET = API_SECRET so the existing middleware check passes.
 * As a defence in depth we also verify the header here.
 *
 * Schedule lives in vercel.json (`crons` array).
 */

import { NextRequest, NextResponse } from 'next/server'
// fetchHandler import removed — cron now uses HTTP fetch to /scrape + /extract
// so each stage gets its own 300s budget instead of sharing cron's.
// All enrich/derive handlers are now called via external HTTP fetch
// from this file (externalStep helper). That gives each step its own
// 300s Vercel function budget. The imports above were removed —
// cron-refresh no longer pulls them in-process.
import { POST as momentsFetchHandler } from '@/app/api/moments/fetch/route'
import { refreshMomentStatuses } from '@/lib/moments-db'
import { POST as momentsBriefsHandler } from '@/app/api/moments/backfill-briefs/route'
import { POST as momentsEnrichHandler } from '@/app/api/moments/enrich-topics/route'
import { sql } from '@/lib/culture-db'

// Cron jobs are long-running. Max out within Hobby plan budget.
export const maxDuration = 300

/**
 * Run an external HTTP step. Each step gets its own 300s function
 * budget separate from the cron's, so we can chain 10+ enrich/AI
 * steps without exceeding the cron's 300s.
 */
async function externalStep(
  origin: string,
  bearer: string,
  path: string,
  body: unknown = {},
  timeoutMs = 270_000,
): Promise<{ ok: boolean; data: Record<string, unknown> | null; error?: string }> {
  try {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(tid)
    const data = await res.json().catch(() => null)
    return { ok: res.ok, data }
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now()

  // Defence in depth: verify the bearer token even though middleware already
  // checks it. Vercel cron is configured with CRON_SECRET = API_SECRET so
  // the header value will match either env var.
  const auth = req.headers.get('authorization') ?? ''
  const expectedBearer = `Bearer ${process.env.API_SECRET}`
  const cronBearer = `Bearer ${process.env.CRON_SECRET ?? process.env.API_SECRET}`
  if (auth !== expectedBearer && auth !== cronBearer) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ── Monthly check: if no moments fetch in the last 25 days, run one ───
  // Vercel Hobby plan limits us to 1 cron, so we piggy-back the monthly
  // moments refresh on top of the daily Culture Radar one. Moments are
  // cheaper (5 Perplexity queries, no Firecrawl), ~60-90s.
  //
  // We previously gated on "day 1 of month" which meant a mid-month deploy
  // would skip an entire month. Now we check actual elapsed time since the
  // last successful moments-source scrape — robust to deploy timing.
  const lastFetchRows = (await sql().query(
    `SELECT MAX(last_scraped_at) AS last
       FROM culture_sources
      WHERE source_type = 'perplexity_moment_query'
        AND last_scrape_status = 'ok'`,
  )) as Array<{ last: string | null }>
  const lastMomentsFetch = lastFetchRows[0]?.last ? new Date(lastFetchRows[0].last) : null
  const daysSinceLast = lastMomentsFetch
    ? Math.floor((Date.now() - lastMomentsFetch.getTime()) / 86_400_000)
    : Infinity
  const shouldRunMoments = daysSinceLast >= 25
  const isMonthStart = shouldRunMoments  // legacy name kept in response body

  let momentsSummary: unknown = null
  let momentsError: string | null = null
  let momentsBriefsBriefed = 0

  if (shouldRunMoments) {
    try {
      const momentsFetchReq = new NextRequest(new URL('http://internal/api/moments/fetch'), {
        method: 'POST',
        headers: { authorization: expectedBearer, 'content-type': 'application/json' },
        body: JSON.stringify({ triggeredBy: `cron-monthly-${daysSinceLast}d-since-last` }),
      })
      const r = await momentsFetchHandler(momentsFetchReq)
      const d = (await r.json()) as { error?: string }
      if (!r.ok) {
        momentsError = d.error ?? `HTTP ${r.status}`
      } else {
        momentsSummary = d
      }

      // Run briefs for any newly added moments (best-effort)
      try {
        const briefReq = new NextRequest(new URL('http://internal/api/moments/backfill-briefs'), {
          method: 'POST',
          headers: { authorization: expectedBearer, 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 10 }),
        })
        const briefRes = await momentsBriefsHandler(briefReq)
        const briefData = (await briefRes.json()) as { briefed?: number }
        momentsBriefsBriefed = briefData.briefed ?? 0
      } catch {
        /* best-effort */
      }

      // Enrich top upcoming moments with related topics (best-effort)
      try {
        const enrichReq = new NextRequest(new URL('http://internal/api/moments/enrich-topics'), {
          method: 'POST',
          headers: { authorization: expectedBearer, 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 8 }),
        })
        await momentsEnrichHandler(enrichReq)
      } catch {
        /* best-effort */
      }
    } catch (err) {
      momentsError = err instanceof Error ? err.message : String(err)
    }
  }

  // ── Daily moment status refresh ───────────────────────────────────────
  // Moves moments through upcoming -> happening -> archived based on
  // their next_occurrence + typical_duration_days. Cheap single SQL.
  try {
    await refreshMomentStatuses()
  } catch {
    /* best-effort */
  }

  // ── Step 1a: SCRAPE (separate function invocation, own 300s budget) ───
  // Use external HTTP fetch so the scrape and extract stages each get
  // their own 300s Vercel function budget — they don't share cron's.
  const origin = req.nextUrl.origin
  let fetchSummary: unknown = null
  let fetchError: string | null = null
  let scrapeOk = 0
  let scrapeFailed = 0
  try {
    const scrapeRes = await fetch(`${origin}/api/culture/scrape`, {
      method: 'POST',
      headers: { authorization: expectedBearer, 'content-type': 'application/json' },
      body: JSON.stringify({ triggeredBy: 'cron-daily-7am' }),
    })
    const d = (await scrapeRes.json()) as { okCount?: number; failedCount?: number; error?: string }
    if (!scrapeRes.ok) fetchError = d.error ?? `scrape HTTP ${scrapeRes.status}`
    else {
      scrapeOk = d.okCount ?? 0
      scrapeFailed = d.failedCount ?? 0
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err)
  }

  // ── Step 1b: EXTRACT (drain queue, can be called multiple times) ──────
  // One call here per cron run. If the queue isn't fully drained, the
  // next day's cron picks it up. In practice queue drains in 1 call when
  // scrape was healthy.
  let extractInserted = 0
  let extractUpdated = 0
  let extractRemaining = 0
  if (!fetchError) {
    try {
      const extractRes = await fetch(`${origin}/api/culture/extract`, {
        method: 'POST',
        headers: { authorization: expectedBearer, 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 120, rerank: true }),
      })
      const d = (await extractRes.json()) as {
        inserted?: number; updated?: number; queueRemaining?: number; error?: string
      }
      if (extractRes.ok) {
        extractInserted = d.inserted ?? 0
        extractUpdated = d.updated ?? 0
        extractRemaining = d.queueRemaining ?? 0
      }
    } catch (err) {
      console.error('[cron] extract failed', err)
    }
  }

  fetchSummary = {
    scrape: { ok: scrapeOk, failed: scrapeFailed },
    extract: { inserted: extractInserted, updated: extractUpdated, queueRemaining: extractRemaining },
  }

  // ── Step 2: brief backfill (best-effort, capped at one batch of 15) ───
  // We do one batch only inside the 300s budget. The dashboard's auto-chain
  // covers the rest the next time someone hits Refresh.
  let briefsBriefed = 0
  let briefsFailed = 0
  if (!fetchError) {
    try {
      const r = await externalStep(origin, expectedBearer, '/api/culture/backfill-briefs', { limit: 15 })
      briefsBriefed = (r.data?.briefed as number) ?? 0
      briefsFailed = (r.data?.failed as number) ?? 0
    } catch {
      /* best-effort */
    }
  }

  // ── All post-extract enrichments via external HTTP fetch ─────────────
  // Each step gets its own 300s function budget. Cron-refresh just
  // orchestrates and aggregates the summaries. Run in parallel where
  // possible (no cross-step dependencies).
  const [
    creatorsRes, bundlesRes, countriesRes, vibesRes, verifyRes,
    subculturesRes,
  ] = await Promise.all([
    externalStep(origin, expectedBearer, '/api/culture/scan-creators'),
    externalStep(origin, expectedBearer, '/api/culture/recompute-bundles'),
    externalStep(origin, expectedBearer, '/api/culture/enrich-countries', { limit: 60 }),
    externalStep(origin, expectedBearer, '/api/culture/enrich-vibes', { limit: 60 }),
    externalStep(origin, expectedBearer, '/api/culture/verify-trends', { limit: 80 }),
    externalStep(origin, expectedBearer, '/api/culture/enrich-subcultures', { limit: 60 }),
  ])
  const creatorsScanned = (creatorsRes.data?.inserted as number) ?? 0
  const bundlesUpdated = (bundlesRes.data?.updated as number) ?? 0
  const bundlesCleared = (bundlesRes.data?.cleared as number) ?? 0
  const countriesTagged = (countriesRes.data?.tagged as number) ?? 0
  const countriesDropped = (countriesRes.data?.dropped as number) ?? 0
  const vibesTagged = (vibesRes.data?.tagged as number) ?? 0
  const trendsArchived = (verifyRes.data?.archived as number) ?? 0
  const subculturesTagged = (subculturesRes.data?.tagged as number) ?? 0

  // ── Derivations + snapshots (all external, all parallel) ────────────
  const [
    growthRes, embedRes, snapshotRes, gtSnapRes, lifecycleRes,
  ] = await Promise.all([
    externalStep(origin, expectedBearer, '/api/culture/compute-growth'),
    externalStep(origin, expectedBearer, '/api/culture/embed', { limit: 80 }),
    externalStep(origin, expectedBearer, '/api/culture/snapshot-trends'),
    externalStep(origin, expectedBearer, '/api/culture/snapshot-gt'),
    externalStep(origin, expectedBearer, '/api/culture/compute-lifecycle'),
  ])
  const growthScored = (growthRes.data?.updated as number) ?? 0
  const embedsAdded = (embedRes.data?.embedded as number) ?? 0
  const snapshotsInserted = (snapshotRes.data?.inserted as number) ?? 0
  const gtItemsSnapped = (gtSnapRes.data?.inserted as number) ?? 0
  const lifecyclesComputed = (lifecycleRes.data?.updated as number) ?? 0

  // ── Mindmap + URL verification (both external, parallel) ─────────────
  const [mindmapRes, urlVerifyRes] = await Promise.all([
    externalStep(origin, expectedBearer, '/api/culture/enrich-mindmaps', { limit: 40 }),
    externalStep(origin, expectedBearer, '/api/culture/verify-urls', { limit: 30 }),
  ])
  const mindmapsEnriched = (mindmapRes.data?.enriched as number) ?? 0
  const urlsKept = (urlVerifyRes.data?.videoUrlsKept as number) ?? 0
  const urlsDropped = (urlVerifyRes.data?.videoUrlsDropped as number) ?? 0

  // ── Article date verification ───────────────────────────────────────
  // Fetches each trend's example_urls, parses the real publication date
  // (Open Graph, JSON-LD, HTML5 <time>, URL-path fallback), archives
  // trends whose ALL datable source articles are older than 14 days.
  // Catches the case where Gemini re-detected an old trend today
  // (fresh first_seen_at) but the underlying article is from 2024.
  // Cached in culture_article_dates with 7d TTL so daily reruns are
  // fast. GET via /api/culture/verify-article-dates because the route
  // already uses query params; pass via URL.
  let articleDatesScanned = 0
  let articleDatesArchived = 0
  try {
    const res = await fetch(
      `${origin}/api/culture/verify-article-dates?dryRun=0&limit=200&maxAgeDays=30&concurrency=8`,
      {
        method: 'GET',
        headers: { authorization: expectedBearer },
        signal: AbortSignal.timeout(270_000),
      },
    )
    const d = (await res.json().catch(() => null)) as {
      scanned?: number; archived?: number
    } | null
    if (res.ok && d) {
      articleDatesScanned = d.scanned ?? 0
      articleDatesArchived = d.archived ?? 0
    }
  } catch {
    /* best-effort — defense-in-depth, not critical for cron success */
  }

  return NextResponse.json({
    ok: !fetchError,
    durationMs: Date.now() - started,
    fetchError,
    fetchSummary,
    briefsBriefed,
    briefsFailed,
    urlsKept,
    urlsDropped,
    creatorsScanned,
    bundlesUpdated,
    bundlesCleared,
    mindmapsEnriched,
    countriesTagged,
    countriesDropped,
    vibesTagged,
    subculturesTagged,
    growthScored,
    trendsArchived,
    snapshotsInserted,
    gtItemsSnapped,
    embedsAdded,
    lifecyclesComputed,
    articleDatesScanned,
    articleDatesArchived,
    isMonthStart,
    momentsError,
    momentsSummary,
    momentsBriefsBriefed,
    triggeredAt: new Date().toISOString(),
  })
}
