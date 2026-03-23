import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { sessionStore } from '@/lib/session-store'
import { ALL_COUNTRIES, MAX_FILES } from '@/lib/constants'
import type { ScanConfig } from '@/types/scanner'

// POST /api/scan — create a new scan session
export async function POST(req: NextRequest) {
  const body = await req.json()
  const config: ScanConfig = body.config

  if (!config || !config.targetCountries || config.targetCountries.length === 0) {
    return NextResponse.json({ error: 'Invalid config: targetCountries required' }, { status: 400 })
  }

  const ALLOWED_COUNTRIES = ALL_COUNTRIES as readonly string[]
  const invalidCountry = config.targetCountries.find((c: string) => !ALLOWED_COUNTRIES.includes(c.toLowerCase()))
  if (invalidCountry) {
    return NextResponse.json({ error: `Ongeldig land: ${invalidCountry}` }, { status: 400 })
  }

  const sessionId = uuidv4()
  const total: number = Math.min(body.total ?? 0, MAX_FILES)

  // Clean up expired sessions opportunistically (fire-and-forget)
  sessionStore.cleanupExpired().catch(() => {})

  await sessionStore.set({
    id: sessionId,
    status: 'running',
    total,
    processed: 0,
    results: [],
    config,
    createdAt: Date.now(),
  })

  return NextResponse.json({ sessionId, total })
}
