/**
 * Google Trends — daily trending searches per region.
 *
 * Google Trends has no official API. The endpoints used here are the same
 * ones the public trends.google.com website calls — undocumented but stable
 * for years.
 *
 *   - RSS feed:   https://trends.google.com/trending/rss?geo=NL
 *     Parses easily; gives title, traffic ("20,000+"), related news links.
 *
 *   - JSON daily: https://trends.google.com/trends/api/dailytrends?...
 *     Richer (related queries, image, share url) but prefixed with `)]}'`
 *     and shaped slightly differently per locale.
 *
 * We try JSON first, fall back to RSS. Output is normalized so the rest of
 * the pipeline doesn't care which path was used.
 */

export interface GoogleTrendItem {
  title: string
  traffic: string | null         // raw human string, e.g. "50K+", "20.000+"
  trafficValue: number | null    // best-effort numeric extract
  region: string                 // geo code, e.g. "NL"
  startedAt: string | null       // ISO8601 if available
  relatedQueries: string[]
  articles: Array<{ title: string; url: string; source: string | null }>
  shareUrl: string | null
  imageUrl: string | null
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Fetch daily trends for a region. Default NL.
 * Returns an empty list rather than throwing on network errors.
 */
export async function fetchGoogleTrends(opts: {
  geo?: string
  hl?: string
  maxItems?: number
} = {}): Promise<GoogleTrendItem[]> {
  const geo = opts.geo ?? 'NL'
  const hl = opts.hl ?? 'nl-NL'
  const maxItems = opts.maxItems ?? 30

  // Try JSON first (richer payload).
  try {
    const json = await fetchDailyTrendsJson(geo, hl)
    if (json.length > 0) return json.slice(0, maxItems)
  } catch (err) {
    console.warn('[google-trends] JSON path failed, falling back to RSS:', err)
  }

  // RSS fallback.
  try {
    const rss = await fetchDailyTrendsRss(geo)
    return rss.slice(0, maxItems)
  } catch (err) {
    console.error('[google-trends] RSS path failed:', err)
    return []
  }
}

// ───────────────────────────────────────────────────────────────────────────
// JSON path
// ───────────────────────────────────────────────────────────────────────────

interface RawDailyTrends {
  default?: {
    trendingSearchesDays?: Array<{
      date?: string
      trendingSearches?: Array<{
        title?: { query?: string }
        formattedTraffic?: string
        image?: { newsUrl?: string; imageUrl?: string }
        shareUrl?: string
        articles?: Array<{
          title?: string
          url?: string
          source?: string
          snippet?: string
        }>
        relatedQueries?: Array<{ query?: string }>
      }>
    }>
  }
}

async function fetchDailyTrendsJson(geo: string, hl: string): Promise<GoogleTrendItem[]> {
  // ns=20 stretches the daily window. Google trims to what's actually trending,
  // so this is a soft request — typically returns 15-25 items.
  const url = `https://trends.google.com/trends/api/dailytrends?hl=${encodeURIComponent(hl)}&tz=-60&geo=${encodeURIComponent(geo)}&ns=20`
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`google-trends JSON HTTP ${res.status}`)
  const text = await res.text()
  // Google prefixes the JSON with `)]}',\n` to prevent JSON hijacking.
  const cleaned = text.replace(/^\)\]\}',?\n?/, '').trim()
  const parsed = JSON.parse(cleaned) as RawDailyTrends

  const items: GoogleTrendItem[] = []
  const today = new Date().toISOString().slice(0, 10)

  for (const day of parsed.default?.trendingSearchesDays ?? []) {
    const dateStr = day.date ? `${day.date.slice(0, 4)}-${day.date.slice(4, 6)}-${day.date.slice(6, 8)}` : today
    for (const s of day.trendingSearches ?? []) {
      const title = s.title?.query?.trim()
      if (!title) continue
      items.push({
        title,
        traffic: s.formattedTraffic ?? null,
        trafficValue: parseTraffic(s.formattedTraffic),
        region: geo,
        startedAt: dateStr,
        relatedQueries: (s.relatedQueries ?? [])
          .map((r) => r.query?.trim())
          .filter((q): q is string => !!q),
        articles: (s.articles ?? [])
          .map((a) => ({
            title: a.title?.trim() ?? '',
            url: a.url ?? '',
            source: a.source ?? null,
          }))
          .filter((a) => !!a.url && !!a.title),
        shareUrl: s.shareUrl ?? null,
        imageUrl: s.image?.imageUrl ?? null,
      })
    }
  }

  return items
}

// ───────────────────────────────────────────────────────────────────────────
// RSS path
// ───────────────────────────────────────────────────────────────────────────

async function fetchDailyTrendsRss(geo: string): Promise<GoogleTrendItem[]> {
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml' },
  })
  if (!res.ok) throw new Error(`google-trends RSS HTTP ${res.status}`)
  const xml = await res.text()
  return parseRssXml(xml, geo)
}

function parseRssXml(xml: string, geo: string): GoogleTrendItem[] {
  const items: GoogleTrendItem[] = []
  // Extract <item>…</item> blocks. Stable parser without an XML lib.
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
  for (const block of blocks) {
    const title = decode(matchTag(block, 'title'))
    if (!title) continue
    const traffic = decode(matchTag(block, 'ht:approx_traffic'))
    const pubDate = matchTag(block, 'pubDate')
    const newsItems = block.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/g) ?? []
    items.push({
      title,
      traffic: traffic || null,
      trafficValue: parseTraffic(traffic),
      region: geo,
      startedAt: pubDate ? new Date(pubDate).toISOString() : null,
      relatedQueries: [],
      articles: newsItems
        .map((n) => ({
          title: decode(matchTag(n, 'ht:news_item_title')) ?? '',
          url: decode(matchTag(n, 'ht:news_item_url')) ?? '',
          source: decode(matchTag(n, 'ht:news_item_source')) ?? null,
        }))
        .filter((a) => !!a.url && !!a.title),
      shareUrl: null,
      imageUrl: decode(matchTag(block, 'ht:picture')) ?? null,
    })
  }
  return items
}

function matchTag(block: string, tag: string): string {
  // Allow CDATA wrappers.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i')
  return re.exec(block)?.[1]?.trim() ?? ''
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

// ───────────────────────────────────────────────────────────────────────────
// Traffic parsing: "50K+", "1M+", "20.000+", "200,000+"
// ───────────────────────────────────────────────────────────────────────────

function parseTraffic(input: string | null | undefined): number | null {
  if (!input) return null
  const cleaned = input.trim().toLowerCase().replace(/[.,\s]/g, '')
  const m = /^(\d+)([km])?\+?$/.exec(cleaned)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  if (m[2] === 'k') return n * 1_000
  if (m[2] === 'm') return n * 1_000_000
  return n
}
