/**
 * Moments Radar — AI extraction layer.
 *
 * Takes Perplexity research output and asks Gemini to extract structured
 * upcoming moments. Different shape than Culture Radar's trend extraction
 * because moments need country-specific dates and forward-looking metadata.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { CULTURE_GEMINI_MODEL } from '@/lib/constants'
import { extractJson } from '@/lib/culture-radar'
import type {
  ActionCountry,
  CountryDate,
  MomentCategory,
} from '@/types/culture'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')

const VALID_CATEGORIES: MomentCategory[] = [
  'holiday', 'national', 'sport', 'festival', 'religious', 'seasonal',
  'entertainment', 'music', 'celebrity', 'product_launch', 'award_show',
  'political', 'pop_culture',
]

const VALID_COUNTRIES: ActionCountry[] = [
  'NL', 'FR', 'DE', 'BE', 'ES', 'IT', 'PL', 'CZ', 'SK', 'HU', 'AT', 'CH', 'RO', 'PT',
]

export interface AIIdentifiedMoment {
  name: string
  description: string
  category: MomentCategory
  scope: 'global' | 'country-specific'
  countryDates: CountryDate[]
  recurring: 'yearly' | 'yearly-variable' | 'one-time'
  culturalRelevance: number
  hashtags: string[]
  exampleUrls: string[]
}

export interface AIMomentResult {
  moments: AIIdentifiedMoment[]
  modelUsed: string
  tokensIn?: number
  tokensOut?: number
}

export async function extractMomentsFromResearch(args: {
  sourceName: string
  researchText: string
  citationUrls: string[]
  maxMoments?: number
}): Promise<AIMomentResult> {
  const { sourceName, researchText, citationUrls } = args
  const maxMoments = args.maxMoments ?? 8

  const trimmed = researchText.slice(0, 12_000)
  const today = new Date().toISOString().slice(0, 10)

  const prompt = `You are extracting upcoming CULTURAL MOMENTS from research about
upcoming events. Action operates in 14 European countries
(${VALID_COUNTRIES.join(', ')}). Today's date is ${today}.

# SOURCE
Name: ${sourceName}

# RESEARCH TEXT (Perplexity synthesis)
${trimmed}

# CITATIONS
${citationUrls.slice(0, 8).map((c, i) => `${i + 1}. ${c}`).join('\n')}

# TASK
Identify up to ${maxMoments} concrete, NAMED upcoming cultural moments from the
research above. These should be specific things Action's marketing team can plan
content around.

# CRITICAL RULES

1. SPECIFICITY — every moment must be a named, real event with a real date.
   GOOD: "Squid Game Season 3 finale", "Oasis reunion tour - Wembley", "iPhone 18 launch"
   BAD: "TV shows", "Music releases", "Celebrity events"

2. DATES — only include moments with a known date or date range. Skip
   speculative or unconfirmed ones. Date must be on or after ${today}.

3. SCOPE:
   - "global" = single date, all 14 Action countries can react (streaming
     releases, Oscars, viral album drops, global product launches)
   - "country-specific" = only relevant for a subset of countries, OR
     different dates per country (concert tours, regional events)

4. COUNTRY DATES:
   - For global: put all 14 country codes with the same date
   - For country-specific: only the relevant countries with their dates
   - Use ISO date format YYYY-MM-DD
   - country codes: ${VALID_COUNTRIES.join(', ')}

5. CULTURAL RELEVANCE — score 1-10 based on:
   - 8-10: globally-discussed event (Olympics, Eurovision, Oasis reunion)
   - 6-7: niche-but-significant (specific show finale, mid-tier album drop)
   - 1-5: minor / hyper-local

6. RECURRING:
   - "one-time" = this specific moment happens once (Squid Game S3 finale)
   - "yearly" = annual moments (Oscars, Met Gala)
   - "yearly-variable" = annual but date shifts (Easter, Champions League final)

# OUTPUT
Return ONLY valid JSON:

{
  "moments": [
    {
      "name": "...",
      "description": "1-3 sentences: what it is and why it matters for brands",
      "category": "one of [${VALID_CATEGORIES.join(', ')}]",
      "scope": "global" or "country-specific",
      "countryDates": [{"country":"NL","date":"2026-MM-DD","localName":"optional"}],
      "recurring": "one-time" or "yearly" or "yearly-variable",
      "culturalRelevance": 7,
      "hashtags": ["#optional"],
      "exampleUrls": ["https://..."]
    }
  ]
}

If no concrete moments are findable, return { "moments": [] }.`

  const model = genAI.getGenerativeModel({
    model: CULTURE_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  })

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text()
    const usage = result.response.usageMetadata
    const parsed = extractJson<{ moments?: unknown }>(text)
    const rawMoments = Array.isArray(parsed?.moments) ? parsed.moments : []

    const moments: AIIdentifiedMoment[] = rawMoments
      .filter((m): m is Record<string, unknown> => m !== null && typeof m === 'object')
      .map(normalizeMoment)
      .filter((m): m is AIIdentifiedMoment => m !== null)

    return {
      moments,
      modelUsed: CULTURE_GEMINI_MODEL,
      tokensIn: usage?.promptTokenCount,
      tokensOut: usage?.candidatesTokenCount,
    }
  } catch (err) {
    console.error('[moments-ai] failed:', err)
    return { moments: [], modelUsed: CULTURE_GEMINI_MODEL }
  }
}

function normalizeMoment(raw: Record<string, unknown>): AIIdentifiedMoment | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return null
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  if (!description) return null

  const category = isCategory(raw.category) ? raw.category : 'pop_culture'
  const scope: 'global' | 'country-specific' = raw.scope === 'global' ? 'global' : 'country-specific'

  // Country dates: filter to known countries + valid dates
  const today = new Date().toISOString().slice(0, 10)
  const countryDatesRaw: unknown[] = Array.isArray(raw.countryDates) ? raw.countryDates : []
  const countryDates: CountryDate[] = countryDatesRaw
    .filter((cd): cd is { country: string; date: string; localName?: string } =>
      cd != null &&
      typeof cd === 'object' &&
      typeof (cd as { country?: unknown }).country === 'string' &&
      typeof (cd as { date?: unknown }).date === 'string',
    )
    .map((cd) => ({
      country: cd.country.toUpperCase() as ActionCountry,
      date: cd.date,
      localName: typeof cd.localName === 'string' ? cd.localName : undefined,
    }))
    .filter((cd) => VALID_COUNTRIES.includes(cd.country))
    .filter((cd) => /^\d{4}-\d{2}-\d{2}$/.test(cd.date))
    .filter((cd) => cd.date >= today)

  if (countryDates.length === 0) return null  // no future date = drop

  const recurringRaw = typeof raw.recurring === 'string' ? raw.recurring : 'one-time'
  const recurring: 'yearly' | 'yearly-variable' | 'one-time' =
    recurringRaw === 'yearly' || recurringRaw === 'yearly-variable'
      ? recurringRaw
      : 'one-time'

  const culturalRelevance = Math.max(1, Math.min(10, Math.round(Number(raw.culturalRelevance) || 6)))

  const hashtags = Array.isArray(raw.hashtags)
    ? raw.hashtags.filter((h): h is string => typeof h === 'string').map((h) => (h.startsWith('#') ? h : `#${h}`))
    : []
  const exampleUrls = Array.isArray(raw.exampleUrls)
    ? raw.exampleUrls.filter((u): u is string => typeof u === 'string')
    : []

  return {
    name,
    description,
    category,
    scope,
    countryDates,
    recurring,
    culturalRelevance,
    hashtags,
    exampleUrls,
  }
}

function isCategory(v: unknown): v is MomentCategory {
  return typeof v === 'string' && VALID_CATEGORIES.includes(v as MomentCategory)
}
