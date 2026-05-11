/**
 * TikTok oEmbed thumbnail fetcher.
 *
 * Public oEmbed endpoint, no auth required:
 *   https://www.tiktok.com/oembed?url=https://www.tiktok.com/@user/video/...
 *
 * Returns: { thumbnail_url, title, author_name, html, ... }
 *
 * We store the thumbnail + author so the dashboard can render a TikTok-style
 * preview card without re-fetching.
 */

const OEMBED_API = 'https://www.tiktok.com/oembed'
const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface TikTokOEmbed {
  thumbnailUrl: string
  authorName: string
  authorUrl: string
  title: string
}

export async function fetchTikTokOEmbed(videoUrl: string): Promise<TikTokOEmbed | null> {
  if (!videoUrl.includes('tiktok.com')) return null

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(`${OEMBED_API}?url=${encodeURIComponent(videoUrl)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': REAL_UA },
    })
    clearTimeout(timer)
    if (!res.ok) return null

    const data = (await res.json()) as {
      thumbnail_url?: string
      title?: string
      author_name?: string
      author_url?: string
    }

    if (!data.thumbnail_url) return null

    return {
      thumbnailUrl: data.thumbnail_url,
      authorName: data.author_name ?? '',
      authorUrl: data.author_url ?? '',
      title: data.title ?? '',
    }
  } catch {
    return null
  }
}
