/**
 * Fetch a curated mix of TikTok videos parsed from /discover scrapes
 * for the newsletter. Returns a small grid (4-6 items) of country-tagged
 * trending TikToks.
 */

import { sql } from '@/lib/culture-db'

export interface DiscoverVideoForReport {
  creator: string
  videoId: string
  videoUrl: string
  countryFlag: string
  countryLabel: string
  sourceTopic: string
}

const COUNTRY_FLAGS: Record<string, { flag: string; label: string }> = {
  'nederlandse-trends':   { flag: '🇳🇱', label: 'Netherlands' },
  'belgische-trends':     { flag: '🇧🇪', label: 'Belgium' },
  'tendances-francaises': { flag: '🇫🇷', label: 'France' },
  'deutsche-trends':      { flag: '🇩🇪', label: 'Germany' },
  'tendencias-espanolas': { flag: '🇪🇸', label: 'Spain' },
  'tendenze-italiane':    { flag: '🇮🇹', label: 'Italy' },
  'tendencias-portuguesas': { flag: '🇵🇹', label: 'Portugal' },
  'trendy-w-polsce':      { flag: '🇵🇱', label: 'Poland' },
  'viral':                { flag: '🌐', label: 'Global Viral' },
  'trending':             { flag: '🌐', label: 'Global Trending' },
  'foryou':               { flag: '🌐', label: 'For You' },
  'dance-trends':         { flag: '💃', label: 'Dance' },
  'food-trends':          { flag: '🍴', label: 'Food' },
  'beauty-trends':        { flag: '💄', label: 'Beauty' },
  'fashion-trends':       { flag: '👗', label: 'Fashion' },
  'life-hacks':           { flag: '🧠', label: 'Life Hacks' },
  'comedy':               { flag: '😂', label: 'Comedy' },
  'music-trends':         { flag: '🎵', label: 'Music' },
}

const CATEGORY_FLAGS: Record<string, { flag: string; label: string }> = {
  food: { flag: '🍴', label: 'Food' },
  beauty: { flag: '💄', label: 'Beauty' },
  fashion: { flag: '👗', label: 'Fashion' },
  home: { flag: '🏠', label: 'Home' },
  lifestyle: { flag: '✨', label: 'Lifestyle' },
  tech: { flag: '💻', label: 'Tech' },
  meme: { flag: '😂', label: 'Meme' },
  culture: { flag: '🎭', label: 'Culture' },
  platform: { flag: '📱', label: 'Platform' },
  sound: { flag: '🎵', label: 'Sound' },
  sport: { flag: '⚽', label: 'Sport' },
}

/**
 * Pull TikTok video URLs from active trends' example_urls. These come
 * from sources that actually link to specific videos (Perplexity
 * citations, Spotted in the Wild manual reports, some newsletters,
 * trend hashtag scrapes). Filters to one video per creator + one per
 * trend for variety, prefers high-popularity recent trends.
 */
export async function fetchPulseVideos(maxVideos = 6): Promise<DiscoverVideoForReport[]> {
  const rows = (await sql().query(
    `SELECT id, name, category, country_relevance, example_urls,
            popularity_score, first_seen_at
       FROM culture_trends
      WHERE status = 'active'
        AND (verify_verdict IS NULL OR verify_verdict != 'fabricated')
        AND example_urls IS NOT NULL
        AND array_length(example_urls, 1) > 0
        AND first_seen_at >= NOW() - INTERVAL '14 days'
      ORDER BY popularity_score DESC, first_seen_at DESC
      LIMIT 200`,
  )) as Array<{
    id: string; name: string; category: string
    country_relevance: string[] | null
    example_urls: string[]
    popularity_score: number; first_seen_at: string
  }>

  const videoLinkRe = /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._-]+)\/video\/(\d+)/i
  const collected: DiscoverVideoForReport[] = []
  const seenVideoIds = new Set<string>()
  const seenCreators = new Set<string>()
  const seenTrendIds = new Set<string>()

  for (const r of rows) {
    if (seenTrendIds.has(r.id)) continue
    for (const u of r.example_urls) {
      const m = u.match(videoLinkRe)
      if (!m) continue
      const creator = m[1]
      const videoId = m[2]
      if (seenVideoIds.has(videoId) || seenCreators.has(creator)) continue
      const meta = CATEGORY_FLAGS[r.category] ?? { flag: '📱', label: r.category }
      collected.push({
        creator,
        videoId,
        videoUrl: `https://www.tiktok.com/@${creator}/video/${videoId}`,
        countryFlag: meta.flag,
        countryLabel: r.name.slice(0, 40),  // trend name as label
        sourceTopic: r.category,
      })
      seenVideoIds.add(videoId)
      seenCreators.add(creator)
      seenTrendIds.add(r.id)
      if (collected.length >= maxVideos) return collected
      break  // one video per trend
    }
  }

  return collected
}
