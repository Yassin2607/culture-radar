import { NextRequest, NextResponse } from 'next/server'
import { sessionStore } from '@/lib/session-store'
import { analyzeImage } from '@/lib/claude'
import type { ProcessableFile, ImageResult } from '@/types/scanner'

// Allow large request bodies (images as base64)
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// POST /api/scan/[sessionId]/batch
// Receives a batch of images, processes them concurrently, and stores each
// result immediately so the SSE stream can emit real-time progress updates.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  const sessionOrUndef = await sessionStore.get(sessionId)

  if (!sessionOrUndef) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const session = sessionOrUndef

  if (session.status === 'cancelled') {
    return NextResponse.json({ cancelled: true })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err) {
    return NextResponse.json({ error: `FormData parse error: ${err instanceof Error ? err.message : String(err)}` }, { status: 400 })
  }

  const metadataRaw = formData.get('metadata')
  if (!metadataRaw || typeof metadataRaw !== 'string') {
    return NextResponse.json({ error: 'Missing metadata' }, { status: 400 })
  }

  const meta: { id: string; filename: string; mimeType: string } = JSON.parse(metadataRaw)
  const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
  if (!ALLOWED_MIMES.has(meta.mimeType)) {
    return NextResponse.json({ error: 'Ongeldig bestandstype. Alleen afbeeldingen zijn toegestaan.' }, { status: 400 })
  }
  const blob = formData.get('file') as Blob | null
  let base64 = ''
  if (blob) {
    const buffer = Buffer.from(await blob.arrayBuffer())
    base64 = buffer.toString('base64')
  }

  const file: ProcessableFile = {
    id: meta.id,
    filename: meta.filename,
    mimeType: meta.mimeType,
    base64,
    objectUrl: '',
    sizeBytes: blob?.size ?? 0,
  }

  // Process the single file
  let result: ImageResult
  try {
    const analysis = await analyzeImage(file, session.config, null)
    result = {
      id: file.id,
      filename: file.filename,
      objectUrl: file.objectUrl,
      processedAt: new Date().toISOString(),
      ...analysis,
    }
  } catch (err) {
    result = {
      id: file.id,
      filename: file.filename,
      objectUrl: file.objectUrl,
      processedAt: new Date().toISOString(),
      status: 'error',
      languageCheck: null,
      priceCheck: null,
      brandCheck: null,
      summary: 'Processing failed',
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }

  // Atomic append — avoids race condition when multiple batch requests run concurrently
  await sessionStore.appendResult(sessionId, result)

  const updated = await sessionStore.get(sessionId)
  if (updated && updated.processed >= updated.total) {
    await sessionStore.update(sessionId, { status: 'complete' })
  }

  return NextResponse.json({ processed: 1 })
}
