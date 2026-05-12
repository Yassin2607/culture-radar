/**
 * Country relevance inference.
 *
 * Most trends come out of extraction with an empty country_relevance
 * array, which the dashboard treats as "global, show on every country
 * filter". That's wrong for stories like "Benfica vs Porto" (PT-only)
 * or "West Ham VAR controversy" (UK-only — not even an Action country).
 *
 * This function asks Gemini to tag a trend with the Action countries it
 * is meaningfully relevant to. The Action country list is the 14
 * markets where Action operates. Anything UK/US/global-only gets back
 * an empty array — but with a special marker so we know the AI saw it
 * and decided "not for any Action market".
 *
 * To avoid one Gemini call per trend, we batch up to 12 trends per
 * call and parse a JSON map back.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { CULTURE_GEMINI_MODEL } from '@/lib/constants'
import { extractJson } from '@/lib/culture-radar'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')

export const ACTION_COUNTRIES = [
  'NL', 'BE', 'FR', 'DE', 'AT', 'CH', 'ES', 'IT', 'PT', 'PL', 'CZ', 'SK', 'HU', 'RO',
] as const

export type ActionCountryCode = typeof ACTION_COUNTRIES[number]

export interface CountryInferInput {
  id: string
  name: string
  description: string
  sourceNames: string[]
  hashtags: string[]
}

export interface CountryInferResult {
  id: string
  countries: ActionCountryCode[]   // empty array = not relevant to any Action market
  scope: 'global' | 'multi' | 'country' | 'none'
}

/**
 * Infer country_relevance for a batch of trends.
 * Returns a map keyed by trend id.
 *
 * Gemini is asked to classify each trend as:
 *   - GLOBAL: a format/meme/aesthetic/sound that travels across markets
 *             → all Action countries
 *   - MULTI: relevant to a specific subset of countries (e.g. football
 *            tournament involving multiple Action markets)
 *   - COUNTRY: tied to a specific country (Portuguese football, German
 *              politics, Hungarian elections, etc.)
 *   - NONE: tied to a country Action doesn't operate in (UK, US, BR)
 *           or a hyper-local story with no Action market relevance.
 */
export async function inferCountryRelevance(
  trends: CountryInferInput[],
): Promise<CountryInferResult[]> {
  if (trends.length === 0) return []

  const prompt = buildPrompt(trends)
  const model = genAI.getGenerativeModel({
    model: CULTURE_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.1,                  // deterministic classification
      responseMimeType: 'application/json',
    },
  })

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  const parsed = extractJson<{ results?: unknown }>(text)
  const rawResults = Array.isArray(parsed?.results) ? parsed.results : []

  const byId = new Map<string, CountryInferResult>()
  for (const raw of rawResults) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : null
    if (!id) continue

    const scope = (typeof r.scope === 'string' ? r.scope : 'global').toLowerCase() as CountryInferResult['scope']
    const countriesRaw = Array.isArray(r.countries) ? r.countries : []
    const countries = countriesRaw
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.toUpperCase())
      .filter((c): c is ActionCountryCode => (ACTION_COUNTRIES as readonly string[]).includes(c))

    // If Gemini said GLOBAL, expand to all Action countries so the trend
    // appears on every filter. If NONE, return empty + scope=none.
    const finalCountries =
      scope === 'global' ? [...ACTION_COUNTRIES] :
      scope === 'none'   ? [] :
      countries
    byId.set(id, { id, countries: finalCountries, scope })
  }

  // Default to GLOBAL for anything Gemini didn't return (safe fallback).
  return trends.map((t) =>
    byId.get(t.id) ?? { id: t.id, countries: [...ACTION_COUNTRIES], scope: 'global' as const },
  )
}

function buildPrompt(trends: CountryInferInput[]): string {
  const list = trends
    .map((t, i) =>
      `${i + 1}. ID: ${t.id}
   NAME: ${t.name}
   DESCRIPTION: ${t.description.slice(0, 320)}
   ${t.sourceNames.length > 0 ? `SOURCES: ${t.sourceNames.slice(0, 3).join(', ')}` : ''}
   ${t.hashtags.length > 0 ? `HASHTAGS: ${t.hashtags.slice(0, 6).join(' ')}` : ''}`,
    )
    .join('\n\n')

  return `You are an analyst for Action, a discount retailer operating in 14 European countries:
NL (Netherlands), BE (Belgium), FR (France), DE (Germany), AT (Austria), CH (Switzerland),
ES (Spain), IT (Italy), PT (Portugal), PL (Poland), CZ (Czechia), SK (Slovakia),
HU (Hungary), RO (Romania).

For each trend below, classify its country relevance for Action's marketing team.

Classification scope:
- "global"  = format/meme/aesthetic/sound/behavior that travels across markets.
              Examples: TikTok aesthetics, viral dance challenges, AI tool adoption,
              global product launches, universal beauty/food/home trends.
- "multi"   = relevant to a specific subset of Action countries (e.g. a tournament
              involving multiple Action markets, or a regional behavior pattern).
- "country" = tied to ONE specific country. Examples: Portuguese football team
              news (PT only), German politics (DE only), Polish holiday (PL only).
- "none"    = tied to a country Action does NOT operate in (UK, USA, Brazil,
              India, etc.) or a hyper-local story with no broader market relevance.

For "multi" and "country", return the relevant Action country codes in the "countries"
field. For "global", we expand to all 14 countries automatically. For "none", return
an empty countries array.

CRITICAL RULES:
- UK football clubs (Arsenal, West Ham, Tottenham, Chelsea, Liverpool, Man City, Man Utd):
  → scope = "none" (Action doesn't operate in UK).
- US news/sports (NFL, NBA, MLB, US elections, Trump): → scope = "none".
- Portuguese clubs (Benfica, Porto, Sporting): → scope = "country", countries = ["PT"].
- Polish clubs/news: → ["PL"]. Czech (Pardubice, Slavia, Sparta): → ["CZ"].
- Eurovision: → scope = "multi", include all PARTICIPATING Action countries
  (typically all 14).
- World Cup, FIFA, Euros: → scope = "multi" (most Action countries).
- A TikTok trend that mentions a specific Dutch creator: still "global" unless the
  trend itself is NL-only.
- A specific city: classify by its country (Pardubice → CZ, Antwerp → BE).
- If unsure, prefer "global".

Trends to classify:

${list}

Return JSON in this exact shape:
{
  "results": [
    { "id": "<trend id>", "scope": "global|multi|country|none", "countries": ["NL", "BE", ...] },
    ...
  ]
}
`
}
