/**
 * POST /api/culture/enrich-mindmaps
 *
 * Generates a Google-Trends-like context mindmap for each active trend
 * that doesn't have one yet. 6 categories of bullets: origin, spreading,
 * adjacent, variations, searches, brandPlays.
 *
 * Body: { limit?: number, force?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { generateTrendMindmap } from '@/lib/trend-mindmap'

export const maxDuration = 300

interface Row {
  id: string
  name: string
  description: string
  category: string
  hashtags: string[] | null
}

const CONCURRENCY = 5

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { limit?: number; force?: boolean } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    /* empty */
  }

  const limit = Math.min(80, Math.max(1, body.limit ?? 12))
  const filter = body.force ? '' : 'AND mindmap IS NULL'

  const rows = (await sql().query(
    `SELECT id, name, description, category, hashtags
       FROM culture_trends
      WHERE status = 'active' ${filter}
      ORDER BY COALESCE(daily_rank, 999) ASC,
               COALESCE(weekly_rank, 999) ASC,
               popularity_score DESC
      LIMIT $1`,
    [limit],
  )) as Row[]

  let enriched = 0
  let failed = 0
  let idx = 0

  async function worker() {
    while (idx < rows.length) {
      const i = idx++
      const r = rows[i]
      try {
        const mm = await generateTrendMindmap({
          name: r.name,
          description: r.description,
          category: r.category,
          hashtags: r.hashtags ?? [],
        })
        if (!mm) {
          failed++
          continue
        }
        // Save if we got at least 1 section with content. Niche trends
        // sometimes only get an origin or a spreading bullet — better to
        // show partial context than nothing.
        const filled = Object.values(mm).filter((arr) => arr.length > 0).length
        if (filled < 1) {
          failed++
          continue
        }
        await sql().query(
          `UPDATE culture_trends SET mindmap = $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(mm), r.id],
        )
        enriched++
      } catch (err) {
        console.error('[enrich-mindmaps] failed for', r.name, err)
        failed++
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    processed: rows.length,
    enriched,
    failed,
  })
}
