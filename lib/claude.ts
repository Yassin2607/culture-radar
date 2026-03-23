import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_MODEL, COUNTRY_LANGUAGES } from '@/lib/constants'
import type {
  ScanConfig,
  ImageResult,
  ProcessableFile,
  LanguageCheckResult,
  PriceCheckResult,
  BrandCheckResult,
  PriceLookupResult,
} from '@/types/scanner'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')

interface RawAnalysis {
  languageCheck?: {
    detected_languages?: string[]
    text_found?: boolean
    language_correct?: boolean | null
    language_issues?: string[]
    confidence?: 'high' | 'medium' | 'low'
  }
  priceCheck?: {
    price_visible?: boolean
    price_in_image?: string | null
    currency_symbol?: string | null
    price_format_correct?: boolean | null
    notes?: string
  }
  brandCheck?: {
    action_logo_present?: boolean
    logo_usage_correct?: boolean | null
    brand_colors_present?: boolean
    brand_colors_correct?: boolean | null
    text_readable?: boolean
    offensive_content?: boolean
    quality_issues?: string[]
    overall_quality?: 'good' | 'acceptable' | 'poor'
  }
  overallStatus?: 'pass' | 'fail' | 'warning'
  summary?: string
}

function buildPrompt(config: ScanConfig, priceData: PriceLookupResult | null): string {
  const targetLangs = config.targetCountries
    .flatMap((c) => COUNTRY_LANGUAGES[c] ?? [])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', ')

  return `Analyze this retail promotional image for Action (the European discount retailer).
IMPORTANT: Only analyze the TEXT OVERLAY on the image (headlines, slogans, labels, price tags, captions). Ignore the products, product packaging, and any text printed on the products themselves — those are not relevant.
Respond ONLY with a valid JSON object matching this exact structure — no markdown, no extra text:

{
  "languageCheck": {
    "detected_languages": [],
    "text_found": false,
    "language_correct": null,
    "language_issues": [],
    "confidence": "high"
  },
  "priceCheck": {
    "price_visible": false,
    "price_in_image": null,
    "currency_symbol": null,
    "price_format_correct": null,
    "notes": ""
  },
  "brandCheck": {
    "action_logo_present": false,
    "logo_usage_correct": null,
    "brand_colors_present": false,
    "brand_colors_correct": null,
    "text_readable": true,
    "offensive_content": false,
    "quality_issues": [],
    "overall_quality": "good"
  },
  "overallStatus": "pass",
  "summary": ""
}

${
  config.enableLanguageCheck
    ? `LANGUAGE CHECK: Target markets are: ${config.targetCountries.join(', ').toUpperCase()}.
Expected languages: ${targetLangs}.
Only detect text in the overlay layer (headlines, slogans, price tags, labels added on top of the image). Do NOT read text on products or product packaging.
Set language_correct=true if the overlay text is in an expected language for the target market.
Set language_correct=false if overlay text is in the WRONG language.
Set language_correct=null if no overlay text is found or you cannot determine.
Action markets: NL=Dutch, FR=French, DE=German, BE=Dutch+French, ES=Spanish, IT=Italian, PL=Polish, CZ=Czech, SK=Slovak, HU=Hungarian, AT=German, CH=German+French+Italian, RO=Romanian, PT=Portuguese.
All European languages for reference (for correct identification): Albanian, Basque, Belarusian, Bosnian, Breton, Bulgarian, Catalan, Croatian, Czech, Danish, Dutch, English, Estonian, Faroese, Finnish, French, Frisian, Galician, Georgian, German, Greek, Hungarian, Icelandic, Irish, Italian, Latvian, Lithuanian, Luxembourgish, Macedonian, Maltese, Norwegian, Occitan, Polish, Portuguese, Romanian, Romansh, Russian, Serbian, Slovak, Slovenian, Sorbian, Spanish, Swedish, Turkish, Ukrainian, Welsh.`
    : 'LANGUAGE CHECK: Not requested. Set languageCheck values to defaults.'
}

${
  config.enablePriceCheck
    ? `PRICE CHECK: Look for a numeric price in the text overlay only (not on product packaging).
Extract the numeric price value if visible. Set price_in_image to the number you see (e.g. "299", "2.99", "1299").
IMPORTANT: Prices displayed as whole numbers WITHOUT a comma or decimal separator (e.g. "299", "1299") are 100% correct. Do NOT flag the absence of a comma as an issue. This is the correct format.
currency_symbol: ALWAYS set to null — do not report or evaluate currency symbols under any circumstances.
price_format_correct: ALWAYS set to null — never evaluate formatting, commas, separators, or symbols.
The ONLY reason to set price_format_correct=false is if website price data is provided AND the numeric value clearly does not match.
${
  priceData?.results && priceData.results.length > 0
    ? `WEBSITE PRICE DATA: ${JSON.stringify(priceData.results)}. Only set price_format_correct=false if the numeric image price clearly differs from ALL website prices.`
    : 'No live price data available. Set price_format_correct=null.'
}`
    : 'PRICE CHECK: Not requested. Set priceCheck values to defaults.'
}

${
  config.enableBrandCheck
    ? `BRAND & QUALITY CHECK: Evaluate the text overlay only. Do NOT check or evaluate brand colors or logo usage — always set action_logo_present=false, logo_usage_correct=null, brand_colors_present=false, brand_colors_correct=null.
