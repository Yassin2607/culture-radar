/**
 * GET /api/culture/discover-test
 * Live test of TikTok /discover scrape: try Firecrawl on one URL,
 * report what we got. No DB writes.
 */
import { NextResponse } from 'next/server'
import FirecrawlApp from '@mendable/firecrawl-js'
import { parseDiscoverHtml } from '@/lib/tiktok-discover'

export async function GET() {
  const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY ?? '' })
  const url = 'https://www.tiktok.com/discover/nederlandse-trends'

  try {
    const result = await firecrawl.scrape(url, {
      formats: ['html'],
      waitFor: 5000,
      timeout: 60_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
      },
    })
    const r = result as { html?: string; markdown?: string; metadata?: unknown }
    const html = r.html ?? ''
    const parsed = parseDiscoverHtml(html, 'nederlandse-trends')
    return NextResponse.json({
      ok: true,
      htmlLength: html.length,
      htmlPreview: html.slice(0, 800),
      metadata: r.metadata,
      videosFound: parsed.videos.length,
      topCreators: parsed.topCreators.slice(0, 8),
      lastUpdated: parsed.lastUpdated,
      pageTitle: parsed.pageTitle,
    })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
