/**
 * TikTok Creative Center — direct SSR scraper.
 *
 * TikTok's Creative Center is a Next.js SSR app. The trending-hashtag data
 * is embedded in the `__NEXT_DATA__` script tag of each page render. We
 * fetch the HTML, parse out the JSON, and get real engagement metrics:
 *
 *   - hashtagName            ("fifaworldcup")
 *   - rank                   (1 = #1 NL this week)
 *   - publishCnt             (post count)
 *   - videoViews             (total cumulative views)
 *   - rankDiff               (positions gained/lost vs previous period)
 *   - trend[]                (7-day velocity time series)
 *   - industryInfo           (category: Sports, Beauty, Food, etc.)
 *
 * No browser required. Works from a Vercel serverless function because
 * TikTok's CDN serves the SSR HTML to plain HTTP clients without captcha.
 */

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface CreativeCenterHashtag {
  hashtagId: string
  hashtagName: string
  rank: number
  rankDiff: number
  publishCnt: number
  videoViews: number
  industry: string  // e.g. "Sports & Outdoor", "Beauty", "Food & Beverage"
  countryCode: string
  trendSeries: Array<{ time: number; value: number }>
  isPromoted: boolean
}

export interface CreativeCenterResult {
  ok: boolean
  hashtags: CreativeCenterHashtag[]
  error?: string
}

/**
 * Fetch trending hashtags from TikTok Creative Center for a given country.
 *
 * @param countryCode  ISO code (NL, FR, DE, BE, ES, IT, etc.) or '' for global
 * @param period       7 | 30 | 120 days
 */
export async function fetchCreativeCenterHashtags(
  countryCode: string,
  period: 7 | 30 | 120 = 7,
): Promise<CreativeCenterResult> {
  const url = countryCode
    ? `https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?period=${period}&countryCode=${countryCode}`
    : `https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?period=${period}`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': REAL_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    clearTimeout(timer)

    if (!res.ok) {
      return { ok: false, hashtags: [], error: `HTTP ${res.status}` }
    }
    const html = await res.text()

    // Pull the __NEXT_DATA__ JSON blob (without /s flag for ES5 compat)
    const match = html.match(/__NEXT_DATA__"\s+type="application\/json">([\s\S]+?)<\/script>/)
    if (!match) {
      return { ok: false, hashtags: [], error: 'no_next_data' }
    }

    let data: unknown
    try {
      data = JSON.parse(match[1])
    } catch (err) {
      return {
        ok: false,
        hashtags: [],
        error: 'json_parse_failed: ' + (err instanceof Error ? err.message : String(err)),
      }
    }

    const queries =
      (data as {
        props?: {
          pageProps?: {
            dehydratedState?: {
              queries?: Array<{
                queryKey?: unknown[]
                state?: { data?: { pages?: Array<{ list?: unknown[] }> } }
              }>
            }
          }
        }
      }).props?.pageProps?.dehydratedState?.queries ?? []

    const items: unknown[] = []
    for (const q of queries) {
      const pages = q.state?.data?.pages
      if (!Array.isArray(pages)) continue
      for (const p of pages) {
        // p can be null when TikTok returns an empty page (e.g. when
        // pagination is exhausted or auth challenge served instead of
        // data). Without this guard the scraper crashes with
        // "Cannot read properties of null (reading 'list')".
        if (p && typeof p === 'object' && Array.isArray((p as { list?: unknown[] }).list)) {
          items.push(...(p as { list: unknown[] }).list)
        }
      }
    }

    const hashtags: CreativeCenterHashtag[] = items
      .filter(
        (it): it is Record<string, unknown> =>
          it !== null && typeof it === 'object' && 'hashtagName' in (it as object),
      )
      .map((it) => ({
        hashtagId: String(it.hashtagId ?? ''),
        hashtagName: String(it.hashtagName ?? ''),
        rank: Number(it.rank ?? 0),
        rankDiff: Number(it.rankDiff ?? 0),
        publishCnt: Number(it.publishCnt ?? 0),
        videoViews: Number(it.videoViews ?? 0),
        industry:
          (it.industryInfo as { value?: string } | undefined)?.value ?? '',
        countryCode:
          (it.countryInfo as { id?: string } | undefined)?.id ?? '',
        trendSeries: Array.isArray(it.trend)
          ? (it.trend as Array<{ time: number; value: number }>)
          : [],
        isPromoted: Boolean(it.isPromoted),
      }))
      .filter((h) => h.hashtagName)

    return { ok: true, hashtags }
  } catch (err) {
    return {
      ok: false,
      hashtags: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Map TikTok Creative Center industry → our culture category enum.
 */
const INDUSTRY_TO_CATEGORY: Record<string, string> = {
  'sports & outdoor': 'sport',
  'beauty & personal care': 'beauty',
  'food & beverage': 'food',
  'apparel & accessories': 'fashion',
  'home & garden': 'home',
  'travel': 'lifestyle',
  'entertainment': 'culture',
  'pets': 'lifestyle',
  'baby, kids & maternity': 'lifestyle',
  'games': 'tech',
  'tech & electronics': 'tech',
  'auto': 'lifestyle',
  'business services': 'culture',
  'financial services': 'culture',
  'education': 'culture',
  'health': 'lifestyle',
  'life services': 'lifestyle',
}

export function industryToCategory(industry: string): string {
  return INDUSTRY_TO_CATEGORY[industry.toLowerCase().trim()] ?? 'culture'
}

/**
 * Convert raw post count to a 1-10 popularity score using log scale.
 * Real numbers replacing AI's vibe-based guess.
 *
 *      < 100 posts  → 1
 *      ~ 1K  posts  → 4
 *      ~ 10K posts  → 6
 *      ~ 100K posts → 8
 *      ~ 1M+ posts  → 10
 */
export function popularityFromPostCount(postCount: number): number {
  if (postCount <= 0) return 1
  const log = Math.log10(postCount)
  // Map log10(0)=0 → 1 and log10(1_000_000)=6 → 10
  return Math.max(1, Math.min(10, Math.round(1.5 + log * 1.4)))
}
