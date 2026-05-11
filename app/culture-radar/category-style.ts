/**
 * Visual style per culture category. Keeps the dashboard scannable —
 * the eye picks up an icon + colour before reading the trend name.
 */

export interface CategoryStyle {
  emoji: string
  bg: string
  fg: string
  border: string
  accent: string  // Used for left-border accent on the card
}

export const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  food:      { emoji: '🍴', bg: '#fff7ed', fg: '#9a3412', border: '#fed7aa', accent: '#ea580c' },
  beauty:    { emoji: '💄', bg: '#fdf2f8', fg: '#9d174d', border: '#fbcfe8', accent: '#db2777' },
  fashion:   { emoji: '👗', bg: '#faf5ff', fg: '#6b21a8', border: '#e9d5ff', accent: '#9333ea' },
  home:      { emoji: '🏠', bg: '#ecfeff', fg: '#155e75', border: '#a5f3fc', accent: '#0891b2' },
  lifestyle: { emoji: '✨', bg: '#fefce8', fg: '#854d0e', border: '#fef08a', accent: '#ca8a04' },
  tech:      { emoji: '💻', bg: '#eff6ff', fg: '#1e40af', border: '#bfdbfe', accent: '#2563eb' },
  meme:      { emoji: '😂', bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca', accent: '#dc2626' },
  culture:   { emoji: '🎭', bg: '#f5f3ff', fg: '#5b21b6', border: '#ddd6fe', accent: '#7c3aed' },
  platform:  { emoji: '📱', bg: '#f0fdf4', fg: '#166534', border: '#bbf7d0', accent: '#16a34a' },
  sound:     { emoji: '🎵', bg: '#f0f9ff', fg: '#075985', border: '#bae6fd', accent: '#0284c7' },
}

export function styleFor(category: string): CategoryStyle {
  return CATEGORY_STYLES[category] ?? {
    emoji: '🔥',
    bg: '#f3f4f6',
    fg: '#4a4f5c',
    border: '#e5e7eb',
    accent: '#6b7280',
  }
}

/**
 * Lifecycle stage visual config. Used by the progress bar on each card.
 */
export const LIFECYCLE_VISUAL: Record<string, { label: string; progress: number; color: string; bg: string }> = {
  emerging:   { label: 'Emerging',   progress: 25,  color: '#065f46', bg: '#d1fae5' },
  growing:    { label: 'Growing',    progress: 55,  color: '#1e40af', bg: '#dbeafe' },
  peak:       { label: 'Peak',       progress: 90,  color: '#92400e', bg: '#fef3c7' },
  saturating: { label: 'Saturating', progress: 70,  color: '#6b7280', bg: '#f3f4f6' },
}
