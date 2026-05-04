# Pinterest Trends Panel — Rankings Tab

**Date:** 2026-03-26
**Status:** Approved

---

## Goal

Add a "Pinterest Trending — In de Schijnwerpers" panel at the top of the Rankings tab, showing trending search keywords from Pinterest for both the Netherlands (NL) and the United States (US), grouped by category. The panel is read-only and does not affect product scores.

---

## Scope

- New API route: `/api/trends/pinterest`
- New UI component: `PinterestTrendsPanel` in `app/trend-predictor/page.tsx`
- No new Supabase tables required
- No changes to scoring or prediction logic

---

## API Route — `/api/trends/pinterest`

### Method
`GET`

### Behaviour
1. Check localStorage cache key `pinterest_trends_cache_v1` on the **client** (12-hour TTL). If fresh, skip the API call entirely.
2. On cache miss, call `GET /api/trends/pinterest`.
3. Scrape `https://trends.pinterest.com/?country=NL` and `https://trends.pinterest.com/?country=US` **in parallel** using Firecrawl (`firecrawl.scrape`, `formats: ['markdown']`, `waitFor: 3000`).
4. Pass both markdown results in a single Claude Haiku call. Prompt asks Claude to extract the "in de schijnwerpers" (spotlight) keywords and their categories from each country's content.
5. Filter out categories whose name matches (case-insensitive, Dutch or English):
   - `onderwijs` / `education`
   - `bruiloft` / `wedding`
6. Return structured JSON.

### Response shape
```ts
interface PinterestTrend {
  category: string   // e.g. "Wonen", "Mode", "Eten & Drinken"
  keyword: string    // e.g. "maximalistisch interieur"
}

interface PinterestTrendsResult {
  nl: PinterestTrend[]
  us: PinterestTrend[]
  cachedAt: string   // ISO timestamp
}
```

### Error handling
- If either Firecrawl scrape fails, return `{ nl: [], us: [], cachedAt: null, error: 'scrape_failed' }` with status 200 (so the UI can degrade gracefully).
- If Claude fails to parse valid JSON, return the same empty-array fallback.
- Log errors server-side only (no stack traces in response).

### Constraints
- `maxDuration = 60` (Vercel hobby plan)
- Two parallel Firecrawl scrapes + one Claude Haiku call should complete in ~15–25 s

---

## Caching

| Layer | Mechanism | TTL |
|-------|-----------|-----|
| Client | `localStorage` key `pinterest_trends_cache_v1` | 12 hours |

No server-side cache (same pattern as Pains & Gains). Each browser caches its own result after the first load.

---

## UI Component — `PinterestTrendsPanel`

### Location
Top of the `RankingsTab` component, above the product list.

### States
| State | Behaviour |
|-------|-----------|
| Loading | Skeleton placeholder (two columns of shimmer chips) |
| Error | Small inline message: "Pinterest trends tijdelijk niet beschikbaar." Rankings still works normally. |
| Empty | Nothing rendered (no data and no error, e.g. cache miss + API returns empty arrays) |
| Loaded | Full panel as described below |

### Layout
```
┌─────────────────────────────────────────────────────────┐
│ Pinterest Trending — In de Schijnwerpers        [↑ Hide] │
│ Gecached 3u geleden                     [↻ Vernieuwen]  │
├────────────────────────────┬────────────────────────────┤
│ 🇳🇱 Nederland               │ 🇺🇸 United States           │
│                            │                            │
│ Wonen                      │ Home Decor                 │
│ [maximalistisch interieur] │ [coastal grandmother]      │
│ [plantenwand]              │ [biophilic design]         │
│                            │                            │
│ Mode                       │ Fashion                    │
│ [boho zomer]               │ [quiet luxury]             │
└────────────────────────────┴────────────────────────────┘
```

- Panel is **collapsible** (open by default); collapse state persisted in `localStorage`
- Keywords rendered as small read-only pill chips (no click action for now)
- Category names rendered as small uppercase grey labels above their keyword groups
- Refresh button clears the localStorage cache and re-fetches

---

## Data Flow

```
RankingsTab mounts
    → read localStorage pinterest_trends_cache_v1
    → if fresh (< 12h): render panel from cache
    → if stale/missing: fetch GET /api/trends/pinterest
        → Firecrawl scrapes NL + US in parallel
        → Claude Haiku extracts { nl, us } keywords
        → API returns PinterestTrendsResult
    → write result to localStorage
    → render PinterestTrendsPanel
```

---

## Files Changed

| File | Change |
|------|--------|
| `app/api/trends/pinterest/route.ts` | New file |
| `app/trend-predictor/page.tsx` | Add `PinterestTrendsPanel` component + wire into `RankingsTab` |

---

## Out of Scope

- Clicking a keyword to filter Action products (future)
- Boosting product scores based on Pinterest trends (future)
- Server-side Supabase cache (not needed for now)
- Pinterest API / OAuth (not needed for now)
