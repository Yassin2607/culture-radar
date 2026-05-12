/**
 * POST /api/culture/enrich-countries
 *
 * Tags trends with their country_relevance via Gemini. Trends with
 * empty/null country_relevance (the default state after AI extraction)
 * get inferred and updated. Batches 10 trends per Gemini call.
 *
 * Body: { limit?: number, force?: boolean }
 *   limit  = total trends to process this run (default 60, max 200)
 *   force  = also re-tag trends that already have a non-empty array
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { inferCountryRelevance } from '@/lib/trend-country'

export const maxDuration = 300

interface Row {
  id: string
  name: string
  description: string
  source_names: string[]
  hashtags: string[] | null
}

const BATCH_SIZE = 10

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { limit?: number; force?: boolean } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch { /* empty */ }

  const limit = Math.min(200, Math.max(1, body.limit ?? 60))
  const filter = body.force
    ? ''
    : 'AND (country_relevance IS NULL OR cardinality(country_relevance) = 0)'

  const rows = (await sql().query(
    `SELECT id, name, description, source_names, hashtags
       FROM culture_trends
      WHERE status = 'active' ${filter}
      ORDER BY COALESCE(daily_rank, 999) ASC,
               COALESCE(weekly_rank, 999) ASC,
               popularity_score DESC
      LIMIT $1`,
    [limit],
  )) as Row[]

  let tagged = 0
  let dropped = 0
  let failed = 0
  const scopeSummary: Record<string, number> = { global: 0, multi: 0, country: 0, none: 0 }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    try {
      const results = await inferCountryRelevance(
        batch.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          sourceNames: r.source_names ?? [],
          hashtags: r.hashtags ?? [],
        })),
      )

      for (const r of results) {
        scopeSummary[r.scope] = (scopeSummary[r.scope] ?? 0) + 1

        if (r.scope === 'none') {
          // Archive the trend — Action doesn't care about UK football
          // or US politics. Keep it in the DB but hide it from the UI.
          await sql().query(
            `UPDATE culture_trends SET status = 'archived', country_relevance = '{}', updated_at = NOW() WHERE id = $1`,
            [r.id],
          )
          dropped++
        } else {
          await sql().query(
            `UPDATE culture_trends SET country_relevance = $1::text[], updated_at = NOW() WHERE id = $2`,
            [r.countries, r.id],
          )
          tagged++
        }
      }
    } catch (err) {
      console.error('[enrich-countries] batch failed', err)
      failed += batch.length
    }
  }

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    processed: rows.length,
    tagged,
    dropped,
    failed,
    scopeSummary,
  })
}
