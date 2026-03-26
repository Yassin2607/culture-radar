import { NextResponse } from 'next/server'
import FirecrawlApp from '@mendable/firecrawl-js'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ProductPrediction } from '@/types/trends'

export const maxDuration = 300

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY ?? '' })

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SCORING_BATCH_SIZE = 15
const SCORING_CONCURRENCY = 2

interface RawProduct {
  productName: string | null
  imageUrl: string | null
  productUrl: string | null
  price: number | null
  category: string
  searchTerm: string
  pageUrl: string
}

interface ScoredItem {
  index: number
  priceQuality: number
  innovation: number
  practicalUtility: number
  giftPotential: number
  seasonalRelevance: number
  viralPotential: number
  trendScore: number
  reasoning: string
  topSignals: string[]
  targetAudience: string[]
  season: string[]
  contentAngles: string[]
  platformBuzz: string
  hook: string | null
  contentConcept: string | null
  videoFormat: string | null
  requiresPerson: boolean
  callToAction: string | null
  musicSuggestion: string | null
  engagementEstimate: number | null
  conceptIdeas: Array<{ title: string; description: string; platform: string }> | null
}

interface PersistentCache {
  cachedAt: string
  predictions: ProductPrediction[]
  supabaseRowCount: number
}

// ─── New Arrivals Pages ───────────────────────────────────────────────────────

const NIEUW_PAGES = [
  'https://www.action.com/nl-nl/nieuw/',
  'https://www.action.com/nl-nl/nieuw/?page=2',
  'https://www.action.com/nl-nl/nieuw/?page=3',
]

// ─── Supabase Cache ──────────────────────────────────────────────────────────

async function loadCache(): Promise<PersistentCache | null> {
  const { data, error } = await supabaseAdmin
    .from('predictions_cache')
    .select('*')
    .eq('id', 'main')
    .single()
  if (error || !data) {
    if (error) console.warn('[TrendPredict] Cache load failed:', error.message)
    return null
  }
  return {
    cachedAt: data.cached_at,
    predictions: data.predictions as ProductPrediction[],
    supabaseRowCount: data.supabase_row_count,
  }
}

async function saveCache(entry: PersistentCache): Promise<void> {
  await supabaseAdmin.from('predictions_cache').upsert({
    id: 'main',
    cached_at: entry.cachedAt,
    predictions: entry.predictions,
    supabase_row_count: entry.supabaseRowCount,
  })
}

async function getSupabaseRowCount(): Promise<number> {
  const { count } = await supabase
    .from('Tiktok Data Action')
    .select('*', { count: 'exact', head: true })
  return count ?? 0
}

// ─── Season Hint ─────────────────────────────────────────────────────────────

function getSeasonHint(): string {
  const month = new Date().getMonth() + 1
  if (month === 12 || month <= 2) {
    return month === 2
      ? "February: Valentine's winding down, spring-prep content begins. Spring cleaning, organisation, and fresh home decor are the next big wave."
      : 'Winter: festive season winding down, new year organisation and home refresh are trending.'
  }
  if (month <= 5) return 'Spring: spring cleaning, Easter, garden, and outdoor living are trending. Fresh colours, plants, and storage products peak now.'
  if (month <= 8) return 'Summer: outdoor living, garden, beach accessories, and summer home decor are trending.'
  return 'Autumn/Winter: Halloween, Sinterklaas, Christmas, and gezellig home decor are trending. Candles, textiles, and seasonal decoration peak now.'
}

