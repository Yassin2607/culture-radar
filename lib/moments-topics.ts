/**
 * Moments Radar — Related topics enrichment.
 *
 * For each moment, surface the topics, traditions, sub-events, related
 * searches, and "things people care about" around that moment. Helps the
 * social team see beyond just the name (e.g. for "Bastille Day 14 juillet"
 * also surface: military parade, Eiffel Tower fireworks, Bal des pompiers,
 * Tour de France stage overlap).
 *
 * Implementation: Perplexity research. Google Trends related-queries is
 * fragile without session cookies, so we use Perplexity for richer text +
 * citations. Optionally we also pull general Google Trends daily-trending
 * items per country and surface any that mention the moment's keywords.
 */

import { perplexitySearch } from '@/lib/perplexity'
import { fetchGoogleTrends } from '@/lib/google-trends'

export interface RelatedTopic {
  topic: string
  context: string         // 1 sentence why it's related
  source: 'perplexity' | 'google_trends'
  countries?: string[]    // which Action countries the topic resonates in
  url?: string
}

export interface RelatedTopicsResult {
  ok: boolean
  topics: RelatedTopic[]
  rawResearch: string     // for storing alongside structured topics
  error?: string
}

/**
 * Fetches related topics for a single moment via Perplexity. Optionally
 * augments with Google Trends overlap for the listed countries.
 */
export async function fetchRelatedTopicsForMoment(args: {
  name: string
  description: string
  category: string
  countries: string[]
  date: string
}): Promise<RelatedTopicsResult> {
  const { name, description, category, countries, date } = args

  const countryList = countries.length > 0
    ? countries.join(', ')
    : 'across Europe'

  const query = `For the upcoming moment "${name}" on ${date} in ${countryList}, what are the related topics, traditions, sub-events, and parallel cultural moments people talk about around this time?

Context: ${description}

For example, for Bastille Day in France: military parade on Champs-Élysées, Eiffel Tower fireworks, Bal des pompiers, Tour de France overlap, traditional French food, etc.

Give 5-10 specific related topics with 1-sentence context each. Mark which countries each topic resonates in if applicable. Focus on things a brand could build social content around. Be specific — no generic statements.

Format response as a markdown list.`

  const research = await perplexitySearch(query, {
    systemPromptOverride: `You are a cultural intelligence researcher. Give specific, named related topics — never generic descriptions. Cite real sources when possible.`,
  })

  if (!research.ok || !research.text) {
    return {
      ok: false,
      topics: [],
      rawResearch: '',
      error: research.error ?? 'no_perplexity_data',
    }
  }

  // Parse the markdown list into structured topics. Simple regex-based,
  // robust to slight format variation.
  const topics = parsePerplexityTopics(research.text, research.citations)

  return {
    ok: true,
    topics,
    rawResearch: research.text,
  }
}

/**
 * Parse Perplexity's markdown bullet list into structured topics.
 * Accepts variants:
 *   - **Topic**: context
 *   * Topic — context
 *   - Topic (context)
 */
function parsePerplexityTopics(text: string, citations: string[]): RelatedTopic[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const topics: RelatedTopic[] = []

  for (const line of lines) {
    // Skip headers and prose
    if (!/^[-*•]/.test(line) && !/^\d+\./.test(line)) continue

    // Strip list markers + numbering
    let cleaned = line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '')

    // Pull a topic + context: try bold-marker, em-dash, or colon split
    let topic = ''
    let context = ''

    const boldMatch = cleaned.match(/^\*\*([^*]+)\*\*[:\s—-]*\s*(.*)/)
    if (boldMatch) {
      topic = boldMatch[1].trim()
      context = boldMatch[2].trim()
    } else {
      const emDashIdx = cleaned.search(/\s[—–-]\s/)
      const colonIdx = cleaned.indexOf(':')
      const splitIdx = emDashIdx > 0
        ? emDashIdx
        : colonIdx > 0 && colonIdx < 60
          ? colonIdx
          : -1
      if (splitIdx > 0) {
        topic = cleaned.slice(0, splitIdx).trim().replace(/[*_]/g, '')
        context = cleaned.slice(splitIdx).replace(/^[\s—–:-]+/, '').trim()
      } else {
        topic = cleaned.slice(0, 60).trim()
        context = cleaned.length > 60 ? cleaned.slice(60).trim() : ''
      }
    }

    // Strip citation refs like [1], [2,3] from context
    context = context.replace(/\[\d+(?:,\s*\d+)*\]/g, '').trim()
    topic = topic.replace(/\[\d+(?:,\s*\d+)*\]/g, '').trim()
    topic = topic.replace(/[*_]+/g, '').trim()

    if (topic && topic.length <= 80) {
      topics.push({
        topic,
        context: context.slice(0, 240),
        source: 'perplexity',
      })
    }
    if (topics.length >= 12) break
  }

  // Attach citations to the first few topics as urls
  for (let i = 0; i < Math.min(topics.length, citations.length); i++) {
    topics[i].url = citations[i]
  }

  return topics
}

/**
 * Optionally augment topics with Google Trends overlap: for each country,
 * fetch daily trending searches and surface any that contain the moment's
 * keywords. Best-effort, fails silently.
 */
export async function augmentWithGoogleTrends(args: {
  momentName: string
  countries: string[]
  topics: RelatedTopic[]
}): Promise<RelatedTopic[]> {
  const result: RelatedTopic[] = []
  const keywords = args.momentName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['the', 'and', 'day'].includes(w))

  for (const country of args.countries.slice(0, 3)) {
    try {
      const items = await fetchGoogleTrends({ geo: country, hl: country.toLowerCase(), maxItems: 30 })
      for (const item of items) {
        const lower = item.title.toLowerCase()
        const matches = keywords.some((k) => lower.includes(k))
        if (matches) {
          result.push({
            topic: item.title,
            context: `Trending on Google in ${country}${item.traffic ? ` (${item.traffic})` : ''}`,
            source: 'google_trends',
            countries: [country],
            url: item.shareUrl ?? undefined,
          })
        }
      }
    } catch {
      /* best-effort */
    }
  }
  return [...args.topics, ...result]
}
