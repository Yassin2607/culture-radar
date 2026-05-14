/**
 * Article publication date extraction.
 *
 * Fetches an article URL and parses its publication date from common
 * meta-tag signals. Used by the magazine renderer to filter out trends
 * whose underlying source articles are old (even when first_seen_at is
 * recent because we re-detected them today).
 *
 * Signal priority (most reliable first):
 *   1. JSON-LD <script type="application/ld+json"> with datePublished
 *   2. <meta property="article:published_time">
 *   3. <meta property="og:article:published_time">
 *   4. <meta name="pubdate" | "publishdate" | "DC.date" | "date">
 *   5. <time datetime="..." pubdate> or first <time datetime="...">
 *   6. URL path /YYYY/MM/ or /YYYY-MM-DD/ patterns
 *
 * Returns null if no signal found. Caches results in
 * culture_article_dates so we don't re-fetch the same URL.
 */

import { sql } from '@/lib/culture-db'

export interface ArticleDateResult {
  url: string
  publishedAt: Date | null
  source: 'jsonld' | 'meta-article' | 'meta-og' | 'meta-other' | 'time-tag' | 'url-path' | 'none'
  httpStatus: number | null
  error: string | null
}

const FETCH_TIMEOUT_MS = 8000
const USER_AGENT =
  'Mozilla/5.0 (compatible; CultureRadarBot/1.0; +https://action-culture-radar.vercel.app)'

/**
 * Fetch an article URL and extract its publication date. Cached in
 * culture_article_dates (24h TTL — we re-check periodically because
 * sites sometimes backdate or correct article metadata).
 */
export async function getArticlePublishedAt(
  url: string,
  options: { force?: boolean; cacheTtlHours?: number } = {},
): Promise<ArticleDateResult> {
  const ttl = options.cacheTtlHours ?? 24 * 7  // 7 days — articles rarely change pubdate

  if (!options.force) {
    const cached = (await sql().query(
      `SELECT url, published_at, source, http_status, error
         FROM culture_article_dates
        WHERE url = $1 AND fetched_at >= NOW() - ($2 || ' hours')::INTERVAL
        LIMIT 1`,
      [url, String(ttl)],
    )) as Array<{
      url: string
      published_at: string | null
      source: string | null
      http_status: number | null
      error: string | null
    }>
    if (cached.length > 0) {
      const c = cached[0]
      return {
        url: c.url,
        publishedAt: c.published_at ? new Date(c.published_at) : null,
        source: (c.source ?? 'none') as ArticleDateResult['source'],
        httpStatus: c.http_status,
        error: c.error,
      }
    }
  }

  const result = await fetchAndExtract(url)

  await sql().query(
    `INSERT INTO culture_article_dates (url, published_at, source, http_status, error, fetched_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (url) DO UPDATE
        SET published_at = EXCLUDED.published_at,
            source = EXCLUDED.source,
            http_status = EXCLUDED.http_status,
            error = EXCLUDED.error,
            fetched_at = NOW()`,
    [
      url,
      result.publishedAt ? result.publishedAt.toISOString() : null,
      result.source,
      result.httpStatus,
      result.error,
    ],
  )

  return result
}

async function fetchAndExtract(url: string): Promise<ArticleDateResult> {
  // Skip internal pseudo-URLs (Perplexity syntheses, etc.)
  if (url.startsWith('internal://') || !url.startsWith('http')) {
    return { url, publishedAt: null, source: 'none', httpStatus: null, error: 'non-http url' }
  }

  // Skip URLs we can't usefully date (homepages, search results,
  // social media platforms — the URL itself isn't an article)
  if (isUndatableUrl(url)) {
    // Fall back to URL-path date if any
    const urlDate = extractDateFromUrlPath(url)
    return {
      url,
      publishedAt: urlDate,
      source: urlDate ? 'url-path' : 'none',
      httpStatus: null,
      error: urlDate ? null : 'undatable url type',
    }
  }

  try {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
      },
      redirect: 'follow',
    })
    clearTimeout(tid)

    if (!res.ok) {
      // Still try URL-path extraction even on 4xx/5xx
      const urlDate = extractDateFromUrlPath(url)
      return {
        url,
        publishedAt: urlDate,
        source: urlDate ? 'url-path' : 'none',
        httpStatus: res.status,
        error: `http ${res.status}`,
      }
    }

    const html = await res.text()
    const truncated = html.slice(0, 200_000) // first 200KB enough for <head>

    const extracted = extractDateFromHtml(truncated) ?? {
      date: extractDateFromUrlPath(url),
      source: 'url-path' as const,
    }

    return {
      url,
      publishedAt: extracted.date,
      source: extracted.date ? extracted.source : 'none',
      httpStatus: res.status,
      error: null,
    }
  } catch (err) {
    const urlDate = extractDateFromUrlPath(url)
    return {
      url,
      publishedAt: urlDate,
      source: urlDate ? 'url-path' : 'none',
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * URLs that don't correspond to a single article: homepages, listing
 * pages, social profiles, RSS/search endpoints. Don't waste a fetch.
 */
function isUndatableUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const path = u.pathname.replace(/\/$/, '')
    if (host.includes('tiktok.com')) return true
    if (host.includes('instagram.com')) return true
    if (host.includes('youtube.com') && path.startsWith('/feed')) return true
    if (host.includes('trends.google.com')) return true
    if (host.includes('reddit.com') && (path === '' || path.startsWith('/r/'))) return false // article-ish
    if (path === '' || path === '/') return true
    if (path.startsWith('/search') || path.startsWith('/tag/') || path.startsWith('/topic/')) return true
    return false
  } catch {
    return true
  }
}

