/**
 * Daily Culture Radar report renderer.
 *
 * Generates a newsletter-style HTML report from the current state of the
 * culture_trends + culture_moments tables. Designed to feel like a daily
 * briefing email — clean typography, big sections, embedded thumbnails,
 * actionable content angles.
 *
 * Used by:
 *   - /culture-radar/report page (server-rendered, public, shareable)
 *   - /api/culture/report.html (raw HTML download for email forwarding)
 */

import { sql } from '@/lib/culture-db'
import { isoWeek } from '@/lib/culture-radar'
import { getTodaysCohort } from '@/lib/creator-radar'
import type { ActionBrief, CultureTrend, CultureMoment } from '@/types/culture'

interface CreatorForReport {
  handle: string
  platform: string
  profile_url: string | null
  name: string | null
  niche: string | null
  why_relevant: string | null
  follower_count: number | null
  country_relevance: string[] | null
  example_video_urls: string[] | null
  tags: string[] | null
  cohort_date: string
}

interface TrendForReport {
  id: string
  name: string
  description: string
  category: string
  popularity_score: number
  daily_rank: number | null
  weekly_rank: number | null
  hashtags: string[] | null
  example_urls: string[] | null
  thumbnail_url: string | null
  thumbnail_meta: { authorName?: string } | null
  brand_brief: ActionBrief | null
  source_names: string[] | null
  estimated_views: string | null
  country_relevance: string[] | null
  first_seen_at: string
  content_type: string | null
  mindmap: CultureTrend['mindmap']
}

interface MomentForReport {
  id: string
  name: string
  description: string
  category: string
  tier: string
  cultural_relevance: number
  country_dates: Array<{ country: string; date: string; localName?: string }>
  next_occurrence: string | null
  brand_brief: ActionBrief | null
  related_topics: CultureMoment['relatedTopics']
}

export interface ReportData {
  generatedAt: string
  week: string
  dailyTop10: TrendForReport[]
  weeklyTop20: TrendForReport[]
  inspiration: TrendForReport[]
  emerging: TrendForReport[]
  upcomingMoments: MomentForReport[]
  creators: CreatorForReport[]
}

