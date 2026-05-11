/**
 * Culture Radar — AI analysis layer.
 *
 * Wraps Gemini 2.5 Flash to extract structured trends from scraped source
 * content. Keeps the prompt + parsing in one place so it can be tweaked
 * without touching API routes.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { CULTURE_GEMINI_MODEL } from '@/lib/constants'
import { extractJson } from '@/lib/culture-radar'
import type {
  AIAnalysisResult,
  AIIdentifiedTrend,
  CultureCategory,
} from '@/types/culture'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')

const VALID_CATEGORIES: CultureCategory[] = [
  'food',
  'beauty',
  'fashion',
  'home',
  'lifestyle',
  'tech',
  'meme',
  'culture',
  'platform',
  'sound',
]

const VALID_CONTENT_TYPES = [
  'hashtag',
  'format',
  'sound',
  'aesthetic',
  'behavior',
  'meme',
]

/**
 * Ask Gemini to identify trends in scraped content from a single source.
 * Returns up to `maxTrends` items per source. Filters invalid categories
 * / content types defensively.
 */
export async function analyzeSourceContent(args: {
  sourceName: string
  sourceCategory: CultureCategory
  sourceUrl: string
  contentMarkdown: string
  maxTrends?: number
  lookbackDays?: number
}): Promise<AIAnalysisResult> {
  const { sourceName, sourceCategory, sourceUrl, contentMarkdown } = args
  const maxTrends = args.maxTrends ?? 8
  const lookbackDays = args.lookbackDays ?? 0

  const trimmed = contentMarkdown.slice(0, 12_000)

  const windowDescription =
    lookbackDays > 0
      ? `the last ${lookbackDays} days (this is a one-time backfill, so include anything that was trending at any point during that window)`
      : 'the current week (skip anything that already peaked or is evergreen)'

  const prompt = `You are a cultural trend analyst. Extract SPECIFIC, NAMED trends from scraped content.

# SOURCE
Name: ${sourceName}
Category: ${sourceCategory}
URL: ${sourceUrl}

# CONTENT (truncated)
${trimmed}

# TASK
Identify up to ${maxTrends} distinct cultural trends from the content above.
Window: ${windowDescription}.

# CRITICAL: SPECIFICITY RULES
Every trend MUST be specific and named. Generic category names are REJECTED.

BAD (too generic — do not return these):
- "Viral TikTok Sounds" → describes all of TikTok
- "Beauty Trends" → describes a whole category
- "Food Content" → meaningless
- "Popular Hashtags" → not a trend
- "Mother's Day Celebrations" → calendar event, not a trend
- "Easter content" / "Christmas hype" → holiday surge, belongs in moments planner not here
- "GLP-1 Supplements" → generic product category without specific brand/named product

GOOD (specific and named):
- "Lorde's 'What Was That' used for dramatic reveal formats" — specific song + format
- "Glazed donut nails" — specific named aesthetic
- "Day-in-my-life as a [job] POV" — specific content format with a pattern
- "Cowboy core fashion aesthetic" — named trend with clear visual identity
- "Dubai chocolate bar craze" — specific product trend with name

RULE 1: If you cannot give it a specific name that someone could Google and find — skip it.

RULE 2: DO NOT extract holiday content surges (Mother's Day celebrations, Easter content, Christmas hype, Father's Day appreciation, Valentine's posts, Halloween costumes generally). These are calendar events — they belong in a separate moments planner. ONLY extract a holiday-adjacent trend if it has a SPECIFIC named anchor on top, e.g. "Charli XCX surprise Mother's Day Twitch concert" or "Sephora 50% off Mother's Day drop".

RULE 3: DO NOT extract generic product categories. A specific named product (e.g. "Trader Joe's insulated mini totes", "Dubai chocolate bar") is fine. "Remineralizing gum" or "GLP-1 supplements" without a brand name is not.

RULE 4: DO NOT surface mature/established movements as fresh trends. Things like sourdough baking, kombucha, oat milk, matcha latte, ASMR, cottagecore, mob wife aesthetic, manifestation, bullet journaling, etc. have already had their viral moment YEARS ago. Only include them if there is a SPECIFIC new hook this month — e.g. "Charli XCX dropped a sourdough recipe video that hit 8M views" or "Izzio launched a new gluten-free bread line that is going viral on TikTok with #IzzioLaunch". Otherwise skip them — Action's marketing team is past these movements.

# FIELDS PER TREND
- name: specific label (e.g. "Strawberry girl summer aesthetic", not "summer aesthetics")
- description: 2-3 sentences: (1) what it looks like specifically, (2) who's doing it, (3) why NOW
- category: ONE of [${VALID_CATEGORIES.join(', ')}]
- contentType: ONE of [${VALID_CONTENT_TYPES.join(', ')}]
- hashtags: specific hashtags seen in the content WITH # prefix
- popularityScore: integer 1-10, signal strength in THIS source
- reasoning: 1 sentence with a concrete signal (view count, post volume, rank position)
- estimatedViews: human-readable if available (e.g. "2.3M posts", "#3 trending NL", "59K posts/7d")
- exampleUrls: PRIORITIZE direct video URLs (tiktok.com, instagram.com/reel, youtube.com/shorts, youtu.be). Pull them from the content if present. Blog/news article URLs only if no direct video link is available. The team wants to WATCH the trend, not read about it.

# OUTPUT
Valid JSON only, no markdown fences:

{
  "trends": [
    { "name": "...", "description": "...", "category": "...", "contentType": "...",
      "hashtags": ["#..."], "popularityScore": 7, "reasoning": "...",
      "estimatedViews": "...", "exampleUrls": ["..."] }
  ]
}

If the content contains no specific named trends, return { "trends": [] }.`

  const model = genAI.getGenerativeModel({
    model: CULTURE_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
    },
  })

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  const usage = result.response.usageMetadata

  const parsed = extractJson<{ trends?: unknown }>(text)
  const rawTrends = Array.isArray(parsed?.trends) ? parsed.trends : []

  const trends: AIIdentifiedTrend[] = rawTrends
    .filter((t): t is Record<string, unknown> => t !== null && typeof t === 'object')
    .map((t) => normalizeTrend(t, sourceCategory))
    .filter((t): t is AIIdentifiedTrend => t !== null)

  return {
    trends,
    modelUsed: CULTURE_GEMINI_MODEL,
    tokensIn: usage?.promptTokenCount,
    tokensOut: usage?.candidatesTokenCount,
  }
}

