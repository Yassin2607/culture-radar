/**
 * POST /api/culture/rerank
 *
 * Recomputes daily_rank + weekly_rank for the current week using the
 * current ranking formula. No scraping, no Gemini. Cheap, runs in
 * seconds, useful for testing formula changes without waiting for the
 * full fetch cycle.
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadActiveTrendsForRanking, applyTrendRanks } from '@/lib/culture-db'
import { isoWeek, rankingScore } from '@/lib/culture-radar'

export const maxDuration = 60

export async function POST(_req: NextRequest) {
  const started = Date.now()
  const week = isoWeek()
  const today = new Date().toISOString().slice(0, 10)

  const rows = await loadActiveTrendsForRanking(week)
  const ranked = rows
    .map((t) => ({
      id: t.id,
      score: rankingScore({
        popularity: Number(t.popularity_score) || 0,
        freshness: Number(t.freshness_score) || 0,
        validation: Number(t.validation_score) || 0,
        firstSeenAt: t.first_seen_at ?? null,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      id: r.id,
      dailyRank: i < 10 ? i + 1 : null,
      weeklyRank: i < 50 ? i + 1 : null,
    }))

  await applyTrendRanks(ranked, today)

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    week,
    totalRanked: rows.length,
    dailyTop: ranked.filter((r) => r.dailyRank != null).length,
    weeklyTop: ranked.filter((r) => r.weeklyRank != null).length,
  })
}
