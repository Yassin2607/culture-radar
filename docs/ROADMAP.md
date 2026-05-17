# Culture Radar — Roadmap

Status as of 2026-05-17. Strategy: ship in small, observable phases so
the magazine keeps getting better every week instead of waiting on a
big-bang upgrade.

## Where we are now

The tool runs end-to-end:

- 130+ sources scraped daily (Firecrawl, Perplexity, TikTok CC, Google
  Trends, Reddit JSON, blog feeds)
- Gemini extracts named trends; merge/dedup across sources
- Trends ranked by popularity, freshness, growth, validation
- Enrichment: brand briefs, mindmaps, embeddings, vibes, countries,
  subcultures, lifecycle stage, article-date verification
- Daily HTML magazine with editorial layout, AI hero images, embedded
  TikTok pulse videos, by-country sections, breakout predictions, and
  (as of today) Velocity Leaders + Skip List sections
- GitHub Actions cron at 06:00 UTC runs the full refresh independent
  of Vercel scheduling (which kept dropping the schedule)
- Live scrape progress panel in the dashboard

## Open issues / friction

1. **Magazine HTML is 31 MB** — base64-inlined AI images. Browser
   loads fine, email forward chokes (Gmail max attachment 25 MB).
2. **Brief coverage ≈ 40%** — top trends covered, tail not. Late
   batches hit Gemini rate-limits sometimes.
3. **Firecrawl credits ran out today** — 40 sources failed in the
   morning cron. Needs either a plan upgrade or a swap of the
   highest-volume sources to non-Firecrawl methods.
4. **TikTok signal still indirect** — Creative Center API works, but
   raw /discover scraping is blocked. Perplexity-based queries partly
   cover it.
5. **Vercel GitHub webhook still broken** — every code change needs
   manual `vercel deploy`. GitHub Actions cron now compensates for the
   schedule side, but auto-deploys still need a UI fix.

## Phase plan

### Phase A — Magazine payload + email-ready output (next)
Goal: under 1 MB per magazine, suitable for email and Slack forward.

- Move AI hero images from inline base64 to Vercel Blob storage
  (`@vercel/blob`) — return signed CDN URLs in the HTML
- Convert PNG → WebP (or 80%-quality JPEG) before storing
- Add `?inline=0` mode that produces a pure-text fallback for email
  clients that block remote images
- Optional: a separate "executive summary" 5-section export
  for Slack channels

**Effort:** 4-6 hours. **Cost:** Vercel Blob storage is metered but cheap
at this scale (~€0.50/mo).

### Phase B — TikTok signal via paid scrape service
Goal: real TikTok video data without Firecrawl block.

- Pilot ScrapingBee or ZenRows on the highest-value endpoints
  (/discover/{slug}, /tag/{hashtag}, creator profile pages)
- Build a `scrapeTikTokViaProxy` dispatcher in `lib/`
- Replace Perplexity-Reddit-replacement sources with real Reddit
  data via the same proxy
- Add per-source proxy budget tracking

**Effort:** 6-8 hours. **Cost:** €30-60/mo for proxy.

### Phase C — Alerts + webhooks for breakout trends
Goal: don't wait 24 h for the magazine when a trend is exploding now.

- Hook into `compute-growth` step: when `growth_score >= 8.5` and
  the trend wasn't in yesterday's snapshot, fire a Slack webhook
- Same for `verify-trends` when a trend gets validated as `real` and
  is in a strategic category (food + home for Action)
- "Watch list" feature in dashboard — pin specific keywords to get
  alerts when matching trends appear

**Effort:** 3-4 hours.

### Phase D — Brand activation tracker
Goal: see who has already played each trend so the team doesn't pitch
something a competitor just shipped.

- For each trend's example_urls, fetch the post and parse caption
  for `@brand` mentions
- Cross-reference against a list of competitor handles (Lidl, Aldi,
  Hema, IKEA, AH, Jumbo, etc.)
- Show "Already activated by:" badge in the magazine

**Effort:** 6-8 hours.

### Phase E — Multi-brand support
Goal: same tool, different brand profiles. JackandAI's other clients
(Danone, Renault, Jagermeister, Lidl) get their own briefs and tones
without forking the codebase.

- Add `brands` table with positioning, tone, must-avoid, target
  countries, product categories
- Brief generation per (trend, brand) pair instead of per trend
- Magazine endpoints accept `?brand=action|danone|...`
- Brand-specific Velocity Leaders and Skip Lists

**Effort:** 12-16 hours.

### Phase F — PDF magazine + Slides export
Goal: the marketing team can hand the magazine directly to a client
exec.

- Server-side rendering via Puppeteer (Vercel function) or external
  service (DocRaptor / PDFShift)
- Branded PDF cover, table of contents linked, page numbers
- Optional Slides version (Google Slides API or PPTX export)

**Effort:** 8-12 hours.

### Phase G — Historical comparison + "trend memory"
Goal: not just "what's hot today" but "is this a real shift or a one-day
spike?"

- Weekly digest section comparing this week to last week
- "Trends that disappeared" — what we hyped that didn't stick
- Calibration page for the predictor — how often does growth_score >= 7
  actually break in 14 days?

**Effort:** 6-8 hours.

### Phase H — Creator pipeline integration
Goal: when a trend lands, the team has 3 creators they can DM today.

- Already partially built (`/api/culture/scan-creators`,
  `creator-radar.ts`). Surface in the magazine as "Creators on this
  trend" inline per trend card.
- Add creator-fit scoring per trend (vibe match, country, niche)
- Outreach template generation per (trend × creator)

**Effort:** 4-6 hours.

### Phase I — Mobile-first dashboard view
Goal: pull up the dashboard on a phone during a meeting.

- Current dashboard is fine on laptop, cramped on mobile
- Responsive filter bar, swipe through trends, larger touch targets
- Save-for-later flagging that syncs with desktop

**Effort:** 4-6 hours.

### Phase J — A/B test briefs and angles
Goal: learn which brief styles actually convert to good content.

- When a trend is activated (post published), log the brief used
- After 7 days, pull engagement numbers via creator APIs
- Train a small ranker over time — surface "high-performing brief
  patterns" in the magazine

**Effort:** large — depends on integration depth. Probably 20+ hours
spread across iterations.

## What I'd ship next (recommendation)

In priority order if I had a free week:

1. **Phase A (magazine payload)** — unblocks email distribution,
   directly improves how the team uses the tool day-to-day
2. **Phase C (breakout alerts)** — turns the magazine from
   once-a-day digest into a live signal feed
3. **Phase B (TikTok via proxy)** — biggest content-quality lift, but
   has a recurring cost
4. **Phase E (multi-brand)** — only makes sense once JackandAI has at
   least one other paying client wanting the same tool

Everything else is value-additive but lower priority.

## Maintenance cadence

- **Daily**: GitHub Actions cron runs the refresh at 06:00 UTC. Failures
  show up in the Actions tab and email.
- **Weekly**: review the "Skip List" section of the magazine to spot
  patterns of false positives — these are signal to tune the
  Gemini extraction prompt.
- **Monthly**: re-tune Perplexity query prompts based on which sources
  consistently yield trends vs which return content but no NAMED items.
- **Quarterly**: full source audit using `/api/culture/source-productivity`
  — drop sources with zero trends in 90 days, add new ones based on
  emerging cultural channels.
