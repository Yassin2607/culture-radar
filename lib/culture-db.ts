/**
 * Culture Radar — DB layer.
 *
 * Wraps Neon's serverless Postgres client. Only used by the culture-radar
 * routes; the rest of the app keeps using Supabase.
 *
 * Connection string is read from `POSTGRES_URL` (the env var Vercel
 * Postgres / Neon sets when you provision a DB and link it to a project).
 *
 * Why a custom layer instead of `sql\`...\`` everywhere?
 *   - Provides typed wrapper functions for the queries we use repeatedly.
 *   - Centralises connection-pool config + error logging.
 *   - Lets us swap Neon for another Postgres host later without touching
 *     every API route.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type {
  ActionBrief,
  CultureCategory,
  CultureSource,
  CultureTrend,
  SourceType,
} from '@/types/culture'

// ── Connection ─────────────────────────────────────────────────────────────

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL

let _sql: NeonQueryFunction<false, false> | null = null

/**
 * Lazy, cached Neon client. Throws a clear error if no connection string
 * is configured — better than the cryptic "fetch failed" you get otherwise.
 */
export function sql(): NeonQueryFunction<false, false> {
  if (!connectionString) {
    throw new Error(
      'POSTGRES_URL (or DATABASE_URL) is not set. Configure a Neon/Vercel Postgres DB and add the connection string to .env.local.',
    )
  }
  if (!_sql) _sql = neon(connectionString)
  return _sql
}

// ── Row shapes (snake_case, as Postgres returns them) ──────────────────────

interface SourceRowDB {
  id: number
  name: string
  url: string
  category: string
  source_type: string
  reliability: number
  detection_lag_days: number | null
  active: boolean
  notes: string | null
  last_scraped_at: string | null
  last_scrape_status: string | null
  last_scrape_error: string | null
}

interface TrendRowDB {
  id: string
  created_at: string
  updated_at: string
  first_seen_at: string
  name: string
  slug: string
  description: string
  category: string
  content_type: string | null
  hashtags: string[] | null
  example_urls: string[] | null
  thumbnail_url: string | null
  popularity_score: number
  freshness_score: number
  validation_score: number
  reasoning: string | null
  source_ids: number[] | null
  source_names: string[] | null
  daily_rank: number | null
  weekly_rank: number | null
  rank_date: string | null
  rank_week: string | null
  estimated_views: string | null
  status: string
  brand_brief: ActionBrief | null
}

interface ExistingTrendForUpsert {
  id: string
  source_ids: number[]
  hashtags: string[]
  example_urls: string[]
  popularity_score: number
  first_seen_at: string
}

// ── Sources ────────────────────────────────────────────────────────────────

export interface ListSourcesArgs {
  activeOnly?: boolean
  category?: string
  ids?: number[]
  categories?: string[]
}

export async function listSources(args: ListSourcesArgs = {}): Promise<SourceRowDB[]> {
  const conditions: string[] = []
  const params: unknown[] = []

  if (args.activeOnly) conditions.push('active = true')
  if (args.category) {
    params.push(args.category)
    conditions.push(`category = $${params.length}`)
  }
  if (args.ids?.length) {
    params.push(args.ids)
    conditions.push(`id = ANY($${params.length}::int[])`)
  }
  if (args.categories?.length) {
    params.push(args.categories)
    conditions.push(`category = ANY($${params.length}::text[])`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = (await sql().query(
    `SELECT id, name, url, category, source_type, reliability, detection_lag_days,
            active, notes, last_scraped_at, last_scrape_status, last_scrape_error
       FROM culture_sources
       ${where}
       ORDER BY category ASC, reliability DESC`,
    params,
  )) as SourceRowDB[]
  return rows
}

export async function updateSourceScrapeStatus(args: {
  id: number
  fetchedAt: string
  status: 'ok' | 'error' | 'skipped'
  error: string | null
}): Promise<void> {
  await sql().query(
    `UPDATE culture_sources
        SET last_scraped_at = $1,
            last_scrape_status = $2,
            last_scrape_error = $3
      WHERE id = $4`,
    [args.fetchedAt, args.status, args.error, args.id],
  )
}

export function rowToSource(row: SourceRowDB): CultureSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    category: row.category as CultureCategory,
    sourceType: row.source_type as SourceType,
    reliability: row.reliability,
    detectionLagDays: row.detection_lag_days,
    active: row.active,
    notes: row.notes,
    lastScrapedAt: row.last_scraped_at,
    lastScrapeStatus: row.last_scrape_status as CultureSource['lastScrapeStatus'],
    lastScrapeError: row.last_scrape_error,
  }
}

// ── Trends ─────────────────────────────────────────────────────────────────

