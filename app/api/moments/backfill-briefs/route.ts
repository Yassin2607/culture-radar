/**
 * POST /api/moments/backfill-briefs
 *
 * Generates Action briefs for moments that don't have one yet. Loops in
 * date order — most imminent moments get briefs first.
 *
 * Body:
 *   { "limit": 20, "force": false }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql, getTrendingSounds } from '@/lib/culture-db'
import { saveMomentBrief } from '@/lib/moments-db'
import { generateActionBrief } from '@/lib/culture-action-brief'
import { isoWeek } from '@/lib/culture-radar'
import type { CountryDate } from '@/types/culture'

export const maxDuration = 300

const CONCURRENCY = 4

interface CandidateRow {
  id: string
  name: string
  description: string
  category: string
  scope: string
  country_dates: CountryDate[] | null
  example_urls: string[] | null
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { limit?: number; force?: boolean } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    /* allow empty body */
  }

  const limit = Math.min(50, Math.max(1, body.limit ?? 15))
  const force = body.force ?? false

  const filter = force ? '' : 'AND brand_brief IS NULL'
  const rows = (await sql().query(
    `SELECT id, name, description, category, scope, country_dates, example_urls
       FROM culture_moments
      WHERE status <> 'archived' ${filter}
      ORDER BY next_occurrence ASC NULLS LAST
      LIMIT $1`,
    [limit],
  )) as CandidateRow[]

  if (rows.length === 0) {
    return NextResponse.json({
      processed: 0,
      briefed: 0,
      failed: 0,
      durationMs: Date.now() - started,
      message: 'No moments needing a brief.',
    })
  }

  const trendingSounds = await getTrendingSounds(isoWeek(new Date()), 12)
  let briefed = 0
  let failed = 0
  let idx = 0

  async function worker() {
    while (idx < rows.length) {
      const i = idx++
      const row = rows[i]
      try {
        const countriesNote =
          row.scope === 'global'
            ? 'Global moment — applies to all Action countries.'
            : `Per-country dates: ${(row.country_dates ?? []).map((c) => `${c.country} ${c.date}`).join(', ')}`
        const url = row.example_urls?.[0] ?? null
        const brief = await generateActionBrief({
          name: row.name,
          description: `${row.description}\n\n${countriesNote}`,
          category: row.category,
          brandExample: null,
          url,
          trendingSounds,
        })
        if (brief) {
          await saveMomentBrief(row.id, brief)
          briefed++
        } else {
          failed++
        }
      } catch (err) {
        console.error('[moments/backfill-briefs] failed for', row.name, err)
        failed++
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  return NextResponse.json({
    processed: rows.length,
    briefed,
    failed,
    durationMs: Date.now() - started,
  })
}
