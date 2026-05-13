/**
 * POST /api/culture/snapshot-gt
 *
 * Captures a snapshot of Google Trends daily trending searches for all
 * 14 Action countries. Stores raw items (title, traffic, related,
 * articles) per country per day so we can:
 *   - Detect cross-country patterns ("FIFA World Cup is in 9 of 14 today")
 *   - Compute deltas ("new today" vs "still trending from yesterday")
 *   - Surface search-volume-weighted lists
 *   - Feed richer context into the AI extraction
 *
 * Wired into the daily cron. Auto-creates the table on first call.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { fetchGoogleTrends } from '@/lib/google-trends'

export const maxDuration = 300

const COUNTRIES = ['NL', 'BE', 'FR', 'DE', 'AT', 'CH', 'ES', 'IT', 'PT', 'PL', 'CZ', 'SK', 'HU', 'RO']
const LANG: Record<string, string> = {
  NL: 'nl-NL', BE: 'nl-BE', FR: 'fr-FR', DE: 'de-DE', AT: 'de-AT', CH: 'de-CH',
  ES: 'es-ES', IT: 'it-IT', PT: 'pt-PT', PL: 'pl-PL', CZ: 'cs-CZ', SK: 'sk-SK',
  HU: 'hu-HU', RO: 'ro-RO',
}

export async function POST(_req: NextRequest) {
  const started = Date.now()

  await sql().query(`
    CREATE TABLE IF NOT EXISTS culture_gt_snapshots (
      geo TEXT NOT NULL,
      snapshot_date DATE NOT NULL,
      rank INTEGER NOT NULL,
      title TEXT NOT NULL,
      title_normalized TEXT NOT NULL,
      traffic TEXT,
      traffic_value INTEGER,
      started_at TIMESTAMPTZ,
      related_queries JSONB,
      articles JSONB,
      share_url TEXT,
      image_url TEXT,
      PRIMARY KEY (geo, snapshot_date, rank)
    )
  `)
  await sql().query(`
    CREATE INDEX IF NOT EXISTS idx_gt_snap_date_title
      ON culture_gt_snapshots (snapshot_date, title_normalized)
  `)
  await sql().query(`
    CREATE INDEX IF NOT EXISTS idx_gt_snap_geo_date
      ON culture_gt_snapshots (geo, snapshot_date DESC)
  `)

  let inserted = 0
  const results: Array<{ geo: string; items: number; error?: string }> = []

  for (const geo of COUNTRIES) {
    try {
      const items = await fetchGoogleTrends({ geo, hl: LANG[geo] ?? 'en-US', maxItems: 40 })
      if (items.length === 0) {
        results.push({ geo, items: 0 })
        continue
      }
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        await sql().query(
          `INSERT INTO culture_gt_snapshots
             (geo, snapshot_date, rank, title, title_normalized, traffic, traffic_value,
              started_at, related_queries, articles, share_url, image_url)
           VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
           ON CONFLICT (geo, snapshot_date, rank) DO UPDATE SET
             title = EXCLUDED.title,
             title_normalized = EXCLUDED.title_normalized,
             traffic = EXCLUDED.traffic,
             traffic_value = EXCLUDED.traffic_value,
             started_at = EXCLUDED.started_at,
             related_queries = EXCLUDED.related_queries,
             articles = EXCLUDED.articles,
             share_url = EXCLUDED.share_url,
             image_url = EXCLUDED.image_url`,
          [
            geo, i + 1, it.title, normalizeTitle(it.title),
            it.traffic, it.trafficValue,
            it.startedAt,
            JSON.stringify(it.relatedQueries),
            JSON.stringify(it.articles),
            it.shareUrl, it.imageUrl,
          ],
        )
        inserted++
      }
      results.push({ geo, items: items.length })
    } catch (err) {
      results.push({ geo, items: 0, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // GC snapshots older than 60 days
  await sql().query(
    `DELETE FROM culture_gt_snapshots WHERE snapshot_date < CURRENT_DATE - INTERVAL '60 days'`,
  )

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    inserted,
    results,
  })
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
