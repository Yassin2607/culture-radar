/**
 * Culture Radar — Action-specific trend brief generator.
 *
 * Given a trend (name, description, category, optional context), asks Gemini
 * to produce a structured brief that tells the Action team:
 *   - Why this matters for Action right now
 *   - Which product categories connect
 *   - A concrete, executable content angle
 *   - Urgency (how fast to act)
 *   - Lifecycle stage
 *   - The underlying cultural driver
 *
 * Used by:
 *   - /api/culture/submit  → always, for manually spotted trends
 *   - /api/culture/fetch   → for top-ranked trends after each run
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { CULTURE_GEMINI_MODEL } from '@/lib/constants'
import { extractJson } from '@/lib/culture-radar'
import type { ActionBrief } from '@/types/culture'

export type { ActionBrief }

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')

/**
 * ACTION context injected into every brief prompt.
 * Keep this tight — Gemini reads the whole thing every call.
 */
const ACTION_CONTEXT = `
Action is a European discount retail chain in 14 countries (NL, FR, DE, BE, ES, IT, PL, CZ, SK, HU, AT, CH, RO, PT).

Product mix (all at extremely low prices):
- Cleaning & household (core)
- Seasonal: Halloween, Xmas, Easter, summer, back-to-school
- Garden & DIY
- Office & school supplies
- Beauty basics (drugstore level)
- Candy & snacks
- Toys & games
- Party supplies & decorations
- Home decor & storage
- Clothing basics

Customer: cost-conscious families + young adults who love a good deal. They follow trends but only buy if it's affordable.

CRITICAL: Action runs a TikTok BUSINESS ACCOUNT. Business accounts have legally
restricted music access — they may ONLY use sounds from the TikTok Commercial
Music Library (CML), TikTok's royalty-free pool, original sounds Action creates,
or music for which Action has bought a sync license. Using regular pop/commercial
music = automatic takedown and possible copyright claim. Action has been hit
with a sound claim before; do not repeat the mistake.
`.trim()

/**
 * Sound licensing classification rules used in the prompt. Kept as a constant
 * so we can iterate the wording in one place.
 */
const SOUND_LICENSING_RULES = `
SOUND LICENSING ASSESSMENT — apply this every time you pick a sound:

SAFE (soundRisk = "safe") only when ALL of these hold:
  - Royalty-free / public domain / Creative Commons (e.g. Kevin MacLeod,
    Free Music Archive, incompetech.com tracks)
  - OR explicitly known to be in the TikTok Commercial Music Library (CML)
  - OR a TikTok-native generic sound (anonymous "original sound" with no
    copyrighted music underneath)

RISKY (soundRisk = "risky") for any of:
  - Commercial pop / rap / dance music by a named artist or label
    (Charli XCX, NSYNC, Rebecca Black, Michael Jackson, Armin van Buuren,
    any chart song, sped-up remixes of chart songs, etc.)
  - "Original sound by @creator" using a recognizable copyrighted song
  - Anything where the rights aren't clearly cleared for commercial use

UNKNOWN (soundRisk = "unknown") if you genuinely cannot tell.

For soundWarning:
  - SAFE: 1 short sentence confirming why it is safe ("Royalty-free under
    Creative Commons" / "Available in TikTok Commercial Music Library")
  - RISKY: 1 short, direct sentence Action's social team can act on, e.g.
    "Commercial track — Action's business account cannot use it; either
    swap to a CML alternative or do not post with this sound."
  - UNKNOWN: "Verify in the TikTok Commercial Music Library before posting."

If the suggestedSound is risky, also rewrite the contentAngle to make the
post work WITHOUT specifying that exact sound (so the team has a backup).
`.trim()

export interface TrendingSoundContext {
  name: string
  description: string
}