export async function fetchReportData(): Promise<ReportData> {
  const week = isoWeek()

  const dailyTop10 = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap
       FROM culture_trends
      WHERE rank_week = $1 AND status = 'active' AND daily_rank IS NOT NULL
      ORDER BY daily_rank ASC LIMIT 10`,
    [week],
  )) as TrendForReport[]

  const weeklyTop20 = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap
       FROM culture_trends
      WHERE rank_week = $1 AND status = 'active' AND weekly_rank IS NOT NULL
        AND (daily_rank IS NULL OR daily_rank > 10)
      ORDER BY weekly_rank ASC LIMIT 20`,
    [week],
  )) as TrendForReport[]

  const inspiration = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap
       FROM culture_trends
      WHERE status = 'active'
        AND content_type IN ('format','meme','aesthetic','behavior')
        AND freshness_score >= 5
      ORDER BY first_seen_at DESC, popularity_score DESC
      LIMIT 8`,
  )) as TrendForReport[]

  const emerging = (await sql().query(
    `SELECT id, name, description, category, popularity_score, daily_rank,
            weekly_rank, hashtags, example_urls, thumbnail_url, thumbnail_meta,
            brand_brief, source_names, estimated_views, country_relevance,
            first_seen_at::TEXT AS first_seen_at, content_type, mindmap
       FROM culture_trends
      WHERE status = 'active' AND popularity_score < 7 AND freshness_score >= 7
      ORDER BY first_seen_at DESC LIMIT 6`,
  )) as TrendForReport[]

  const upcomingMoments = (await sql().query(
    `SELECT id, name, description, category, tier, cultural_relevance,
            country_dates, next_occurrence::TEXT AS next_occurrence,
            brand_brief, related_topics
       FROM culture_moments
      WHERE status <> 'archived'
        AND next_occurrence IS NOT NULL
        AND next_occurrence >= CURRENT_DATE
        AND next_occurrence <= CURRENT_DATE + INTERVAL '21 days'
      ORDER BY next_occurrence ASC, cultural_relevance DESC
      LIMIT 8`,
  )) as MomentForReport[]

  const creators = (await getTodaysCohort()) as CreatorForReport[]

  return {
    generatedAt: new Date().toISOString(),
    week,
    dailyTop10,
    weeklyTop20,
    inspiration,
    emerging,
    upcomingMoments,
    creators,
  }
}

// ── HTML rendering ──────────────────────────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  food: '🍴', beauty: '💄', fashion: '👗', home: '🏠', lifestyle: '✨',
  tech: '💻', meme: '😂', culture: '🎭', platform: '📱', sound: '🎵',
  sport: '⚽', festival: '🎪', religious: '🕊️', seasonal: '🌿',
  entertainment: '🎬', music: '🎤', celebrity: '⭐', product_launch: '📦',
  award_show: '🏆', political: '🏛️', pop_culture: '🌀', national: '🏳️',
  holiday: '🎉',
}

const CATEGORY_COLOR: Record<string, string> = {
  food: '#ea580c', beauty: '#db2777', fashion: '#9333ea', home: '#0891b2',
  lifestyle: '#ca8a04', tech: '#2563eb', meme: '#dc2626', culture: '#7c3aed',
  platform: '#16a34a', sound: '#0284c7',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// Cinematic full-bleed cover hero: tall image, gradient overlay, headline,
// kicker, and dek floating bottom-left. Falls back to a category-themed
// SVG poster when no thumbnail is available.
function renderCoverHero(t: TrendForReport): string {
  const color = CATEGORY_COLOR[t.category] ?? '#FF1300'
  const emoji = CATEGORY_EMOJI[t.category] ?? '🔥'
  const hasThumb = !!t.thumbnail_url

  // SVG poster: bold typographic placeholder when no real image
  const svgPoster = !hasThumb
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 800 480" preserveAspectRatio="xMidYMid slice" style="display:block;">
         <defs>
           <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
             <stop offset="0%" stop-color="${color}" stop-opacity="0.18"/>
             <stop offset="100%" stop-color="${color}" stop-opacity="0.55"/>
           </linearGradient>
         </defs>
         <rect width="800" height="480" fill="#000"/>
         <rect width="800" height="480" fill="url(#bg)"/>
         <g transform="rotate(-12 660 240)">
           <text x="660" y="280" text-anchor="middle" font-family="Archivo Black,sans-serif" font-size="320" fill="${color}" opacity="0.35">${emoji}</text>
         </g>
       </svg>`
    : ''

  return `
<tr>
  <td style="padding:28px 40px 40px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#000;border:1px solid #FF1300;">
      <tr>
        <td style="position:relative;padding:0;${hasThumb ? `background-image:linear-gradient(180deg,rgba(0,0,0,0.15) 0%,rgba(0,0,0,0.75) 75%,rgba(0,0,0,0.95) 100%),url(${escapeHtml(t.thumbnail_url!)});background-size:cover;background-position:center;` : ''}">
          <div style="${hasThumb ? 'min-height:420px;' : ''}">
            ${!hasThumb ? `<div style="position:relative;width:100%;height:420px;overflow:hidden;">${svgPoster}<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.2) 0%,rgba(0,0,0,0.85) 100%);"></div></div>` : ''}
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="${hasThumb ? 'position:absolute;bottom:0;left:0;right:0;' : 'margin-top:-280px;position:relative;'}">
              <tr>
                <td style="padding:24px 32px 28px;">
                  <p style="margin:0 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.25em;color:#FF1300;text-transform:uppercase;">★ TODAY'S #1 · ${escapeHtml(t.category).toUpperCase()}</p>
                  <h2 style="margin:8px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:54px;line-height:0.9;color:#FFFDF3;text-transform:uppercase;letter-spacing:-0.025em;max-width:90%;">${escapeHtml(t.name)}<span style="color:#FF1300;">.</span></h2>
                  <p style="margin:14px 0 0 0;font-family:'Newsreader',Georgia,serif;font-size:18px;line-height:1.45;color:#FFFDF3;opacity:0.92;font-weight:300;max-width:80%;">${escapeHtml(t.description.slice(0, 260))}${t.description.length > 260 ? '…' : ''}</p>
                  ${t.estimated_views ? `<p style="margin:14px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.12em;color:#FFFDF3;opacity:0.6;text-transform:uppercase;">📊 ${escapeHtml(t.estimated_views)}${t.hashtags && t.hashtags.length > 0 ? ` · ${escapeHtml(t.hashtags.slice(0, 3).join(' '))}` : ''}</p>` : ''}
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>`
}

function renderTrendCard(t: TrendForReport, opts: { showRank?: boolean } = {}): string {
  const emoji = CATEGORY_EMOJI[t.category] ?? '🔥'
  const color = CATEGORY_COLOR[t.category] ?? '#6b7280'
  const brief = t.brand_brief
  const countries = (t.country_relevance ?? []).slice(0, 4).join(' ')
  const videoUrls = (t.example_urls ?? []).filter(
    (u) => u.includes('tiktok.com') || u.includes('instagram.com') || u.includes('youtube.com'),
  )
  const otherUrls = (t.example_urls ?? []).filter(
    (u) => !videoUrls.includes(u),
  )

  return `
