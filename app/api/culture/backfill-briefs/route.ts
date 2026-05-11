/**
 * POST /api/culture/backfill-briefs
 *
 * Generates Action briefs for trends that don't have one yet. Useful after:
 *   - A schema migration that added the brand_brief column to existing rows.
 *   - A scrape run that inserted trends without briefs.
 *
 * Body (all optional):
 *   {
 *     "limit":     20,         // max trends to brief (default 20)
 *     "week":      "2026-W20", // ISO week (default = current)
 *     "force":     false       // re-generate even if brief already exists
 *   }
 *
 * Returns: { processed, briefed, skipped, failed, durationMs }
 *
 * Cost: ~1 Gemini call per trend. Safe to run repeatedly because by default
 * it only touches trends without an existing brief.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql, saveBrandBrief, getTrendingSounds } from '@/lib/culture-db'
import { generateActionBrief } from '@/lib/culture-action-brief'
import { isoWeek } from '@/lib/culture-radar'

export const maxDuration = 300

interface BackfillBody {
  limit?: number
  week?: string
  force?: boolean
}

interface CandidateRow {
  id: string
  name: string
  description: string
  category: string
  source_names: string[] | null
  example_urls: string[] | null
}

const CONCURRENCY = 4

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: BackfillBody = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    /* allow empty body */
  }

  const limit = Math.min(50, Math.max(1, body.limit ?? 20))
  const week = body.week ?? isoWeek(new Date())
  const force = body.force ?? false

  // Select candidates: top trends this week (by ranking signals)
  // that either have no brief, or where force=true.
  const briefFilter = force ? '' : 'AND brand_brief IS NULL'
  const rows = (await sql().query(
    `SELECT id, name, description, category, source_names, example_urls
       FROM culture_trends
      WHERE rank_week = $1
        AND status = 'active'
        ${briefFilter}
      ORDER BY
        COALESCE(daily_rank, 999) ASC,
        COALESCE(weekly_rank, 999) ASC,
        popularity_score DESC
      LIMIT $2`,
    [week, limit],
  )) as CandidateRow[]

  if (rows.length === 0) {
    return NextResponse.json({
      processed: 0,
      briefed: 0,
      skipped: 0,
      failed: 0,
      durationMs: Date.now() - started,
      message: 'No trends needing a brief.',
    })
  }

  let briefed = 0
  let failed = 0

  // Load trending sounds ONCE — same menu for every brief in this batch.
  const trendingSounds = await getTrendingSounds(week, 12)

  // Concurrency-limited loop
  let idx = 0
  async function worker() {
    while (idx < rows.length) {
      const i = idx++
      const row = rows[i]
      try {
        const brandExample =
          row.source_names?.find((n) => n === 'Spotted in the Wild') ? null : null
        const url = row.example_urls?.[0] ?? null
        const brief = await generateActionBrief({
          name: row.name,
          description: row.description,
          category: row.category,
          brandExample,
          url,
          trendingSounds,
        })
        if (brief) {
          await saveBrandBrief(row.id, brief)
          briefed++
        } else {
          failed++
        }
      } catch (err) {
        console.error('[backfill-briefs] failed for', row.name, err)
        failed++
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  return NextResponse.json({
    processed: rows.length,
    briefed,
    skipped: 0,
    failed,
    durationMs: Date.now() - started,
    week,
  })
}
