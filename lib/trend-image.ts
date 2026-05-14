/**
 * Cinematic hero image generator using Gemini 2.5 Flash Image.
 *
 * Generates a magazine-cover-style image per trend for the daily report.
 * Cached in culture_trend_images keyed by (trend_id, generated_date).
 *
 * Cost: ~$0.03-0.04 per image. We generate at most 3 per day (top 3
 * features) so daily cost is bounded around $0.12.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { sql } from '@/lib/culture-db'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')
const MODEL = 'gemini-2.5-flash-image'

export interface ImageInput {
  trendId: string
  name: string
  description: string
  category: string
  vibe?: string | null
  subculture?: string | null
}

export interface ImageResult {
  dataUrl: string | null   // "data:image/png;base64,..."
  cached: boolean
  prompt?: string
}

/**
 * Build a Gemini image prompt from trend metadata. Tunes for editorial
 * magazine cover style — cinematic lighting, painterly textures, no
 * letters/text on the image.
 */
function buildPrompt(t: ImageInput): string {
  const vibeAdj: Record<string, string> = {
    unhinged: 'chaotic surreal',
    aesthetic: 'curated cinematic',
    humor: 'playful warm',
    wholesome: 'soft golden-hour',
    emotional: 'melancholy moody',
    informational: 'editorial documentary',
    product: 'product-launch glossy',
    sport: 'dynamic action',
  }
  const subcultureCue = t.subculture ? `, ${t.subculture.replace(/_/g, ' ')} aesthetic` : ''
  const vibeCue = t.vibe ? vibeAdj[t.vibe] ?? 'cinematic' : 'cinematic'

  return `Editorial magazine cover photograph illustrating: "${t.name}". ${t.description.slice(0, 200)}.
Style: ${vibeCue} photography${subcultureCue}, shot on Hasselblad, shallow depth of field, rich color grading, magazine cover quality.
ABSOLUTELY NO text, no logos, no letters, no words, no captions in the image. Pure visual composition.
Composition: centered subject with negative space at top-right for typography. Strong mood, cohesive palette.`
}

export async function generateHeroImage(t: ImageInput): Promise<ImageResult> {
  // Ensure cache table
  await sql().query(`
    CREATE TABLE IF NOT EXISTS culture_trend_images (
      trend_id UUID NOT NULL,
      generated_date DATE NOT NULL,
      data_url TEXT,
      prompt TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (trend_id, generated_date)
    )
  `)

  // Check cache
  const cached = (await sql().query(
    `SELECT data_url FROM culture_trend_images
      WHERE trend_id = $1 AND generated_date = CURRENT_DATE`,
    [t.trendId],
  )) as Array<{ data_url: string | null }>
  if (cached[0]?.data_url) {
    return { dataUrl: cached[0].data_url, cached: true }
  }

  const prompt = buildPrompt(t)

  try {
    const model = genAI.getGenerativeModel({ model: MODEL })
    const result = await model.generateContent(prompt)
    const parts = result.response.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find((p) => (p as { inlineData?: unknown }).inlineData)
    const inlineData = imagePart && (imagePart as { inlineData?: { data?: string; mimeType?: string } }).inlineData
    if (!inlineData?.data) {
      return { dataUrl: null, cached: false, prompt }
    }
    const mime = inlineData.mimeType ?? 'image/png'
    const dataUrl = `data:${mime};base64,${inlineData.data}`

    // Cache it
    await sql().query(
      `INSERT INTO culture_trend_images (trend_id, generated_date, data_url, prompt)
       VALUES ($1, CURRENT_DATE, $2, $3)
       ON CONFLICT (trend_id, generated_date) DO UPDATE SET
         data_url = EXCLUDED.data_url,
         prompt = EXCLUDED.prompt`,
      [t.trendId, dataUrl, prompt],
    )

    // GC old generations (>7 days)
    await sql().query(
      `DELETE FROM culture_trend_images
        WHERE generated_date < CURRENT_DATE - INTERVAL '7 days'`,
    )

    return { dataUrl, cached: false, prompt }
  } catch (err) {
    console.error('[trend-image] generation failed', t.trendId, err)
    return { dataUrl: null, cached: false, prompt }
  }
}

/**
 * Generate hero images for multiple trends with concurrency limit.
 * Gemini handles concurrency fine — sequential was too slow. Most
 * are cache-hits on subsequent calls so wall time is fast.
 */
export async function generateHeroImagesForReport(
  inputs: ImageInput[],
  concurrency = 3,
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
      while (cursor < inputs.length) {
        const i = cursor++
        const inp = inputs[i]
        try {
          const r = await generateHeroImage(inp)
          if (r.dataUrl) results.set(inp.trendId, r.dataUrl)
        } catch (err) {
          console.error('[trend-image] batch failed for', inp.trendId, err)
        }
      }
    }),
  )
  return results
}
