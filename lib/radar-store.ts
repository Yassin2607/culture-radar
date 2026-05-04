import type { RadarStore, UploadRecord } from '@/types/promo'
import { weekKey } from './product-extractor'

const STORAGE_KEY = 'promo-radar-store'

export function emptyStore(): RadarStore {
  return { products: {}, productNames: {}, uploads: [] }
}

export function loadStore(): RadarStore {
  if (typeof window === 'undefined') return emptyStore()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw)
    if (!parsed.productNames) parsed.productNames = {}
    return parsed as RadarStore
  } catch {
    return emptyStore()
  }
}

function saveStore(store: RadarStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

/**
 * Add a new week's products to the store.
 * Returns the updated store.
 */
export function addWeekToStore(
  store: RadarStore,
  products: string[],
  week: number,
  year: number,
  filename: string,
  productNames?: Record<string, string>,
): RadarStore {
  const key = weekKey(week, year)

  // Check for duplicate upload (same week+year already exists)
  const alreadyUploaded = store.uploads.some((u) => u.week === week && u.year === year)

  // Build updated products map
  const updatedProducts = { ...store.products }

  if (!alreadyUploaded) {
    for (const pn of products) {
      if (!updatedProducts[pn]) {
        updatedProducts[pn] = [key]
      } else if (!updatedProducts[pn].includes(key)) {
        updatedProducts[pn] = [...updatedProducts[pn], key].sort()
      }
    }
  } else {
    // Re-upload: remove old week data first, then re-add
    for (const pn of Object.keys(updatedProducts)) {
      updatedProducts[pn] = updatedProducts[pn].filter((k) => k !== key)
      if (updatedProducts[pn].length === 0) {
        delete updatedProducts[pn]
      }
    }
    for (const pn of products) {
      if (!updatedProducts[pn]) {
        updatedProducts[pn] = [key]
      } else {
        updatedProducts[pn] = [...updatedProducts[pn], key].sort()
      }
    }
  }

  const newUpload: UploadRecord = {
    id: `${year}-${week}-${Date.now()}`,
    filename,
    week,
    year,
    uploadedAt: new Date().toISOString(),
    productCount: products.length,
  }

  const updatedUploads = alreadyUploaded
    ? store.uploads
        .filter((u) => !(u.week === week && u.year === year))
        .concat(newUpload)
        .sort((a, b) => weekKey(b.week, b.year).localeCompare(weekKey(a.week, a.year)))
    : [...store.uploads, newUpload].sort((a, b) =>
        weekKey(b.week, b.year).localeCompare(weekKey(a.week, a.year)),
      )

  const updatedNames = { ...store.productNames, ...(productNames || {}) }
  const updated: RadarStore = { products: updatedProducts, productNames: updatedNames, uploads: updatedUploads }
  saveStore(updated)
  return updated
}

/**
 * Delete a week from the store (removes its contributions from all products).
 */
export function deleteWeekFromStore(store: RadarStore, week: number, year: number): RadarStore {
  const key = weekKey(week, year)
  const updatedProducts = { ...store.products }
  const updatedNames = { ...store.productNames }

  for (const pn of Object.keys(updatedProducts)) {
    updatedProducts[pn] = updatedProducts[pn].filter((k) => k !== key)
    if (updatedProducts[pn].length === 0) {
      delete updatedProducts[pn]
      delete updatedNames[pn]
    }
  }

  const updatedUploads = store.uploads.filter((u) => !(u.week === week && u.year === year))

  const updated: RadarStore = { products: updatedProducts, productNames: updatedNames, uploads: updatedUploads }
  saveStore(updated)
  return updated
}

/** Wipe everything. */
export function clearStore(): RadarStore {
  const empty = emptyStore()
  saveStore(empty)
  return empty
}
