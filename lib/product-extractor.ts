import type { ParsedWeekFile, ProductsByWeek } from '@/types/promo'

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

/** Extract promo products grouped by their week number from the sheet.
 *  If the sheet has "Article number", "Promo?" and a week column (first column),
 *  products are grouped by week. For duplicate article numbers, the last (highest)
 *  week where Promo? = 1 is used. Falls back to flat extraction for simple sheets. */
export async function extractProductsByWeek(file: File): Promise<ProductsByWeek> {
  const XLSX = await import('xlsx')
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false })

  // Look for a sheet with structured "Article number" + "Promo?" columns
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    if (rows.length === 0) continue

    const headers = Object.keys(rows[0])
    const articleCol = headers.find((h) => /article\s*number/i.test(h))
    const promoCol = headers.find((h) => /^promo\s*\??$/i.test(h))

    if (articleCol && promoCol) {
      // The first column contains the week number
      const weekCol = headers[0]

      // For each product, track the highest week where Promo? = 1
      const productWeekMap = new Map<string, number>()

      for (const row of rows) {
        const promoVal = String(row[promoCol]).trim()
        if (promoVal !== '1') continue

        const weekVal = parseInt(String(row[weekCol]), 10)
        if (!weekVal || weekVal < 1 || weekVal > 53) continue

        const articleVal = String(row[articleCol]).trim()
        const matches = articleVal.match(PRODUCT_NUMBER_RE)
        if (matches) {
          for (const m of matches) {
            const existing = productWeekMap.get(m)
            if (!existing || weekVal > existing) {
              productWeekMap.set(m, weekVal)
            }
          }
        }
      }

      // Group products by week
      const byWeek: ProductsByWeek = {}
      for (const [product, week] of productWeekMap) {
        if (!byWeek[week]) byWeek[week] = []
        byWeek[week].push(product)
      }
      // Sort products within each week
      for (const week of Object.keys(byWeek)) {
        byWeek[Number(week)].sort()
      }
      return byWeek
    }
  }

  // Fallback: scan all cells, return all products under week 0 (unknown)
  const found = new Set<string>()
  const artikellijstSheets = workbook.SheetNames.filter((n) => /artikellijst/i.test(n))
  const sheetsToScan = artikellijstSheets.length > 0 ? artikellijstSheets : workbook.SheetNames

  for (const sheetName of sheetsToScan) {
    const sheet = workbook.Sheets[sheetName]
    const cellAddresses = Object.keys(sheet).filter((key) => !key.startsWith('!'))

    for (const addr of cellAddresses) {
      const cell = sheet[addr]
      if (!cell) continue

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

  return { 0: Array.from(found).sort() }
}

/** Parse an Excel file: extract products grouped by week. */
export async function parseWeekFile(file: File): Promise<ParsedWeekFile> {
  const { year } = parseWeekFromFilename(file.name)
  const byWeek = await extractProductsByWeek(file)
  const weeks = Object.keys(byWeek).map(Number).filter((w) => w > 0)

  if (weeks.length > 0) {
    // Multi-week file: return all products with per-week info attached
    const allProducts = [...new Set(Object.values(byWeek).flat())].sort()
    return { products: allProducts, week: null, year, filename: file.name, productsByWeek: byWeek }
  }

  // Fallback single-week
  const products = byWeek[0] || []
  const { week } = parseWeekFromFilename(file.name)
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
 * Returns the promo week key for today using the standard ISO week number.
 */
export function getCurrentWeekKey(): string {
  const now = new Date()
  const utc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const dayNum = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return weekKey(weekNo, utc.getUTCFullYear())
}
