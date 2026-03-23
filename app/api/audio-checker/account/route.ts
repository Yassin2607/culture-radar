import { NextResponse } from 'next/server'
import FirecrawlApp from '@mendable/firecrawl-js'
import { assessCopyrightRisk, type MetadataResult } from '@/lib/audio-checker'

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY ?? '' })

export const maxDuration = 120

function parseReelMetadata(url: string, markdown: string): MetadataResult {
  const creatorMatch = markdown.match(/(?:@|by\s+)([a-zA-Z0-9_.]+)/i)
  const creator = creatorMatch?.[1] ?? undefined

  const trackMatch = markdown.match(/(?:Audio|Music|Song|Track)[:\s]+["']?([^"'\n]+)["']?/i)
  const artistMatch = markdown.match(/(?:Artist|By|Singer)[:\s]+["']?([^"'\n]+)["']?/i)
  const isOriginal = /original\s*(audio|sound)/i.test(markdown)
  const captionMatch = markdown.match(/(?:caption|description)[:\s]+["']?([^"'\n]{1,200})/i)
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

async function scanAccount(username: string): Promise<{ username: string; count: number; results: MetadataResult[]; error?: string }> {
  try {
    // Scrape the Instagram profile page to find reel URLs
    const profileUrl = `https://www.instagram.com/${username}/reels/`
    const profileResult = await firecrawl.scrape(profileUrl, {
      formats: ['markdown'],
      waitFor: 5000,
      timeout: 20000,
    })

    const markdown = profileResult.markdown ?? ''
    if (!markdown) {
      return { username, count: 0, results: [], error: 'Kon het profiel niet laden. Controleer of het account openbaar is.' }
    }

    // Extract reel URLs from the profile page
    const reelPattern = /https:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/g
    const reelUrls: string[] = []
    const seen = new Set<string>()
    let match: RegExpExecArray | null

    while ((match = reelPattern.exec(markdown)) !== null) {
      const reelUrl = match[0].split(/[?#)/]/)[0] // Clean URL
      if (!seen.has(reelUrl)) {
        seen.add(reelUrl)
        reelUrls.push(reelUrl)
      }
    }

    if (reelUrls.length === 0) {
      return { username, count: 0, results: [], error: 'Geen reels gevonden. Controleer of het account openbaar is en reels heeft.' }
    }

    // Limit to 50 reels max, process in batches of 5
    const limitedUrls = reelUrls.slice(0, 50)
    const allMetadata: MetadataResult[] = []
    const BATCH_SIZE = 5

    for (let i = 0; i < limitedUrls.length; i += BATCH_SIZE) {
      const batch = limitedUrls.slice(i, i + BATCH_SIZE)
      const promises = batch.map(async (url) => {
        try {
          const result = await firecrawl.scrape(url, {
            formats: ['markdown'],
            waitFor: 3000,
            timeout: 15000,
          })
          const md = result.markdown ?? ''
          if (!md) return { url, error: 'Kon geen metadata ophalen.' } as MetadataResult
          return parseReelMetadata(url, md)
        } catch {
          return { url, error: 'Metadata ophalen mislukt.' } as MetadataResult
        }
      })

      const settled = await Promise.allSettled(promises)
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          allMetadata.push(r.value)
        }
      }
    }

    return { username, count: allMetadata.length, results: allMetadata }
  } catch (err) {
    console.error(`[AccountScanner] Firecrawl error for @${username}:`, err)
    return { username, count: 0, results: [], error: 'Account scan mislukt.' }
  }
}

export async function POST(req: Request) {
  try {
    const { username }: { username: string } = await req.json()

    if (!username?.trim()) {
      return NextResponse.json({ error: 'Geen gebruikersnaam opgegeven.' }, { status: 400 })
    }

    const clean = username.replace('@', '').trim()
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(clean)) {
      return NextResponse.json({ error: 'Ongeldige gebruikersnaam. Alleen letters, cijfers, punten en underscores.' }, { status: 400 })
    }

    if (!process.env.FIRECRAWL_API_KEY) {
      return NextResponse.json({ error: 'Firecrawl API key niet geconfigureerd.' }, { status: 500 })
    }

    const { username: scannedUser, count, results: metadata, error: scanError } = await scanAccount(clean)

    if (scanError && !metadata.length) {
      console.error(`[AccountScanner] Scan failed for @${scannedUser}:`, scanError)
      return NextResponse.json(
        { error: `Scan mislukt voor @${scannedUser}. ${scanError}` },
        { status: 502 }
      )
    }

    if (!metadata.length) {
      return NextResponse.json(
        { error: `Geen reels gevonden voor @${scannedUser}. Controleer of het account openbaar is.` },
        { status: 404 }
      )
    }

    const assessed = await assessCopyrightRisk(metadata)
    return NextResponse.json({ username: scannedUser, count, results: assessed })
  } catch (err) {
    console.error('[AccountScanner] Error:', err)
    return NextResponse.json(
      { error: 'Er is een fout opgetreden. Probeer het later opnieuw.' },
      { status: 500 }
    )
  }
}