function getCurrentISOWeek(): string {
  const now = new Date()
  const jan4 = new Date(now.getFullYear(), 0, 4)
  const startOfWeek1 = new Date(jan4)
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  const diffMs = now.getTime() - startOfWeek1.getTime()
  const weekNum = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

async function fetchPinterestTrends(): Promise<string> {
  const currentWeek = getCurrentISOWeek()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[] | null

  // Try current week first (use supabaseAdmin to bypass RLS)
  const current = await supabaseAdmin
    .from('pinterest_trends')
    .select('keyword, category, growth_raw')
    .eq('region', 'NL')
    .eq('week', currentWeek)
    .order('growth_pct', { ascending: false, nullsFirst: false })
    .limit(50)
  data = current.data

  // Fall back to most recent week if no data for current week
  if (!data || data.length === 0) {
    const fallback = await supabaseAdmin
      .from('pinterest_trends')
      .select('keyword, category, growth_raw, week')
      .eq('region', 'NL')
      .order('created_at', { ascending: false })
      .limit(50)
    data = fallback.data
    if (data && data.length > 0) {
      const week = data[0].week
      console.log(`[Pinterest] No data for ${currentWeek}, falling back to ${week}`)
    }
  }

  if (!data || data.length === 0) {
    console.log('[Pinterest] No Pinterest trend data available')
    return ''
  }

  // Group by category
  const grouped: Record<string, string[]> = {}
  for (const row of data) {
    const cat = (row.category ?? 'other').toUpperCase().replace(/-/g, ' ')
    if (!grouped[cat]) grouped[cat] = []
    const entry = row.growth_raw ? `${row.keyword} (${row.growth_raw})` : row.keyword
    grouped[cat].push(entry)
  }

  const lines = Object.entries(grouped)
    .map(([cat, keywords]) => `${cat}: ${keywords.join(', ')}`)
    .join('\n')

  return lines
}

// ─── Live RSS Trend Fetching ──────────────────────────────────────────────────

const RSS_SOURCES = [
  { name: 'Google Trends NL',      url: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=NL' },
  { name: 'Reddit /r/Netherlands',  url: 'https://www.reddit.com/r/thenetherlands/.rss' },
  { name: 'Reddit OutOfTheLoop',    url: 'https://www.reddit.com/r/OutOfTheLoop/.rss' },
  { name: 'Exploding Topics',       url: 'https://explodingtopics.com/blog/rss.xml' },
  { name: 'Social Media Today',     url: 'https://www.socialmediatoday.com/rss.xml' },
  { name: 'Reddit TikTokCringe',    url: 'https://www.reddit.com/r/TikTokCringe/.rss' },
  { name: 'MrToucan TikTok Trends', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1SZ-1Ydb7Ri6zEOF0CcwrA' },
  { name: 'Frankwatching NL',       url: 'https://www.frankwatching.com/feed/' },
  { name: 'Later Blog',             url: 'https://later.com/blog/feed/' },
]

function parseRssTitles(xml: string): string[] {
  const titles: string[] = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let itemMatch: RegExpExecArray | null
  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const item = itemMatch[1]
    const titleMatch = item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)
    if (titleMatch) {
      const title = titleMatch[1].trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
      if (title && title.length > 3) titles.push(title)
    }
  }
  return titles
}

async function fetchLiveTrends(): Promise<string> {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(async (source) => {
      const res = await fetch(source.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrendBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const xml = await res.text()
      const titles = parseRssTitles(xml).slice(0, 12)
      if (titles.length === 0) throw new Error('no titles parsed')
      return `[${source.name}]\n${titles.map((t) => `- ${t}`).join('\n')}`
    })
  )
  const successful = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<string>[]
  const summary = successful.map((r) => r.value).join('\n\n')
  console.log(`[Live RSS] Fetched trend signals from ${successful.length}/${RSS_SOURCES.length} sources`)
  return summary
}

// ─── Firecrawl New Arrivals Scraper ──────────────────────────────────────────
// Uses Firecrawl cloud API to scrape Action.com (JS-rendered SPA).

interface FirecrawlProduct {
  name?: string
  price?: string
  image?: string
  url?: string
}

function parsePrice(priceStr: string | undefined): number | null {
  if (!priceStr) return null
  const cleaned = priceStr.replace(/[^\d.,]/g, '')
  if (!cleaned) return null
  let normalized: string
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    // Dutch decimal: "1,49" → "1.49"
    normalized = cleaned.replace(',', '.')
  } else if (cleaned.includes(',') && cleaned.includes('.')) {
    // Both separators — determine which is decimal by last occurrence
    const dotIdx = cleaned.lastIndexOf('.')
    const commaIdx = cleaned.lastIndexOf(',')
    if (dotIdx > commaIdx) {
      // "1,499.99" → remove commas
      normalized = cleaned.replace(/,/g, '')
    } else {
      // "1.499,99" → remove dots, replace comma with dot
      normalized = cleaned.replace(/\./g, '').replace(',', '.')
    }
  } else {
    // Only dots or only digits: "1.49" or "149" — use as-is
    normalized = cleaned
  }
  const val = parseFloat(normalized)
  return isNaN(val) ? null : val
}

