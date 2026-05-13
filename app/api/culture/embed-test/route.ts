/**
 * GET /api/culture/embed-test
 *
 * Diagnostic: tries Gemini embed with a hardcoded string. Surfaces the
 * exact error so we can pick the right model name.
 */
import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export async function GET() {
  const apiKey = process.env.GOOGLE_API_KEY ?? ''
  const genAI = new GoogleGenerativeAI(apiKey)
  const candidates = ['text-embedding-004', 'gemini-embedding-001', 'embedding-001', 'models/text-embedding-004']
  const results: Array<{ model: string; ok: boolean; length: number; error?: string }> = []
  for (const m of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: m })
      const r = await model.embedContent('hello world cottagecore aesthetic test')
      results.push({ model: m, ok: true, length: r.embedding.values.length })
    } catch (err) {
      results.push({ model: m, ok: false, length: 0, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return NextResponse.json({ apiKeyPresent: !!apiKey, results })
}
