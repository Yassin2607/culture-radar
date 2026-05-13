/**
 * POST /api/culture/scrape
 *
 * Stage 1 of the fetch pipeline (split from monolithic /fetch which
 * regularly exceeded the 300s budget). This endpoint ONLY scrapes
 * sources and stores the raw content in `culture_scrape_results`.
 * No Gemini, no AI, no ranking.
 *
 * /api/culture/extract drains the queue afterwards.
 *
 * Body: { limit?: number, sourceIds?: number[], lookbackDays?: number }
 *   limit  = optional cap (default: scrape all active)
 *   sourceIds = scrape only these
 *   lookbackDays = pass through to scrape (some sources widen by date)
 *
 * Idempotent: re-running drops + re-inserts results for the same
 * (run_id, source_id) — but each call creates a new run_id.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql, listSources, createFetchRun, updateSourceScrapeStatus } from '@/lib/culture-db'
import type { SourceRow } from '@/app/api/culture/fetch/route'
import { CULTURE_GEMINI_MODEL } from '@/lib/constants'

// Re-export the scrapeSource function from the legacy /fetch route
// to avoid duplicating the dispatch logic.
import { scrapeSource as _scrapeSource } from '@/app/api/culture/fetch/route'

export const maxDuration = 300

const SCRAPE_CONCURRENCY = 8

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { limit?: number; sourceIds?: number[]; lookbackDays?: number; triggeredBy?: string } = {}
  try { body = await req.json().catch(() => ({})) } catch { /* */ }

  // Ensure table
  await sql().query(`
    CREATE TABLE IF NOT EXISTS culture_scrape_results (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      source_name TEXT NOT NULL,
      source_category TEXT NOT NULL,
      url TEXT NOT NULL,
      scraped_at TIMESTAMPTZ DEFAULT NOW(),
      text_snippet TEXT NOT NULL,
      top_links JSONB,
      status TEXT NOT NULL,
      error TEXT,
      processed_at TIMESTAMPTZ
    )
  `)
  await sql().query(`
    CREATE INDEX IF NOT EXISTS idx_scrape_unprocessed
      ON culture_scrape_results (processed_at) WHERE processed_at IS NULL
  `)

  // Load sources
  const rows = await listSources({ activeOnly: true, ids: body.sourceIds })
  let sources = rows as unknown as SourceRow[]
  if (body.limit) sources = sources.slice(0, body.limit)
  if (sources.length === 0) {
    return NextResponse.json({ ok: true, message: 'No active sources matched filters', scraped: 0 })
  }

  const runId = await createFetchRun({
    triggeredBy: body.triggeredBy ?? 'scrape-only',
    sourcesAttempted: sources.length,
    aiModel: CULTURE_GEMINI_MODEL,
  })

  const lookbackDays = Math.max(0, Math.min(30, body.lookbackDays ?? 0))

  // Run scrapes
  const results: Array<{ sourceId: number; ok: boolean; error?: string }> = []
  let ok = 0
  let failed = 0
  let cursor = 0

  await Promise.all(
    Array.from({ length: Math.min(SCRAPE_CONCURRENCY, sources.length) }, async () => {
      while (cursor < sources.length) {
        const i = cursor++
        const s = sources[i]
        try {
          const r = await _scrapeSource(s, lookbackDays)
          // Store result
          await sql().query(
            `INSERT INTO culture_scrape_results
               (run_id, source_id, source_name, source_category, url,
                text_snippet, top_links, status, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
            [
              runId, s.id, s.name, s.category, r.url,
              r.textSnippet ?? '',
              JSON.stringify(r.topLinks ?? []),
              r.ok ? 'ok' : 'error',
              r.error ?? null,
            ],
          )
          await updateSourceScrapeStatus({
            id: s.id,
            fetchedAt: r.fetchedAt,
            status: r.ok ? 'ok' : 'error',
            error: r.error ?? null,
          })
          if (r.ok) ok++
          else failed++
          results.push({ sourceId: s.id, ok: r.ok, error: r.error })
        } catch (err) {
          failed++
          results.push({ sourceId: s.id, ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }),
  )

  return NextResponse.json({
    ok: true,
    runId,
    durationMs: Date.now() - started,
    scraped: ok + failed,
    okCount: ok,
    failedCount: failed,
    message: `Scraped ${ok + failed} sources, ${ok} ok, ${failed} failed. Call /api/culture/extract to process.`,
  })
}
