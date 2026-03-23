import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const platform = searchParams.get('platform') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const perPage = 25
  const qRaw = searchParams.get('q') ?? ''
  if (qRaw.length > 200) return NextResponse.json({ error: 'Zoekopdracht te lang.' }, { status: 400 })
  const q = qRaw.toLowerCase()

  // Fetch counts and data in parallel; limit rows to keep responses fast
  const [fbRes, tiktokRes, redditRes, fbCount, tiktokCount, redditCount] = await Promise.all([
    platform && platform !== 'Facebook' ? Promise.resolve({ data: [] }) :
      supabase.from('FB data scraper').select('"Caption (text)", Likes, Groepsnaam, "Facebook URL"').limit(150),
    platform && platform !== 'TikTok' ? Promise.resolve({ data: [] }) :
      supabase.from('Tiktok Data Action').select('Caption, Likes, Zoekterm, "Video URL"').limit(150),
    platform && platform !== 'Reddit' ? Promise.resolve({ data: [] }) :
      supabase.from('redditdata').select('Titel, Beschrijving, Categorieën, URL').limit(150),
    supabase.from('FB data scraper').select('*', { count: 'exact', head: true }),
    supabase.from('Tiktok Data Action').select('*', { count: 'exact', head: true }),
    supabase.from('redditdata').select('*', { count: 'exact', head: true }),
  ])

  const posts = [
    ...((fbRes.data ?? []) as Row[]).map((r) => ({
      platform: 'Facebook',
      caption: (r['Caption (text)'] ?? '') as string,
      group: (r['Groepsnaam'] ?? '') as string,
      url: (r['Facebook URL'] ?? '') as string,
      likes: (r['Likes'] ?? 0) as number,
    })),
    ...((tiktokRes.data ?? []) as Row[]).map((r) => ({
      platform: 'TikTok',
      caption: (r['Caption'] ?? '') as string,
      group: (r['Zoekterm'] ?? '') as string,
      url: (r['Video URL'] ?? '') as string,
      likes: (r['Likes'] ?? 0) as number,
    })),
    ...((redditRes.data ?? []) as Row[]).map((r) => ({
      platform: 'Reddit',
      caption: [r['Titel'], r['Beschrijving']].filter(Boolean).join(': ') as string,
      group: (r['Categorieën'] ?? '') as string,
      url: (r['URL'] ?? '') as string,
      likes: 0,
    })),
  ]

  const platformCounts = {
    Facebook: fbCount.count ?? 0,
    TikTok: tiktokCount.count ?? 0,
    Reddit: redditCount.count ?? 0,
  }

  // Keyword search mode: filter by caption, return up to 50 without pagination
  if (q) {
    const matched = posts.filter((p) => p.caption.toLowerCase().includes(q))
    return NextResponse.json({ items: matched.slice(0, 50), total: matched.length, page: 1, perPage: 50, totalPages: 1, platformCounts })
  }

  const total = posts.length
  const items = posts.slice((page - 1) * perPage, page * perPage)

  return NextResponse.json({ items, total, page, perPage, totalPages: Math.ceil(total / perPage), platformCounts })
}
