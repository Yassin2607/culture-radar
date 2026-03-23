import { NextResponse } from 'next/server'
import FirecrawlApp from '@mendable/firecrawl-js'
import { assessCopyrightRisk, type MetadataResult } from '@/lib/audio-checker'

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY ?? '' })

export const maxDuration = 60

function parseReelMetadata(url: string, markdown: string): MetadataResult {
  // Extract creator from URL pattern /reel/CODE/ or /@username/
  const creatorMatch = markdown.match(/(?:@|by\s+)([a-zA-Z0-9_.]+)/i)
  const creator = creatorMatch?.[1] ?? undefined

  // Look for audio/music info in the scraped content
  const trackMatch = markdown.match(/(?:Audio|Music|Song|Track)[:\s]+["']?([^"'\n]+)["']?/i)
  const artistMatch = markdown.match(/(?:Artist|By|Singer)[:\s]+["']?([^"'\n]+)["']?/i)

  // Check for "Original Audio" or "original sound" indicators
  const isOriginal = /original\s*(audio|sound)/i.test(markdown)

  // Try to extract caption
  const captionMatch = markdown.match(/(?:caption|description)[:\s]+["']?([^"'\n]{1,200})/i)

  // Extract reel ID from URL
  const reelIdMatch = url.match(/\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/)

  return {
    url,
    reelId: reelIdMatch?.[1],
    creator,
    caption: captionMatch?.[1]?.trim(),
    track: trackMatch?.[1]?.trim() ?? null,
    artist: artistMatch?.[1]?.trim() ?? null,
    album: null,
    audioTitle: trackMatch?.[1]?.trim() ?? (isOriginal ? 'Original sound' : undefined),
    isOriginalSound: isOriginal || (!trackMatch && !artistMatch),
  }
}

async function extractMetadata(urls: string[]): Promise<{ results: MetadataResult[] }> {
  const results: MetadataResult[] = []

  // Process URLs concurrently (max 5 at a time per validation)
  const promises = urls.map(async (url) => {
    try {
      const result = await firecrawl.scrape(url, {
        formats: ['markdown'],
        waitFor: 3000,
        timeout: 15000,
      })

      const markdown = result.markdown ?? ''
      if (!markdown) {
        return { url, error: 'Kon geen metadata ophalen van deze URL.' } as MetadataResult
      }

      return parseReelMetadata(url, markdown)
    } catch (err) {
      console.error(`[AudioChecker] Firecrawl error for ${url}:`, err)
      return { url, error: 'Metadata ophalen mislukt.' } as MetadataResult
    }
  })

  const settled = await Promise.allSettled(promises)
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      results.push(r.value)
    } else {
      results.push({ url: 'unknown', error: 'Onverwachte fout bij ophalen metadata.' })
    }
  }

  return { results }
}

export async function POST(req: Request) {
  try {
    const { urls }: { urls: string[] } = await req.json()

    if (!urls?.length) {
      return NextResponse.json({ error: 'Geen URLs opgegeven.' }, { status: 400 })
    }
    if (urls.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 URLs per keer.' }, { status: 400 })
    }
    const igPattern = /^https:\/\/(www\.)?instagram\.com\//
    for (const url of urls) {
      if (url.length > 500 || !igPattern.test(url)) {
        return NextResponse.json({ error: 'Alleen geldige Instagram URLs zijn toegestaan.' }, { status: 400 })
      }
    }

    if (!process.env.FIRECRAWL_API_KEY) {
      return NextResponse.json({ error: 'Firecrawl API key niet geconfigureerd.' }, { status: 500 })
    }

    const { results: metadata } = await extractMetadata(urls)
    const assessed = await assessCopyrightRisk(metadata)
    return NextResponse.json({ results: assessed })
  } catch (err) {
    console.error('[AudioChecker] Error:', err)
    return NextResponse.json(
      { error: 'Er is een fout opgetreden. Probeer het later opnieuw.' },
      { status: 500 }
    )
  }
}