function normalizeTrend(
  raw: Record<string, unknown>,
  fallbackCategory: CultureCategory,
): AIIdentifiedTrend | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return null

  const description =
    typeof raw.description === 'string' ? raw.description.trim() : ''
  if (!description) return null

  // Reject generic, non-specific "trends" that are really just categories.
  if (isGenericTrendName(name) || isGenericDescription(description)) {
    return null
  }

  // Reject calendar-anchored content surges (Mother's Day Celebrations etc.)
  // — these peak on the day and are too late by the time they reach Action.
  if (looksLikePostEventSurge(name, description)) {
    return null
  }

  // Require at least one specificity anchor: hashtag, @handle, quoted
  // string, recognised number ("3M views", "#1 trending"), or a Title-Case
  // proper noun. Without an anchor it's just a concept, not a trend.
  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning : ''
  if (!hasAnchor(name, description, reasoning, raw)) {
    return null
  }

  const category = isCategory(raw.category) ? raw.category : fallbackCategory
  const contentType = isContentType(raw.contentType) ? raw.contentType : 'format'

  const hashtags = Array.isArray(raw.hashtags)
    ? raw.hashtags
        .filter((h): h is string => typeof h === 'string')
        .map((h) => (h.startsWith('#') ? h : `#${h}`))
    : []

  let popularityScore = clampInt(
    typeof raw.popularityScore === 'number' ? raw.popularityScore : 5,
    1,
    10,
  )

  // Demote mature concepts without a fresh hook so they don't claim Top 10.
  if (looksLikeMatureConcept(name, description)) {
    popularityScore = Math.min(popularityScore, 5)
  }

  const estimatedViews =
    typeof raw.estimatedViews === 'string' ? raw.estimatedViews : undefined
  const exampleUrls = Array.isArray(raw.exampleUrls)
    ? raw.exampleUrls.filter((u): u is string => typeof u === 'string')
    : undefined

  return {
    name,
    description,
    category,
    contentType,
    hashtags,
    popularityScore,
    reasoning,
    estimatedViews,
    exampleUrls,
  }
}

