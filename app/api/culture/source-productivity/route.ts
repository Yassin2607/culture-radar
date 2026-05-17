/**
 * GET /api/culture/source-productivity
 *
 * Per-source health + yield report. Differs from /source-health which
 * only shows last-scrape status: this endpoint quantifies how many
 * actual TRENDS each source produced over the past N days, so you
 * can see at a glance which sources are pulling their weight and
 * which ones are quietly returning content but no usable signal.
 *
 * Query:
 *   ?days=7              → look-back window (default 7, max 30)
 *   ?minProductivity=N   → only show sources producing at least N trends
 *                          in the window (default 0)
 *
 * Response:
 *   {
 *     window: { days, since },
 *     sources: [{
 *       id, name, source_type, category, active,
 *       scrapes_attempted, scrapes_ok, scrapes_failed,
 *       trends_attributed, trends_per_scrape,
 *       avg_snippet_chars,
 *       last_scrape_status, last_scrape_error,
 *       health: "healthy" | "low-yield" | "failing" | "silent"
 *     }],
 *     summary: { total_sources, healthy, low_yield, failing, silent }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'

export const dynamic = 'force-dynamic'

interface SourceProductivityRow {
  id: number
  name: string
  source_type: string
  category: string
  active: boolean
  scrapes_attempted: number
  scrapes_ok: number
  scrapes_failed: number
  trends_attributed: number
  avg_snippet_chars: number
  last_scrape_status: string | null
  last_scrape_error: string | null
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') ?? '7', 10), 1), 30)
  const minProd = Math.max(parseInt(url.searchParams.get('minProductivity') ?? '0', 10), 0)

  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  // Single SQL with sub-queries — keeps it one round-trip
  const rows = (await sql().query(
    `WITH scrape_stats AS (
       SELECT source_id,
              COUNT(*)::int AS attempted,
              COUNT(*) FILTER (WHERE status = 'ok')::int AS ok,
              COUNT(*) FILTER (WHERE status = 'error')::int AS failed,
              COALESCE(ROUND(AVG(length(text_snippet)) FILTER (WHERE status = 'ok'))::int, 0) AS avg_chars
         FROM culture_scrape_results
        WHERE scraped_at >= $1
        GROUP BY source_id
     ),
     trend_attribution AS (
       SELECT s.id AS source_id, COUNT(t.id)::int AS trend_count
         FROM culture_sources s
    LEFT JOIN culture_trends t ON s.id = ANY(t.source_ids)
                              AND t.first_seen_at >= $1
        GROUP BY s.id
     )
     SELECT s.id, s.name, s.source_type, s.category, s.active,
            COALESCE(ss.attempted, 0) AS scrapes_attempted,
            COALESCE(ss.ok, 0) AS scrapes_ok,
            COALESCE(ss.failed, 0) AS scrapes_failed,
            COALESCE(ta.trend_count, 0) AS trends_attributed,
            COALESCE(ss.avg_chars, 0) AS avg_snippet_chars,
            s.last_scrape_status,
            s.last_scrape_error
       FROM culture_sources s
  LEFT JOIN scrape_stats ss ON ss.source_id = s.id
  LEFT JOIN trend_attribution ta ON ta.source_id = s.id
   ORDER BY ta.trend_count DESC NULLS LAST,
            ss.ok DESC NULLS LAST,
            s.name ASC`,
    [since],
  )) as SourceProductivityRow[]

  const enriched = rows
    .map((r) => {
      const tps = r.scrapes_ok > 0 ? r.trends_attributed / r.scrapes_ok : 0
      const health = computeHealth(r, tps)
      return {
        ...r,
        trends_per_scrape: Math.round(tps * 100) / 100,
        health,
      }
    })
    .filter((r) => r.trends_attributed >= minProd)

  const summary = {
    total_sources: enriched.length,
    healthy: enriched.filter((r) => r.health === 'healthy').length,
    low_yield: enriched.filter((r) => r.health === 'low-yield').length,
    failing: enriched.filter((r) => r.health === 'failing').length,
    silent: enriched.filter((r) => r.health === 'silent').length,
  }

  return NextResponse.json({
    window: { days, since },
    summary,
    sources: enriched,
  })
}

function computeHealth(
  r: SourceProductivityRow,
  tps: number,
): 'healthy' | 'low-yield' | 'failing' | 'silent' {
  if (!r.active) return 'silent'
  if (r.scrapes_attempted === 0) return 'silent'
  if (r.scrapes_ok === 0) return 'failing'
  // 0 trends across the window despite successful scrapes
  if (r.trends_attributed === 0) return 'low-yield'
  // Generally productive sources hit >= 0.5 trends per successful scrape
  if (tps < 0.3) return 'low-yield'
  return 'healthy'
}