export async function findTrendForUpsert(slug: string, week: string): Promise<ExistingTrendForUpsert | null> {
  const rows = (await sql().query(
    `SELECT id, source_ids, hashtags, example_urls, popularity_score, first_seen_at
       FROM culture_trends
      WHERE slug = $1 AND rank_week = $2
      LIMIT 1`,
    [slug, week],
  )) as ExistingTrendForUpsert[]
  return rows[0] ?? null
}

export interface InsertTrendArgs {
  name: string
  slug: string
  description: string
  category: string
  contentType: string
  hashtags: string[]
  exampleUrls: string[]
  popularityScore: number
  freshnessScore: number
  validationScore: number
  reasoning: string
  sourceIds: number[]
  sourceNames: string[]
  estimatedViews: string | null
  rankWeek: string
  firstSeenAt: string
}

export async function insertTrend(t: InsertTrendArgs): Promise<boolean> {
  try {
    await sql().query(
      `INSERT INTO culture_trends
         (name, slug, description, category, content_type, hashtags, example_urls,
          popularity_score, freshness_score, validation_score, reasoning,
          source_ids, source_names, estimated_views, rank_week, first_seen_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        t.name,
        t.slug,
        t.description,
        t.category,
        t.contentType,
        t.hashtags,
        t.exampleUrls,
        t.popularityScore,
        t.freshnessScore,
        t.validationScore,
        t.reasoning,
        t.sourceIds,
        t.sourceNames,
        t.estimatedViews,
        t.rankWeek,
        t.firstSeenAt,
      ],
    )
    return true
  } catch (err) {
    console.error('[culture-db] insert failed:', err)
    return false
  }
}

export interface UpdateTrendArgs {
  id: string
  name: string
  description: string
  category: string
  contentType: string
  hashtags: string[]
  exampleUrls: string[]
  popularityScore: number
  freshnessScore: number
  validationScore: number
  reasoning: string
  sourceIds: number[]
  sourceNames: string[]
  estimatedViews: string | null
  now: string
}

export async function updateTrend(t: UpdateTrendArgs): Promise<boolean> {
  try {
    await sql().query(
      `UPDATE culture_trends
          SET name = $1,
              description = $2,
              category = $3,
              content_type = $4,
              hashtags = $5,
              example_urls = $6,
              popularity_score = $7,
              freshness_score = $8,
              validation_score = $9,
              reasoning = $10,
              source_ids = $11,
              source_names = $12,
              estimated_views = $13,
              updated_at = $14
        WHERE id = $15`,
      [
        t.name,
        t.description,
        t.category,
        t.contentType,
        t.hashtags,
        t.exampleUrls,
        t.popularityScore,
        t.freshnessScore,
        t.validationScore,
        t.reasoning,
        t.sourceIds,
        t.sourceNames,
        t.estimatedViews,
        t.now,
        t.id,
      ],
    )
    return true
  } catch (err) {
    console.error('[culture-db] update failed:', err)
    return false
  }
}

export async function loadActiveTrendsForRanking(week: string): Promise<
  Array<{ id: string; popularity_score: number; freshness_score: number; validation_score: number }>
> {
  const rows = (await sql().query(
    `SELECT id, popularity_score, freshness_score, validation_score
       FROM culture_trends
      WHERE rank_week = $1 AND status = 'active'`,
    [week],
  )) as Array<{ id: string; popularity_score: number; freshness_score: number; validation_score: number }>
  return rows
}

export async function applyTrendRanks(
  ranks: Array<{ id: string; dailyRank: number | null; weeklyRank: number | null }>,
  rankDate: string,
): Promise<void> {
  // Single round-trip via VALUES clause. Cheap on Neon (one HTTP fetch).
  if (ranks.length === 0) return
  const values: unknown[] = []
  const tuples: string[] = []
  for (const r of ranks) {
    values.push(r.id, r.dailyRank, r.weeklyRank, rankDate)
    const i = values.length
    tuples.push(`($${i - 3}::uuid, $${i - 2}::int, $${i - 1}::int, $${i}::date)`)
  }
  await sql().query(
    `UPDATE culture_trends AS t
        SET daily_rank = v.daily_rank,
            weekly_rank = v.weekly_rank,
            rank_date = v.rank_date
       FROM (VALUES ${tuples.join(', ')})
              AS v(id, daily_rank, weekly_rank, rank_date)
      WHERE t.id = v.id`,
    values,
  )
}

export async function archiveStaleTrends(cutoffIso: string): Promise<void> {
  await sql().query(
    `UPDATE culture_trends
        SET status = 'archived',
            freshness_score = 0,
            daily_rank = NULL,
            weekly_rank = NULL
      WHERE first_seen_at < $1
        AND status = 'active'`,
    [cutoffIso],
  )
}

// ── Fetch runs (audit log) ─────────────────────────────────────────────────

export async function createFetchRun(args: {
  triggeredBy: string
  sourcesAttempted: number
  aiModel: string
}): Promise<string> {
  const rows = (await sql().query(
    `INSERT INTO culture_fetch_runs
        (triggered_by, sources_attempted, status, ai_model)
      VALUES ($1, $2, 'running', $3)
      RETURNING id`,
    [args.triggeredBy, args.sourcesAttempted, args.aiModel],
  )) as Array<{ id: string }>
  return rows[0].id
}

export async function finishFetchRun(args: {
  id: string
  finishedAt: string
  sourcesOk: number
  sourcesFailed: number
  trendsInserted: number
  trendsUpdated: number
  status: 'ok' | 'partial' | 'failed'
  aiTokensIn: number
  aiTokensOut: number
}): Promise<void> {
  await sql().query(
    `UPDATE culture_fetch_runs
        SET finished_at = $1,
            sources_ok = $2,
            sources_failed = $3,
            trends_inserted = $4,
            trends_updated = $5,
            status = $6,
            ai_tokens_in = $7,
            ai_tokens_out = $8
      WHERE id = $9`,
    [
      args.finishedAt,
      args.sourcesOk,
      args.sourcesFailed,
      args.trendsInserted,
      args.trendsUpdated,
      args.status,
      args.aiTokensIn,
      args.aiTokensOut,
      args.id,
    ],
  )
}

// ── Trend listing (for GET /api/culture/trends) ────────────────────────────

export interface ListTrendsArgs {
  week: string
  view: 'daily' | 'weekly' | 'all' | 'emerging'
  category: string | null
  limit: number
  includeArchived: boolean
}

export async function listTrends(args: ListTrendsArgs): Promise<TrendRowDB[]> {
  const conditions: string[] = ['rank_week = $1']
  const params: unknown[] = [args.week]

  if (!args.includeArchived) conditions.push(`status = 'active'`)
  if (args.category) {
    params.push(args.category)
    conditions.push(`category = $${params.length}`)
  }

  let orderBy: string
  if (args.view === 'daily') {
    conditions.push('daily_rank IS NOT NULL')
    orderBy = 'daily_rank ASC'
  } else if (args.view === 'weekly') {
    conditions.push('weekly_rank IS NOT NULL')
    orderBy = 'weekly_rank ASC'
  } else if (args.view === 'emerging') {
    // Recently discovered, not yet popular = rising signal.
    // Popularity < 7 = not mainstream. Freshness >= 7 = seen within ~7 days.
    conditions.push('popularity_score < 7')
    conditions.push('freshness_score >= 7')
    orderBy = 'first_seen_at DESC, popularity_score DESC'
  } else {
    orderBy = 'popularity_score DESC, freshness_score DESC'
  }

  params.push(args.limit)
  const rows = (await sql().query(
    `SELECT id, created_at, updated_at, first_seen_at, name, slug, description,
            category, content_type, hashtags, example_urls, thumbnail_url,
            popularity_score, freshness_score, validation_score, reasoning,
            source_ids, source_names, daily_rank, weekly_rank, rank_date,
            rank_week, estimated_views, status, brand_brief
       FROM culture_trends
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${params.length}`,
    params,
  )) as TrendRowDB[]
  return rows
}

/**
 * Load the currently trending sound-category trends for a given week.
 * Used to give the Action brief generator a real menu of sounds to suggest.
 * Returns name + short description ordered by signal strength.
 */
export async function getTrendingSounds(week: string, limit = 12): Promise<Array<{ name: string; description: string }>> {
  const rows = (await sql().query(
    `SELECT name, description
       FROM culture_trends
      WHERE rank_week = $1
        AND status = 'active'
        AND (category = 'sound' OR content_type = 'sound')
      ORDER BY popularity_score DESC, freshness_score DESC
      LIMIT $2`,
    [week, limit],
  )) as Array<{ name: string; description: string }>
  return rows
}

/** Write a generated Action brief back to a trend row. */
export async function saveBrandBrief(trendId: string, brief: ActionBrief): Promise<void> {
  await sql().query(
    `UPDATE culture_trends SET brand_brief = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(brief), trendId],
  )
}

export function rowToTrend(row: TrendRowDB): CultureTrend {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    firstSeenAt: row.first_seen_at,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category as CultureTrend['category'],
    contentType: row.content_type as CultureTrend['contentType'],
    hashtags: row.hashtags ?? [],
    exampleUrls: row.example_urls ?? [],
    thumbnailUrl: row.thumbnail_url,
    popularityScore: Number(row.popularity_score) || 0,
    freshnessScore: Number(row.freshness_score) || 0,
    validationScore: Number(row.validation_score) || 0,
    reasoning: row.reasoning,
    sourceIds: row.source_ids ?? [],
    sourceNames: row.source_names ?? [],
    dailyRank: row.daily_rank,
    weeklyRank: row.weekly_rank,
    rankDate: row.rank_date,
    rankWeek: row.rank_week,
    estimatedViews: row.estimated_views,
    status: row.status as CultureTrend['status'],
    brandBrief: row.brand_brief ?? null,
  }
}