async function scrapePageWithFirecrawl(pageUrl: string): Promise<RawProduct[]> {
  const MAX_RETRIES = 3
  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const waitMs = 1000 * Math.pow(2, attempt - 1) // 1s, 2s, 4s
        console.log(`[Firecrawl] ${pageUrl}: retrying after ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }

      const result = await firecrawl.scrape(pageUrl, {
        formats: ['markdown'],
        waitFor: 3000,
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'nl-NL,nl;q=0.9',
        },
      })

      const markdown = result.markdown ?? ''
      if (!markdown) {
        console.warn(`[Firecrawl] ${pageUrl}: attempt ${attempt + 1}: no markdown content returned`)
        lastError = new Error('No markdown returned from Firecrawl')
        if (attempt < MAX_RETRIES - 1) continue
        throw lastError
      }

      console.log(`[Firecrawl] ${pageUrl}: received ${markdown.length} chars of markdown`)

      // Use Claude to extract products from the markdown (with retry on failures)
      let extraction
      for (let extractAttempt = 0; extractAttempt < 2; extractAttempt++) {
        try {
          extraction = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4000,
            messages: [{
              role: 'user',
              content: `Extract ALL products from this Action.com "Nieuw" (new arrivals) page content. Return a JSON array only, no markdown fences.

Each product should have: name, price (as string like "1.49"), image (full URL), url (full URL to product page).

Page content:
${markdown.slice(0, 12000)}

Return ONLY a JSON array like: [{"name":"Product Name","price":"1.49","image":"https://...","url":"https://..."}]
If no products found, return []`
            }],
          })
          break
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          
          // Check for insufficient credits error
          if (msg.includes('credit balance is too low') || msg.includes('insufficient_quota')) {
            throw new Error(`Anthropic API credits exhausted. Please add more credits to your Anthropic account. Error: ${msg}`)
          }
          
          if (extractAttempt === 0) {
            if ((msg.includes('429') || msg.includes('529')) && extractAttempt < 1) {
              console.log(`[Claude] ${pageUrl}: rate limited, retrying extraction`)
              await new Promise((resolve) => setTimeout(resolve, 2000))
              continue
            }
          }
          throw err
        }
      }

      if (!extraction) throw new Error('Failed to create extraction')

      const text = extraction.content[0].type === 'text' ? extraction.content[0].text.trim() : '[]'
      const cleaned = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
      let products: FirecrawlProduct[] = []
      try {
        products = JSON.parse(cleaned)
      } catch (parseErr) {
        console.error(`[Firecrawl] ${pageUrl}: failed to parse Claude response as JSON:`, cleaned.slice(0, 200))
        throw parseErr
      }

      const mapped = products
        .filter((p) => p.name)
        .map((p) => ({
          productName: p.name ?? null,
          imageUrl: p.image ?? null,
          productUrl: p.url ?? null,
          price: parsePrice(p.price),
          category: 'Nieuw',
          searchTerm: 'nieuw',
          pageUrl,
        }))

      console.log(`[Firecrawl] ${pageUrl}: extracted ${mapped.length} products`)
      return mapped
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`[Firecrawl] ${pageUrl}: attempt ${attempt + 1} failed: ${lastError.message}`)
      // Credit errors are fatal — don't retry, propagate immediately
      if (lastError.message.includes('credits exhausted') || lastError.message.includes('credit balance is too low')) {
        throw lastError
      }
    }
  }

  console.error(`[Firecrawl] ${pageUrl}: all ${MAX_RETRIES} attempts failed. Last error: ${lastError?.message}`)
  return []
}

async function scrapeNewArrivals(): Promise<RawProduct[]> {
  console.log(`[Firecrawl] Scraping ${NIEUW_PAGES.length} new arrival pages in parallel`)
  // Scrape pages in parallel (Firecrawl handles rate limits)
  const results = await Promise.allSettled(NIEUW_PAGES.map((url) => scrapePageWithFirecrawl(url)))
  
  results.forEach((r, i) =>
    r.status === 'fulfilled'
      ? console.log(`[Firecrawl] Page ${i + 1}: ${r.value.length} products`)
      : console.error(`[Firecrawl] Page ${i + 1}: error - ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
  )

  // Surface fatal errors (e.g. Anthropic credits) instead of burying them
  const fatalError = results.find((r): r is PromiseRejectedResult => {
    if (r.status !== 'rejected') return false
    const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
    return msg.includes('credits exhausted') || msg.includes('credit balance is too low')
  })
  if (fatalError) throw fatalError.reason

  const fulfilled = results.filter((r): r is PromiseFulfilledResult<RawProduct[]> => r.status === 'fulfilled')
  const allProducts = fulfilled.flatMap((r) => r.value)
  console.log(`[Firecrawl] Total products scraped: ${allProducts.length} from ${fulfilled.length}/${NIEUW_PAGES.length} pages`)
  return allProducts
}