export async function generateActionBrief(trend: {
  name: string
  description: string
  category: string
  brandExample?: string | null
  url?: string | null
  /** Currently trending sounds the brief can reference for TikTok/Reels content angles. */
  trendingSounds?: TrendingSoundContext[]
}): Promise<ActionBrief | null> {
  const model = genAI.getGenerativeModel({
    model: CULTURE_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  })

  const context = [
    trend.brandExample ? `Spotted at: ${trend.brandExample}` : null,
    trend.url ? `Reference: ${trend.url}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  // Build the trending-sounds menu the AI can pick from for the suggestion.
  const soundsList = (trend.trendingSounds ?? [])
    .slice(0, 12)
    .map((s, i) => `${i + 1}. ${s.name} — ${s.description.slice(0, 140)}`)
    .join('\n')

  const soundsBlock = soundsList
    ? `\n# TRENDING SOUNDS (currently in our Culture Radar — pick one if it fits)\n${soundsList}\n`
    : ''

  const prompt = `You are a cultural intelligence analyst briefing the Action marketing and buying team.

${ACTION_CONTEXT}

---

${SOUND_LICENSING_RULES}

---

TREND TO ANALYZE:
Name: ${trend.name}
Category: ${trend.category}
Description: ${trend.description}
${context ? context + '\n' : ''}${soundsBlock}
---

Produce a concise, specific brief for Action. Be concrete — no generic statements.
Bad: "Action can use this to reach younger audiences."
Good: "The CE2026 exam meme wave peaks this week — Action can post a student packing their school bag from Action's stationery aisle."

For "suggestedSound": pick the ONE trending sound from the list above that best fits
the content angle, and explain in 1 short sentence WHY it fits. Use the EXACT name
from the list. If no sound fits naturally (e.g. for a static aesthetic, an in-store
moment, or a non-video format), return null — do not force it.

Then for "soundRisk" and "soundWarning": apply the SOUND LICENSING ASSESSMENT
rules above. If suggestedSound is null, return null for both. Default to "risky"
when uncertain — Action would rather pass on a risky suggestion than get hit
with another sound claim.

Return ONLY valid JSON:
{
  "actionRelevance": "1 concrete sentence: what this means for Action's products, content, or buying agenda",
  "productCategories": ["up to 3 specific Action product categories that connect, e.g. 'School supplies', 'Party decorations'"],
  "contentAngle": "One specific, executable social post idea for Action — describe the visual, the caption angle, or the product tie-in",
  "suggestedSound": "<exact sound name from list> — <1 short sentence why it fits>" or null,
  "soundRisk": "safe" | "risky" | "unknown" or null,
  "soundWarning": "1 short, action-oriented sentence for the social team" or null,
  "urgency": <integer 1-10, where 10 = act this week before it peaks>,
  "lifecycleStage": "<one of: emerging | growing | peak | saturating>",
  "whyNow": "1 sentence on the cultural or seasonal driver making this trend happen right now"
}`

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text()
    const parsed = extractJson<ActionBrief>(text)
    if (!parsed || !parsed.actionRelevance) return null

    // Clamp urgency
    parsed.urgency = Math.min(10, Math.max(1, Math.round(parsed.urgency)))

    // Validate lifecycle stage
    const validStages = ['emerging', 'growing', 'peak', 'saturating']
    if (!validStages.includes(parsed.lifecycleStage)) {
      parsed.lifecycleStage = 'growing'
    }

    // Max 3 product categories
    parsed.productCategories = (parsed.productCategories ?? []).slice(0, 3)

    // Normalize suggestedSound: keep string or null, drop empty/placeholder
    const ss = (parsed as { suggestedSound?: unknown }).suggestedSound
    parsed.suggestedSound =
      typeof ss === 'string' && ss.trim().length > 3 && ss.toLowerCase() !== 'null'
        ? ss.trim()
        : null

    // Normalize sound risk fields. If there is no suggested sound, both go null.
    if (!parsed.suggestedSound) {
      parsed.soundRisk = null
      parsed.soundWarning = null
    } else {
      const validRisks = ['safe', 'risky', 'unknown']
      // Default to 'risky' when missing or invalid — safer for Action.
      parsed.soundRisk = validRisks.includes(parsed.soundRisk as string)
        ? parsed.soundRisk
        : 'risky'
      // soundWarning should be a non-empty string for risky/unknown cases.
      const sw = (parsed as { soundWarning?: unknown }).soundWarning
      parsed.soundWarning =
        typeof sw === 'string' && sw.trim().length > 3 ? sw.trim() : null
      // If we marked risky and the AI didn't include a warning, inject one.
      if (parsed.soundRisk === 'risky' && !parsed.soundWarning) {
        parsed.soundWarning =
          "Likely commercial music — Action's business account cannot use it. Swap to a Commercial Music Library track or use original audio."
      }
      if (parsed.soundRisk === 'unknown' && !parsed.soundWarning) {
        parsed.soundWarning =
          'Licensing unclear — verify in the TikTok Commercial Music Library before posting.'
      }
    }

    return parsed
  } catch (err) {
    console.error('[culture-action-brief] Gemini call failed:', err)
    return null
  }
}