/**
 * Extract date from URL path patterns like /2024/09/15/ or /2024-09-15/.
 */
function extractDateFromUrlPath(url: string): Date | null {
  // /YYYY/MM/DD/ or /YYYY/MM/
  const ymd = url.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//)
  if (ymd) {
    const d = new Date(`${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}T00:00:00Z`)
    if (!isNaN(d.getTime())) return d
  }
  const ym = url.match(/\/(20\d{2})\/(\d{1,2})\//)
  if (ym) {
    const d = new Date(`${ym[1]}-${ym[2].padStart(2, '0')}-01T00:00:00Z`)
    if (!isNaN(d.getTime())) return d
  }
  // /YYYY-MM-DD/ slug-style
  const dashYmd = url.match(/\/(20\d{2})-(\d{2})-(\d{2})/)
  if (dashYmd) {
    const d = new Date(`${dashYmd[1]}-${dashYmd[2]}-${dashYmd[3]}T00:00:00Z`)
    if (!isNaN(d.getTime())) return d
  }
  return null
}

/**
 * Extract date from HTML <head> meta tags + JSON-LD blocks.
 */
function extractDateFromHtml(
  html: string,
): { date: Date | null; source: ArticleDateResult['source'] } | null {
  // 1. JSON-LD datePublished — most reliable when present
  const jsonLdBlocks = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  )
  for (const block of jsonLdBlocks) {
    const datePublished = findDatePublishedInJsonLd(block[1])
    if (datePublished) return { date: datePublished, source: 'jsonld' }
  }

  // 2. <meta property="article:published_time" content="...">
  const m1 = html.match(
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
  )
  if (m1) {
    const d = new Date(m1[1])
    if (!isNaN(d.getTime())) return { date: d, source: 'meta-article' }
  }

  // 3. <meta property="og:article:published_time">
  const m2 = html.match(
    /<meta[^>]+property=["']og:article:published_time["'][^>]+content=["']([^"']+)["']/i,
  )
  if (m2) {
    const d = new Date(m2[1])
    if (!isNaN(d.getTime())) return { date: d, source: 'meta-og' }
  }

  // 4. Other common meta names
  const otherNames = ['pubdate', 'publishdate', 'publish_date', 'DC.date', 'DC.date.issued', 'date', 'sailthru.date']
  for (const name of otherNames) {
    const re = new RegExp(`<meta[^>]+name=["']${name.replace('.', '\\.')}["'][^>]+content=["']([^"']+)["']`, 'i')
    const m = html.match(re)
    if (m) {
      const d = new Date(m[1])
      if (!isNaN(d.getTime())) return { date: d, source: 'meta-other' }
    }
  }

  // 5. <time datetime="..." pubdate> or first <time datetime="...">
  const pubTime = html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*pubdate/i)
  if (pubTime) {
    const d = new Date(pubTime[1])
    if (!isNaN(d.getTime())) return { date: d, source: 'time-tag' }
  }
  const anyTime = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)
  if (anyTime) {
    const d = new Date(anyTime[1])
    if (!isNaN(d.getTime())) return { date: d, source: 'time-tag' }
  }

  return null
}

/**
 * Recursively scan a JSON-LD payload for the first datePublished value.
 */
function findDatePublishedInJsonLd(raw: string): Date | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    // Some sites have malformed JSON-LD with trailing commas etc.
    return null
  }
  const stack: unknown[] = [data]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item)
      continue
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>
      const dp = obj.datePublished ?? obj.dateCreated
      if (typeof dp === 'string') {
        const d = new Date(dp)
        if (!isNaN(d.getTime())) return d
      }
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') stack.push(v)
      }
    }
  }
  return null
}
