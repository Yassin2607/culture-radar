// Stored in localStorage under key 'promo-radar-store'
export interface RadarStore {
  products: Record<string, string[]> // productNumber → ["2025-W08", "2025-W09", ...]
  uploads: UploadRecord[]
}

export interface UploadRecord {
  id: string
  filename: string
  week: number
  year: number
  uploadedAt: string   // ISO date string
  productCount: number // distinct 7-digit codes found
}

export interface ParsedWeekFile {
  products: string[]   // deduplicated 7-digit product numbers
  week: number | null  // null if not detected from filename
  year: number
  filename: string
  productsByWeek?: ProductsByWeek  // present when the sheet contains per-product week numbers
}

/** Product grouped by its promo week (extracted from the sheet's week column). */
export interface ProductsByWeek {
  [weekNumber: number]: string[]  // weekNumber → product numbers
}