<tr><td style="padding:0 0 24px 0;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFDF3;border:1px solid #000;border-left:6px solid ${color};overflow:hidden;">
    <tr>
      ${t.thumbnail_url
        ? `<td width="180" valign="top" style="padding:0;background:#000;width:180px;">
            <img src="${escapeHtml(t.thumbnail_url)}" alt="" width="180" style="display:block;width:180px;height:180px;object-fit:cover;border:0;" />
          </td>`
        : `<td width="180" valign="middle" style="padding:0;background:#000;width:180px;height:180px;text-align:center;position:relative;">
            <table cellpadding="0" cellspacing="0" border="0" width="180" height="180" style="width:180px;height:180px;">
              <tr><td valign="middle" align="center" style="background-image:linear-gradient(135deg,${color}33 0%,${color}88 100%);width:180px;height:180px;">
                <div style="font-family:'Archivo Black',sans-serif;font-size:64px;line-height:1;color:#FFFDF3;opacity:0.4;">${emoji}</div>
                <p style="margin:6px 0 0 0;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.18em;color:#FFFDF3;text-transform:uppercase;">${escapeHtml(t.category)}</p>
              </td></tr>
            </table>
          </td>`}
      <td valign="top" style="padding:16px 18px;">
        ${opts.showRank && t.daily_rank ? `<span style="display:inline-block;background:#E3000F;color:#fff;font-weight:700;font-size:12px;padding:2px 8px;border-radius:99px;margin-right:6px;">#${t.daily_rank}</span>` : ''}
        <span style="display:inline-block;background:${color}15;color:${color};font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:3px 8px;border-radius:4px;margin-right:6px;">${emoji} ${escapeHtml(t.category)}</span>
        ${countries ? `<span style="font-size:10px;color:#6b7280;">${escapeHtml(countries)}</span>` : ''}
        <h3 style="margin:6px 0 4px 0;font-family:Georgia,serif;font-size:18px;color:#111827;line-height:1.3;">${escapeHtml(t.name)}</h3>
        <p style="margin:6px 0 0 0;font-size:13px;color:#374151;line-height:1.5;">${escapeHtml(t.description.slice(0, 280))}${t.description.length > 280 ? '…' : ''}</p>
        ${t.hashtags && t.hashtags.length > 0 ? `<p style="margin:6px 0 0 0;font-size:11px;color:#6b7280;">${escapeHtml(t.hashtags.slice(0, 5).join(' '))}</p>` : ''}
        ${t.estimated_views ? `<p style="margin:4px 0 0 0;font-size:11px;color:#9ca3af;">📊 ${escapeHtml(t.estimated_views)}</p>` : ''}
        ${brief ? `
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;background:#fafafa;border-radius:4px;">
            <tr>
              <td style="padding:10px 12px;">
                <p style="margin:0 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#FF1300;">Waarom voor Action</p>
                <p style="margin:0 0 10px 0;font-size:13px;color:#1f2937;line-height:1.5;">${escapeHtml(brief.actionRelevance)}</p>
                <p style="margin:0 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#000;">Content angle</p>
                <p style="margin:0 0 6px 0;font-size:12px;color:#374151;line-height:1.5;">${escapeHtml(brief.contentAngle)}</p>
                ${brief.suggestedSound ? `<p style="margin:0;font-size:11px;color:#6b7280;">♪ <strong>${brief.soundRisk === 'safe' ? '✓' : brief.soundRisk === 'risky' ? '⚠' : '?'}</strong> ${escapeHtml(brief.suggestedSound)}</p>` : ''}
                ${brief.productCategories && brief.productCategories.length > 0 ? `
                <p style="margin:8px 0 0 0;font-size:11px;">
                  ${brief.productCategories.map((c) => `<span style="display:inline-block;background:#fef2f2;color:#E3000F;border:1px solid #fecaca;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600;margin-right:4px;">${escapeHtml(c)}</span>`).join('')}
                </p>` : ''}
                <p style="margin:6px 0 0 0;font-size:10px;color:#9ca3af;">⏱️ urgentie ${brief.urgency}/10 · ${escapeHtml(brief.lifecycleStage)}</p>
              </td>
            </tr>
          </table>
        ` : ''}
        ${videoUrls.length > 0 || otherUrls.length > 0 ? `
          <p style="margin:10px 0 0 0;font-size:11px;">
            ${videoUrls.slice(0, 3).map((u) => `<a href="${escapeHtml(u)}" style="display:inline-block;background:#000;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-weight:600;margin-right:4px;margin-bottom:4px;">▶ ${u.includes('tiktok.com') ? 'TikTok' : u.includes('instagram.com') ? 'Reel' : 'YouTube'}</a>`).join('')}
            ${otherUrls.slice(0, 2).map((u) => `<a href="${escapeHtml(u)}" style="display:inline-block;background:#f3f4f6;color:#4a4f5c;padding:4px 10px;border-radius:4px;text-decoration:none;margin-right:4px;margin-bottom:4px;border:1px solid #e5e7eb;">📄 Article</a>`).join('')}
          </p>
        ` : ''}
        ${t.mindmap && (t.mindmap.origin?.length > 0 || t.mindmap.brandPlays?.length > 0) ? `
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:10px;border-top:1px dashed #e5e7eb;">
            <tr>
              <td style="padding:8px 0 0 0;">
                ${t.mindmap.origin && t.mindmap.origin.length > 0 ? `<p style="margin:0 0 4px 0;font-size:10px;color:#6b7280;"><strong style="color:#065f46;">🌱 Origin:</strong> ${escapeHtml(t.mindmap.origin[0].label)}${t.mindmap.origin[0].detail ? ' — ' + escapeHtml(t.mindmap.origin[0].detail.slice(0, 110)) : ''}</p>` : ''}
                ${t.mindmap.brandPlays && t.mindmap.brandPlays.length > 0 ? `<p style="margin:0;font-size:10px;color:#6b7280;"><strong style="color:#b91c1c;">💼 Brand plays:</strong> ${escapeHtml(t.mindmap.brandPlays[0].label)}${t.mindmap.brandPlays[0].detail ? ' — ' + escapeHtml(t.mindmap.brandPlays[0].detail.slice(0, 110)) : ''}</p>` : ''}
              </td>
            </tr>
          </table>
        ` : ''}
      </td>
    </tr>
  </table>
