/**
 * Moments Radar — DB layer.
 *
 * Mirrors the shape of lib/culture-db.ts but for the culture_moments table.
 * Same Neon connection (single Postgres DB across both radars).
 */

import { sql } from '@/lib/culture-db'
import type {
  ActionBrief,
  ActionCountry,
  CountryDate,
  CultureMoment,
  MomentCategory,
  MomentRelatedTopic,
  MomentTier,
} from '@/types/culture'

interface MomentRowDB {
  id: string
  created_at: string
  updated_at: string
  name: string
  slug: string
  description: string
  tier: string
  cultural_relevance: number
  category: string
  scope: string
  country_dates: CountryDate[] | null
  next_occurrence: string | null
  recurring: string | null
  typical_duration_days: number
  hashtags: string[] | null
  example_urls: string[] | null
  thumbnail_url: string | null
  brand_brief: ActionBrief | null
  source_names: string[] | null
  reasoning: string | null
  status: string
  related_topics: MomentRelatedTopic[] | null
}

export interface ListMomentsArgs {
  country?: ActionCountry | null
  category?: MomentCategory | null
  tier?: MomentTier | null
  horizonDays?: number       // only show moments within N days from now
  includeArchived?: boolean
  limit?: number
}

export async function listMoments(args: ListMomentsArgs = {}): Promise<MomentRowDB[]> {
  const conditions: string[] = []
  const params: unknown[] = []

  // We derive an "effective next date" from country_dates on the fly:
  // the earliest date in country_dates that is today or later. This is
  // robust to a moment having one country's date already in the past
  // while another country's date is still upcoming — the moment stays
  // visible until ALL its country dates have passed, not just the
  // earliest one. The stored next_occurrence column may go stale
  // between cron refreshes, so we don't rely on it for filter/order.
  const effectiveNextSql = `(
    SELECT MIN((cd->>'date')::date)
      FROM jsonb_array_elements(country_dates) AS cd
     WHERE (cd->>'date')::date >= CURRENT_DATE
  )`

  if (!args.includeArchived) {
    conditions.push(`status <> 'archived'`)
    // Show the moment if there's ANY country date still in the future,
    // OR fall back to the stored next_occurrence column for moments
    // with empty country_dates.
    conditions.push(`(
      ${effectiveNextSql} IS NOT NULL
      OR (next_occurrence IS NULL OR next_occurrence >= CURRENT_DATE)
    )`)
  }

  if (args.tier) {
    params.push(args.tier)
    conditions.push(`tier = $${params.length}`)
  }
  if (args.category) {
    params.push(args.category)
    conditions.push(`category = $${params.length}`)
  }
  if (args.country) {
    // Match if scope is global OR if country_dates contains this country
    params.push(args.country)
    conditions.push(`(scope = 'global' OR country_dates @> jsonb_build_array(jsonb_build_object('country', $${params.length}::text)))`)
  }
  if (args.horizonDays && args.horizonDays > 0) {
    params.push(args.horizonDays)
    // Use the dynamic effective_next here too, so a moment with an
    // upcoming NL date 50 days out doesn't get filtered out just
    // because the stored next_occurrence is now in the past.
    conditions.push(`(
      ${effectiveNextSql} IS NULL
      OR ${effectiveNextSql} <= CURRENT_DATE + ($${params.length}::int * INTERVAL '1 day')
    )`)
  }

  const limit = Math.min(500, args.limit ?? 200)
  params.push(limit)

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  // Order by the dynamic effective_next so moments with already-passed
  // first dates surface at the position of their NEXT upcoming country.
  const rows = (await sql().query(
    `SELECT id, created_at, updated_at, name, slug, description, tier,
            cultural_relevance, category, scope, country_dates,
            COALESCE(${effectiveNextSql}, next_occurrence)::TEXT AS next_occurrence,
            recurring, typical_duration_days, hashtags, example_urls,
            thumbnail_url, brand_brief, source_names, reasoning, status,
            related_topics
       FROM culture_moments
       ${where}
       ORDER BY COALESCE(${effectiveNextSql}, next_occurrence) ASC NULLS LAST,
                cultural_relevance DESC
       LIMIT $${params.length}`,
    params,
  )) as MomentRowDB[]
  return rows
}

