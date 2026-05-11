/**
 * POST /api/culture/scan-creators
 *
 * Runs the daily creator scan: 25 niche creators surfaced via a rotating
 * lens prompt (different angle each day of the week). Stored to
 * culture_creators with today's cohort_date.
 *
 * Body (optional):
 *   { "lens": "format-inventors", "count": 25 }
 */

import { NextRequest, NextResponse } from 'next/server'
import { discoverDailyCreators, saveDailyCohort } from '@/lib/creator-radar'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { lens?: string; count?: number } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    /* empty */
  }

  const result = await discoverDailyCreators({
    countOverride: body.count,
    lensOverride: body.lens,
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, lens: result.lens },
      { status: 500 },
    )
  }

  const inserted = await saveDailyCohort(result.creators, result.lens)

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    lens: result.lens,
    discovered: result.creators.length,
    inserted,
  })
}