</td></tr>`
}

function renderCreatorCard(c: CreatorForReport): string {
  const platformBg = c.platform === 'tiktok' ? '#000' : c.platform === 'instagram' ? '#E1306C' : '#FF0000'
  const platformLabel = c.platform === 'tiktok' ? 'TT' : c.platform === 'instagram' ? 'IG' : 'YT'
  const followerStr = c.follower_count
    ? c.follower_count >= 1_000_000
      ? `${(c.follower_count / 1_000_000).toFixed(1)}M`
      : c.follower_count >= 1_000
        ? `${Math.round(c.follower_count / 1_000)}K`
        : String(c.follower_count)
    : ''
  const videos = (c.example_video_urls ?? []).slice(0, 2)

  return `
<td valign="top" style="padding:0 6px 12px 0;width:50%;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFDF3;border:1px solid #000;border-left:4px solid #FF1300;">
    <tr>
      <td style="padding:12px 14px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td valign="middle">
              <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:14px;color:#000;letter-spacing:-0.01em;">${c.profile_url ? `<a href="${escapeHtml(c.profile_url)}" style="color:#000;text-decoration:none;">@${escapeHtml(c.handle)}</a>` : `@${escapeHtml(c.handle)}`}</p>
              ${c.name && c.name.replace(/^@/, '') !== c.handle ? `<p style="margin:1px 0 0 0;font-family:'Inter',sans-serif;font-size:11px;color:#000;opacity:0.6;">${escapeHtml(c.name)}</p>` : ''}
            </td>
            <td valign="middle" align="right" width="80">
              <span style="display:inline-block;background:${platformBg};color:#FFFDF3;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.1em;padding:2px 6px;">${platformLabel}</span>
              ${followerStr ? `<span style="display:inline-block;font-family:'Archivo Black',sans-serif;font-size:11px;color:#FF1300;margin-left:4px;">${followerStr}</span>` : ''}
            </td>
          </tr>
        </table>
        ${c.niche ? `<p style="margin:6px 0 0 0;font-family:'Inter',sans-serif;font-size:12px;color:#000;line-height:1.4;">${escapeHtml(c.niche)}</p>` : ''}
        ${c.why_relevant ? `<p style="margin:6px 0 0 0;font-family:'Inter',sans-serif;font-size:11px;color:#000;line-height:1.4;background:#FFFDF3;border-left:2px solid #FF1300;padding:4px 8px;"><strong style="color:#FF1300;">WAAROM:</strong> ${escapeHtml(c.why_relevant)}</p>` : ''}
        ${(c.country_relevance && c.country_relevance.length > 0) || (c.tags && c.tags.length > 0) ? `
          <p style="margin:6px 0 0 0;font-family:'Inter',sans-serif;font-size:10px;color:#000;">
            ${(c.country_relevance ?? []).slice(0, 3).map((cc) => `<span style="display:inline-block;background:#000;color:#FFFDF3;padding:1px 6px;margin-right:3px;font-family:'Archivo Black',sans-serif;font-size:9px;">${escapeHtml(cc)}</span>`).join('')}
            ${(c.tags ?? []).slice(0, 3).map((t) => `<span style="display:inline-block;background:#FFFDF3;color:#000;border:1px solid #000;padding:1px 6px;margin-right:3px;font-size:9px;">${escapeHtml(t)}</span>`).join('')}
          </p>` : ''}
        ${videos.length > 0 ? `
          <p style="margin:8px 0 0 0;">
            ${videos.map((u) => `<a href="${escapeHtml(u)}" style="display:inline-block;background:#000;color:#FFFDF3;font-family:'Archivo Black',sans-serif;font-size:9px;letter-spacing:0.08em;padding:3px 7px;text-decoration:none;margin-right:3px;">▶ VIDEO</a>`).join('')}
          </p>` : ''}
      </td>
    </tr>
  </table>
