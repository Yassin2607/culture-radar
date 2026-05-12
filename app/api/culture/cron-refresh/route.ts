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
import { POST as fetchHandler } from '@/app/api/culture/fetch/route'
import { POST as backfillBriefsHandler } from '@/app/api/culture/backfill-briefs/route'
import { POST as verifyUrlsHandler } from '@/app/api/culture/verify-urls/route'
import { POST as scanCreatorsHandler } from '@/app/api/culture/scan-creators/route'
import { POST as recomputeBundlesHandler } from '@/app/api/culture/recompute-bundles/route'
import { POST as enrichMindmapsHandler } from '@/app/api/culture/enrich-mindmaps/route'
import { POST as enrichCountriesHandler } from '@/app/api/culture/enrich-countries/route'
import { POST as momentsFetchHandler } from '@/app/api/moments/fetch/route'
import { POST as momentsBriefsHandler } from '@/app/api/moments/backfill-briefs/route'
import { POST as momentsEnrichHandler } from '@/app/api/moments/enrich-topics/route'
import { sql } from '@/lib/culture-db'

// Cron jobs are long-running. Max out within Hobby plan budget.
export const maxDuration = 300

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

  // ── Step 1: fetch (scrape + AI + rank + archive) ───────────────────────
  let fetchSummary: unknown = null
  let fetchError: string | null = null
  try {
    const fetchReq = new NextRequest(new URL('http://internal/api/culture/fetch'), {
      method: 'POST',
      headers: {
        authorization: expectedBearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ triggeredBy: 'cron-daily-7am' }),
    })
    const res = await fetchHandler(fetchReq)
    const data = (await res.json()) as { summary?: unknown; error?: string }
    if (!res.ok) {
      fetchError = data.error ?? `HTTP ${res.status}`
    } else {
      fetchSummary = data.summary
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err)
  }

  // ── Step 2: brief backfill (best-effort, capped at one batch of 15) ───
  // We do one batch only inside the 300s budget. The dashboard's auto-chain
  // covers the rest the next time someone hits Refresh.
  let briefsBriefed = 0
  let briefsFailed = 0
  if (!fetchError) {
    try {
      const briefReq = new NextRequest(new URL('http://internal/api/culture/backfill-briefs'), {
        method: 'POST',
        headers: {
          authorization: expectedBearer,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ limit: 15 }),
      })
      const res = await backfillBriefsHandler(briefReq)
      const data = (await res.json()) as { briefed?: number; failed?: number }
      briefsBriefed = data.briefed ?? 0
      briefsFailed = data.failed ?? 0
    } catch {
      /* best-effort */
    }
  }

  // ── Step 2b: Daily Creator scan (25 new creators per cohort) ─────────
  let creatorsScanned = 0
  if (!fetchError) {
    try {
      const creatorReq = new NextRequest(new URL('http://internal/api/culture/scan-creators'), {
        method: 'POST',
        headers: { authorization: expectedBearer, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const r = await scanCreatorsHandler(creatorReq)
      const d = (await r.json()) as { inserted?: number }
      creatorsScanned = d.inserted ?? 0
    } catch {
      /* best-effort */
    }
  }

  // ── Step 2c: Recompute bundle keys ────────────────────────────────────
  let bundlesUpdated = 0
  let bundlesCleared = 0
  if (!fetchError) {
    try {
      const bundleReq = new NextRequest(new URL('http://internal/api/culture/recompute-bundles'), {
        method: 'POST',
        headers: { authorization: expectedBearer, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const r = await recomputeBundlesHandler(bundleReq)
      const d = (await r.json()) as { updated?: number; cleared?: number }
      bundlesUpdated = d.updated ?? 0
      bundlesCleared = d.cleared ?? 0
    } catch {
      /* best-effort */
    }
  }

  // ── Step 2c2: Country relevance enrichment (geo filter accuracy) ─────
  // Tag untagged trends with the Action markets they're relevant to.
  // Trends tagged "none" (UK football, US news) get archived.
  let countriesTagged = 0
  let countriesDropped = 0
  if (!fetchError) {
    try {
      const countryReq = new NextRequest(new URL('http://internal/api/culture/enrich-countries'), {
        method: 'POST',
        headers: { authorization: expectedBearer, 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 60 }),
      })
      const r = await enrichCountriesHandler(countryReq)
      const d = (await r.json()) as { tagged?: number; dropped?: number }
      countriesTagged = d.tagged ?? 0
      countriesDropped = d.dropped ?? 0
    } catch {
      /* best-effort */
    }
  }

  // ── Step 2d: Mindmap enrichment (Context & connections per trend) ─────
  // One batch of 12 trends per cron run, ranked by daily_rank. The top
  // hero/featured trends get a mindmap within one day of going active.
  let mindmapsEnriched = 0
  if (!fetchError) {
    try {
      const mindmapReq = new NextRequest(new URL('http://internal/api/culture/enrich-mindmaps'), {
        method: 'POST',
        headers: { authorization: expectedBearer, 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 40 }),
      })
      const r = await enrichMindmapsHandler(mindmapReq)
      const d = (await r.json()) as { enriched?: number }
      mindmapsEnriched = d.enriched ?? 0
    } catch {
      /* best-effort */
    }
  }

  // ── Step 3: URL verification (drop hallucinated TikTok URLs) ──────────
  // Best-effort. We process the most-recent 30 trends — anything older has
  // already been verified by a previous cron run.
  let urlsKept = 0
  let urlsDropped = 0
  if (!fetchError) {
    try {
      const verifyReq = new NextRequest(new URL('http://internal/api/culture/verify-urls'), {
        method: 'POST',
        headers: {
          authorization: expectedBearer,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ limit: 30 }),
      })
      const res = await verifyUrlsHandler(verifyReq)
      const data = (await res.json()) as {
        videoUrlsKept?: number
        videoUrlsDropped?: number
      }
      urlsKept = data.videoUrlsKept ?? 0
      urlsDropped = data.videoUrlsDropped ?? 0
    } catch {
      /* best-effort */
    }
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
    isMonthStart,
    momentsError,
    momentsSummary,
    momentsBriefsBriefed,
    triggeredAt: new Date().toISOString(),
  })
}
