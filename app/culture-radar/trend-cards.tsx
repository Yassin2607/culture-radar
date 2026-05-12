'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { CultureTrend } from '@/types/culture'
import { TrendVisual, paletteFor } from './trend-visual'
import { computeMomentum } from '@/lib/trend-momentum'

// Extended trend type with optional bundle variants
type TrendWithVariants = CultureTrend & { bundleVariants?: CultureTrend[] }

// ── Momentum pill ─────────────────────────────────────────────────────────

function MomentumPill({ trend, size = 'sm' }: { trend: CultureTrend; size?: 'sm' | 'md' }) {
  const m = computeMomentum(trend.firstSeenAt, trend.popularityScore)
  const isSmall = size === 'sm'
  return (
    <span
      title={`${m.label} · pop ${trend.popularityScore}/10`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontFamily: 'var(--font-jai-display)',
        fontSize: isSmall ? 9 : 10,
        letterSpacing: '0.1em',
        padding: isSmall ? '2px 6px' : '3px 8px',
        background: m.color === '#FF1300' ? '#FFE4E0' : '#F5F5F5',
        color: m.color,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: isSmall ? 11 : 13, lineHeight: 1 }}>{m.arrow}</span>
      {m.label}
    </span>
  )
}

// ── Stacked variant badge (visual cluster signal) ─────────────────────────

function StackedVariants({ variants, position = 'top-right' }: {
  variants?: CultureTrend[]
  position?: 'top-right' | 'inline'
}) {
  if (!variants || variants.length === 0) return null
  const count = variants.length
  const stackStyle: React.CSSProperties = position === 'top-right'
    ? { position: 'absolute', top: 8, right: 44, zIndex: 2 }
    : { position: 'relative', display: 'inline-block', marginLeft: 8 }

  return (
    <span style={stackStyle} title={`${count} variants: ${variants.slice(0, 5).map((v) => v.name).join(', ')}`}>
      {/* Stacked card shadows */}
      <span style={{ position: 'absolute', top: 4, left: 4, width: 38, height: 26, background: '#00000022', border: '1px solid #00000010' }} />
      <span style={{ position: 'absolute', top: 2, left: 2, width: 38, height: 26, background: '#FFFDF3', border: '1px solid #00000020' }} />
      <span
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 38,
          height: 26,
          background: '#FF1300',
          color: '#FFFDF3',
          fontFamily: 'var(--font-jai-display)',
          fontSize: 11,
          letterSpacing: '0.05em',
        }}
      >
        +{count}
      </span>
    </span>
  )
}

function VariantsChips({ variants }: { variants?: CultureTrend[] }) {
  if (!variants || variants.length === 0) return null
  return (
    <div style={{ marginTop: 10, padding: '8px 10px', background: '#FAF6E6', border: '1px solid #00000010' }}>
      <p className="jai-mono-label" style={{ margin: 0, fontSize: 9, color: '#FF1300' }}>
        ALSO TRENDING AS · {variants.length} VARIANTS
      </p>
      <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#1a1a1a', lineHeight: 1.4 }}>
        {variants.slice(0, 8).map((v) => v.name).join(' · ')}
      </p>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (diffDays === 0) {
    const h = Math.floor((Date.now() - date.getTime()) / 3_600_000)
    return h < 1 ? 'just now' : `${h}h ago`
  }
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 28) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function classifyUrl(url: string) {
  const lower = url.toLowerCase()
  if (lower.includes('tiktok.com')) return { label: '▶ TikTok', bg: '#000', fg: '#FFFDF3' }
  if (lower.includes('instagram.com')) return { label: '◯ Reel', bg: '#E1306C', fg: '#FFFDF3' }
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return { label: '▶ YouTube', bg: '#FF0000', fg: '#FFFDF3' }
  if (lower.includes('reddit.com')) return { label: 'Reddit', bg: '#FF4500', fg: '#FFFDF3' }
  if (lower.includes('pinterest.com')) return { label: 'Pinterest', bg: '#E60023', fg: '#FFFDF3' }
  return { label: 'Article', bg: '#000', fg: '#FFFDF3' }
}

function sortUrls(urls: string[]): string[] {
  const score = (u: string) => {
    const l = u.toLowerCase()
    if (l.includes('tiktok.com')) return 1
    if (l.includes('instagram.com')) return 2
    if (l.includes('youtube.com') || l.includes('youtu.be')) return 3
    return 9
  }
  return [...urls].sort((a, b) => score(a) - score(b))
}

// ── Feedback shared widget ─────────────────────────────────────────────────

function useFeedback(trendId: string) {
  const [state, setState] = useState<'idle' | 'useful' | 'generic' | 'archived'>('idle')
  const send = async (action: 'useful' | 'generic' | 'archive') => {
    setState(action === 'archive' ? 'archived' : action)
    try {
      await apiFetch('/api/culture/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trendId, action }),
      })
    } catch {
      /* best-effort */
    }
  }
  return { state, send }
}

