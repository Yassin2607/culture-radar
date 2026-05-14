/**
 * GET  /api/culture/verify-article-dates?dryRun=1&limit=200&maxAgeDays=14
 * POST /api/culture/verify-article-dates
 *
 * Verifies that each active trend is backed by recent source articles.
 * For each trend with external example_urls, fetches each URL and reads
 * its published date (Open Graph article:published_time, JSON-LD
 * datePublished, <time> tag, or URL-path fallback). Archives trends
 * where ALL datable source URLs resolve to articles older than the
 * cutoff (default 14 days).
 *
 * Trends whose URLs are all undatable (e.g. TikTok video pages,
 * homepages) are LEFT ALONE — we can't disprove freshness, and the
 * existing 7-day first_seen_at cap covers them.
 *
 * Uses culture_article_dates as a cache so we don't re-fetch URLs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { getArticlePublishedAt } from '@/lib/article-date'

export const maxDuration = 300 // 5 min — bulk fetching is slow
export const dynamic = 'force-dynamic'

interface TrendRow {
  id: string
  name: string
  example_urls: string[] | null
  first_seen_at: string
}

interface VerdictPerUrl {
  url: string
  publishedAt: string | null
  daysOld: number | null
  source: string
  error: string | null
}

interface TrendVerdict {
  id: string
  name: string
  verdict: 'fresh' | 'stale' | 'inconclusive'
  newestArticleDays: number | null
  urls: VerdictPerUrl[]
}

async function run(opts: {
  dryRun: boolean
  limit: number
  maxAgeDays: number
  concurrency: number
}): Promise<{
  scanned: number
  archived: number
  results: TrendVerdict[]
  durationMs: number
}> {
  const start = Date.now()

  const trends = (await sql().query(
    `SELECT id, name, example_urls, first_seen_at::TEXT AS first_seen_at
       FROM culture_trends
      WHERE status = 'active'
        AND (verify_verdict IS NULL OR verify_verdict != 'fabricated')
        AND example_urls IS NOT NULL
        AND array_length(example_urls, 1) > 0
      ORDER BY popularity_score DESC, first_seen_at DESC
      LIMIT $1`,
    [opts.limit],
  )) as TrendRow[]

  const cutoff = new Date(Date.now() - opts.maxAgeDays * 24 * 60 * 60 * 1000)
  const results: TrendVerdict[] = []
  let archived = 0

  // Process trends in chunks so we have bounded concurrency over URL fetches
  for (let i = 0; i < trends.length; i += opts.concurrency) {
    const batch = trends.slice(i, i + opts.concurrency)
    const verdicts = await Promise.all(batch.map((t) => verifyTrend(t, cutoff)))
    for (const v of verdicts) {
      results.push(v)
      if (v.verdict === 'stale' && !opts.dryRun) {
        await sql().query(
          `UPDATE culture_trends
              SET status = 'archived', updated_at = NOW()
            WHERE id = $1 AND status = 'active'`,
          [v.id],
        )
        archived++
      }
    }
  }

  return {
    scanned: trends.length,
    archived,
    results,
    durationMs: Date.now() - start,
  }
}

async function verifyTrend(t: TrendRow, cutoff: Date): Promise<TrendVerdict> {
  const urls = (t.example_urls ?? []).filter(Boolean)
  const perUrl: VerdictPerUrl[] = []
  let newestMs: number | null = null
  let datableCount = 0

  for (const u of urls) {
    const r = await getArticlePublishedAt(u)
    const ms = r.publishedAt ? r.publishedAt.getTime() : null
    const days = ms ? (Date.now() - ms) / 86400000 : null
    perUrl.push({
      url: u,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      daysOld: days !== null ? Math.round(days * 10) / 10 : null,
      source: r.source,
      error: r.error,
    })
    if (ms !== null) {
      datableCount++
      if (newestMs === null || ms > newestMs) newestMs = ms
    }
  }

  // Verdict logic:
  // - No datable URLs → inconclusive (leave the trend alone)
  // - Newest datable article is older than cutoff → stale (archive)
  // - Otherwise → fresh
  let verdict: TrendVerdict['verdict']
  if (datableCount === 0) {
    verdict = 'inconclusive'
  } else if (newestMs !== null && newestMs < cutoff.getTime()) {
    verdict = 'stale'
  } else {
    verdict = 'fresh'
  }

  return {
    id: t.id,
    name: t.name,
    verdict,
    newestArticleDays:
      newestMs !== null ? Math.round(((Date.now() - newestMs) / 86400000) * 10) / 10 : null,
    urls: perUrl,
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') !== '0'
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10), 1000)
  const maxAgeDays = parseInt(url.searchParams.get('maxAgeDays') ?? '14', 10)
  const concurrency = Math.min(parseInt(url.searchParams.get('concurrency') ?? '8', 10), 16)

  const out = await run({ dryRun, limit, maxAgeDays, concurrency })
  return NextResponse.json({
    ok: true,
    dryRun,
    limit,
    maxAgeDays,
    concurrency,
    ...out,
    stale: out.results.filter((r) => r.verdict === 'stale').length,
    fresh: out.results.filter((r) => r.verdict === 'fresh').length,
    inconclusive: out.results.filter((r) => r.verdict === 'inconclusive').length,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
