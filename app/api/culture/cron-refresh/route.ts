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
import { POST as momentsFetchHandler } from '@/app/api/moments/fetch/route'
import { POST as momentsBriefsHandler } from '@/app/api/moments/backfill-briefs/route'

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

  // ── Monthly check: on the 1st of the month, also refresh Moments Radar ─
  // Vercel Hobby plan limits us to 1 cron, so we piggy-back the monthly
  // moments refresh on top of the daily Culture Radar one. Moments are
  // cheaper (5 Perplexity queries, no Firecrawl), ~60-90s.
  const isMonthStart = new Date().getUTCDate() === 1

  let momentsSummary: unknown = null
  let momentsError: string | null = null
  let momentsBriefsBriefed = 0

  if (isMonthStart) {
    try {
      const momentsFetchReq = new NextRequest(new URL('http://internal/api/moments/fetch'), {
        method: 'POST',
        headers: { authorization: expectedBearer, 'content-type': 'application/json' },
        body: JSON.stringify({ triggeredBy: 'cron-monthly-1st' }),
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

  return NextResponse.json({
    ok: !fetchError,
    durationMs: Date.now() - started,
    fetchError,
    fetchSummary,
    briefsBriefed,
    briefsFailed,
    isMonthStart,
    momentsError,
    momentsSummary,
    momentsBriefsBriefed,
    triggeredAt: new Date().toISOString(),
  })
}
