/**
 * Culture Radar — shared helpers.
 *
 * Pure functions, no I/O. Used by the fetch + trends API routes.
 */

import type { AIIdentifiedTrend, CultureCategory } from '@/types/culture'

// ───────────────────────────────────────────────────────────────────────────
// Identity / dedup
// ───────────────────────────────────────────────────────────────────────────

/**
 * Slug strips diacritics, lowercases, collapses non-alphanumerics.
 * Two trends with the same slug are treated as the same trend.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    // strip combining diacritical marks
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ───────────────────────────────────────────────────────────────────────────
// Time helpers
// ───────────────────────────────────────────────────────────────────────────

/** ISO week string, e.g. "2026-W19" */
export function isoWeek(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** YYYY-MM-DD in UTC */
export function isoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

/** Days between two dates (rounded down). */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}

// ───────────────────────────────────────────────────────────────────────────
// Scoring
// ───────────────────────────────────────────────────────────────────────────

/**
 * Freshness: 10 when first seen this week, decaying linearly to 0 over 7 days.
 * After 7 days the trend should be archived (not displayed by default).
 */
export function freshnessScore(firstSeenAt: Date, now: Date = new Date()): number {
  const days = daysBetween(firstSeenAt, now)
  if (days <= 0) return 10
  if (days >= 7) return 0
  return Number((10 - (10 * days) / 7).toFixed(2))
}

/**
 * Validation: number of distinct source IDs that confirmed the trend, capped.
 * 1 source = 1, 2 = 2, ... up to 5.
 */
export function validationScore(sourceIds: number[]): number {
  return Math.min(5, new Set(sourceIds).size)
}

/**
 * Final ranking score used for daily/weekly top lists.
 *
 *   0.5 * popularity (0-10)
 * + 0.3 * freshness  (0-10)
 * + 0.2 * (validation * 2)  // map 1-5 to 2-10
 *
 * Output is in [0, 10].
 */
export function rankingScore(args: {
  popularity: number
  freshness: number
  validation: number
  firstSeenAt?: string | null
}): number {
  const { popularity, freshness, validation, firstSeenAt } = args

  // Recency boost: trends first seen in the last 24h get +2, last 3 days
  // get +1. Forces the daily top to refresh as new signals come in
  // rather than letting established hashtags (WK, big sport events)
  // squat on positions for days.
  let recencyBoost = 0
  if (firstSeenAt) {
    const ageDays = (Date.now() - new Date(firstSeenAt).getTime()) / 86_400_000
    if (ageDays < 1) recencyBoost = 2
    else if (ageDays < 3) recencyBoost = 1
    else if (ageDays > 10) recencyBoost = -1  // gentle decay for stale top
  }

  return (
    0.35 * clamp(popularity, 0, 10) +    // was 0.5
    0.40 * clamp(freshness, 0, 10) +     // was 0.3
    0.20 * clamp(validation * 2, 0, 10) +
    recencyBoost
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// ───────────────────────────────────────────────────────────────────────────
// Merging — combine AI-identified trends across sources
// ───────────────────────────────────────────────────────────────────────────

export interface MergedTrend {
  slug: string
  name: string
  description: string
  category: CultureCategory
  contentType: string
  hashtags: string[]
  popularityScore: number
  reasoning: string
  estimatedViews: string | null
  exampleUrls: string[]
  sourceIds: number[]
  sourceNames: string[]
}

/**
 * Merge a list of AI-identified trends into a deduplicated list. Two levels
 * of merging:
 *
 *   1. Exact slug match — same trend from different sources gets unioned.
 *   2. Near-duplicate match (Jaccard similarity >= 0.7 on slug bigrams
 *      AND same category) — different wordings of the same trend get
 *      merged into the highest-popularity one.
 *
 * This prevents "Dawn Powerwash Spray" and "Dawn Powerwash Spray Hacks"
 * from both ending up in the Top 10.
 */
export function mergeTrends(
  identified: Array<AIIdentifiedTrend & { sourceId: number; sourceName: string }>,
): MergedTrend[] {
  const bySlug = new Map<string, MergedTrend>()

  for (const t of identified) {
    const slug = slugify(t.name)
    if (!slug) continue

    // First check exact match
    const existing = bySlug.get(slug)
    if (existing) {
      mergeInto(existing, t)
      continue
    }

    // Then check near-duplicate (same category + slug Jaccard >= 0.7)
    const dup = findNearDuplicateSlug(slug, t.category, bySlug)
    if (dup) {
      mergeInto(dup, t)
      continue
    }

    // Otherwise insert as new
    bySlug.set(slug, {
      slug,
      name: t.name,
      description: t.description,
      category: t.category,
      contentType: t.contentType,
      hashtags: [...new Set(t.hashtags ?? [])],
      popularityScore: t.popularityScore,
      reasoning: t.reasoning,
      estimatedViews: t.estimatedViews ?? null,
      exampleUrls: [...new Set(t.exampleUrls ?? [])],
      sourceIds: [t.sourceId],
      sourceNames: [t.sourceName],
    })
  }

  return Array.from(bySlug.values())
}

function mergeInto(
  existing: MergedTrend,
  t: AIIdentifiedTrend & { sourceId: number; sourceName: string },
): void {
  existing.sourceIds = Array.from(new Set([...existing.sourceIds, t.sourceId]))
  existing.sourceNames = Array.from(new Set([...existing.sourceNames, t.sourceName]))
  existing.hashtags = Array.from(new Set([...existing.hashtags, ...(t.hashtags ?? [])]))
  existing.exampleUrls = Array.from(
    new Set([...existing.exampleUrls, ...(t.exampleUrls ?? [])]),
  )
  if (t.popularityScore > existing.popularityScore) {
    existing.name = t.name
    existing.description = t.description
    existing.popularityScore = t.popularityScore
    existing.reasoning = t.reasoning
    if (t.estimatedViews) existing.estimatedViews = t.estimatedViews
  }
}

/**
 * Find a near-duplicate slug in the existing merge map. Two slugs are
 * considered near-duplicates when:
 *   - Same category (cross-category collisions stay separate)
 *   - Jaccard similarity on character bigrams >= 0.7
 *
 * Example: "dawn-powerwash-spray" vs "dawn-powerwash-spray-hacks" → 0.85+
 */
function findNearDuplicateSlug(
  slug: string,
  category: CultureCategory,
  existing: Map<string, MergedTrend>,
): MergedTrend | null {
  const slugBigrams = bigrams(slug)
  if (slugBigrams.size < 3) return null  // too short to be reliable

  for (const [otherSlug, t] of existing) {
    if (t.category !== category) continue
    if (Math.abs(otherSlug.length - slug.length) > 25) continue  // length sanity check
    const sim = jaccardSimilarity(slugBigrams, bigrams(otherSlug))
    if (sim >= 0.7) return t
  }
  return null
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersect = 0
  for (const x of a) if (b.has(x)) intersect++
  return intersect / (a.size + b.size - intersect)
}

// ───────────────────────────────────────────────────────────────────────────
// AI output parsing — extract JSON even when wrapped in code fences
// ───────────────────────────────────────────────────────────────────────────

/**
 * Models love to wrap JSON in ```json ... ``` even when told not to.
 * Strip fences, find the outermost {...}, parse. Returns null on failure.
 */
export function extractJson<T = unknown>(text: string): T | null {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(stripped.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