- Text readability: is the overlay text legible and not cut off?
- Offensive content: flag any inappropriate, discriminatory, or legally problematic content in the overlay.
- Quality issues: only list problems with text readability or offensive content. Do not mention colors or logos.`
    : 'BRAND CHECK: Not requested. Set brandCheck values to defaults.'
}

Set overallStatus:
- "pass" = all enabled checks passed
- "warning" = minor issues found (language confidence low, etc.)
- "fail" = any check definitively failed (wrong language, wrong price, offensive content, etc.)

Write a single-sentence summary explaining the result based on the overlay text only.`
}

async function generateWithRetry(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  parts: Parameters<typeof model.generateContent>[0],
  retries = 5
): Promise<ReturnType<typeof model.generateContent> extends Promise<infer T> ? T : never> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await model.generateContent(parts) as never
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const isAuthError = msg.includes('401') || msg.includes('403') || msg.includes('API key')
      if (isAuthError) throw err
      const is429 = msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('quota') || msg.includes('503')
      if (is429 && attempt < retries) {
        // Extract retry delay from error or use exponential backoff
        const retryMatch = msg.match(/retry.*?(\d+)s/i)
        const waitMs = retryMatch ? parseInt(retryMatch[1]) * 1000 : Math.min(30000, 5000 * Math.pow(2, attempt))
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries exceeded')
}

export async function analyzeImage(
  file: ProcessableFile,
  config: ScanConfig,
  priceData: PriceLookupResult | null
): Promise<Omit<ImageResult, 'id' | 'filename' | 'objectUrl' | 'processedAt'>> {
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction:
      'You are a professional content QA analyst for Action, a European discount retail chain. Analyze images for compliance. Always respond with valid JSON only — no markdown fences, no explanation text.',
  })

  const result = await generateWithRetry(model, [
    {
      inlineData: {
        data: file.base64,
        mimeType: file.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
      },
    },
    buildPrompt(config, priceData),
  ])

  const rawText = result.response.text()

  let parsed: RawAnalysis
  try {
    const cleaned = rawText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return {
      status: 'error',
      languageCheck: null,
      priceCheck: null,
      brandCheck: null,
      summary: 'Failed to parse AI response',
      error: `Parse error: ${rawText.slice(0, 200)}`,
    }
  }

  const languageCheck: LanguageCheckResult | null = config.enableLanguageCheck
    ? {
        enabled: true,
        detected_languages: parsed.languageCheck?.detected_languages ?? [],
        text_found: parsed.languageCheck?.text_found ?? false,
        language_correct: parsed.languageCheck?.language_correct ?? null,
        language_issues: parsed.languageCheck?.language_issues ?? [],
        confidence: parsed.languageCheck?.confidence ?? 'medium',
      }
    : null

  const priceCheck: PriceCheckResult | null = config.enablePriceCheck
    ? {
        enabled: true,
        price_visible: parsed.priceCheck?.price_visible ?? false,
        price_in_image: parsed.priceCheck?.price_in_image ?? null,
        currency_symbol: parsed.priceCheck?.currency_symbol ?? null,
        price_format_correct: parsed.priceCheck?.price_format_correct ?? null,
        website_prices:
          priceData?.results?.map((r) => ({
            country: r.country,
            price: r.price,
            match: r.match,
          })) ?? null,
        notes: parsed.priceCheck?.notes ?? '',
      }
    : null

  const brandCheck: BrandCheckResult | null = config.enableBrandCheck
    ? {
        enabled: true,
        action_logo_present: parsed.brandCheck?.action_logo_present ?? false,
        logo_usage_correct: parsed.brandCheck?.logo_usage_correct ?? null,
        brand_colors_present: parsed.brandCheck?.brand_colors_present ?? false,
        brand_colors_correct: parsed.brandCheck?.brand_colors_correct ?? null,
        text_readable: parsed.brandCheck?.text_readable ?? true,
        offensive_content: parsed.brandCheck?.offensive_content ?? false,
        quality_issues: parsed.brandCheck?.quality_issues ?? [],
        overall_quality: parsed.brandCheck?.overall_quality ?? 'good',
      }
    : null

  return {
    status: parsed.overallStatus ?? 'warning',
    languageCheck,
    priceCheck,
    brandCheck,
    summary: parsed.summary ?? '',
  }
}
