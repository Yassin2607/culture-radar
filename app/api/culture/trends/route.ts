/**
 * GET /api/culture/trends
 *
 * Returns culture trends with optional filters.
 *
 * Query params:
 *   view=daily         → only trends with daily_rank set (top 10 today)
 *   view=weekly        → only trends with weekly_rank set (top 50 this week)
 *   view=all (default) → every active trend, ordered by ranking
 *   category=food|...  → filter by category
 *   week=2026-W19      → override week (defaults to current ISO week)
 *   limit=50           → cap (default 100)
 *   includeArchived=1  → include archived trends (default: off)
 *
 * Storage: Neon / Vercel Postgres.
 */

import { NextResponse } from 'next/server'
import { isoWeek } from '@/lib/culture-radar'
import { listTrends, rowToTrend } from '@/lib/culture-db'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const view = (searchParams.get('view') ?? 'all') as 'daily' | 'weekly' | 'all' | 'emerging'
  const category = searchParams.get('category')
  const week = searchParams.get('week') ?? isoWeek()
  const limit = Math.min(Number(searchParams.get('limit') ?? '100'), 200)
  const includeArchived = searchParams.get('includeArchived') === '1'

  try {
    const rows = await listTrends({
      week,
      view,
      category,
      limit,
      includeArchived,
    })
    return NextResponse.json({
      week,
      view,
      count: rows.length,
      trends: rows.map(rowToTrend),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), trends: [] },
      { status: 500 },
    )
  }
}