</td>`
}

function renderMomentRow(m: MomentForReport): string {
  const date = m.next_occurrence ? new Date(m.next_occurrence) : null
  const daysUntil = date ? Math.ceil((date.getTime() - Date.now()) / 86_400_000) : 0
  const countries = (m.country_dates ?? []).map((c) => c.country).join(' ')
  const brief = m.brand_brief
  return `
<tr>
  <td width="60" valign="top" style="padding:10px 0;text-align:center;">
    <div style="background:#E3000F;color:#fff;border-radius:6px;padding:6px 4px;">
      <div style="font-size:18px;font-weight:700;line-height:1;">${date ? date.getDate() : '?'}</div>
      <div style="font-size:10px;text-transform:uppercase;margin-top:2px;">${date ? date.toLocaleDateString('en-GB', { month: 'short' }) : ''}</div>
      <div style="font-size:9px;margin-top:2px;opacity:0.85;">over ${daysUntil}d</div>
    </div>
  </td>
  <td valign="top" style="padding:10px 0 10px 12px;border-bottom:1px solid #f0f0f0;">
    <p style="margin:0;font-size:14px;font-weight:600;color:#111827;">${escapeHtml(m.name)}</p>
    <p style="margin:2px 0 0 0;font-size:11px;color:#6b7280;">${escapeHtml(m.category)} · ${escapeHtml(countries)}</p>
    <p style="margin:4px 0 0 0;font-size:12px;color:#374151;line-height:1.4;">${escapeHtml(m.description.slice(0, 180))}${m.description.length > 180 ? '…' : ''}</p>
    ${brief ? `<p style="margin:4px 0 0 0;font-size:11px;color:#4a4f5c;"><strong>Voor Action:</strong> ${escapeHtml(brief.contentAngle.slice(0, 200))}</p>` : ''}
  </td>
