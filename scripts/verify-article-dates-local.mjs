#!/usr/bin/env node
/**
 * Local runner for article-date verification. Reads .env.local, runs the
 * same logic as /api/culture/verify-article-dates, prints verdicts.
 *
 * Usage:
 *   node scripts/verify-article-dates-local.mjs           # dry run, limit 50
 *   node scripts/verify-article-dates-local.mjs run 500   # apply, limit 500
 */

import { readFileSync } from 'fs'
import { neon } from '@neondatabase/serverless'

// ── Load env ──────────────────────────────────────────────────────────────
const envText = readFileSync('.env.local', 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const sql = neon(process.env.POSTGRES_URL)

const apply = process.argv[2] === 'run'
const limit = parseInt(process.argv[3] ?? '50', 10)
const maxAgeDays = parseInt(process.argv[4] ?? '14', 10)
const concurrency = 8
const FETCH_TIMEOUT_MS = 8000

const cutoff = new Date(Date.now() - maxAgeDays * 86400_000)
const USER_AGENT =
  'Mozilla/5.0 (compatible; CultureRadarBot/1.0; +https://action-culture-radar.vercel.app)'

console.log(
  `[verify] mode=${apply ? 'APPLY' : 'dry-run'} limit=${limit} maxAgeDays=${maxAgeDays} concurrency=${concurrency}`,
)
console.log(`[verify] cutoff = ${cutoff.toISOString()} (now = ${new Date().toISOString()})`)

// ── Date extraction ───────────────────────────────────────────────────────

function extractDateFromUrlPath(url) {
  const ymd = url.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//)
  if (ymd) {
    const d = new Date(`${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}T00:00:00Z`)
    if (!isNaN(d.getTime())) return d
  }
  const ym = url.match(/\/(20\d{2})\/(\d{1,2})\//)
  if (ym) {
    const d = new Date(`${ym[1]}-${String(ym[2]).padStart(2, '0')}-01T00:00:00Z`)
    if (!isNaN(d.getTime())) return d
  }
  const dashYmd = url.match(/\/(20\d{2})-(\d{2})-(\d{2})/)
  if (dashYmd) {
    const d = new Date(`${dashYmd[1]}-${dashYmd[2]}-${dashYmd[3]}T00:00:00Z`)
    if (!isNaN(d.getTime())) return d
  }
  return null
}

function findDatePublishedInJsonLd(raw) {
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const stack = [data]
  while (stack.length) {
    const node = stack.pop()
    if (!node) continue
    if (Array.isArray(node)) { for (const i of node) stack.push(i); continue }
    if (typeof node === 'object') {
      const dp = node.datePublished ?? node.dateCreated
      if (typeof dp === 'string') {
        const d = new Date(dp)
        if (!isNaN(d.getTime())) return d
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v)
    }
  }
  return null
}

function extractDateFromHtml(html) {
  const jsonLdBlocks = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
  for (const block of jsonLdBlocks) {
    const d = findDatePublishedInJsonLd(block[1])
    if (d) return { date: d, source: 'jsonld' }
  }
  let m = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
  if (m) { const d = new Date(m[1]); if (!isNaN(d.getTime())) return { date: d, source: 'meta-article' } }
  m = html.match(/<meta[^>]+property=["']og:article:published_time["'][^>]+content=["']([^"']+)["']/i)
  if (m) { const d = new Date(m[1]); if (!isNaN(d.getTime())) return { date: d, source: 'meta-og' } }
  for (const name of ['pubdate','publishdate','publish_date','DC.date','DC.date.issued','date','sailthru.date']) {
    const re = new RegExp(`<meta[^>]+name=["']${name.replace('.','\\.')}["'][^>]+content=["']([^"']+)["']`, 'i')
    const x = html.match(re)
    if (x) { const d = new Date(x[1]); if (!isNaN(d.getTime())) return { date: d, source: 'meta-other' } }
  }
  // Schema.org microdata (Pressat, older WordPress themes)
  let ip = html.match(/<meta[^>]+itemprop=["'](?:datePublished|dateCreated)["'][^>]+content=["']([^"']+)["']/i)
  if (ip) { const d = new Date(ip[1]); if (!isNaN(d.getTime())) return { date: d, source: 'meta-other' } }
  ip = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["'](?:datePublished|dateCreated)["']/i)
  if (ip) { const d = new Date(ip[1]); if (!isNaN(d.getTime())) return { date: d, source: 'meta-other' } }
  m = html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*pubdate/i)
  if (m) { const d = new Date(m[1]); if (!isNaN(d.getTime())) return { date: d, source: 'time-tag' } }
  m = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)
  if (m) { const d = new Date(m[1]); if (!isNaN(d.getTime())) return { date: d, source: 'time-tag' } }
  return null
}

function isUndatableUrl(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const path = u.pathname.replace(/\/$/, '')
    if (host.includes('tiktok.com')) return true
    if (host.includes('instagram.com')) return true
    if (host.includes('youtube.com') && path.startsWith('/feed')) return true
    if (host.includes('trends.google.com')) return true
    if (path === '' || path === '/') return true
    if (path.startsWith('/search') || path.startsWith('/tag/') || path.startsWith('/topic/')) return true
    return false
  } catch { return true }
}

async function fetchAndExtract(url) {
  if (url.startsWith('internal://') || !url.startsWith('http')) {
    return { publishedAt: null, source: 'none', httpStatus: null, error: 'non-http' }
  }
  if (isUndatableUrl(url)) {
    const d = extractDateFromUrlPath(url)
    return { publishedAt: d, source: d ? 'url-path' : 'none', httpStatus: null, error: d ? null : 'undatable' }
  }
  try {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8' },
      redirect: 'follow',
    })
    clearTimeout(tid)
    if (!res.ok) {
      const d = extractDateFromUrlPath(url)
      return { publishedAt: d, source: d ? 'url-path' : 'none', httpStatus: res.status, error: `http ${res.status}` }
    }
    const html = (await res.text()).slice(0, 1_000_000)
    const ex = extractDateFromHtml(html) ?? { date: extractDateFromUrlPath(url), source: 'url-path' }
    return { publishedAt: ex.date, source: ex.date ? ex.source : 'none', httpStatus: res.status, error: null }
  } catch (err) {
    const d = extractDateFromUrlPath(url)
    return { publishedAt: d, source: d ? 'url-path' : 'none', httpStatus: null, error: String(err.message ?? err) }
  }
}

async function getCachedOrFetch(url) {
  const cached = await sql`
    SELECT url, published_at, source, http_status, error
      FROM culture_article_dates
     WHERE url = ${url} AND fetched_at >= NOW() - INTERVAL '7 days'
     LIMIT 1`
  if (cached.length) {
    const c = cached[0]
    return {
      publishedAt: c.published_at ? new Date(c.published_at) : null,
      source: c.source ?? 'none',
      httpStatus: c.http_status,
      error: c.error,
    }
  }
  const r = await fetchAndExtract(url)
  await sql`
    INSERT INTO culture_article_dates (url, published_at, source, http_status, error, fetched_at)
    VALUES (${url}, ${r.publishedAt ? r.publishedAt.toISOString() : null}, ${r.source}, ${r.httpStatus}, ${r.error}, NOW())
    ON CONFLICT (url) DO UPDATE SET
      published_at = EXCLUDED.published_at,
      source = EXCLUDED.source,
      http_status = EXCLUDED.http_status,
      error = EXCLUDED.error,
      fetched_at = NOW()`
  return r
}

async function verifyTrend(t) {
  const urls = (t.example_urls ?? []).filter(Boolean)
  const perUrl = []
  let newestMs = null
  let datable = 0
  for (const u of urls) {
    const r = await getCachedOrFetch(u)
    const ms = r.publishedAt ? r.publishedAt.getTime() : null
    perUrl.push({ url: u, ms, source: r.source, error: r.error })
    if (ms !== null) { datable++; if (newestMs === null || ms > newestMs) newestMs = ms }
  }
  let verdict
  if (datable === 0) verdict = 'inconclusive'
  else if (newestMs < cutoff.getTime()) verdict = 'stale'
  else verdict = 'fresh'
  return { id: t.id, name: t.name, verdict, newestMs, urls: perUrl }
}

// ── Main ──────────────────────────────────────────────────────────────────

const trends = await sql`
  SELECT id, name, example_urls
    FROM culture_trends
   WHERE status = 'active'
     AND (verify_verdict IS NULL OR verify_verdict != 'fabricated')
     AND example_urls IS NOT NULL
     AND array_length(example_urls, 1) > 0
   ORDER BY popularity_score DESC, first_seen_at DESC
   LIMIT ${limit}`

console.log(`[verify] scanning ${trends.length} trends\n`)

const stale = []
const fresh = []
const inconclusive = []

for (let i = 0; i < trends.length; i += concurrency) {
  const batch = trends.slice(i, i + concurrency)
  const verdicts = await Promise.all(batch.map(verifyTrend))
  for (const v of verdicts) {
    if (v.verdict === 'stale') stale.push(v)
    else if (v.verdict === 'fresh') fresh.push(v)
    else inconclusive.push(v)
    const daysOld = v.newestMs ? ((Date.now() - v.newestMs) / 86400000).toFixed(1) + 'd' : '—'
    console.log(`  ${v.verdict.padEnd(13)} ${String(daysOld).padStart(8)}  ${v.name.slice(0, 60)}`)
  }
}

console.log(`\n[verify] summary: ${fresh.length} fresh · ${stale.length} stale · ${inconclusive.length} inconclusive`)

if (apply && stale.length > 0) {
  console.log(`\n[verify] archiving ${stale.length} stale trends...`)
  for (const v of stale) {
    await sql`UPDATE culture_trends SET status='archived', updated_at=NOW() WHERE id=${v.id} AND status='active'`
  }
  console.log(`[verify] done`)
} else if (stale.length > 0) {
  console.log(`\n[verify] DRY RUN — would archive ${stale.length}. Run with: node scripts/verify-article-dates-local.mjs run ${limit}`)
}

if (stale.length > 0) {
  console.log(`\n[verify] stale trend examples:`)
  for (const v of stale.slice(0, 10)) {
    const ageStr = v.newestMs ? ((Date.now() - v.newestMs) / 86400000).toFixed(0) + 'd' : '?'
    console.log(`  ${v.name} (newest article ${ageStr} old)`)
    for (const u of v.urls.slice(0, 2)) {
      const uAge = u.ms ? ((Date.now() - u.ms) / 86400000).toFixed(0) + 'd' : 'undated'
      console.log(`    [${u.source}] ${uAge}  ${u.url.slice(0, 90)}`)
    }
  }
}
