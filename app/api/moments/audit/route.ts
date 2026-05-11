/**
 * POST /api/moments/audit
 *
 * Validates every moment in the DB and returns a list of issues.
 *
 * Two layers of checks:
 *
 * 1. STRUCTURAL (always run, fast)
 *    - Country codes are valid Action countries
 *    - Dates parse as YYYY-MM-DD and are real calendar dates
 *    - Category + tier are valid
 *    - next_occurrence matches the earliest future date in country_dates
 *    - No duplicate country codes within a single moment
 *    - All country_dates are past → flag as 'fully_past' (should be archived
 *      or rolled to next year)
 *
 * 2. AI VERIFICATION (opt-in via body.verifyWithAI = true, slower)
 *    Runs a Perplexity query per moment to verify the date is correct,
 *    e.g. "Is Mother's Day in the Netherlands on 2026-05-10? Yes/No + source."
 *
 * Body (optional):
 *   {
 *     "verifyWithAI": false,       // run Perplexity cross-check
 *     "fix": false,                // auto-fix next_occurrence drift
 *     "limit": 200                 // max moments to audit
 *   }
 *
 * Returns: { totalChecked, issues: [{ momentId, slug, name, severity, type, detail }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { perplexitySearch } from '@/lib/perplexity'
import type { ActionCountry, CountryDate, MomentCategory, MomentTier } from '@/types/culture'

export const maxDuration = 300

const VALID_COUNTRIES: ActionCountry[] = [
  'NL', 'FR', 'DE', 'BE', 'ES', 'IT', 'PL', 'CZ', 'SK', 'HU', 'AT', 'CH', 'RO', 'PT',
]
const VALID_CATEGORIES: MomentCategory[] = [
  'holiday', 'national', 'sport', 'festival', 'religious', 'seasonal',
  'entertainment', 'music', 'celebrity', 'product_launch', 'award_show',
  'political', 'pop_culture',
]
const VALID_TIERS: MomentTier[] = ['standard', 'cultural']

type Severity = 'error' | 'warning' | 'info'

interface Issue {
  momentId: string
  slug: string
  name: string
  severity: Severity
  type: string
  detail: string
}

interface MomentRow {
  id: string
  slug: string
  name: string
  description: string
  tier: string
  category: string
  scope: string
  country_dates: CountryDate[] | null
  next_occurrence: string | null
  recurring: string | null
  status: string
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  const body = (await req.json().catch(() => ({}))) as {
    verifyWithAI?: boolean
    fix?: boolean
    limit?: number
  }
  const limit = Math.min(500, body.limit ?? 200)

  const rows = (await sql().query(
    `SELECT id, slug, name, description, tier, category, scope,
            country_dates, next_occurrence::TEXT AS next_occurrence,
            recurring, status
       FROM culture_moments
       LIMIT $1`,
    [limit],
  )) as MomentRow[]

  const today = new Date().toISOString().slice(0, 10)
  const issues: Issue[] = []
  let fixed = 0

  // ── 1. Structural checks ─────────────────────────────────────────────
  for (const r of rows) {
    const cds = r.country_dates ?? []
    const push = (severity: Severity, type: string, detail: string) =>
      issues.push({ momentId: r.id, slug: r.slug, name: r.name, severity, type, detail })

    // Empty / missing country_dates on a country-specific moment
    if (r.scope !== 'global' && cds.length === 0) {
      push('error', 'no_country_dates', 'Country-specific moment has no country_dates entries')
    }

    // Validate each country_date
    const seenCountries = new Set<string>()
    for (const cd of cds) {
      // Country code
      if (!VALID_COUNTRIES.includes(cd.country as ActionCountry)) {
        push('error', 'invalid_country', `Unknown country code: ${cd.country}`)
      }
      // Duplicate country
      if (seenCountries.has(cd.country)) {
        push('warning', 'duplicate_country', `${cd.country} appears more than once`)
      }
      seenCountries.add(cd.country)
      // Date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cd.date)) {
        push('error', 'bad_date_format', `${cd.country}: "${cd.date}" is not YYYY-MM-DD`)
        continue
      }
      const parsed = new Date(cd.date + 'T00:00:00Z')
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== cd.date) {
        push('error', 'invalid_date', `${cd.country}: ${cd.date} is not a real calendar date`)
      }
    }

    // Category + tier
    if (!VALID_CATEGORIES.includes(r.category as MomentCategory)) {
      push('error', 'invalid_category', `Unknown category: ${r.category}`)
    }
    if (!VALID_TIERS.includes(r.tier as MomentTier)) {
      push('error', 'invalid_tier', `Unknown tier: ${r.tier}`)
    }

    // next_occurrence drift: should be earliest FUTURE date among country_dates
    const futureDates = cds.map((cd) => cd.date).filter((d) => d >= today).sort()
    const expectedNext = futureDates[0] ?? null

    if (r.next_occurrence !== expectedNext) {
      push(
        'warning',
        'next_occurrence_drift',
        `Stored next_occurrence=${r.next_occurrence} but earliest future date is ${expectedNext ?? '(all past)'}`,
      )
      if (body.fix && expectedNext !== r.next_occurrence) {
        await sql().query(
          `UPDATE culture_moments SET next_occurrence = $1, updated_at = NOW() WHERE id = $2`,
          [expectedNext, r.id],
        )
        fixed++
      }
    }

    // Fully past moment that is still 'upcoming'
    if (expectedNext === null && cds.length > 0 && r.status !== 'archived') {
      push(
        'info',
        'fully_past',
        `All ${cds.length} country dates are in the past; archiving.`,
      )
      if (body.fix) {
        await sql().query(
          `UPDATE culture_moments SET status = 'archived', updated_at = NOW() WHERE id = $1`,
          [r.id],
        )
        fixed++
      }
    }

    // Global moments should have all 14 countries
    if (r.scope === 'global' && cds.length > 0 && cds.length < 14) {
      push(
        'info',
        'incomplete_global',
        `Global-scope moment has only ${cds.length}/14 country entries`,
      )
    }
  }

  // ── 2. Optional AI verification ──────────────────────────────────────
  // We only verify a focused subset: standard-tier moments with NL dates,
  // since those are the highest-stakes for the home market. Bounded to 15
  // checks so we don't blow the 300s budget.
  let aiChecks = 0
  if (body.verifyWithAI) {
    const sample = rows
      .filter((r) => {
        const cds = r.country_dates ?? []
        const nl = cds.find((cd) => cd.country === 'NL')
        return r.tier === 'standard' && nl && nl.date >= today
      })
      .slice(0, 15)

    for (const r of sample) {
      const nl = (r.country_dates ?? []).find((cd) => cd.country === 'NL')!
      const q = `Is "${r.name}" in the Netherlands actually on ${nl.date}? Answer with: a one-line "YES" or "NO + correct date", then one citation URL.`
      const res = await perplexitySearch(q)
      aiChecks++
      if (!res.ok) continue
      const text = res.text.toLowerCase()
      if (text.startsWith('no') || text.includes(' wrong') || text.includes('incorrect')) {
        issues.push({
          momentId: r.id,
          slug: r.slug,
          name: r.name,
          severity: 'warning',
          type: 'ai_date_mismatch',
          detail: `AI suggests date may be wrong for NL ${nl.date}: ${res.text.slice(0, 200)}`,
        })
      }
    }
  }

  // Summary
  const byCount: Record<string, number> = {}
  for (const i of issues) byCount[i.type] = (byCount[i.type] ?? 0) + 1

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    totalChecked: rows.length,
    aiChecks,
    fixed,
    summary: byCount,
    issues,
  })
}
