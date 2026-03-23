import { NextRequest } from 'next/server'
import { sessionStore } from '@/lib/session-store'
import { SESSION_POLL_INTERVAL_MS } from '@/lib/constants'
import type { ScanStreamEvent, ScanSummary } from '@/types/scanner'

// GET /api/scan/[sessionId]/stream — Server-Sent Events for real-time progress
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(sessionId)) {
    return new Response('Session not found', { status: 404 })
  }

  if (!(await sessionStore.has(sessionId))) {
    return new Response('Session not found', { status: 404 })
  }

  const encoder = new TextEncoder()
  let lastSentIndex = 0
  const startTime = Date.now()

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: ScanStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      let polling = true

      const poll = async () => {
        while (polling) {
          try {
            const session = await sessionStore.get(sessionId)
            if (!session) {
              controller.close()
              return
            }

            // Send any new results since last poll
            const newResults = session.results.slice(lastSentIndex)
            for (const result of newResults) {
              send({ type: 'result', result })
              lastSentIndex++
            }

            // Send progress update
            send({
              type: 'progress',
              processed: session.processed,
              total: session.total,
              currentFile: newResults.length > 0 ? newResults[newResults.length - 1].filename : '',
            })

            // Check for completion or error
            if (session.status === 'complete' || session.status === 'error' || session.status === 'cancelled') {
              const summary: ScanSummary = {
                total: session.total,
                passed: session.results.filter((r) => r.status === 'pass').length,
                failed: session.results.filter((r) => r.status === 'fail').length,
                warnings: session.results.filter((r) => r.status === 'warning').length,
                errors: session.results.filter((r) => r.status === 'error').length,
                durationMs: Date.now() - startTime,
              }
              send({ type: 'complete', summary })
              controller.close()
              return
            }
          } catch {
            // DB error — keep polling
          }

          await new Promise((resolve) => setTimeout(resolve, SESSION_POLL_INTERVAL_MS))
        }
      }

      poll().catch((err) => {
        console.error('[SSE] poll() crashed:', err)
        try {
          send({ type: 'complete', summary: { total: 0, passed: 0, failed: 0, warnings: 0, errors: 1, durationMs: Date.now() - startTime } })
          controller.close()
        } catch { /* already closed */ }
      })

      req.signal.addEventListener('abort', () => {
        polling = false
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

// DELETE /api/scan/[sessionId]/stream — cancel a scan
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const UUID_RE_DEL = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (UUID_RE_DEL.test(sessionId) && await sessionStore.has(sessionId)) {
    await sessionStore.update(sessionId, { status: 'cancelled' })
    return new Response(null, { status: 204 })
  }
  return new Response('Not found', { status: 404 })
}