// ─── Claude Batch Scoring ─────────────────────────────────────────────────────

async function scoreBatch(
  batch: RawProduct[],
  globalOffset: number,
  redditSummary: string,
  tiktokSummary: string,
  fbSummary: string,
  liveTrendSummary: string,
  seasonHint: string,
  pinterestSummary: string
): Promise<ScoredItem[]> {
  const catalog = batch.map((p, i) =>
    `${i}: "${p.productName ?? 'Unknown'}" — ${p.price != null ? `€${p.price}` : 'price unknown'}`
  ).join('\n')

  const prompt = `Je bent een productanalist + contentstrateeg voor Action (budget retailer NL/BE, producten €0.50–€20).

HUIDIG SEIZOEN: ${seasonHint}

━━━ TREND SIGNALS ━━━

LIVE TRENDS (RSS — fetched this session):
${liveTrendSummary || 'No RSS data available'}

REDDIT (Action publiek):
${redditSummary || 'No data'}

TIKTOK (Dutch Action content):
${tiktokSummary || 'No data'}

FACEBOOK (Action kopers groepen):
${fbSummary || 'No data'}

PINTEREST TRENDS (planning intent — wat NL consumenten zoeken/pinnen):
${pinterestSummary || 'No data'}

━━━ NIEUWE ACTION PRODUCTEN (${batch.length} stuks) ━━━
${catalog}

━━━ TAAK ━━━
Beoordeel elk product op 6 criteria (schaal 1–10) én genereer content concept.

CRITERIA:
1. PRIJS-KWALITEIT: Wat krijg je voor het geld vs. alternatieven?
2. INNOVATIE: Wat is uniek of vernieuwend aan dit product?
3. PRAKTISCH NUT: Hoe vaak gebruikt? Welke problemen lost het op?
4. CADEAU POTENTIE: Voor wie geschikt, bij welke gelegenheden?
5. SEIZOEN RELEVANTIE: Hoe relevant nu in dit seizoen?
6. VIRALE POTENTIE: Geschikt voor TikTok/Instagram/Facebook content? Welke formats?

Weeg PINTEREST TRENDS mee: producten die aansluiten bij trending Pinterest zoektermen scoren hoger op SEIZOEN RELEVANTIE en VIRALE POTENTIE, omdat Pinterest-gebruikers actief plannen om deze producten te kopen of gebruiken.

CONTENT CONCEPT (per product):
- hook: pakkende Dutch TikTok opener (max 12 woorden, start met: POV, Wacht, Dit, Niemand, Ik, of een getal)
- contentConcept: concrete 2-3 zin Dutch video concept (wat filmen, hoe presenteren, waarom het werkt)
- videoFormat: "TikTok POV" / "Instagram Tutorial" / "Facebook DIY" / "TikTok Haul" etc.
- requiresPerson: true als creator in beeld moet, false voor product-only content
- callToAction: platform-specifieke CTA (bijv. "Link in bio →", "Sla op voor later!", "Tag een vriendin!")
- musicSuggestion: passende muziek/sound tip (bijv. "Trending lente-geluid", "ASMR unboxing sfeer")
- engagementEstimate: verwachte engagement score 1–10 voor dit platform
- targetAudience: array uit ["teens","young_adults","adults","seniors","parents","students"]
- conceptIdeas: array van PRECIES 3 Nederlandse content ideeën, elk met:
  - title: korte pakkende titel (5–8 woorden, Dutch)
  - description: 1–2 zinnen concrete invulling voor NL/BE markt
  - platform: "TikTok" | "Instagram" | "Facebook"
  Maak elk idee uniek qua format (niet 3× hetzelfde platform)

Return ONLY a valid JSON array, one object per product in index order:
[{"index":0,"priceQuality":8,"innovation":5,"practicalUtility":9,"giftPotential":6,"seasonalRelevance":8,"viralPotential":9,"trendScore":75,"reasoning":"1-2 zinnen waarom.","topSignals":["Google Trends NL: lente schoonmaak","TikTok: opruim hacks 80K views","Reddit NL: organisatie tips viral"],"targetAudience":["young_adults","students"],"season":["spring"],"contentAngles":["Haul","Before/After"],"platformBuzz":"tiktok","hook":"POV: dit kost maar €1 bij Action","contentConcept":"Open met een rommelige kast en sluit af met de opgeruimde versie. Voice-over: 'Ik heb €2 uitgegeven.' Gebruik trending opruim-geluid.","videoFormat":"TikTok POV","requiresPerson":false,"callToAction":"Sla op voor later!","musicSuggestion":"Trending lente clean-up geluid","engagementEstimate":8,"conceptIdeas":[{"title":"POV: €2 budget haul check","description":"Pak 3 producten uit en vergelijk ze live met duurdere alternatieven. Perfect voor korte 'value for money' content.","platform":"TikTok"},{"title":"Voor en na opruim challenge","description":"Laat zien hoe het product een rommelig hoekje transformeert. Gebruik trending organisatie-geluid.","platform":"Instagram"},{"title":"3 redenen waarom ik dit koop","description":"Casual talking-head video waarin je uitlegt waarom dit product handig is voor het gezin. Sluit af met een prijs reveal.","platform":"Facebook"}]}]

Rules:
- trendScore = Math.round(gemiddelde van de 6 scores × 10) — integer 0–100
- topSignals: precies 3 strings die verwijzen naar echte data uit de trend signals hierboven
- season: subset van ["spring","summer","autumn","winter"]
- contentAngles: 1–3 uit ["Room tour","Haul","Before/After","DIY Tutorial","Styling","Unboxing","Gift Guide"]
- platformBuzz: één van "tiktok","reddit","facebook","mixed"
- Return ALL ${batch.length} objects — sla geen enkel product over
- Return ONLY the JSON array`

  // Retry up to 3 times with backoff on rate limit (429) errors
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const waitSec = 30 * attempt // 30s, 60s
      console.log(`[Claude] Batch ${globalOffset}: rate limited — waiting ${waitSec}s before retry ${attempt}/2`)
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000))
    }
    let text: string
    try {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      })
      if (message.stop_reason === 'max_tokens') {
        console.error(`[Claude] Batch ${globalOffset}: hit max_tokens limit — response truncated, will retry`)
        if (attempt < 2) continue
        // Last attempt: try to parse what we got anyway
      }
      text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if ((msg.includes('429') || msg.includes('529')) && attempt < 2) {
        console.warn(`[Claude] Batch ${globalOffset}: rate limited (attempt ${attempt + 1}/3)`)
        continue
      }
      throw err
    }

    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (!arrayMatch) {
      const preview = text.slice(0, 400)
      console.error(`[Claude] Batch ${globalOffset}: no JSON array found. Response preview:\n${preview}`)
      throw new Error(`No JSON array in Claude response (offset ${globalOffset}). Preview: ${preview}`)
    }

    let parsed: ScoredItem[]
    try {
      parsed = JSON.parse(arrayMatch[0])
    } catch (parseErr) {
      const preview = arrayMatch[0].slice(0, 400)
      console.error(`[Claude] Batch ${globalOffset}: JSON.parse failed. Preview:\n${preview}`)
      throw new Error(`JSON parse failed (offset ${globalOffset}): ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`)
    }
    return parsed.map((item) => ({ ...item, index: item.index + globalOffset }))
  }
  throw new Error(`Batch ${globalOffset} failed after 3 attempts (persistent rate limit)`)
}

