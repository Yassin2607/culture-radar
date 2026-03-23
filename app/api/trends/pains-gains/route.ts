import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export interface SourcePost {
  platform: string
  caption: string
  url: string
}

export interface PainGainItem {
  keyword: string
  score: number
  count: number
  postIndices: number[]  // 0-based indices into the posts array
}

export interface PainsGainsResult {
  gains: PainGainItem[]
  pains: PainGainItem[]
  posts: SourcePost[]
}

export async function GET() {
  const [fbRes, tiktokRes, redditRes] = await Promise.all([
    supabase.from('FB data scraper').select('"Caption (text)", "Facebook URL"').limit(60),
    supabase.from('Tiktok Data Action').select('Caption, "Video URL"').limit(80),
    supabase.from('redditdata').select('Titel, Beschrijving, URL').limit(40),
  ])

  const sourcePosts: SourcePost[] = [
    ...((fbRes.data ?? []) as Row[])
      .filter((r) => r['Caption (text)'])
      .map((r) => ({ platform: 'Facebook', caption: String(r['Caption (text)']), url: r['Facebook URL'] ?? '' })),
    ...((tiktokRes.data ?? []) as Row[])
      .filter((r) => r['Caption'])
      .map((r) => ({ platform: 'TikTok', caption: String(r['Caption']), url: r['Video URL'] ?? '' })),
    ...((redditRes.data ?? []) as Row[])
      .filter((r) => r['Titel'])
      .map((r) => ({ platform: 'Reddit', caption: [r['Titel'], r['Beschrijving']].filter(Boolean).join(' '), url: r['URL'] ?? '' })),
  ].slice(0, 120)

  const postsText = sourcePosts.map((p, i) => `${i + 1}. [${p.platform}] ${p.caption.slice(0, 200)}`).join('\n')

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Analyze these social media posts about Action (Dutch budget retailer) products. Extract recurring pains and gains as keywords.

Posts (numbered 1–${sourcePosts.length}):
${postsText}

Return ONLY valid JSON (no markdown):
{
  "gains": [{"keyword": "string", "score": number 1-10, "count": number, "postIndices": [0-based post indices]}],
  "pains": [{"keyword": "string", "score": number 1-10, "count": number, "postIndices": [0-based post indices]}]
}

Rules:
- gains: positive themes — posts expressing satisfaction, excitement, praise, or a tip about something working well (max 15)
- pains: negative themes — posts expressing complaints, problems, disappointment, or something not working (max 15)
- score: strength of signal 1-10
- count: estimated number of posts mentioning it
- postIndices: 0-based indices (post number minus 1) of posts that DIRECTLY support the keyword
  ⚠ STRICT SENTIMENT MATCHING:
  - A post may ONLY appear under a GAIN if it is clearly positive about that topic
  - A post may ONLY appear under a PAIN if it is clearly negative about that topic
  - A positive post (praise, tip, compliment) must NEVER be listed under a pain keyword
  - A negative post (complaint, problem) must NEVER be listed under a gain keyword
  - When in doubt, leave the post out of postIndices
- Keywords in Dutch or English as used in the posts`,
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
  const cleaned = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
  const parsed = JSON.parse(cleaned) as { gains: PainGainItem[]; pains: PainGainItem[] }

  // Ensure postIndices are valid 0-based indices
  const clamp = (items: PainGainItem[]) =>
    items.map((item) => ({
      ...item,
      postIndices: (item.postIndices ?? []).filter((idx) => idx >= 0 && idx < sourcePosts.length),
    }))

  const result: PainsGainsResult = {
    gains: clamp(parsed.gains ?? []),
    pains: clamp(parsed.pains ?? []),
    posts: sourcePosts,
  }

  return NextResponse.json(result)
}
