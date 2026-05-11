/**
 * Trend visual generator.
 *
 * Either an actual thumbnail image (from TikTok oEmbed), or — when no image
 * is available — a generated SVG poster with category color + the trend
 * name in Archivo Black.
 *
 * The poster is what differentiates this from a generic "no image"
 * placeholder — it still feels intentional, editorial, on-brand.
 */

import type { CultureTrend } from '@/types/culture'

const CATEGORY_PALETTE: Record<string, { bg: string; fg: string; accent: string }> = {
  food:      { bg: '#FFE3CC', fg: '#1a1a1a', accent: '#FF1300' },
  beauty:    { bg: '#FFD9E9', fg: '#1a1a1a', accent: '#FF1300' },
  fashion:   { bg: '#E6D9FF', fg: '#1a1a1a', accent: '#FF1300' },
  home:      { bg: '#CCEEFF', fg: '#1a1a1a', accent: '#FF1300' },
  lifestyle: { bg: '#FFF1B3', fg: '#1a1a1a', accent: '#FF1300' },
  tech:      { bg: '#D9E6FF', fg: '#1a1a1a', accent: '#FF1300' },
  meme:      { bg: '#FFCCCC', fg: '#1a1a1a', accent: '#FF1300' },
  culture:   { bg: '#E6CCFF', fg: '#1a1a1a', accent: '#FF1300' },
  platform:  { bg: '#CCFFCC', fg: '#1a1a1a', accent: '#FF1300' },
  sound:     { bg: '#CCE6FF', fg: '#1a1a1a', accent: '#FF1300' },
}

export function paletteFor(category: string) {
  return CATEGORY_PALETTE[category] ?? { bg: '#FFFDF3', fg: '#1a1a1a', accent: '#FF1300' }
}

export function TrendVisual({
  trend,
  size = 'medium',
}: {
  trend: Pick<CultureTrend, 'name' | 'category' | 'thumbnailUrl' | 'hashtags'>
  size?: 'hero' | 'medium' | 'compact'
}) {
  const pal = paletteFor(trend.category)
  const dims = size === 'hero'
    ? { width: '100%', height: 360 }
    : size === 'medium'
      ? { width: '100%', height: 200 }
      : { width: 80, height: 80 }

  if (trend.thumbnailUrl) {
    return (
      <div
        style={{
          ...dims,
          backgroundImage: `url(${trend.thumbnailUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundColor: '#000',
          position: 'relative',
        }}
      />
    )
  }

  // SVG poster — typographic placeholder
  const name = trend.name.replace(/^#/, '').slice(0, 32)
  const isLarge = size === 'hero' || size === 'medium'
  return (
    <div
      style={{
        ...dims,
        backgroundColor: pal.bg,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-end',
        padding: isLarge ? 24 : 8,
      }}
    >
      {/* Decorative diagonal stripe */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-30%',
          width: '80%',
          height: '140%',
          background: pal.accent,
          opacity: 0.08,
          transform: 'rotate(15deg)',
        }}
      />
      {/* Category tag top-left */}
      <span
        style={{
          position: 'absolute',
          top: isLarge ? 16 : 6,
          left: isLarge ? 16 : 6,
          fontFamily: 'var(--font-jai-display)',
          fontSize: isLarge ? 10 : 7,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: pal.accent,
          background: '#000',
          padding: isLarge ? '3px 8px' : '2px 4px',
        }}
      >
        {trend.category}
      </span>
      {/* Title */}
      {isLarge && (
        <h3
          style={{
            margin: 0,
            fontFamily: 'var(--font-jai-display)',
            fontSize: size === 'hero' ? 44 : 22,
            lineHeight: 0.95,
            color: pal.fg,
            textTransform: 'uppercase',
            letterSpacing: '-0.02em',
            position: 'relative',
            zIndex: 1,
            maxWidth: '90%',
          }}
        >
          {name}
          <span style={{ color: pal.accent }}>.</span>
        </h3>
      )}
      {!isLarge && (
        <span
          style={{
            fontFamily: 'var(--font-jai-display)',
            fontSize: 28,
            color: pal.accent,
            position: 'absolute',
            bottom: 4,
            right: 8,
          }}
        >
          #
        </span>
      )}
    </div>
  )
}