</tr>`
}

export function renderReportHtml(data: ReportData): string {
  const dateLabel = formatDate(data.generatedAt)
  const totalTrends = data.dailyTop10.length + data.weeklyTop20.length + data.inspiration.length + data.emerging.length

  // JackandAI brand palette
  // - Primary red: #FF1300
  // - Black: #000000
  // - Cream: #FFFDF3
  // Fonts: Benzin-style display (Archivo Black as approximation) + clean sans (Inter)

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Culture Radar Daily — ${dateLabel}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  body { margin: 0; padding: 0; background: #FFFDF3; font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #000000; }
  h1, h2, h3 { font-family: 'Archivo Black', 'Archivo', sans-serif; letter-spacing: -0.01em; }
  a { color: inherit; }
  .display { font-family: 'Archivo Black', sans-serif; }
  @media print {
    body { background: #FFFDF3; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#FFFDF3;font-family:'Inter',sans-serif;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFDF3;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table cellpadding="0" cellspacing="0" border="0" width="760" style="max-width:760px;background:#FFFDF3;">
        <!-- Magazine cover: hero trend image + branded headline -->
        <tr>
          <td style="padding:0;background:#000000;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="padding:32px 40px 16px;color:#FFFDF3;">
                  <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#FF1300;">JACK&amp;A!  ×  ACTION  ·  ISSUE ${data.week}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:0 40px 8px;color:#FFFDF3;">
                  <h1 style="margin:0;font-family:'Archivo Black',sans-serif;font-size:88px;line-height:0.88;font-weight:900;text-transform:uppercase;letter-spacing:-0.035em;color:#FFFDF3;">Culture<br/>Radar<span style="color:#FF1300;">.</span></h1>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 40px 0;">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td valign="middle" style="border-top:1px solid #FFFDF3;padding-top:14px;">
                        <p style="margin:0;font-family:'Newsreader',Georgia,serif;font-size:18px;color:#FFFDF3;font-style:italic;font-weight:300;">${dateLabel}</p>
                      </td>
                      <td valign="middle" align="right" style="border-top:1px solid #FFFDF3;padding-top:14px;">
                        <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.18em;color:#FF1300;text-transform:uppercase;">${totalTrends} trends · ${data.upcomingMoments.length} moments · ${data.creators.length} creators</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              ${data.dailyTop10[0] ? renderCoverHero(data.dailyTop10[0]) : ''}
            </table>
          </td>
        </tr>
        <!-- Red accent strip -->
        <tr><td style="background:#FF1300;height:6px;line-height:0;font-size:0;">&nbsp;</td></tr>

        <!-- Editor's note — magazine-style intro -->
        <tr>
          <td style="padding:40px 40px 16px;background:#FFFDF3;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td width="180" valign="top">
                  <p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.2em;color:#FF1300;text-transform:uppercase;">FROM THE EDITOR</p>
                  <p style="margin:8px 0 0 0;font-family:'Newsreader',Georgia,serif;font-size:14px;color:#000;font-style:italic;font-weight:300;">${new Date(data.generatedAt).toLocaleDateString('nl-NL', { weekday: 'long' })}<br/>${data.week}</p>
                </td>
                <td valign="top" style="padding-left:24px;border-left:2px solid #000;">
                  <p style="margin:0;font-family:'Newsreader',Georgia,serif;font-size:18px;line-height:1.55;color:#000;font-weight:400;">
                    Vandaag staan er <strong>${data.dailyTop10.length} trends</strong> bovenaan, <strong>${data.inspiration.length} formats</strong> om direct over te nemen, <strong>${data.emerging.length} signalen</strong> die nog klein zijn maar snel stijgen, <strong>${data.creators.length} creators</strong> om te volgen, en <strong>${data.upcomingMoments.length} moments</strong> die in de komende drie weken vallen.
                  </p>
                  <p style="margin:12px 0 0 0;font-family:'Inter',sans-serif;font-size:12px;color:#6b6b6b;">
                    Klik op een trend om de bron te openen. Sounds met <strong style="color:#FF1300;">✓ SAFE</strong> zijn rechtenvrij te gebruiken op Action's TikTok Business Account.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- DAILY TOP 10 -->
        <tr>
          <td style="padding:40px 40px 8px;background:#FFFDF3;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#FF1300;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">01</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Today's Top ${data.dailyTop10.length}</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">🔥 What's hot<br/><span style="color:#FF1300;">right now.</span></h2>
            <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">De trends die Action's team vandaag moet kennen.</p>
          </td>
        </tr>
        <tr><td style="padding:0 40px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${data.dailyTop10.map((t) => renderTrendCard(t, { showRank: true })).join('')}
          </table>
        </td></tr>

        ${data.inspiration.length > 0 ? `
        <!-- INSPIRATION -->
        <tr><td style="background:#FFFDF3;height:32px;"></td></tr>
        <tr>
          <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#000;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">02</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Inspiration formats</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">💡 Steal these<br/><span style="color:#FF1300;">formats.</span></h2>
            <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Manieren om content te MAKEN: edit-tricks, visuele signaturen, format-templates.</p>
          </td>
        </tr>
        <tr><td style="padding:0 40px;background:#FFFDF3;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${data.inspiration.map((t) => renderTrendCard(t)).join('')}
          </table>
        </td></tr>` : ''}

        ${data.emerging.length > 0 ? `
        <!-- EMERGING -->
        <tr><td style="background:#FFFDF3;height:32px;"></td></tr>
        <tr>
          <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#000;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">03</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Emerging signals</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">✨ Get in<br/><span style="color:#FF1300;">early.</span></h2>
            <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Klein maar stijgend: claim de trend voor hij mainstream wordt.</p>
          </td>
        </tr>
        <tr><td style="padding:0 40px;background:#FFFDF3;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${data.emerging.map((t) => renderTrendCard(t)).join('')}
          </table>
        </td></tr>` : ''}

        ${data.creators.length > 0 ? `
        <!-- CREATORS — 25 of the day -->
        <tr><td style="background:#FFFDF3;height:32px;"></td></tr>
        <tr>
          <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#000;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">04</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">${data.creators.length} creators of the day</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">📺 New creators<br/><span style="color:#FF1300;">to watch.</span></h2>
            <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Niche creators, elke dag gerouleerd vanuit een andere invalshoek. Vandaag ${data.creators.length} nieuwe namen.</p>
          </td>
        </tr>
        <tr><td style="padding:0 40px;background:#FFFDF3;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${(() => {
              // Render as 2-col grid: 2 creators per <tr>
              const rows: string[] = []
              for (let i = 0; i < data.creators.length; i += 2) {
                rows.push(
                  `<tr>${renderCreatorCard(data.creators[i])}${
                    data.creators[i + 1] ? renderCreatorCard(data.creators[i + 1]) : '<td style="width:50%"></td>'
                  }</tr>`,
                )
              }
              return rows.join('')
            })()}
          </table>
        </td></tr>` : ''}

        ${data.upcomingMoments.length > 0 ? `
        <!-- MOMENTS -->
        <tr><td style="background:#FFFDF3;height:32px;"></td></tr>
        <tr>
          <td style="padding:24px 40px 8px;background:#FFFDF3;border-top:2px solid #000;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#FF1300;color:#FFFDF3;padding:4px 10px;font-family:'Archivo Black',sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:900;">05</td>
                <td width="12">&nbsp;</td>
                <td><p style="margin:0;font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#000;">Upcoming moments</p></td>
              </tr>
            </table>
            <h2 style="margin:14px 0 4px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:1.05;color:#000;text-transform:uppercase;letter-spacing:-0.02em;">📅 Coming<br/><span style="color:#FF1300;">next 3 weeks.</span></h2>
            <p style="margin:8px 0 18px 0;font-family:'Inter',sans-serif;font-size:13px;color:#000;opacity:0.7;">Bouw campagnes en content rond deze momenten.</p>
          </td>
        </tr>
        <tr><td style="padding:0 40px 40px;background:#FFFDF3;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${data.upcomingMoments.map(renderMomentRow).join('')}
          </table>
        </td></tr>` : ''}

        <!-- Footer in JackandAI black -->
        <tr>
          <td style="padding:40px 40px;background:#000000;text-align:center;">
            <p style="margin:0 0 12px 0;font-family:'Archivo Black',sans-serif;font-size:32px;line-height:0.95;letter-spacing:-0.02em;color:#FFFDF3;text-transform:uppercase;">Jack<span style="color:#FF1300;">&amp;</span>A<span style="color:#FF1300;">!</span></p>
            <p style="margin:0 0 4px 0;font-family:'Inter',sans-serif;font-size:11px;color:#FFFDF3;opacity:0.5;">Samengesteld op ${new Date(data.generatedAt).toLocaleString('nl-NL')} · Dagelijkse briefing van je AI agency</p>
            <p style="margin:12px 0 0 0;font-family:'Inter',sans-serif;font-size:12px;">
              <a href="https://action-culture-radar.vercel.app/culture-radar" style="color:#FF1300;text-decoration:none;font-weight:700;">→ Live dashboard</a>
              <span style="color:#FFFDF3;opacity:0.3;">&nbsp;·&nbsp;</span>
              <a href="https://action-culture-radar.vercel.app/moments-radar" style="color:#FF1300;text-decoration:none;font-weight:700;">→ Moments Radar</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}