function isCategory(v: unknown): v is CultureCategory {
  return typeof v === 'string' && VALID_CATEGORIES.includes(v as CultureCategory)
}

function isContentType(v: unknown): v is AIIdentifiedTrend['contentType'] {
  return typeof v === 'string' && VALID_CONTENT_TYPES.includes(v)
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

// ── Post-event holiday filter ──────────────────────────────────────────────
//
// Trends like "Mother's Day Celebrations" peak ON the holiday and die within
// 24-48h. By the time they surface in Culture Radar (lag from scrape to
// dashboard) they're already too late to act on. These calendar-anchored
// content surges belong in Moments Radar's forward-looking view, not in the
// "trending right now" Culture Radar.
//
// Reject any trend whose name contains a major holiday keyword PLUS a
// generic event noun (celebration, content, day, hype).

// ── Mature concept filter ──────────────────────────────────────────────────
//
// Established movements that have ALREADY had their viral moment years ago.
// A trend mentioning these without a SPECIFIC fresh hook (this-month brand
// launch, named viral creator with a recent video, a specific new product
// drop) gets demoted from popularity 8-10 to 5-6 — keeps it in the radar
// but stops it from claiming the Top 10.
const MATURE_CONCEPTS = [
  // Food / drink (peaked 2020-2023)
  'sourdough', 'kombucha', 'oat milk', 'matcha latte', 'matcha',
  'avocado toast', 'overnight oats', 'bulletproof coffee',
  'celery juice', 'golden milk',
  // Lifestyle / wellness (peaked 2018-2022)
  'mindfulness', 'self-care sunday', 'cold plunge', 'cold shower',
  'bullet journal', 'bullet journaling',
  'gratitude journal', 'vision board', 'manifestation',
  'asmr', 'minimalism lifestyle',
  // Aesthetics that already had their viral peak
  'cottagecore', 'dark academia', 'goblincore', 'y2k aesthetic',
  'mob wife', 'tomato girl', 'clean girl aesthetic',
  // Workout / fitness (long-established)
  'hot yoga', 'spin class', 'crossfit', 'paleo diet', 'keto diet',
  // Tech (mature)
  'metaverse', 'web3', 'nft', 'crypto',
]

// Signals that override the mature-concept demotion — if any of these appear
// in the description, we trust there's a genuine fresh hook.
const FRESH_HOOK_SIGNALS = [
  /\b(launched|launching|just released|just dropped|premiered|debuted)\b/i,
  /\b(this week|this month|today|yesterday|last 7 days|last week)\b/i,
  /\b\d+m\s+views?\s+in\s+(a\s+)?(week|month|day|days)/i,
  /\b\d+x\s+(growth|increase)/i,
  /#\d+\s+(trending|spot)/i,
  /\b(charli xcx|taylor swift|beyonc[eé]|kim k|kardashian|drake|sabrina carpenter)\b/i,
]

function looksLikeMatureConcept(name: string, description: string): boolean {
  const text = `${name} ${description}`.toLowerCase()
  const hitsMature = MATURE_CONCEPTS.some((kw) => text.includes(kw))
  if (!hitsMature) return false
  // Has a fresh hook? Let it through at full popularity.
  const hasFreshHook = FRESH_HOOK_SIGNALS.some((re) => re.test(`${name} ${description}`))
  return !hasFreshHook
}

const HOLIDAY_KEYWORDS = [
  // Mother / Father (multi-lang) — both spaced AND hashtag-style
  "mother's day", 'mothers day', 'mothersday', 'happymothersday',
  'moederdag', 'fête des mères', 'fetedesmeres', 'festa della mamma',
  'festadellamamma', 'día de la madre', 'dia de la madre', 'diadelamadre',
  'dia de las madres', 'diadelasmadres', 'dia da mãe', 'diadamae',
  'muttertag', 'anyák napja', 'anyaknapja', 'dzień matki', 'dzienmatki',
  '10demayo', '10 de mayo', 'feliz dia das mães', '#mamá', '#madre', '#mother',
  "father's day", 'fathers day', 'fathersday',
  'vaderdag', 'fête des pères', 'fetedesperes', 'vatertag',
  'día del padre', 'diadelpadre', 'dia do pai', 'diadopai',
  // Religious / calendar
  "valentine's day", 'valentijnsdag', 'valentijn', 'valentinesday',
  'easter sunday', 'pasen', 'pâques', 'ostern', 'easter2026',
  'carnival', 'carnaval', 'mardi gras', 'mardigras',
  "king's day", 'koningsdag', 'kingsday',
  'halloween',
  'sinterklaas',
  'christmas eve', 'christmas day', "new year's eve", 'newyearseve',
  // Public events / awards
  'met gala', 'metgala', 'cannes film festival', 'cannesfilmfestival',
  'eurovision',
  'oscars', 'grammys',
]

const POST_EVENT_GENERIC_SUFFIXES = [
  'celebrations', 'celebration', 'content', 'hype', 'season',
  'recap', 'wave', 'rush', 'craze', 'discussions',
]

function looksLikePostEventSurge(name: string, description: string): boolean {
  const lowerName = name.toLowerCase()
  const lowerDesc = description.toLowerCase()
  const hasHoliday = HOLIDAY_KEYWORDS.some(
    (kw) => lowerName.includes(kw) || lowerDesc.includes(kw),
  )
  if (!hasHoliday) return false
  const hasGenericSuffix = POST_EVENT_GENERIC_SUFFIXES.some(
    (suf) => lowerName.includes(suf),
  )
  // If both holiday word AND generic suffix → reject.
  // Specific named trends like "Mother's Day Charli XCX merch" survive
  // because they have a named anchor on top.
  return hasGenericSuffix
}

// ── Generic trend filter ────────────────────────────────────────────────────
//
// Even with the "demand specificity" prompt, Gemini occasionally extracts
// category-level labels like "Viral TikTok Sounds" or "Beauty Trends".
// These are useless — they describe a platform, not a trend. We reject
// them here before they hit the DB.

const GENERIC_NAME_PREFIXES = [
  'viral',
  'trending',
  'popular',
  'top ',
  'latest',
  'rising',
  'emerging',
  'best',
  'biggest',
  'most',
  'new',
  'hot',
  'recent',
]

// Names that are JUST a generic noun (no specific identifier).
const GENERIC_NOUN_NAMES = new Set([
  'sounds',
  'audio',
  'music',
  'songs',
  'memes',
  'trends',
  'content',
  'posts',
  'videos',
  'reels',
  'shorts',
  'aesthetics',
  'formats',
  'challenges',
  'dances',
  'hashtags',
])

// ── Specificity anchor requirement ──────────────────────────────────────────
//
// Every accepted trend must contain at least one of:
//   - a hashtag (in the hashtags array, OR in the name/description)
//   - a creator handle (@xyz)
//   - a quoted string ("Glazed donut nails")
//   - a quantified claim (3M views, #1 trending NL)
//   - a Title-Case multi-word proper noun (named song, brand, person)
//
// Without an anchor the "trend" is just a category description — useless
// for Action's content team because they can't point at a real signal.
function hasAnchor(
  name: string,
  description: string,
  reasoning: string,
  raw: Record<string, unknown>,
): boolean {
  const allText = `${name} ${description} ${reasoning}`
  const hashtagsArr = Array.isArray(raw.hashtags) ? raw.hashtags : []

  // Hashtag in array or inline (#word)
  if (hashtagsArr.length > 0) return true
  if (/#\w{3,}/.test(allText)) return true

  // Creator handle
  if (/@\w{3,}/.test(allText)) return true

  // Quoted named entity (e.g. "What Was That", 'brat summer')
  if (/["“']([^"”']{3,40})["”']/.test(allText)) return true

  // Quantified signal — views/posts/likes/streams/rank
  if (/\b\d+[\d.,]*\s?[KMB]\s?(views?|posts?|likes?|streams?|plays?|followers?)/i.test(allText)) {
    return true
  }
  if (/#\d+\s+trending/i.test(allText)) return true
  if (/\b\d+[\d.,]*\s?(million|thousand|billion)\b/i.test(allText)) return true

  // Title-Case multi-word proper noun: "Carolyn Bessette-Kennedy",
  // "Charli XCX", "Dawn Powerwash", "Trader Joe's"
  if (/\b[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?\s+[A-Z][a-z]+/.test(`${name} ${description}`)) {
    return true
  }
  // Single capitalised acronym OR Title-Case all-caps word like "GLP-1"
  // only counts when paired with another distinctive token — so the
  // bare "GLP-1 Supplements" won't pass, but "GLP-1 Ozempic alternative" will.

  return false
}

function isGenericTrendName(name: string): boolean {
  const norm = name.toLowerCase().trim()
  if (!norm) return true

  // Reject if name starts with a vague modifier and contains a category word.
  for (const prefix of GENERIC_NAME_PREFIXES) {
    if (norm.startsWith(prefix + ' ') || norm === prefix.trim()) {
      const rest = norm.slice(prefix.length).trim()
      // "viral tiktok sounds" → rest = "tiktok sounds" → both are platform/noun
      // "trending memes" → rest = "memes" → generic noun
      const words = rest.split(/\s+/).filter(Boolean)
      const lastWord = words[words.length - 1] ?? ''
      if (GENERIC_NOUN_NAMES.has(lastWord)) return true
      // Just "viral memes" / "viral sounds" / "viral songs"
      if (words.length <= 2 && words.every((w) => GENERIC_NOUN_NAMES.has(w) || PLATFORM_WORDS.has(w))) {
        return true
      }
    }
  }

  // Bare generic noun: "Memes", "Trends", "Sounds"
  const words = norm.split(/\s+/).filter(Boolean)
  if (words.length === 1 && GENERIC_NOUN_NAMES.has(words[0])) return true

  // Two-word names where both are platform/generic: "TikTok Memes", "Reels Trends"
  if (words.length === 2 && words.every((w) => GENERIC_NOUN_NAMES.has(w) || PLATFORM_WORDS.has(w))) {
    return true
  }

  return false
}

const PLATFORM_WORDS = new Set([
  'tiktok',
  'instagram',
  'reels',
  'shorts',
  'youtube',
  'twitter',
  'x',
  'threads',
  'pinterest',
  'snapchat',
  'social',
  'media',
])

// Descriptions that just define a category instead of describing a trend.
// We flag them by looking for telltale "definitional" phrasing combined with
// no specific named entities (no quoted strings, no hashtags, no creator names).
function isGenericDescription(desc: string): boolean {
  const norm = desc.toLowerCase()
  const definitionalPhrases = [
    'audio clips and music tracks',
    'content that gains popularity',
    'driving engagement and content creation',
    'primary driver of social media',
    'widespread popularity on social media',
    'a category of',
    'a type of content',
    'general trend of',
  ]
  const looksDefinitional = definitionalPhrases.some((p) => norm.includes(p))
  if (!looksDefinitional) return false

  // If it has any hashtag or quoted string or '@' mention, it has at least
  // one specific anchor — let it through.
  const hasAnchor =
    /["“][^"”]{2,}["”]/.test(desc) ||
    /#\w{3,}/.test(desc) ||
    /@\w{3,}/.test(desc) ||
    // Title-cased multi-word name (e.g. "Charli XCX", "Rebecca Black")
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(desc)
  return !hasAnchor
}
