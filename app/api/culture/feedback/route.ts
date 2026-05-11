/**
 * POST /api/culture/feedback
 *
 * Records human feedback on a trend. Three actions:
 *   - useful   → increments feedback_useful counter (signal of quality)
 *   - generic  → increments feedback_generic, downranks
 *   - archive  → immediately archives the trend
 *
 * Also writes to culture_moderation for the audit trail.
 *
 * Body: { trendId: string, action: 'useful' | 'generic' | 'archive', reason?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'

export async function POST(req: NextRequest) {
  let body: { trendId?: string; action?: string; reason?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const { trendId, action, reason } = body
  if (!trendId || !['useful', 'generic', 'archive'].includes(action ?? '')) {
    return NextResponse.json({ error: 'trendId + action required' }, { status: 400 })
  }

  try {
    // Always log to culture_moderation for audit trail
    await sql().query(
      `INSERT INTO culture_moderation (trend_id, action, reason)
       VALUES ($1, $2, $3)`,
      [trendId, action, reason ?? null],
    )

    if (action === 'useful') {
      await sql().query(
        `UPDATE culture_trends
           SET feedback_useful = COALESCE(feedback_useful, 0) + 1,
               updated_at = NOW()
         WHERE id = $1`,
        [trendId],
      )
    } else if (action === 'generic') {
      // Increment generic counter AND demote the trend so it falls out of
      // top 10 / top 50 visibility.
      await sql().query(
        `UPDATE culture_trends
           SET feedback_generic = COALESCE(feedback_generic, 0) + 1,
               popularity_score = GREATEST(0, popularity_score - 2),
               daily_rank = NULL,
               weekly_rank = NULL,
               updated_at = NOW()
         WHERE id = $1`,
        [trendId],
      )
    } else if (action === 'archive') {
      await sql().query(
        `UPDATE culture_trends
           SET status = 'archived',
               daily_rank = NULL,
               weekly_rank = NULL,
               updated_at = NOW()
         WHERE id = $1`,
        [trendId],
      )
    }

    return NextResponse.json({ ok: true, action })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
