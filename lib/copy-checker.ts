import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_MODEL } from '@/lib/constants'
import type { CopyCheckResult, ExtractedCopy } from '@/types/copy-checker'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')

async function generateWithRetry(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  parts: Parameters<typeof model.generateContent>[0],
  retries = 5
): Promise<ReturnType<typeof model.generateContent> extends Promise<infer T> ? T : never> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await model.generateContent(parts) as never
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const isAuthError = msg.includes('401') || msg.includes('403') || msg.includes('API key')
      if (isAuthError) throw err
      const is429 = msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('quota') || msg.includes('503')
      if (is429 && attempt < retries) {
        const retryMatch = msg.match(/retry.*?(\d+)s/i)
        const waitMs = retryMatch ? parseInt(retryMatch[1]) * 1000 : Math.min(30000, 5000 * Math.pow(2, attempt))
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries exceeded')
}

const PROMPT = `You are a brand compliance expert. The attached PDF contains brand guidelines.
The user will provide social media copy text. Analyze the copy strictly against the guidelines in the PDF.

Respond ONLY with a valid JSON object matching this exact structure — no markdown, no extra text:

{
  "status": "pass",
  "issues": [
    {
      "category": "Tone of voice",
      "description": "Description of the specific issue",
      "severity": "error"
    }
  ],
  "suggestions": [
    "Specific actionable suggestion to improve the copy"
  ],
  "rewrittenOptions": [
    "Full rewritten version of the copy that is 100% compliant with the guidelines",
    "A second alternative rewritten version with a slightly different angle"
  ],
  "summary": "One-sentence overall assessment."
}

Rules:
- status: "pass" if no issues, "warning" if only warnings, "fail" if any errors
- issues: empty array [] if none found
- severity: "error" for clear violations, "warning" for minor deviations or ambiguities
- suggestions: concrete actionable tips explaining what to change, empty array [] if copy is perfect
- rewrittenOptions: when status is "fail" or "warning", provide 2-3 complete rewritten versions of the copy that fully comply with the guidelines. Preserve the original intent and message but fix all violations. Empty array [] if status is "pass" (copy is already compliant)
- summary: a single sentence explaining the overall result
- Check for: tone of voice, brand terminology, prohibited words/phrases, formatting rules, grammar, and anything else specified in the guidelines`

const EXTRACT_PROMPT = `You are reading a PDF containing weekly social media copy drafts for Action (European discount retailer).
Extract ALL individual copy blocks from this document. For each copy block, identify its label or heading (e.g. "Draft 1", "Optie A", "Week 8 - Variant 2", or the nearest section heading). If no label is found, use "Copy 1", "Copy 2", etc.

Respond ONLY with a valid JSON array — no markdown, no extra text:
[
  {"draftName": "Draft 1", "copyText": "The full copy text exactly as written..."},
  {"draftName": "Draft 2", "copyText": "Another copy text..."}
]

Rules:
- Include every distinct copy block, no matter how short
- Preserve the full copy text exactly as written, including line breaks
- Use the nearest heading/label as draftName
- Do not combine multiple copies into one`

export async function extractCopiesFromPdf(draftPdfBase64: string): Promise<ExtractedCopy[]> {
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: 'You are a document parser. Extract structured data from PDFs and return valid JSON only — no markdown, no explanation.',
  })

  const result = await generateWithRetry(model, [
    { inlineData: { data: draftPdfBase64, mimeType: 'application/pdf' } },
    EXTRACT_PROMPT,
  ])

  const rawText = result.response.text()
  try {
    const cleaned = rawText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) throw new Error('Not an array')
    return parsed.filter((item) => item.draftName && item.copyText)
  } catch {
    return [{ draftName: 'All copies', copyText: rawText.slice(0, 2000) }]
  }
}

export async function analyzeCopy(
  pdfBase64: string,
  copyText: string
): Promise<CopyCheckResult> {
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction:
      'You are a brand compliance expert. Analyze social media copy against brand guidelines. Always respond with valid JSON only — no markdown fences, no explanation text.',
  })

  const result = await generateWithRetry(model, [
    {
      inlineData: {
        data: pdfBase64,
        mimeType: 'application/pdf',
      },
    },
    `${PROMPT}\n\nCopy to check:\n"""\n${copyText.replace(/"""/g, '\\"\\"\\\"')}\n"""`,
  ])

  const rawText = result.response.text()

  try {
    const cleaned = rawText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    const toStringArray = (arr: unknown): string[] =>
      Array.isArray(arr)
        ? arr.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
        : []

    return {
      status: parsed.status ?? 'warning',
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: toStringArray(parsed.suggestions),
      rewrittenOptions: toStringArray(parsed.rewrittenOptions),
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    }
  } catch {
    return {
      status: 'warning',
      issues: [],
      suggestions: [],
      rewrittenOptions: [],
      summary: `Failed to parse AI response: ${rawText.slice(0, 200)}`,
    }
  }
}
