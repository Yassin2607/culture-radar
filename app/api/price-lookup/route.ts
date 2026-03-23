import { NextRequest, NextResponse } from 'next/server'
import FirecrawlApp from '@mendable/firecrawl-js'

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY ?? '' })

export const maxDuration = 30

// Country code mapping: scanner uses 'nl', price lookup needs 'nl-nl' format for Action URLs
const COUNTRY_URL_MAP: Record<string, string> = {
  'nl-nl': 'nl-nl', 'be-nl': 'nl-be', 'be-fr': 'fr-be', 'de-de': 'de-de',
  'fr-fr': 'fr-fr', 'at-de': 'de-at', 'lu-fr': 'fr-lu', 'pl-pl': 'pl-pl',
  'cz-cs': 'cs-cz', 'it-it': 'it-it', 'es-es': 'es-es',
  // Also accept 2-letter codes from scanner
  'nl': 'nl-nl', 'be': 'nl-be', 'de': 'de-de', 'fr': 'fr-fr',
  'at': 'de-at', 'pl': 'pl-pl', 'cz': 'cs-cz', 'it': 'it-it',
  'es': 'es-es', 'lu': 'fr-lu',
}

const ALLOWED_COUNTRIES = Object.keys(COUNTRY_URL_MAP)

interface PriceResult {
  country: string
  price: string | null
  match: boolean | null
}

// POST /api/price-lookup — scrapes Action.com product page for price
export async function POST(req: NextRequest) {
  const body = await req.json()

  if (body.product_name && typeof body.product_name === 'string') {
    if (body.product_name.length > 100) {
      return NextResponse.json({ success: false, results: [], error: 'Productnaam te lang (max 100 tekens).' }, { status: 400 })
    }
    if (!/^[\w\s\-.,&()'"/]+$/u.test(body.product_name)) {
      return NextResponse.json({ success: false, results: [], error: 'Ongeldige tekens in productnaam.' }, { status: 400 })
    }
  }
  if (body.country_code && !ALLOWED_COUNTRIES.includes(body.country_code)) {
    return NextResponse.json({ success: false, results: [], error: 'Ongeldig land.' }, { status: 400 })
  }

  if (!process.env.FIRECRAWL_API_KEY) {
    return NextResponse.json({ success: false, results: [], error: 'Firecrawl API key niet geconfigureerd.' }, { status: 500 })
  }

  const productName = body.product_name?.trim()
  const countryCode = body.country_code ?? 'nl-nl'
  const imagePrice = body.image_price ?? null

  if (!productName) {
    return NextResponse.json({ success: false, results: [], error: 'Productnaam is vereist.' }, { status: 400 })
  }

  try {
    const urlCountry = COUNTRY_URL_MAP[countryCode] ?? 'nl-nl'
    const searchUrl = `https://www.action.com/${urlCountry}/search?q=${encodeURIComponent(productName)}`

    const result = await firecrawl.scrape(searchUrl, {
      formats: ['markdown'],
      waitFor: 3000,
      timeout: 15000,
    })

    const markdown = result.markdown ?? ''
    if (!markdown) {
      return NextResponse.json({ success: true, results: [], message: 'Geen resultaten gevonden.' })
    }

    // Extract prices from markdown using common patterns
    const priceResults: PriceResult[] = []
    // Look for price patterns like €1.99, €1,99, 1.99, 1,99
    const pricePattern = /€?\s*(\d+[.,]\d{2})/g
    const matches = markdown.match(pricePattern)

    if (matches && matches.length > 0) {
      // Take first few unique prices
      const seen = new Set<string>()
      for (const m of matches) {
        const cleaned = m.replace('€', '').replace(/\s/g, '').replace(',', '.')
        if (!seen.has(cleaned) && seen.size < 5) {
          seen.add(cleaned)
          const matchesImage = imagePrice ? Math.abs(parseFloat(cleaned) - parseFloat(imagePrice)) < 0.01 : null
          priceResults.push({
            country: countryCode,
            price: cleaned,
            match: matchesImage,
          })
        }
      }
    }

    return NextResponse.json({ success: true, results: priceResults })
  } catch (err) {
    console.error('[PriceLookup] Error:', err)
    return NextResponse.json({ success: false, results: [], error: 'Prijs ophalen mislukt.' })
  }
}
