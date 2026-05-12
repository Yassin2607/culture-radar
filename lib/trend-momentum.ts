/**
 * Trend momentum — derives an "is this rising / flat / cooling" signal
 * from age + popularity score, without needing historical timeseries.
 *
 * Logic (rough heuristic, deliberately simple):
 *   - age < 2 days  + popularity >= 7  → hot (↑↑)
 *   - age < 7 days                     → rising (↑)
 *   - age 7-14 days + popularity >= 7  → resilient (→)
 *   - age 7-14 days                    → steady (→)
 *   - age >= 14 days + popularity >= 7 → late peak (↑)
 *   - age >= 14 days + popularity < 6  → cooling (↓)
 *   - default                          → flat (→)
 */

export type Momentum = 'hot' | 'rising' | 'steady' | 'cooling' | 'flat'

export interface MomentumInfo {
  key: Momentum
  arrow: string         // visual glyph
  label: string         // short label for tooltip
  color: string         // hex
}

export function computeMomentum(firstSeenAt: string | null | undefined, popularity: number): MomentumInfo {
  if (!firstSeenAt) {
    return { key: 'flat', arrow: '→', label: 'Flat', color: '#9ca3af' }
  }
  const ageDays = (Date.now() - new Date(firstSeenAt).getTime()) / 86_400_000

  if (ageDays < 2 && popularity >= 7) {
    return { key: 'hot', arrow: '↑↑', label: 'Hot', color: '#FF1300' }
  }
  if (ageDays < 7) {
    return { key: 'rising', arrow: '↑', label: 'Rising', color: '#FF1300' }
  }
  if (ageDays < 14) {
    return {
      key: 'steady',
      arrow: '→',
      label: popularity >= 7 ? 'Resilient' : 'Steady',
      color: popularity >= 7 ? '#000' : '#6b6b6b',
    }
  }
  if (popularity >= 7) {
    return { key: 'rising', arrow: '↑', label: 'Late peak', color: '#000' }
  }
  if (popularity < 6) {
    return { key: 'cooling', arrow: '↓', label: 'Cooling', color: '#9ca3af' }
  }
  return { key: 'flat', arrow: '→', label: 'Flat', color: '#9ca3af' }
}
