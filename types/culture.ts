export type CultureCategory =
  | 'food'
  | 'beauty'
  | 'fashion'
  | 'home'
  | 'lifestyle'
  | 'tech'
  | 'meme'
  | 'culture'
  | 'platform'
  | 'sound'

export type CultureContentType =
  | 'hashtag'
  | 'format'
  | 'sound'
  | 'aesthetic'
  | 'behavior'
  | 'meme'

export type SourceType =
  | 'platform'
  | 'blog'
  | 'reddit'
  | 'youtube'
  | 'instagram_proxy'
  | 'hashtag_page'
  | 'aggregator'
  | 'google_trends_api'
  | 'perplexity_query'
  | 'manual'

export interface CultureSource {
  id: number
  name: string
  url: string
  category: CultureCategory
  sourceType: SourceType
  reliability: number          // 1-5
  detectionLagDays: number | null
  active: boolean
  notes: string | null
  lastScrapedAt: string | null
  lastScrapeStatus: 'ok' | 'error' | 'skipped' | null
  lastScrapeError: string | null
}

export type SoundLicenseRisk = 'safe' | 'risky' | 'unknown'

export interface ActionBrief {
  actionRelevance: string       // Why this matters for Action specifically
  productCategories: string[]   // Max 3 Action product categories
  contentAngle: string          // Executable content idea for Action social
  suggestedSound: string | null // Concrete TikTok/Reels sound to use, with why
  soundRisk: SoundLicenseRisk | null   // Licensing risk for the suggested sound
  soundWarning: string | null   // Plain-language warning when the sound is risky
  urgency: number               // 1-10
  lifecycleStage: 'emerging' | 'growing' | 'peak' | 'saturating'
  whyNow: string                // The underlying cultural driver
}

export interface CultureTrend {
  id: string
  createdAt: string
  updatedAt: string
  firstSeenAt: string
  name: string
  slug: string
  description: string
  category: CultureCategory
  contentType: CultureContentType | null
  hashtags: string[]
  exampleUrls: string[]
  thumbnailUrl: string | null
  popularityScore: number       // 0-10
  freshnessScore: number        // 0-10
  validationScore: number       // # of sources confirming
  reasoning: string | null
  sourceIds: number[]
  sourceNames: string[]
  dailyRank: number | null
  weeklyRank: number | null
  rankDate: string | null
  rankWeek: string | null
  estimatedViews: string | null
  status: 'active' | 'archived' | 'flagged'
  brandBrief: ActionBrief | null  // Action-specific analysis
}

export type PredictionType = 'emerging' | 'lifecycle' | 'seasonal'

export interface CulturePrediction {
  id: string
  createdAt: string
  updatedAt: string
  predictionType: PredictionType
  title: string
  description: string
  reasoning: string
  confidence: number            // 0-100
  predictedPeakDate: string | null
  predictedDurationDays: number | null
  relatedTrendIds: string[]
  relatedTrendNames: string[]
  hashtags: string[]
  categories: string[]
  seasonalEvent: string | null
  status: 'active' | 'confirmed' | 'expired' | 'failed'
  expiresAt: string
}

// ── Moments Radar ─────────────────────────────────────────────────────────

export type MomentTier = 'standard' | 'cultural'

export type MomentCategory =
  | 'holiday'         // Mother's Day, Christmas, Easter
  | 'national'        // King's Day, Bastille Day
  | 'sport'           // Champions League, F1
  | 'festival'        // Tomorrowland, Lowlands
  | 'religious'       // Carnival, Ramadan
  | 'seasonal'        // back-to-school, summer
  | 'entertainment'   // show finales, film releases
  | 'music'           // album drops, tours
  | 'celebrity'       // royal moments, breakups
  | 'product_launch'  // iPhone, gaming consoles
  | 'award_show'      // Met Gala, Cannes, Eurovision
  | 'political'       // elections
  | 'pop_culture'     // catch-all for zeitgeist

export type ActionCountry =
  | 'NL' | 'FR' | 'DE' | 'BE' | 'ES' | 'IT' | 'PL'
  | 'CZ' | 'SK' | 'HU' | 'AT' | 'CH' | 'RO' | 'PT'

export interface CountryDate {
  country: ActionCountry
  date: string          // YYYY-MM-DD
  localName?: string    // "Moederdag", "Fête des Mères"
}

export interface MomentRelatedTopic {
  topic: string
  context: string
  source: 'perplexity' | 'google_trends'
  countries?: string[]
  url?: string
}

export interface CultureMoment {
  id: string
  createdAt: string
  updatedAt: string
  name: string
  slug: string
  description: string
  tier: MomentTier
  culturalRelevance: number  // 0-10
  category: MomentCategory
  scope: 'global' | 'country-specific'
  countryDates: CountryDate[]
  nextOccurrence: string | null
  recurring: 'yearly' | 'yearly-variable' | 'one-time' | null
  typicalDurationDays: number
  hashtags: string[]
  exampleUrls: string[]
  thumbnailUrl: string | null
  brandBrief: ActionBrief | null
  sourceNames: string[]
  reasoning: string | null
  status: 'upcoming' | 'happening' | 'archived'
  relatedTopics: MomentRelatedTopic[] | null
}

// ── Moderation ────────────────────────────────────────────────────────────

export type ModerationAction = 'approve' | 'reject' | 'flag' | 'use'

export interface CultureModeration {
  id: string
  createdAt: string
  trendId: string
  userId: string | null
  userEmail: string | null
  action: ModerationAction
  reason: string | null
  feedbackTags: string[]
}

export interface CultureFetchRun {
  id: string
  startedAt: string
  finishedAt: string | null
  triggeredBy: string | null
  sourcesAttempted: number
  sourcesOk: number
  sourcesFailed: number
  trendsInserted: number
  trendsUpdated: number
  status: 'running' | 'ok' | 'partial' | 'failed'
  error: string | null
  aiModel: string | null
  aiTokensIn: number | null
  aiTokensOut: number | null
}

// ── Raw scrape result, before AI analysis ───────────────────────────────────

export interface ScrapeResult {
  sourceId: number
  sourceName: string
  sourceCategory: CultureCategory
  url: string
  ok: boolean
  fetchedAt: string
  textSnippet: string         // first ~5000 chars of cleaned markdown
  topLinks: string[]          // up to ~20 outbound links found in content
  error?: string
}

// ── AI output schema (strict JSON the model must return) ───────────────────

export interface AIIdentifiedTrend {
  name: string
  description: string
  category: CultureCategory
  contentType: CultureContentType
  hashtags: string[]
  popularityScore: number     // 0-10
  reasoning: string
  estimatedViews?: string
  exampleUrls?: string[]
}

export interface AIAnalysisResult {
  trends: AIIdentifiedTrend[]
  modelUsed: string
  tokensIn?: number
  tokensOut?: number
}
