import type { ParsedWeekFile } from '@/types/promo'

const PRODUCT_NUMBER_RE = /\b\d{7}\b/g

/**
 * Filter out 7-digit numbers that are unlikely to be Action product codes.
 * Rejects date-like patterns (e.g. 2026031, 1012025), prices, and common false positives.
 */
function isLikelyProductNumber(num: string): boolean {
  const n = parseInt(num, 10)
  // Action product numbers are typically in the 1000000-9999999 range
  // Filter out numbers starting with common date prefixes (year patterns)
  if (num.startsWith('202') || num.startsWith('201') || num.startsWith('200')) return false
  // Filter out numbers that look like concatenated day+month+year (e.g. 0103202 → 01-03-202x)
  if (/^[0-3]\d[01]\d\d{3}$/.test(num)) return false
  // Filter very low numbers (unlikely product codes)
  if (n < 1000000) return false
  return true
}

/** Extract week number from filename. Returns null if not detectable. */
export function parseWeekFromFilename(filename: string): { week: number | null; year: number } {
  const base = filename.replace(/\.[^.]+$/, '') // strip extension

  // Extract year: 4-digit number starting with 20xx
  const yearMatch = base.match(/(20\d{2})/)
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear()

  // Extract week: "week" or "wk" followed by optional spaces/zeros and 1-2 digits
  const weekMatch = base.match(/(?:week|wk)\s*0*(\d{1,2})/i)
  const week = weekMatch ? parseInt(weekMatch[1], 10) : null

  return { week, year }
}

/** Extract all unique 7-digit product numbers from an Excel file. */
export async function extractProductNumbers(file: File): Promise<string[]> {
  const XLSX = await import('xlsx')
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false })

  const found = new Set<string>()

  // Only scan "Artikellijst" tabs; fall back to all sheets if none found
  const artikellijstSheets = workbook.SheetNames.filter((n) => /artikellijst/i.test(n))
  const sheetsToScan = artikellijstSheets.length > 0 ? artikellijstSheets : workbook.SheetNames

  for (const sheetName of sheetsToScan) {
    const sheet = workbook.Sheets[sheetName]
    const cellAddresses = Object.keys(sheet).filter((key) => !key.startsWith('!'))

    for (const addr of cellAddresses) {
      const cell = sheet[addr]
      if (!cell) continue

      // Check the raw value (number) and formatted text (string)
      const values: string[] = []
      if (cell.v !== undefined && cell.v !== null) {
        values.push(String(cell.v))
      }
      if (cell.w) {
        values.push(cell.w)
      }

      for (const val of values) {
        const matches = val.match(PRODUCT_NUMBER_RE)
        if (matches) {
          for (const m of matches) {
            if (isLikelyProductNumber(m)) found.add(m)
          }
        }
      }
    }
  }

  return Array.from(found).sort()
}

/** Parse an Excel file: extract product numbers and detect week from filename. */
export async function parseWeekFile(file: File): Promise<ParsedWeekFile> {
  const [products, { week, year }] = await Promise.all([
    extractProductNumbers(file),
    Promise.resolve(parseWeekFromFilename(file.name)),
  ])

  return { products, week, year, filename: file.name }
}

/** Format a week+year pair as a sortable key, e.g. "2025-W08" */
export function weekKey(week: number, year: number): string {
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Parse a week key back to { week, year } */
export function parseWeekKey(key: string): { week: number; year: number } {
  const m = key.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return { week: 0, year: 0 }
  return { year: parseInt(m[1], 10), week: parseInt(m[2], 10) }
}

/** Human-readable label for a week key: "W8 · 2025" */
export function weekLabel(key: string): string {
  const { week, year } = parseWeekKey(key)
  return `W${week} · ${year}`
}

/**
 * Returns the promo week key for today.
 * Promo weeks run Wednesday–Tuesday, so Monday and Tuesday still belong
 * to the previous promo week. We shift those days back to the Wednesday
 * that opened the current promo period, then compute its ISO week number.
 */
export function getCurrentWeekKey(): string {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

  // On Monday (1) or Tuesday (2), shift back to the Wednesday that started this promo period
  // Mon → 5 days back, Tue → 6 days back
  const d = new Date(now)
  if (dayOfWeek === 1 || dayOfWeek === 2) {
    const daysBack = (dayOfWeek - 3 + 7) % 7  // Mon→5, Tue→6
    d.setDate(d.getDate() - daysBack)
  }

  // ISO week calculation on the adjusted date
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return weekKey(weekNo, utc.getUTCFullYear())
}
