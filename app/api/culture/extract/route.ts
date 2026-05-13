/**
 * POST /api/culture/extract
 *
 * Stage 2 of the fetch pipeline. Drains the unprocessed
 * culture_scrape_results queue: runs Gemini analyzeSourceContent per
 * result, merges identified trends across sources, upserts to
 * culture_trends, marks rows processed, and recomputes ranks.
 *
 * Designed to be call-once or call-in-loop until empty. Has its own
 * 300s budget separate from /scrape.
 *
 * Body: { limit?: number, rerank?: boolean }
 *   limit  = max queue rows to process this run (default 80)
 *   rerank = if true (default), recompute daily/weekly ranks after
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { analyzeSourceContent } from '@/lib/culture-ai'
import { mergeTrends, isoWeek, isoDate, type MergedTrend } from '@/lib/culture-radar'
import { upsertTrend, recomputeRanks } from '@/app/api/culture/fetch/route'
import type { AIIdentifiedTrend, CultureCategory } from '@/types/culture'

export const maxDuration = 300

const AI_CONCURRENCY = 8
const MAX_TRENDS_PER_SOURCE = 8

interface QueueRow {
  id: number
  source_id: number
  source_name: string
  source_category: string
  url: string
  text_snippet: string
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { limit?: number; rerank?: boolean } = {}
  try { body = await req.json().catch(() => ({})) } catch { /* */ }

  const limit = Math.min(200, Math.max(1, body.limit ?? 80))
  const doRerank = body.rerank ?? true

  const rows = (await sql().query(
    `SELECT id, source_id, source_name, source_category, url, text_snippet
       FROM culture_scrape_results
      WHERE processed_at IS NULL AND status = 'ok' AND length(text_snippet) > 50
      ORDER BY scraped_at ASC
      LIMIT $1`,
    [limit],
  )) as QueueRow[]

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      message: 'Queue empty',
      processed: 0,
      durationMs: Date.now() - started,
    })
  }

  // Parallel AI extraction
  let tokensIn = 0
  let tokensOut = 0
  const allIdentified: Array<AIIdentifiedTrend & { sourceId: number; sourceName: string }> = []
  let cursor = 0
  const processedIds: number[] = []

  await Promise.all(
    Array.from({ length: Math.min(AI_CONCURRENCY, rows.length) }, async () => {
      while (cursor < rows.length) {
        const i = cursor++
        const r = rows[i]
        try {
          // TikTok CC pre-structured shortcut (same as legacy fetch)
          if (r.text_snippet.startsWith('{"__tiktok_cc_hashtags":')) {
            try {
              const parsed = JSON.parse(r.text_snippet)
              const { convertCCHashtagsToTrends } = await import('@/app/api/culture/fetch/route') as unknown as {
                convertCCHashtagsToTrends: (h: unknown[], cat: CultureCategory) => AIIdentifiedTrend[]
              }
              const trends = convertCCHashtagsToTrends(parsed.__tiktok_cc_hashtags, r.source_category as CultureCategory)
              allIdentified.push(...trends.map((t) => ({ ...t, sourceId: r.source_id, sourceName: r.source_name })))
            } catch (err) {
              console.error('[extract] CC convert failed', r.source_name, err)
            }
            processedIds.push(r.id)
            continue
          }

          const ai = await analyzeSourceContent({
            sourceName: r.source_name,
            sourceCategory: r.source_category as CultureCategory,
            sourceUrl: r.url,
            contentMarkdown: r.text_snippet,
            maxTrends: MAX_TRENDS_PER_SOURCE,
          })
          tokensIn += ai.tokensIn ?? 0
          tokensOut += ai.tokensOut ?? 0
          allIdentified.push(...ai.trends.map((t) => ({ ...t, sourceId: r.source_id, sourceName: r.source_name })))
          processedIds.push(r.id)
        } catch (err) {
          console.error('[extract] AI failed for', r.source_name, err)
          // Still mark processed so we don't retry forever
          processedIds.push(r.id)
        }
      }
    }),
  )

  // Merge & upsert
  const merged: MergedTrend[] = mergeTrends(allIdentified)
  const week = isoWeek()
  const today = isoDate()
  const now = new Date()
  let inserted = 0
  let updated = 0
  for (const m of merged) {
    try {
      const result = await upsertTrend(m, week, now)
      if (result === 'inserted') inserted++
      else if (result === 'updated') updated++
    } catch (err) {
      console.error('[extract] upsertTrend failed', m.name, err)
    }
  }

  // Mark queue rows processed
  if (processedIds.length > 0) {
    await sql().query(
      `UPDATE culture_scrape_results SET processed_at = NOW() WHERE id = ANY($1::bigint[])`,
      [processedIds],
    )
  }

  // Rerank
  if (doRerank) {
    try { await recomputeRanks(week, today) }
    catch (err) { console.error('[extract] rerank failed', err) }
  }

  // GC processed rows older than 3 days to keep table small
  await sql().query(
    `DELETE FROM culture_scrape_results
      WHERE processed_at IS NOT NULL AND processed_at < NOW() - INTERVAL '3 days'`,
  )

  // Remaining unprocessed count
  const remaining = (await sql().query(
    `SELECT COUNT(*)::int AS n FROM culture_scrape_results WHERE processed_at IS NULL`,
  )) as Array<{ n: number }>

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    processed: processedIds.length,
    identified: allIdentified.length,
    merged: merged.length,
    inserted,
    updated,
    tokensIn,
    tokensOut,
    queueRemaining: remaining[0]?.n ?? 0,
  })
}