function FeedbackRow({ trend, state, send }: { trend: CultureTrend; state: string; send: (a: 'useful' | 'generic' | 'archive') => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderTop: '1px solid #00000010',
        background: '#FFFDF3',
        fontSize: 11,
      }}
    >
      <div style={{ color: '#9ca3af' }}>
        {trend.feedbackUseful > 0 && <span style={{ color: '#047857', marginRight: 8 }}>👍 {trend.feedbackUseful}</span>}
        {trend.feedbackGeneric > 0 && <span style={{ color: '#92400e' }}>👎 {trend.feedbackGeneric}</span>}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['useful', 'generic', 'archive'] as const).map((a) => (
          <button
            key={a}
            onClick={() => send(a)}
            style={{
              fontFamily: 'var(--font-jai-display)',
              fontSize: 9,
              letterSpacing: '0.1em',
              padding: '4px 8px',
              background: state === a ? '#000' : 'transparent',
              color: state === a ? '#FFFDF3' : '#1a1a1a',
              border: '1px solid #00000020',
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            {a === 'useful' ? '👍 Useful' : a === 'generic' ? '👎 Generic' : '🚫 Archive'}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── HERO trend (#1) — full-bleed visual, massive headline, brief inline ────

export function HeroTrend({ trend }: { trend: TrendWithVariants }) {
  const { state, send } = useFeedback(trend.id)
  const [expanded, setExpanded] = useState(true)
  const pal = paletteFor(trend.category)
  const brief = trend.brandBrief

  if (state === 'archived') return null

  return (
    <article className="jai-card jai-card-hover" style={{ marginBottom: 32, overflow: 'hidden' }}>
      <div style={{ position: 'relative' }}>
        <TrendVisual trend={trend} size="hero" />
        {/* Gradient overlay + headline if real thumbnail */}
        {trend.thumbnailUrl && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 100%)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: 32,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <span style={{ background: '#FF1300', color: '#FFFDF3', padding: '4px 12px', fontFamily: 'var(--font-jai-display)', fontSize: 11, letterSpacing: '0.15em' }}>
                #1
              </span>
              <span style={{ background: '#000', color: '#FFFDF3', padding: '4px 10px', fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                {pal.bg && `${trend.category}`}
              </span>
              <MomentumPill trend={trend} size="md" />
            </div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-jai-display)', fontSize: 44, color: '#FFFDF3', lineHeight: 0.95, textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
              {trend.name}
            </h2>
          </div>
        )}
        {/* Rank badge if SVG poster (visible regardless of overlay) */}
        {!trend.thumbnailUrl && (
          <div style={{ position: 'absolute', top: 16, right: 16, background: '#FF1300', color: '#FFFDF3', padding: '6px 14px', fontFamily: 'var(--font-jai-display)', fontSize: 13, letterSpacing: '0.15em' }}>
            #1 TODAY
          </div>
        )}
        <StackedVariants variants={trend.bundleVariants} />
        {/* Collapse toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
          style={{
            position: 'absolute', top: 16, right: trend.thumbnailUrl ? 16 : 130,
            background: '#FFFDF3', color: '#000', border: '1px solid #00000020',
            width: 32, height: 32, cursor: 'pointer',
            fontFamily: 'var(--font-jai-display)', fontSize: 14, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '−' : '+'}
        </button>
      </div>

      {!expanded && (
        <div style={{ padding: '16px 28px 20px' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#1a1a1a', lineHeight: 1.4 }}>
            {trend.description.slice(0, 200)}{trend.description.length > 200 ? '…' : ''}
          </p>
          <p style={{ margin: '8px 0 0 0', fontSize: 11, color: '#9ca3af' }}>
            {trend.sourceNames.slice(0, 2).join(' · ')}
            {trend.firstSeenAt ? ` · added ${formatRelative(trend.firstSeenAt)}` : ''}
          </p>
        </div>
      )}

      {expanded && (
      <>
      {/* Description + brief in 2 columns */}
      <div style={{ padding: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        <div>
          <p className="jai-mono-label" style={{ color: '#FF1300', margin: 0 }}>The signal</p>
          <p className="jai-serif" style={{ margin: '8px 0 0 0', fontSize: 18, lineHeight: 1.4, color: '#1a1a1a' }}>
            {trend.description}
          </p>
          {trend.hashtags.length > 0 && (
            <p style={{ margin: '12px 0 0 0', fontSize: 12, color: '#6b6b6b' }}>{trend.hashtags.slice(0, 8).join(' ')}</p>
          )}
          <VariantsChips variants={trend.bundleVariants} />
          <p style={{ margin: '16px 0 0 0', fontSize: 11, color: '#9ca3af' }}>
            {trend.sourceNames.slice(0, 2).join(' · ')}
            {trend.estimatedViews ? ` · ${trend.estimatedViews}` : ''}
            {trend.firstSeenAt ? ` · added ${formatRelative(trend.firstSeenAt)}` : ''}
          </p>
        </div>

        {brief && (
          <div style={{ background: '#000', color: '#FFFDF3', padding: 20 }}>
            <p className="jai-mono-label" style={{ color: '#FF1300', margin: 0 }}>For Action</p>
            <p style={{ margin: '6px 0 16px 0', fontSize: 15, lineHeight: 1.4 }}>{brief.actionRelevance}</p>

            <p className="jai-mono-label" style={{ color: '#FFFDF3', margin: 0 }}>Content angle</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 13, lineHeight: 1.45, opacity: 0.92 }}>{brief.contentAngle}</p>

            {brief.suggestedSound && (
              <div style={{ marginTop: 14, padding: 12, background: brief.soundRisk === 'safe' ? '#FF1300' : '#1a1a1a', border: brief.soundRisk === 'safe' ? 'none' : '1px solid #FF1300' }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.15em', color: '#FFFDF3' }}>
                  ♪ SOUND · {brief.soundRisk === 'safe' ? '✓ SAFE' : brief.soundRisk === 'risky' ? '⚠ RISKY' : '? CHECK'}
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#FFFDF3', lineHeight: 1.4 }}>
                  {brief.suggestedSound}
                </p>
              </div>
            )}

            {brief.productCategories && brief.productCategories.length > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {brief.productCategories.map((c) => (
                  <span key={c} style={{ background: '#FFFDF3', color: '#1a1a1a', padding: '3px 8px', fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mindmap expanded by default for hero */}
      {trend.mindmap && <MindmapExpanded mindmap={trend.mindmap} centerLabel={trend.name} />}

      {/* URL chips + feedback */}
      {trend.exampleUrls.length > 0 && (
        <div style={{ padding: '0 28px 16px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {sortUrls(trend.exampleUrls).slice(0, 5).map((url, i) => {
            const c = classifyUrl(url)
            return (
              <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer" style={{
                fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.1em',
                padding: '6px 12px', background: c.bg, color: c.fg, textDecoration: 'none',
              }}>
                {c.label}
              </a>
            )
          })}
        </div>
      )}
      </>
      )}

      <FeedbackRow trend={trend} state={state} send={send} />
    </article>
  )
}

// ── Featured trend (#2-3) — medium card 2-up ───────────────────────────────

export function FeaturedTrend({ trend }: { trend: TrendWithVariants }) {
  const { state, send } = useFeedback(trend.id)
  const [expanded, setExpanded] = useState(false)
  const brief = trend.brandBrief

  if (state === 'archived') return null

  return (
    <article className="jai-card jai-card-hover" style={{ overflow: 'hidden' }}>
      <div style={{ position: 'relative' }}>
        <TrendVisual trend={trend} size="medium" />
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ background: '#000', color: '#FFFDF3', padding: '3px 10px', fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.15em' }}>
            #{trend.dailyRank}
          </span>
          <MomentumPill trend={trend} />
        </div>
        <StackedVariants variants={trend.bundleVariants} />
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: '#FFFDF3', color: '#000', border: '1px solid #00000020',
            width: 28, height: 28, cursor: 'pointer',
            fontFamily: 'var(--font-jai-display)', fontSize: 13, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '−' : '+'}
        </button>
      </div>
      <div style={{ padding: 18 }}>
        <p className="jai-mono-label" style={{ color: '#FF1300', margin: 0 }}>{trend.category}</p>
        <h3 style={{ margin: '4px 0 8px 0', fontFamily: 'var(--font-jai-display)', fontSize: 20, lineHeight: 1.05, color: '#000', textTransform: 'uppercase', letterSpacing: '-0.01em' }}>
          {trend.name}
        </h3>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: '#1a1a1a' }}>
          {expanded ? trend.description : `${trend.description.slice(0, 180)}${trend.description.length > 180 ? '…' : ''}`}
        </p>
        <VariantsChips variants={trend.bundleVariants} />
        {brief && (
          <div style={{ marginTop: 12, padding: 10, background: '#FAF6E6', borderLeft: '3px solid #FF1300' }}>
            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.4 }}>
              <strong style={{ fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.12em', color: '#FF1300' }}>FOR ACTION</strong>
              <br />
              {expanded ? brief.actionRelevance : `${brief.actionRelevance.slice(0, 140)}${brief.actionRelevance.length > 140 ? '…' : ''}`}
            </p>
            {expanded && brief.contentAngle && (
              <p style={{ margin: '8px 0 0 0', fontSize: 11, lineHeight: 1.4 }}>
                <strong style={{ fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.12em', color: '#000' }}>ANGLE</strong>
                <br />
                {brief.contentAngle}
              </p>
            )}
            {expanded && brief.suggestedSound && (
              <p style={{ margin: '8px 0 0 0', fontSize: 11, lineHeight: 1.4 }}>
                <strong style={{ fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.12em', color: '#000' }}>
                  ♪ SOUND {brief.soundRisk === 'safe' ? '· ✓ SAFE' : brief.soundRisk === 'risky' ? '· ⚠ RISKY' : ''}
                </strong>
                <br />
                {brief.suggestedSound}
              </p>
            )}
          </div>
        )}
        {trend.mindmap && <MindmapCompact mindmap={trend.mindmap} centerLabel={trend.name} />}
        {trend.exampleUrls.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {sortUrls(trend.exampleUrls).slice(0, expanded ? 8 : 3).map((url, i) => {
              const c = classifyUrl(url)
              return (
                <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer" style={{
                  fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em',
                  padding: '4px 8px', background: c.bg, color: c.fg, textDecoration: 'none',
                }}>
                  {c.label}
                </a>
              )
            })}
          </div>
        )}
      </div>
      <FeedbackRow trend={trend} state={state} send={send} />
    </article>
  )
}

// ── Compact row (#4+) — slim horizontal row ────────────────────────────────

export function CompactTrend({ trend }: { trend: TrendWithVariants }) {
  const { state, send } = useFeedback(trend.id)
  const [expanded, setExpanded] = useState(false)
  const brief = trend.brandBrief

  if (state === 'archived') return null

  return (
    <article
      className="jai-card jai-card-hover"
      style={{ marginBottom: 8, overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', gap: 0 }}>
        <div style={{ flexShrink: 0, width: 100 }}>
          <TrendVisual trend={trend} size="compact" />
        </div>
        <div
          onClick={() => setExpanded((v) => !v)}
          style={{ flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {trend.dailyRank && (
              <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 14, color: '#FF1300', letterSpacing: '-0.02em' }}>
                #{trend.dailyRank}
              </span>
            )}
            <p className="jai-mono-label" style={{ color: '#6b6b6b', margin: 0, fontSize: 9 }}>{trend.category}</p>
            <MomentumPill trend={trend} />
            {trend.bundleVariants && trend.bundleVariants.length > 0 && (
              <span
                title={trend.bundleVariants.map((v) => v.name).join(', ')}
                style={{
                  fontFamily: 'var(--font-jai-display)',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  padding: '2px 6px',
                  background: '#FF1300',
                  color: '#FFFDF3',
                }}
              >
                +{trend.bundleVariants.length} VARIANTS
              </span>
            )}
            {trend.feedbackUseful > 0 && <span style={{ fontSize: 10, color: '#047857' }}>👍 {trend.feedbackUseful}</span>}
          </div>
          <h4 style={{ margin: '4px 0 2px 0', fontFamily: 'var(--font-jai-display)', fontSize: 16, lineHeight: 1.1, color: '#000', textTransform: 'uppercase', letterSpacing: '-0.01em' }}>
            {trend.name}
          </h4>
          <p style={{ margin: 0, fontSize: 12, color: '#4a4a4a', lineHeight: 1.4 }}>
            {expanded ? trend.description : `${trend.description.slice(0, 160)}${trend.description.length > 160 ? '…' : ''}`}
          </p>
          {expanded && trend.bundleVariants && trend.bundleVariants.length > 0 && (
            <p style={{ margin: '4px 0 0 0', fontSize: 10, color: '#6b6b6b' }}>
              {trend.bundleVariants.map((v) => v.name).join(' · ')}
            </p>
          )}
          {brief?.contentAngle && !expanded && (
            <p style={{ margin: '4px 0 0 0', fontSize: 11, color: '#1a1a1a' }}>
              <strong style={{ color: '#FF1300', fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em' }}>ANGLE: </strong>
              {brief.contentAngle.slice(0, 140)}
            </p>
          )}
          {!expanded && trend.mindmap && <MindmapTeaser mindmap={trend.mindmap} />}
        </div>
        <div style={{ flexShrink: 0, padding: '12px 16px', borderLeft: '1px solid #00000010', display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center', minWidth: 110 }}>
          {trend.exampleUrls.slice(0, 2).map((url, i) => {
            const c = classifyUrl(url)
            return (
              <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer" style={{
                fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em',
                padding: '3px 6px', background: c.bg, color: c.fg, textDecoration: 'none', textAlign: 'center',
              }}>
                {c.label}
              </a>
            )
          })}
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse' : 'Expand'}
            style={{
              background: '#FFFDF3', color: '#000', border: '1px solid #00000020',
              fontFamily: 'var(--font-jai-display)', fontSize: 11, padding: '3px 6px',
              cursor: 'pointer', textAlign: 'center', letterSpacing: '0.1em',
            }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '− CLOSE' : '+ MORE'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #00000010', padding: '14px 16px 16px', background: '#FFFDF3' }}>
          {brief && (
            <div style={{ marginBottom: 12 }}>
              <p className="jai-mono-label" style={{ color: '#FF1300', margin: 0, fontSize: 10 }}>FOR ACTION</p>
              <p style={{ margin: '4px 0 0 0', fontSize: 12, lineHeight: 1.45, color: '#1a1a1a' }}>{brief.actionRelevance}</p>

              {brief.contentAngle && (
                <>
                  <p className="jai-mono-label" style={{ color: '#000', margin: '10px 0 0 0', fontSize: 10 }}>CONTENT ANGLE</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, lineHeight: 1.45, color: '#1a1a1a' }}>{brief.contentAngle}</p>
                </>
              )}

              {brief.suggestedSound && (
                <>
                  <p className="jai-mono-label" style={{ color: '#000', margin: '10px 0 0 0', fontSize: 10 }}>
                    ♪ SOUND {brief.soundRisk === 'safe' ? '· ✓ SAFE' : brief.soundRisk === 'risky' ? '· ⚠ RISKY' : ''}
                  </p>
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, lineHeight: 1.45, color: '#1a1a1a' }}>{brief.suggestedSound}</p>
                </>
              )}

              {brief.productCategories && brief.productCategories.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {brief.productCategories.map((c) => (
                    <span key={c} style={{ background: '#000', color: '#FFFDF3', padding: '3px 8px', fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {trend.mindmap && <MindmapCompact mindmap={trend.mindmap} centerLabel={trend.name} />}

          {trend.exampleUrls.length > 2 && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {sortUrls(trend.exampleUrls).slice(0, 8).map((url, i) => {
                const c = classifyUrl(url)
                return (
                  <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer" style={{
                    fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em',
                    padding: '4px 8px', background: c.bg, color: c.fg, textDecoration: 'none',
                  }}>
                    {c.label}
                  </a>
                )
              })}
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <FeedbackRow trend={trend} state={state} send={send} />
          </div>
        </div>
      )}
    </article>
  )
}

// ── Mindmap teaser (one-line preview for Compact rows) ────────────────────

function MindmapTeaser({ mindmap }: { mindmap: NonNullable<CultureTrend['mindmap']> }) {
  // Pick the first non-empty section, prefer origin > spreading > adjacent
  const order: Array<{ key: keyof typeof mindmap; label: string }> = [
    { key: 'origin', label: 'ORIGIN' },
    { key: 'spreading', label: 'SPREADING' },
    { key: 'adjacent', label: 'ADJACENT' },
    { key: 'brandPlays', label: 'BRAND PLAYS' },
    { key: 'variations', label: 'VARIATIONS' },
    { key: 'searches', label: 'SEARCHES' },
  ]
  const picked = order.find((o) => (mindmap[o.key] ?? []).length > 0)
  if (!picked) return null
  const first = mindmap[picked.key]![0]
  const count = Object.values(mindmap).reduce((sum, arr) => sum + arr.length, 0)

  return (
    <p style={{ margin: '4px 0 0 0', fontSize: 10, color: '#6b6b6b', lineHeight: 1.4 }}>
      <strong style={{ fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em', color: '#000' }}>
        🧠 {picked.label}:{' '}
      </strong>
      <span style={{ color: '#1a1a1a' }}>{first.label}</span>
      {first.detail && <span> — {first.detail.slice(0, 80)}</span>}
      {count > 1 && <span style={{ color: '#9ca3af' }}> · +{count - 1} more</span>}
    </p>
  )
}

// ── Mindmap compact (inline reveal for Featured/Compact) ──────────────────

function MindmapCompact({ mindmap, centerLabel }: {
  mindmap: NonNullable<CultureTrend['mindmap']>
  centerLabel?: string
}) {
  const sections: Array<{ key: keyof typeof mindmap; label: string; emoji: string }> = [
    { key: 'origin', label: 'Origin', emoji: '🌱' },
    { key: 'spreading', label: 'Spreading', emoji: '📡' },
    { key: 'adjacent', label: 'Adjacent', emoji: '🔗' },
    { key: 'variations', label: 'Variations', emoji: '🌀' },
    { key: 'searches', label: 'Searches', emoji: '🔍' },
    { key: 'brandPlays', label: 'Brand plays', emoji: '💼' },
  ]
  const nonEmpty = sections.filter((s) => (mindmap[s.key] ?? []).length > 0)
  if (nonEmpty.length === 0) return null

  return (
    <div style={{ marginTop: 12, padding: 10, background: '#FFF7E0', border: '1px solid #00000010' }}>
      <p className="jai-mono-label" style={{ color: '#000', margin: 0, fontSize: 10 }}>
        🧠 CONTEXT &amp; CONNECTIONS
      </p>
      {centerLabel && <MindmapGraph mindmap={mindmap} centerLabel={centerLabel} />}
      {!centerLabel && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 8 }}>
          {nonEmpty.map((s) => (
            <div key={s.key} style={{ borderLeft: '2px solid #000', paddingLeft: 8 }}>
              <p className="jai-mono-label" style={{ margin: 0, fontSize: 9, color: '#000' }}>
                {s.emoji} {s.label}
              </p>
              <ul style={{ margin: '4px 0 0 0', padding: 0, listStyle: 'none' }}>
                {(mindmap[s.key] ?? []).slice(0, 3).map((it, i) => (
                  <li key={i} style={{ fontSize: 11, lineHeight: 1.35, marginBottom: 2, color: '#1a1a1a' }}>
                    <strong>{it.label}</strong>
                    {it.detail && <span style={{ color: '#6b6b6b' }}> — {it.detail.slice(0, 90)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Mindmap (radial node graph for hero, with bullet list below) ──────────

function MindmapExpanded({ mindmap, centerLabel }: {
  mindmap: NonNullable<CultureTrend['mindmap']>
  centerLabel: string
}) {
  return (
    <div style={{ padding: '0 28px 24px' }}>
      <p className="jai-mono-label" style={{ color: '#6b6b6b', margin: '8px 0 4px 0', fontSize: 10 }}>
        🧠 Context &amp; connections
      </p>
      <MindmapGraph mindmap={mindmap} centerLabel={centerLabel} />
    </div>
  )
}

// SVG radial graph: center node + 6 branch labels with mini bullets
function MindmapGraph({ mindmap, centerLabel }: {
  mindmap: NonNullable<CultureTrend['mindmap']>
  centerLabel: string
}) {
  const branches = [
    { key: 'origin' as const, label: 'Origin', emoji: '🌱' },
    { key: 'spreading' as const, label: 'Spreading', emoji: '📡' },
    { key: 'adjacent' as const, label: 'Adjacent', emoji: '🔗' },
    { key: 'variations' as const, label: 'Variations', emoji: '🌀' },
    { key: 'searches' as const, label: 'Searches', emoji: '🔍' },
    { key: 'brandPlays' as const, label: 'Brand plays', emoji: '💼' },
  ]
  const nonEmpty = branches.filter((b) => (mindmap[b.key] ?? []).length > 0)
  if (nonEmpty.length === 0) return null

  const W = 880
  const H = 380
  const cx = W / 2
  const cy = H / 2
  const radius = 140

  // Position 6 branches around the center (top, top-right, bottom-right, bottom, bottom-left, top-left)
  const angles = [-90, -30, 30, 90, 150, 210]
  const positions = nonEmpty.map((b, i) => {
    const a = (angles[i] ?? 0) * Math.PI / 180
    return {
      ...b,
      x: cx + Math.cos(a) * radius,
      y: cy + Math.sin(a) * radius,
      side: Math.cos(a) > 0.1 ? 'right' : Math.cos(a) < -0.1 ? 'left' : 'center',
    }
  })

  return (
    <div style={{ background: '#FFFDF3', border: '1px solid #00000010', padding: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Branch lines */}
        {positions.map((p) => (
          <line key={`line-${p.key}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#000" strokeWidth={1.5} opacity={0.3} />
        ))}
        {/* Center node */}
        <g>
          <circle cx={cx} cy={cy} r={68} fill="#000" />
          <circle cx={cx} cy={cy} r={68} fill="none" stroke="#FF1300" strokeWidth={3} />
          <text
            x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
            fill="#FFFDF3" fontFamily="var(--font-jai-display)" fontSize={13}
            style={{ textTransform: 'uppercase', letterSpacing: '0.02em' }}
          >
            {wrapLabel(centerLabel, 14).map((line, i, arr) => (
              <tspan key={i} x={cx} dy={i === 0 ? -((arr.length - 1) * 8) : 16}>{line}</tspan>
            ))}
          </text>
        </g>
        {/* Branch nodes */}
        {positions.map((p) => {
          const items = mindmap[p.key] ?? []
          const first = items[0]
          const tw = 200
          const th = 78
          const rx = p.side === 'left' ? p.x - tw : p.side === 'right' ? p.x : p.x - tw / 2
          const ry = p.y - th / 2
          return (
            <g key={`node-${p.key}`}>
              <rect x={rx} y={ry} width={tw} height={th} fill="#FFFDF3" stroke="#000" strokeWidth={1.5} />
              <rect x={rx} y={ry} width={tw} height={18} fill="#FF1300" />
              <text
                x={rx + 8} y={ry + 13}
                fill="#FFFDF3" fontFamily="var(--font-jai-display)" fontSize={10}
                style={{ letterSpacing: '0.1em', textTransform: 'uppercase' }}
              >
                {p.emoji} {p.label}
              </text>
              {first && (
                <text
                  x={rx + 8} y={ry + 34}
                  fill="#000" fontFamily="var(--font-body)" fontSize={11} fontWeight={600}
                >
                  {truncate(first.label, 26)}
                </text>
              )}
              {first?.detail && (
                <text
                  x={rx + 8} y={ry + 50}
                  fill="#6b6b6b" fontFamily="var(--font-body)" fontSize={10}
                >
                  {truncate(first.detail, 30)}
                </text>
              )}
              {items.length > 1 && (
                <text
                  x={rx + 8} y={ry + 68}
                  fill="#FF1300" fontFamily="var(--font-jai-display)" fontSize={9}
                  style={{ letterSpacing: '0.08em' }}
                >
                  +{items.length - 1} MORE
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Detail expandables below the graph */}
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.1em', color: '#6b6b6b', textTransform: 'uppercase' }}>
          Show all bullets
        </summary>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {nonEmpty.map((b) => (
            <div key={`list-${b.key}`} style={{ borderLeft: '3px solid #000', padding: '4px 10px' }}>
              <p className="jai-mono-label" style={{ margin: 0, fontSize: 9, color: '#000' }}>
                {b.emoji} {b.label}
              </p>
              <ul style={{ margin: '4px 0 0 0', padding: 0, listStyle: 'none' }}>
                {(mindmap[b.key] ?? []).slice(0, 5).map((it, i) => (
                  <li key={i} style={{ fontSize: 11, lineHeight: 1.4, marginBottom: 3, color: '#1a1a1a' }}>
                    <strong>{it.label}</strong>
                    {it.detail && <span style={{ color: '#6b6b6b' }}> — {it.detail.slice(0, 90)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

function wrapLabel(s: string, perLine: number): string[] {
  const words = s.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    if ((current + ' ' + w).trim().length > perLine && current) {
      lines.push(current.trim())
      current = w
    } else {
      current = (current + ' ' + w).trim()
    }
    if (lines.length >= 2) break
  }
  if (current && lines.length < 3) lines.push(truncate(current, perLine))
  return lines.slice(0, 3)
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