// ─── Main Prediction Pipeline ─────────────────────────────────────────────────

async function runPrediction(): Promise<ProductPrediction[]> {
  console.log('Fetching new Action products via Firecrawl + trend signals in parallel')

  const [allProducts, redditResult, tiktokResult, fbResult, liveTrendSummary, pinterestSummary] = await Promise.all([
    scrapeNewArrivals(),
    supabase.from('redditdata').select('Titel, Beschrijving, Categorieën').limit(20),
    supabase.from('Tiktok Data Action').select('Caption, Views, Likes, Shares, Zoekterm, Tags').limit(80),
    supabase.from('FB data scraper').select('"Caption (text)", Likes, Comments, Shares, Groepsnaam, "Top comments"').limit(20),
    fetchLiveTrends(),
    fetchPinterestTrends(),
  ])

  if (allProducts.length === 0) {
    throw new Error('No products scraped from Action.com. Check server logs — possible causes: Anthropic credits exhausted, Firecrawl blocked by Cloudflare, or page structure changed.')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const redditSummary = ((redditResult.data ?? []) as any[]).map((r) =>
    `[Reddit] ${r.Titel} (${r['Categorieën']})`
  ).join('\n')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tiktokSummary = ((tiktokResult.data ?? []) as any[]).map((r) =>
    `[TikTok] ${r.Zoekterm}: "${(r.Caption ?? '').slice(0, 80)}" — ${r.Views ?? 0} views, ${r.Likes ?? 0} likes`
  ).join('\n')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fbSummary = ((fbResult.data ?? []) as any[]).map((r) =>
    `[Facebook/${r.Groepsnaam}] "${(r['Caption (text)'] ?? '').slice(0, 80)}" — ${r.Likes ?? 0} likes, ${r.Comments ?? 0} comments`
  ).join('\n')

  const seasonHint = getSeasonHint()

  const batches: RawProduct[][] = []
  for (let i = 0; i < allProducts.length; i += SCORING_BATCH_SIZE) {
    batches.push(allProducts.slice(i, i + SCORING_BATCH_SIZE))
  }

  // Score batches with limited concurrency (SCORING_CONCURRENCY at a time)
  const allScoredItems: ScoredItem[] = []
  const batchErrors: string[] = []
  for (let start = 0; start < batches.length; start += SCORING_CONCURRENCY) {
    const chunk = batches.slice(start, start + SCORING_CONCURRENCY)
    const results = await Promise.allSettled(
      chunk.map((batch, ci) => {
        const bi = start + ci
        console.log(`[Claude] Scoring batch ${bi + 1}/${batches.length} (products ${bi * SCORING_BATCH_SIZE}–${Math.min((bi + 1) * SCORING_BATCH_SIZE - 1, allProducts.length - 1)})`)
        return scoreBatch(batch, bi * SCORING_BATCH_SIZE, redditSummary, tiktokSummary, fbSummary, liveTrendSummary, seasonHint, pinterestSummary)
      })
    )
    for (let ci = 0; ci < results.length; ci++) {
      const r = results[ci]
      if (r.status === 'fulfilled') {
        allScoredItems.push(...r.value)
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
        console.error(`[Claude] Scoring batch ${start + ci} failed:`, msg)
        batchErrors.push(`Batch ${start + ci}: ${msg}`)
      }
    }
  }

  if (allScoredItems.length === 0) {
    throw new Error(`All ${batches.length} Claude scoring batches failed.\n${batchErrors.join('\n')}`)
  }

  const predictions: ProductPrediction[] = allScoredItems
    .filter((item) => item.index >= 0 && item.index < allProducts.length)
    .map((item) => {
      const product = allProducts[item.index]
      return {
        productType:       product.category,
        searchTerm:        product.searchTerm,
        trendScore:        Math.min(100, Math.max(0, Math.round(item.trendScore))),
        reasoning:         item.reasoning,
        topSignals:        Array.isArray(item.topSignals) ? item.topSignals.slice(0, 3) : [],
        productName:       product.productName,
        imageUrl:          product.imageUrl,
        productUrl:        product.productUrl || product.pageUrl,
        price:             product.price,
        category:          product.category,
        season:            Array.isArray(item.season) ? item.season : [],
        contentAngles:     Array.isArray(item.contentAngles) ? item.contentAngles : [],
        platformBuzz:      item.platformBuzz ?? 'mixed',
        hook:              item.hook ?? null,
        contentConcept:    item.contentConcept ?? null,
        priceQuality:      item.priceQuality ?? null,
        innovation:        item.innovation ?? null,
        practicalUtility:  item.practicalUtility ?? null,
        giftPotential:     item.giftPotential ?? null,
        seasonalRelevance: item.seasonalRelevance ?? null,
        viralPotential:    item.viralPotential ?? null,
        targetAudience:    Array.isArray(item.targetAudience) ? item.targetAudience : null,
        videoFormat:       item.videoFormat ?? null,
        requiresPerson:    item.requiresPerson ?? null,
        callToAction:      item.callToAction ?? null,
        musicSuggestion:   item.musicSuggestion ?? null,
        engagementEstimate:item.engagementEstimate ?? null,
      }
    })
    .sort((a, b) => b.trendScore - a.trendScore)
    .slice(0, 100)

  return predictions
}

// ─── GET Handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const forceRefresh = searchParams.get('refresh') === '1'
  const cacheOnly = searchParams.get('cacheOnly') === '1'

  // Fast path: just return cached data without running the pipeline
  if (cacheOnly) {
    const cached = await loadCache()
    if (cached) {
      return NextResponse.json({ predictions: cached.predictions, cached: true, cachedAt: cached.cachedAt })
    }
    return NextResponse.json({ predictions: [], cached: false, cachedAt: null })
  }

  console.log('[TrendPredict] Starting — getting Supabase row count...')
  const currentCount = await getSupabaseRowCount()
  console.log(`[TrendPredict] Row count: ${currentCount}`)

  if (!forceRefresh) {
    console.log('[TrendPredict] Checking cache...')
    const cached = await loadCache()
    if (cached) {
      const age = Date.now() - new Date(cached.cachedAt).getTime()
      const withinTTL = age < CACHE_TTL_MS
      const noNewData = currentCount <= cached.supabaseRowCount
      if (withinTTL && noNewData) {
        return NextResponse.json({
          predictions: cached.predictions,
          cached: true,
          cachedAt: cached.cachedAt,
        })
      }
    }
  }

  try {
    const predictions = await runPrediction()
    // Save cache — don't let cache failure break the response
    try {
      await saveCache({ cachedAt: new Date().toISOString(), predictions, supabaseRowCount: currentCount })
    } catch (cacheErr) {
      console.warn('[TrendPredict] Failed to save cache (non-fatal):', cacheErr instanceof Error ? cacheErr.message : String(cacheErr))
    }
    return NextResponse.json({ predictions, cached: false, cachedAt: new Date().toISOString() })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const errStack = err instanceof Error ? err.stack : undefined
    console.error('[TrendPredict] Error:', errMsg, errStack)
    return NextResponse.json(
      { error: errMsg, predictions: [] },
      { status: 500 }
    )
  }
}
