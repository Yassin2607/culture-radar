/**
 * POST /api/culture/compute-growth
 *
 * Walks all active trends and recomputes their growth_score using the
 * pure function in lib/trend-growth. Idempotent, fast (no Gemini),
 * runs in seconds for ~500 trends.
 *
 * Should be called daily after enrich-subcultures + enrich-vibes have
 * had a chance to populate their fields — those feed into the score.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { computeGrowthScore } from '@/lib/trend-growth'
import { isoWeek } from '@/lib/culture-radar'

export const maxDuration = 60

interface Row {
  id: string
  freshness_score: number
  validation_score: number
  popularity_score: number
  first_seen_at: string
  source_names: string[] | null
  subculture: string | null
  vibe: string | null
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { week?: string } = {}
  try { body = await req.json().catch(() => ({})) } catch { /* */ }
  const week = body.week ?? isoWeek()

  // Ensure all columns this endpoint reads/writes exist. Order matters
  // only the first time the endpoint is called on a fresh DB — after
  // that everything is idempotent.
  await sql().query(`ALTER TABLE culture_trends ADD COLUMN IF NOT EXISTS growth_score NUMERIC(3,1)`)
  await sql().query(`ALTER TABLE culture_trends ADD COLUMN IF NOT EXISTS subculture TEXT`)
  await sql().query(`ALTER TABLE culture_trends ADD COLUMN IF NOT EXISTS vibe TEXT`)

  const rows = (await sql().query(
    `SELECT id, freshness_score, validation_score, popularity_score,
            first_seen_at::TEXT AS first_seen_at, source_names, subculture, vibe
       FROM culture_trends
      WHERE status = 'active' AND rank_week = $1`,
    [week],
  )) as Row[]

  let updated = 0
  const buckets = { '0-3': 0, '4-5': 0, '6-7': 0, '8-10': 0 }

  for (const r of rows) {
    const score = computeGrowthScore({
      freshnessScore: r.freshness_score,
      validationScore: r.validation_score,
      popularityScore: r.popularity_score,
      firstSeenAt: r.first_seen_at,
      sourceNames: r.source_names ?? [],
      subculture: r.subculture,
      vibe: r.vibe as never,
    })
    await sql().query(
      `UPDATE culture_trends SET growth_score = $1 WHERE id = $2`,
      [score, r.id],
    )
    updated++
    if (score < 4) buckets['0-3']++
    else if (score < 6) buckets['4-5']++
    else if (score < 8) buckets['6-7']++
    else buckets['8-10']++
  }

  // Top 10 hottest
  const top = (await sql().query(
    `SELECT name, growth_score, popularity_score, subculture, vibe
       FROM culture_trends
      WHERE status = 'active' AND rank_week = $1 AND growth_score IS NOT NULL
      ORDER BY growth_score DESC, popularity_score DESC
      LIMIT 10`,
    [week],
  )) as Array<{ name: string; growth_score: number; popularity_score: number; subculture: string | null; vibe: string | null }>

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    week,
    updated,
    buckets,
    topPredictions: top.map((t) => ({
      name: t.name,
      growth: Number(t.growth_score),
      currentPopularity: t.popularity_score,
      subculture: t.subculture,
      vibe: t.vibe,
    })),
  })
}
