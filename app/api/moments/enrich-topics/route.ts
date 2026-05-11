/**
 * POST /api/moments/enrich-topics
 *
 * Loops over upcoming moments without related_topics and enriches each
 * via Perplexity + Google Trends. Stores in culture_moments.related_topics.
 *
 * Body:
 *   {
 *     "limit": 15,            // max moments to enrich
 *     "force": false,         // re-enrich moments that already have topics
 *     "withGoogleTrends": true  // overlay Google Trends daily-trending matches
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import {
  fetchRelatedTopicsForMoment,
  augmentWithGoogleTrends,
  type RelatedTopic,
} from '@/lib/moments-topics'
import type { CountryDate } from '@/types/culture'

export const maxDuration = 300

interface Candidate {
  id: string
  name: string
  description: string
  category: string
  scope: string
  country_dates: CountryDate[] | null
  next_occurrence: string | null
}

const CONCURRENCY = 3   // Perplexity is the bottleneck — keep modest

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { limit?: number; force?: boolean; withGoogleTrends?: boolean } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    /* empty */
  }

  const limit = Math.min(50, Math.max(1, body.limit ?? 12))
  const force = body.force ?? false
  const withGT = body.withGoogleTrends ?? false

  const filter = force ? '' : 'AND related_topics IS NULL'

  const rows = (await sql().query(
    `SELECT id, name, description, category, scope, country_dates,
            next_occurrence::TEXT AS next_occurrence
       FROM culture_moments
      WHERE status <> 'archived' ${filter}
      ORDER BY next_occurrence ASC NULLS LAST
      LIMIT $1`,
    [limit],
  )) as Candidate[]

  if (rows.length === 0) {
    return NextResponse.json({
      processed: 0,
      enriched: 0,
      failed: 0,
      durationMs: Date.now() - started,
      message: 'No moments needing enrichment.',
    })
  }

  let enriched = 0
  let failed = 0
  let idx = 0

  async function worker() {
    while (idx < rows.length) {
      const i = idx++
      const row = rows[i]
      try {
        const countries = (row.country_dates ?? []).map((cd) => cd.country)
        const result = await fetchRelatedTopicsForMoment({
          name: row.name,
          description: row.description,
          category: row.category,
          countries,
          date: row.next_occurrence ?? '',
        })

        if (!result.ok || result.topics.length === 0) {
          failed++
          continue
        }

        let topics: RelatedTopic[] = result.topics
        if (withGT) {
          topics = await augmentWithGoogleTrends({
            momentName: row.name,
            countries,
            topics: result.topics,
          })
        }

        await sql().query(
          `UPDATE culture_moments
              SET related_topics = $1::jsonb, updated_at = NOW()
            WHERE id = $2`,
          [JSON.stringify(topics), row.id],
        )
        enriched++
      } catch (err) {
        console.error('[enrich-topics] failed for', row.name, err)
        failed++
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  return NextResponse.json({
    processed: rows.length,
    enriched,
    failed,
    durationMs: Date.now() - started,
  })
}