export function rowToMoment(row: MomentRowDB): CultureMoment {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    slug: row.slug,
    description: row.description,
    tier: row.tier as MomentTier,
    culturalRelevance: row.cultural_relevance,
    category: row.category as MomentCategory,
    scope: row.scope as CultureMoment['scope'],
    countryDates: row.country_dates ?? [],
    nextOccurrence: row.next_occurrence,
    recurring: row.recurring as CultureMoment['recurring'],
    typicalDurationDays: row.typical_duration_days,
    hashtags: row.hashtags ?? [],
    exampleUrls: row.example_urls ?? [],
    thumbnailUrl: row.thumbnail_url,
    brandBrief: row.brand_brief,
    sourceNames: row.source_names ?? [],
    reasoning: row.reasoning,
    status: row.status as CultureMoment['status'],
    relatedTopics: row.related_topics ?? null,
  }
}

export interface UpsertMomentArgs {
  name: string
  slug: string
  description: string
  tier: MomentTier
  culturalRelevance: number
  category: MomentCategory
  scope: 'global' | 'country-specific'
  countryDates: CountryDate[]
  nextOccurrence: string | null
  recurring: 'yearly' | 'yearly-variable' | 'one-time' | null
  typicalDurationDays?: number
  hashtags?: string[]
  exampleUrls?: string[]
  sourceNames: string[]
  reasoning?: string | null
}

/**
 * Insert or update a moment keyed by slug. Recomputes next_occurrence from
 * country_dates so it always reflects the earliest upcoming country date.
 */
export async function upsertMoment(args: UpsertMomentArgs): Promise<string> {
  const next = computeNextOccurrence(args.countryDates) ?? args.nextOccurrence

  const rows = (await sql().query(
    `INSERT INTO culture_moments
        (name, slug, description, tier, cultural_relevance, category, scope,
         country_dates, next_occurrence, recurring, typical_duration_days,
         hashtags, example_urls, source_names, reasoning, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, 'upcoming')
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       tier = EXCLUDED.tier,
       cultural_relevance = EXCLUDED.cultural_relevance,
       category = EXCLUDED.category,
       scope = EXCLUDED.scope,
       country_dates = EXCLUDED.country_dates,
       next_occurrence = EXCLUDED.next_occurrence,
       recurring = EXCLUDED.recurring,
       typical_duration_days = EXCLUDED.typical_duration_days,
       hashtags = EXCLUDED.hashtags,
       example_urls = EXCLUDED.example_urls,
       source_names = (
         SELECT array_agg(DISTINCT n) FROM unnest(culture_moments.source_names || EXCLUDED.source_names) AS n
       ),
       reasoning = EXCLUDED.reasoning,
       updated_at = NOW()
     RETURNING id`,
    [
      args.name,
      args.slug,
      args.description,
      args.tier,
      args.culturalRelevance,
      args.category,
      args.scope,
      JSON.stringify(args.countryDates),
      next,
      args.recurring,
      args.typicalDurationDays ?? 1,
      args.hashtags ?? [],
      args.exampleUrls ?? [],
      args.sourceNames,
      args.reasoning ?? null,
    ],
  )) as Array<{ id: string }>
  return rows[0].id
}

export async function saveMomentBrief(momentId: string, brief: ActionBrief): Promise<void> {
  await sql().query(
    `UPDATE culture_moments SET brand_brief = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(brief), momentId],
  )
}

/**
 * Mark moments as 'happening' if their next_occurrence is within their
 * typical_duration_days, and 'archived' if next_occurrence + duration has
 * passed AND the moment is not recurring (one-time moments).
 *
 * Recurring moments stay 'upcoming' so the cron can refresh next_occurrence
 * to next year's date.
 */
export async function refreshMomentStatuses(): Promise<void> {
  await sql().query(`
    UPDATE culture_moments
      SET status = CASE
        WHEN next_occurrence IS NULL THEN status
        WHEN next_occurrence <= CURRENT_DATE
             AND next_occurrence + (typical_duration_days || ' days')::interval >= CURRENT_DATE
          THEN 'happening'
        WHEN next_occurrence + (typical_duration_days || ' days')::interval < CURRENT_DATE
             AND recurring = 'one-time'
          THEN 'archived'
        WHEN next_occurrence > CURRENT_DATE
          THEN 'upcoming'
        ELSE status
      END,
      updated_at = NOW()
  `)
}

function computeNextOccurrence(countryDates: CountryDate[]): string | null {
  if (countryDates.length === 0) return null
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = countryDates
    .map((d) => d.date)
    .filter((d) => d >= today)
    .sort()
  if (upcoming.length > 0) return upcoming[0]
  // All dates are in the past — return the most recent (caller may shift to next year)
  return countryDates.map((d) => d.date).sort().reverse()[0] ?? null
}
