/**
 * GET /api/culture/anomalies
 *
 * Surfaces trends that had a SUDDEN spike — popularity_score jumped
 * significantly compared to their 3-day rolling baseline. These are
 * "something just popped" signals.
 *
 * Pure SQL aggregation on culture_trend_snapshots. Fast.
 *
 * Two types of anomaly:
 *   - "spike": today's popularity is significantly higher than baseline
 *   - "freshman": brand new trend (no snapshots before yesterday) at high popularity
 */

import { NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'

export const maxDuration = 30

interface Row {
  trend_id: string
  name: string
  slug: string
  current: number
  baseline: number | null
  delta: number | null
  snapshots: number
  first_seen_at: string
  vibe: string | null
  subculture: string | null
  growth_score: number | null
}

export async function GET() {
  // Find each trend's latest snapshot and its 3-prior rolling avg
  const rows = (await sql().query(
    `WITH latest AS (
       SELECT trend_id, popularity_score AS current_pop, snapshot_date
         FROM (
           SELECT trend_id, popularity_score, snapshot_date,
                  ROW_NUMBER() OVER (PARTITION BY trend_id ORDER BY snapshot_date DESC) AS rn
             FROM culture_trend_snapshots
         ) s
        WHERE rn = 1
     ),
     baseline AS (
       SELECT trend_id, AVG(popularity_score) AS avg_pop, COUNT(*) AS n
         FROM (
           SELECT trend_id, popularity_score, snapshot_date,
                  ROW_NUMBER() OVER (PARTITION BY trend_id ORDER BY snapshot_date DESC) AS rn
             FROM culture_trend_snapshots
         ) s
        WHERE rn BETWEEN 2 AND 4
        GROUP BY trend_id
     )
     SELECT t.id AS trend_id, t.name, t.slug,
            l.current_pop AS current,
            b.avg_pop AS baseline,
            (l.current_pop - COALESCE(b.avg_pop, 0)) AS delta,
            COALESCE(b.n, 0) + 1 AS snapshots,
            t.first_seen_at::TEXT AS first_seen_at,
            t.vibe, t.subculture, t.growth_score
       FROM culture_trends t
       JOIN latest l ON l.trend_id = t.id
       LEFT JOIN baseline b ON b.trend_id = t.id
      WHERE t.status = 'active'
        AND (t.verify_verdict IS NULL OR t.verify_verdict != 'fabricated')
      ORDER BY (l.current_pop - COALESCE(b.avg_pop, 0)) DESC
      LIMIT 60`,
  )) as Row[]

  const spikes: Array<Row & { kind: 'spike' | 'freshman' }> = []
  for (const r of rows) {
    const baseline = r.baseline == null ? null : Number(r.baseline)
    const current = r.current
    const delta = baseline == null ? current : current - baseline

    // Freshman: high popularity but very few snapshots (just discovered)
    if (r.snapshots <= 2 && current >= 6) {
      spikes.push({ ...r, current, baseline, delta, kind: 'freshman' })
      continue
    }
    // Spike: current is 2+ points above baseline
    if (baseline != null && delta >= 2 && current >= 5) {
      spikes.push({ ...r, current, baseline, delta, kind: 'spike' })
    }
  }

  return NextResponse.json({
    ok: true,
    spikes: spikes.slice(0, 30).map((s) => ({
      trendId: s.trend_id,
      name: s.name,
      slug: s.slug,
      kind: s.kind,
      current: s.current,
      baseline: s.baseline,
      delta: s.delta == null ? null : Math.round(Number(s.delta) * 10) / 10,
      snapshots: s.snapshots,
      vibe: s.vibe,
      subculture: s.subculture,
      growth: s.growth_score == null ? null : Number(s.growth_score),
      firstSeenAt: s.first_seen_at,
    })),
  })
}
