/**
 * POST /api/culture/backfill-tiktok-urls
 *
 * For each top-ranked trend without a TikTok URL, asks Perplexity for 3
 * direct tiktok.com URLs. Filters through the URL verifier (drops Perplexity
 * hallucinations + sequential-ID fakes). Adds survivors to example_urls.
 *
 * Body: { limit?: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { perplexitySearch, extractVideoUrls } from '@/lib/perplexity'
import { verifyVideoUrls, isVideoPlatformUrl } from '@/lib/url-verification'

export const maxDuration = 300

interface Row {
  id: string
  name: string
  description: string
  example_urls: string[] | null
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { limit?: number } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    /* empty */
  }

  const limit = Math.min(50, body.limit ?? 20)

  // Trends with NO tiktok URL yet — prioritise top-ranked
  const rows = (await sql().query(
    `SELECT id, name, description, example_urls
       FROM culture_trends
      WHERE status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM unnest(COALESCE(example_urls, '{}'::text[])) u
          WHERE u LIKE '%tiktok.com%'
        )
      ORDER BY COALESCE(daily_rank, 999) ASC,
               COALESCE(weekly_rank, 999) ASC,
               popularity_score DESC
      LIMIT $1`,
    [limit],
  )) as Row[]

  let foundUrls = 0
  let trendsUpdated = 0
  let failed = 0

  for (const r of rows) {
    const q = `Find 3-5 real direct tiktok.com URLs (format: https://www.tiktok.com/@user/video/19digitid) of actual viral videos for the trend: "${r.name}". Brief context: ${r.description.slice(0, 200)}. Return ONLY working tiktok.com URLs in your response, no commentary needed. Verify they exist before including. Skip URLs you are unsure about.`

    const result = await perplexitySearch(q)
    if (!result.ok) {
      failed++
      continue
    }

    // Pull TikTok URLs from response + citations
    const candidates = extractVideoUrls(result.text + ' ' + result.citations.join(' '))
      .filter((u) => u.includes('tiktok.com'))

    if (candidates.length === 0) {
      failed++
      continue
    }

    // Filter through the URL verifier (fake-ID heuristic + redirect check)
    const verified = await verifyVideoUrls(candidates, { concurrency: 3 })
    const valid = verified.filter((v) => v.ok).map((v) => v.url)

    if (valid.length === 0) {
      failed++
      continue
    }

    // Merge with existing example_urls
    const existing = r.example_urls ?? []
    const merged = Array.from(new Set([...valid.slice(0, 3), ...existing]))
    // Keep video URLs first by sorting (verifier output is already filtered)
    const sorted = [
      ...merged.filter(isVideoPlatformUrl),
      ...merged.filter((u) => !isVideoPlatformUrl(u)),
    ]

    await sql().query(
      `UPDATE culture_trends SET example_urls = $1, updated_at = NOW() WHERE id = $2`,
      [sorted, r.id],
    )
    foundUrls += valid.length
    trendsUpdated++
  }

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    processed: rows.length,
    trendsUpdated,
    foundUrls,
    failed,
  })
}
