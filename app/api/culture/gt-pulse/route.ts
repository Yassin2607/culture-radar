/**
 * GET /api/culture/gt-pulse
 *
 * Cross-country interpretation layer on top of Google Trends snapshots:
 *
 *   multiCountry  trends appearing in N+ countries today (the strongest
 *                 signal — synchronized continent-wide spike).
 *   newToday      titles in today's top that weren't in yesterday's top.
 *                 Caught early.
 *   risingFast    titles whose rank improved by 5+ places day over day.
 *   topByCountry  top 8 per country for the "raw" view.
 *
 * Pure read endpoint — fast, no AI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'

interface SnapshotRow {
  geo: string
  snapshot_date: string
  rank: number
  title: string
  title_normalized: string
  traffic: string | null
  traffic_value: number | null
  related_queries: string[] | null
  articles: Array<{ title: string; url: string; source: string | null }> | null
}

export async function GET(_req: NextRequest) {
  // Pull today + yesterday in one shot
  const rows = (await sql().query(
    `SELECT geo, snapshot_date::TEXT AS snapshot_date, rank, title, title_normalized,
            traffic, traffic_value, related_queries, articles
       FROM culture_gt_snapshots
      WHERE snapshot_date IN (CURRENT_DATE, CURRENT_DATE - INTERVAL '1 day')
      ORDER BY geo, snapshot_date DESC, rank ASC`,
  )) as SnapshotRow[]

  const todayStr = new Date().toISOString().slice(0, 10)
  const today = rows.filter((r) => r.snapshot_date === todayStr)
  const yesterday = rows.filter((r) => r.snapshot_date !== todayStr)

  if (today.length === 0) {
    return NextResponse.json({
      ok: true,
      empty: true,
      message: 'No Google Trends snapshot for today yet. Trigger /api/culture/snapshot-gt first or wait for next cron.',
      multiCountry: [],
      newToday: [],
      risingFast: [],
      topByCountry: [],
    })
  }

  // 1) Multi-country: group today's items by title_normalized, count distinct geos
  const titleMap = new Map<string, {
    title: string
    geos: Array<{ geo: string; rank: number; traffic: string | null; trafficValue: number | null }>
    relatedQueries: Set<string>
    articles: Array<{ title: string; url: string; source: string | null }>
  }>()

  for (const r of today) {
    const key = r.title_normalized
    if (!key) continue
    const existing = titleMap.get(key) ?? {
      title: r.title,
      geos: [],
      relatedQueries: new Set<string>(),
      articles: [],
    }
    existing.geos.push({ geo: r.geo, rank: r.rank, traffic: r.traffic, trafficValue: r.traffic_value })
    for (const q of r.related_queries ?? []) existing.relatedQueries.add(q)
    for (const a of (r.articles ?? []).slice(0, 2)) {
      if (a.url && !existing.articles.find((ea) => ea.url === a.url)) {
        existing.articles.push(a)
      }
    }
    titleMap.set(key, existing)
  }

  const multiCountry = Array.from(titleMap.values())
    .filter((t) => t.geos.length >= 3)
    .map((t) => ({
      title: t.title,
      countryCount: t.geos.length,
      avgRank: Math.round(t.geos.reduce((s, g) => s + g.rank, 0) / t.geos.length),
      totalTrafficValue: t.geos.reduce((s, g) => s + (g.trafficValue ?? 0), 0),
      geos: t.geos.sort((a, b) => a.rank - b.rank),
      relatedQueries: Array.from(t.relatedQueries).slice(0, 8),
      articles: t.articles.slice(0, 4),
    }))
    .sort((a, b) => {
      if (a.countryCount !== b.countryCount) return b.countryCount - a.countryCount
      return a.avgRank - b.avgRank
    })

  // 2) New today vs yesterday: per country, titles present today but not yesterday
  const yesterdayByGeo = new Map<string, Set<string>>()
  for (const r of yesterday) {
    const set = yesterdayByGeo.get(r.geo) ?? new Set<string>()
    set.add(r.title_normalized)
    yesterdayByGeo.set(r.geo, set)
  }
  const newToday: Array<{ title: string; geo: string; rank: number; articles: SnapshotRow['articles'] }> = []
  for (const r of today) {
    const ySet = yesterdayByGeo.get(r.geo)
    if (ySet && !ySet.has(r.title_normalized)) {
      newToday.push({ title: r.title, geo: r.geo, rank: r.rank, articles: r.articles })
    }
  }
  newToday.sort((a, b) => a.rank - b.rank)

  // 3) Rising fast: rank improved by 5+ from yesterday
  const yesterdayRankByGeoTitle = new Map<string, number>()
  for (const r of yesterday) {
    yesterdayRankByGeoTitle.set(`${r.geo}::${r.title_normalized}`, r.rank)
  }
  const risingFast: Array<{ title: string; geo: string; rankToday: number; rankYesterday: number; delta: number }> = []
  for (const r of today) {
    const ry = yesterdayRankByGeoTitle.get(`${r.geo}::${r.title_normalized}`)
    if (ry && ry - r.rank >= 5) {
      risingFast.push({ title: r.title, geo: r.geo, rankToday: r.rank, rankYesterday: ry, delta: ry - r.rank })
    }
  }
  risingFast.sort((a, b) => b.delta - a.delta)

  // 4) Top by country (top 8 per geo)
  const byGeo = new Map<string, SnapshotRow[]>()
  for (const r of today) {
    const list = byGeo.get(r.geo) ?? []
    if (list.length < 8) list.push(r)
    byGeo.set(r.geo, list)
  }
  const topByCountry = Array.from(byGeo.entries()).map(([geo, items]) => ({
    geo,
    items: items.map((i) => ({
      rank: i.rank,
      title: i.title,
      traffic: i.traffic,
      trafficValue: i.traffic_value,
      relatedQueries: (i.related_queries ?? []).slice(0, 4),
      articles: (i.articles ?? []).slice(0, 2),
    })),
  }))

  return NextResponse.json({
    ok: true,
    snapshotDate: todayStr,
    multiCountry: multiCountry.slice(0, 30),
    newToday: newToday.slice(0, 30),
    risingFast: risingFast.slice(0, 20),
    topByCountry,
  })
}
