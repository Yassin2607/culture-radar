/**
 * POST /api/culture/backfill-thumbnails
 *
 * For each active trend with a tiktok.com URL but no thumbnail, fetches
 * the TikTok oEmbed and stores the thumbnail_url + author meta.
 *
 * Body: { limit?: number, force?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { fetchTikTokOEmbed } from '@/lib/tiktok-oembed'

export const maxDuration = 300

interface Row {
  id: string
  name: string
  example_urls: string[] | null
  thumbnail_url: string | null
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: { limit?: number; force?: boolean } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    /* empty */
  }

  const limit = Math.min(100, body.limit ?? 30)
  const filter = body.force ? '' : 'AND thumbnail_url IS NULL'

  const rows = (await sql().query(
    `SELECT id, name, example_urls, thumbnail_url
       FROM culture_trends
      WHERE status = 'active'
        AND example_urls IS NOT NULL
        AND cardinality(example_urls) > 0
        ${filter}
      ORDER BY COALESCE(daily_rank, 999) ASC, popularity_score DESC
      LIMIT $1`,
    [limit],
  )) as Row[]

  let fetched = 0
  let skipped = 0
  let failed = 0

  for (const r of rows) {
    const tiktok = (r.example_urls ?? []).find((u) => u.includes('tiktok.com'))
    if (!tiktok) {
      skipped++
      continue
    }
    const oembed = await fetchTikTokOEmbed(tiktok)
    if (!oembed) {
      failed++
      continue
    }
    await sql().query(
      `UPDATE culture_trends
          SET thumbnail_url = $1,
              thumbnail_meta = $2::jsonb,
              updated_at = NOW()
        WHERE id = $3`,
      [
        oembed.thumbnailUrl,
        JSON.stringify({
          authorName: oembed.authorName,
          authorUrl: oembed.authorUrl,
          title: oembed.title.slice(0, 200),
          source: 'tiktok-oembed',
        }),
        r.id,
      ],
    )
    fetched++
  }

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    processed: rows.length,
    fetched,
    skipped,
    failed,
  })
}
