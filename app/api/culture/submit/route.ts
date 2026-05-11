/**
 * POST /api/culture/submit
 *
 * Manually submit a cultural trend observed "in the wild" (e.g. a brand
 * post on Instagram, a meme format you spotted, a news hook). No scraping
 * or AI needed — the submitter fills in what they saw.
 *
 * Body (JSON):
 *   name            string   required  — trend name, e.g. "Crying in The Yacht"
 *   description     string   required  — what it is + why it's relevant now
 *   category        string   required  — food | beauty | fashion | home | lifestyle | tech | meme | culture | platform | sound
 *   contentType?    string            — format | hashtag | sound | aesthetic | behavior | meme
 *   hashtags?       string[]          — e.g. ["#CE2026", "#NS"]
 *   url?            string            — reference link (Instagram post, TikTok, etc.)
 *   brandExample?   string            — brand/account name where spotted, e.g. "NS Online"
 *   popularityScore? number           — manual estimate 1-10 (default 7)
 *
 * Returns: { ok, slug, week, action: 'inserted' | 'updated' }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  sql,
  findTrendForUpsert,
  insertTrend,
  updateTrend,
  loadActiveTrendsForRanking,
  applyTrendRanks,
  saveBrandBrief,
  getTrendingSounds,
} from '@/lib/culture-db'
import {
  slugify,
  isoWeek,
  isoDate,
  freshnessScore,
  rankingScore,
} from '@/lib/culture-radar'
import { generateActionBrief } from '@/lib/culture-action-brief'
import { perplexityResearchTrend } from '@/lib/perplexity'

// This sentinel URL identifies the "Spotted in the Wild" source row.
const MANUAL_SOURCE_URL = 'internal://manual-submission'
const MANUAL_SOURCE_NAME = 'Spotted in the Wild'

async function getOrCreateManualSource(): Promise<{ id: number; name: string }> {
  const existing = (await sql().query(
    `SELECT id, name FROM culture_sources WHERE url = $1 LIMIT 1`,
    [MANUAL_SOURCE_URL],
  )) as Array<{ id: number; name: string }>

  if (existing.length > 0) return existing[0]

  const created = (await sql().query(
    `INSERT INTO culture_sources
        (name, url, category, source_type, reliability, active, notes)
      VALUES ($1, $2, 'culture', 'manual', 5, true,
              'Manually submitted observations — brands spotted in the wild, Instagram posts, etc.')
      RETURNING id, name`,
    [MANUAL_SOURCE_NAME, MANUAL_SOURCE_URL],
  )) as Array<{ id: number; name: string }>

  return created[0]
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const {
      name,
      description,
      category,
      contentType,
      hashtags,
      url,
      brandExample,
      popularityScore,
    } = body as {
      name?: string
      description?: string
      category?: string
      contentType?: string
      hashtags?: string | string[]
      url?: string
      brandExample?: string
      popularityScore?: number
    }

    if (!name?.trim() || !description?.trim() || !category?.trim()) {
      return NextResponse.json(
        { error: 'name, description, and category are required' },
        { status: 400 },
      )
    }

    const source = await getOrCreateManualSource()
    const slug = slugify(name.trim())

    if (!slug) {
      return NextResponse.json({ error: 'Could not generate a slug from this name' }, { status: 400 })
    }

    const now = new Date()
    const week = isoWeek(now)
    const today = isoDate(now)
    const pop = Math.min(10, Math.max(1, Number(popularityScore) || 7))

    // Normalise hashtags
    const hashtagList: string[] = Array.isArray(hashtags)
      ? hashtags.map((h) => h.trim()).filter(Boolean)
      : typeof hashtags === 'string'
        ? hashtags.split(',').map((h) => h.trim()).filter(Boolean)
        : []

    // Reference URLs
    const exampleUrls: string[] = url?.trim() ? [url.trim()] : []

    // Estimated views field — human-readable provenance
    const estimatedViews = brandExample?.trim()
      ? `Spotted at ${brandExample.trim()}`
      : 'Manual submission'

    // Reasoning stored in the DB (visible in future moderation UI)
    const reasoning = [
      'Manually submitted observation.',
      brandExample?.trim() ? `Spotted at: ${brandExample.trim()}.` : null,
      url?.trim() ? `Reference: ${url.trim()}` : null,
    ]
      .filter(Boolean)
      .join(' ')

    const contentTypeNorm = contentType?.trim() || 'format'

    // ── Upsert ──────────────────────────────────────────────────────────────

    const existing = await findTrendForUpsert(slug, week)

    if (existing) {
      // Merge: keep max popularity, union arrays, increment validation
      const mergedSourceIds = Array.from(new Set([...existing.source_ids, source.id]))
      const mergedExampleUrls = Array.from(new Set([...existing.example_urls, ...exampleUrls]))
      const mergedHashtags = Array.from(new Set([...existing.hashtags, ...hashtagList]))
      const newPop = Math.max(Number(existing.popularity_score), pop)
      const newValidation = Math.min(5, mergedSourceIds.length)
      const freshness = freshnessScore(new Date(existing.first_seen_at), now)

      // Merge source names stored in DB
      const existingSourceNames = (await sql().query(
        `SELECT source_names FROM culture_trends WHERE id = $1`,
        [existing.id],
      )) as Array<{ source_names: string[] | null }>
      const prevNames = existingSourceNames[0]?.source_names ?? []
      const mergedSourceNames = Array.from(new Set([...prevNames, source.name]))

      await updateTrend({
        id: existing.id,
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        contentType: contentTypeNorm,
        hashtags: mergedHashtags,
        exampleUrls: mergedExampleUrls,
        popularityScore: newPop,
        freshnessScore: freshness,
        validationScore: newValidation,
        reasoning,
        sourceIds: mergedSourceIds,
        sourceNames: mergedSourceNames,
        estimatedViews,
        now: now.toISOString(),
      })
    } else {
      await insertTrend({
        name: name.trim(),
        slug,
        description: description.trim(),
        category: category.trim(),
        contentType: contentTypeNorm,
        hashtags: hashtagList,
        exampleUrls,
        popularityScore: pop,
        freshnessScore: freshnessScore(now, now), // 10 — brand new
        validationScore: 1,
        reasoning,
        sourceIds: [source.id],
        sourceNames: [source.name],
        estimatedViews,
        rankWeek: week,
        firstSeenAt: now.toISOString(),
      })
    }

    // ── Recompute rankings for this week ───────────────────────────────────

    const allTrends = await loadActiveTrendsForRanking(week)
    const scored = allTrends
      .map((t) => ({
        id: t.id,
        score: rankingScore({
          popularity: t.popularity_score,
          freshness: t.freshness_score,
          validation: t.validation_score,
        }),
      }))
      .sort((a, b) => b.score - a.score)

    const ranks = scored.map((t, i) => ({
      id: t.id,
      dailyRank: i < 10 ? i + 1 : null,
      weeklyRank: i < 50 ? i + 1 : null,
    }))

    await applyTrendRanks(ranks, today)

    // ── Generate Action brief + Perplexity enrichment (async) ─────────────
    // Fire and forget: enrich the trend in the background. The dashboard
    // will pick it up on next load.
    //
    // Flow:
    //   1. If description is thin (<80 chars), ask Perplexity to research
    //      the trend and produce a richer description.
    //   2. Generate the Action brief using whatever description we have.
    //   3. Save both back to the DB.
    ;(async () => {
      try {
        const rows = (await sql().query(
          `SELECT id FROM culture_trends WHERE slug = $1 AND rank_week = $2 LIMIT 1`,
          [slug, week],
        )) as Array<{ id: string }>
        if (!rows[0]) return

        let workingDescription = description!.trim()
        let workingExampleUrls = exampleUrls

        // Step 1: Perplexity research if description is thin
        if (workingDescription.length < 80) {
          const research = await perplexityResearchTrend({
            name: name!.trim(),
            brandExample: brandExample?.trim() ?? null,
            url: url?.trim() ?? null,
          })
          if (research.ok && research.text) {
            workingDescription = research.text.slice(0, 800)
            workingExampleUrls = Array.from(
              new Set([...workingExampleUrls, ...research.citations.slice(0, 5)]),
            )
            // Persist the enriched description + citations
            await sql().query(
              `UPDATE culture_trends
                  SET description = $1, example_urls = $2, updated_at = NOW()
                WHERE id = $3`,
              [workingDescription, workingExampleUrls, rows[0].id],
            )
          }
        }

        // Step 2: Action brief (with currently trending sounds as menu)
        const trendingSounds = await getTrendingSounds(week, 12)
        const brief = await generateActionBrief({
          name: name!.trim(),
          description: workingDescription,
          category: category!.trim(),
          brandExample: brandExample?.trim() ?? null,
          url: url?.trim() ?? null,
          trendingSounds,
        })
        if (brief) await saveBrandBrief(rows[0].id, brief)
      } catch (err) {
        console.error('[culture/submit] enrichment failed:', err)
      }
    })()

    return NextResponse.json({
      ok: true,
      slug,
      week,
      action: existing ? 'updated' : 'inserted',
    })
  } catch (err) {
    console.error('[culture/submit]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
