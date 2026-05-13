/**
 * Google Trends interpreter.
 *
 * Takes a list of multi-country trending searches (with their article
 * context and related queries) and returns enriched "why is this
 * trending" interpretations from Gemini.
 *
 * One Gemini call for the whole list (batch), JSON response.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { CULTURE_GEMINI_MODEL } from '@/lib/constants'
import { extractJson } from '@/lib/culture-radar'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')

export interface GtInterpretInput {
  title: string
  countryCount: number
  geos: string[]                           // ISO codes
  relatedQueries: string[]
  articles: Array<{ title: string; url: string; source: string | null }>
}

export interface GtInterpretation {
  title: string
  whyNow: string                           // one sentence
  category: string                         // sport | politics | entertainment | tech | celebrity | accident | business | health | other
  actionRelevance: 'high' | 'medium' | 'low' | 'none'
  actionAngle: string | null               // one sentence on whether Action's team should care, null if 'none'
}

export async function interpretGtTrends(
  items: GtInterpretInput[],
): Promise<GtInterpretation[]> {
  if (items.length === 0) return []

  const list = items
    .map((t, i) =>
      `${i + 1}. TITLE: ${t.title}
   COUNTRIES: ${t.geos.join(', ')} (${t.countryCount})
   ${t.relatedQueries.length > 0 ? `RELATED SEARCHES: ${t.relatedQueries.slice(0, 6).join(', ')}` : ''}
   ${t.articles.length > 0 ? `TOP ARTICLES:\n     ${t.articles.slice(0, 3).map((a) => `- "${a.title}"${a.source ? ` (${a.source})` : ''}`).join('\n     ')}` : ''}`,
    )
    .join('\n\n')

  const prompt = `You interpret Google Trends search spikes for Action, a discount retailer
operating in 14 European countries (NL BE FR DE AT CH ES IT PT PL CZ SK HU RO).

For each trending search below, return:

1. whyNow         — ONE SENTENCE in English: what's actually happening,
                    grounded in the article titles. No "people are interested
                    in" fluff — say the actual news/event.
2. category       — one of: sport | politics | entertainment | tech | celebrity
                    | accident | business | health | weather | other
3. actionRelevance — high | medium | low | none. Action's marketing team cares about:
                    - large-audience cultural moments (sport finals, music releases,
                      celebrity moments) that they could lean into → high
                    - smaller cultural events with content potential → medium
                    - news-only topics with no creative angle → low
                    - tragedies, political violence, hyper-local news → none
4. actionAngle    — one short sentence on the creative/content angle Action could
                    take (or null if "none").

CRITICAL: Be concrete and specific. Reference actual names, events, dates from
the article context. If the articles don't make it clear what's happening, say
"context unclear — likely [your best guess]".

Trending searches:

${list}

Return JSON:
{
  "results": [
    { "title": "...", "whyNow": "...", "category": "...", "actionRelevance": "...", "actionAngle": "..." | null }
  ]
}
`

  const model = genAI.getGenerativeModel({
    model: CULTURE_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  })

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text()
    const parsed = extractJson<{ results?: unknown }>(text)
    const raw = Array.isArray(parsed?.results) ? parsed.results : []

    const byTitle = new Map<string, GtInterpretation>()
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      if (typeof o.title !== 'string') continue
      byTitle.set(o.title.toLowerCase(), {
        title: o.title,
        whyNow: typeof o.whyNow === 'string' ? o.whyNow : '',
        category: typeof o.category === 'string' ? o.category : 'other',
        actionRelevance: ['high', 'medium', 'low', 'none'].includes(o.actionRelevance as string)
          ? (o.actionRelevance as 'high' | 'medium' | 'low' | 'none') : 'low',
        actionAngle: typeof o.actionAngle === 'string' ? o.actionAngle : null,
      })
    }

    // Map back to input order, fall back to a stub for unmatched
    return items.map((t) => byTitle.get(t.title.toLowerCase()) ?? {
      title: t.title,
      whyNow: '',
      category: 'other',
      actionRelevance: 'low' as const,
      actionAngle: null,
    })
  } catch (err) {
    console.error('[gt-interpret] gemini failed', err)
    return items.map((t) => ({
      title: t.title,
      whyNow: '',
      category: 'other',
      actionRelevance: 'low' as const,
      actionAngle: null,
    }))
  }
}
