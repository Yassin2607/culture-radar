/**
 * POST /api/moments/fetch
 *
 * Discover new cultural moments via Perplexity. Loops over all sources of
 * type 'perplexity_moment_query', synthesizes upcoming moments from each,
 * and upserts them into culture_moments.
 *
 * Body (optional):
 *   {
 *     "sourceIds": [59, 60],     // subset of moment-query sources
 *     "maxSources": 5,           // hard cap
 *     "triggeredBy": "manual"
 *   }
 *
 * Returns: { runId-style summary, count of new moments }
 *
 * Designed for monthly cadence — call this once a month after the daily
 * Culture Radar fetch.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql, listSources, updateSourceScrapeStatus } from '@/lib/culture-db'
import { perplexitySearch, perplexityToMarkdown } from '@/lib/perplexity'
import { extractMomentsFromResearch } from '@/lib/moments-ai'
import { upsertMoment } from '@/lib/moments-db'
import { slugify } from '@/lib/culture-radar'

export const maxDuration = 300

interface FetchBody {
  sourceIds?: number[]
  maxSources?: number | null
  triggeredBy?: string
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  let body: FetchBody = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    /* allow empty */
  }

  // Load moment-discovery sources from culture_sources
  const rows = (await sql().query(
    `SELECT id, name, url, category, source_type, notes
       FROM culture_sources
      WHERE source_type = 'perplexity_moment_query'
        AND active = true
        ${body.sourceIds?.length ? 'AND id = ANY($1::int[])' : ''}
      ORDER BY id ASC`,
    body.sourceIds?.length ? [body.sourceIds] : [],
  )) as Array<{ id: number; name: string; url: string; category: string; source_type: string; notes: string | null }>

  const cappedSources = body.maxSources ? rows.slice(0, body.maxSources) : rows

  if (cappedSources.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'No moment-discovery sources found. Seed culture_sources with perplexity_moment_query rows.',
    }, { status: 400 })
  }

  let totalMoments = 0
  let totalUpserted = 0
  const failures: Array<{ source: string; error: string }> = []
  const summaries: Array<{ source: string; identified: number; inserted: number }> = []
  let totalTokensIn = 0
  let totalTokensOut = 0

  // Serial loop — Perplexity is rate-friendly enough and we want to fit in
  // the 300s window without burning concurrency on errors.
  for (const src of cappedSources) {
    const fetchedAt = new Date().toISOString()
    try {
      const question = src.notes ?? `What major upcoming cultural moments are coming up in the next 90 days in the ${src.category} space?`
      const research = await perplexitySearch(question)

      if (!research.ok || !research.text) {
        failures.push({ source: src.name, error: research.error ?? 'perplexity_empty' })
        await updateSourceScrapeStatus({
          id: src.id,
          fetchedAt,
          status: 'error',
          error: research.error ?? 'perplexity_empty',
        })
        continue
      }

      // Extract structured moments from the research
      const result = await extractMomentsFromResearch({
        sourceName: src.name,
        researchText: perplexityToMarkdown(research),
        citationUrls: research.citations,
        maxMoments: 6,
      })
      totalTokensIn += result.tokensIn ?? 0
      totalTokensOut += result.tokensOut ?? 0
      totalMoments += result.moments.length

      // Upsert each
      let inserted = 0
      for (const m of result.moments) {
        const slug = slugify(m.name)
        if (!slug) continue
        try {
          await upsertMoment({
            name: m.name,
            slug,
            description: m.description,
            tier: 'cultural',
            culturalRelevance: m.culturalRelevance,
            category: m.category,
            scope: m.scope,
            countryDates: m.countryDates,
            nextOccurrence: m.countryDates[0]?.date ?? null,
            recurring: m.recurring,
            typicalDurationDays: 1,
            hashtags: m.hashtags,
            exampleUrls: m.exampleUrls,
            sourceNames: [src.name],
            reasoning: `Discovered via ${src.name}.`,
          })
          inserted++
          totalUpserted++
        } catch (err) {
          console.error('[moments/fetch] upsert failed for', m.name, err)
        }
      }

      summaries.push({ source: src.name, identified: result.moments.length, inserted })
      await updateSourceScrapeStatus({
        id: src.id,
        fetchedAt,
        status: 'ok',
        error: null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push({ source: src.name, error: msg })
      await updateSourceScrapeStatus({
        id: src.id,
        fetchedAt,
        status: 'error',
        error: msg,
      })
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    status: failures.length === 0 ? 'ok' : failures.length === cappedSources.length ? 'failed' : 'partial',
    durationMs: Date.now() - started,
    sourcesAttempted: cappedSources.length,
    sourcesOk: cappedSources.length - failures.length,
    sourcesFailed: failures.length,
    momentsIdentified: totalMoments,
    momentsUpserted: totalUpserted,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    summaries,
    failures,
    triggeredBy: body.triggeredBy ?? 'manual',
  })
}
