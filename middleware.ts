import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isRateLimited } from '@/lib/rate-limit'

const RATE_LIMITS: Record<string, number> = {
  '/api/audio-checker': 10,
  '/api/copy-check': 10,
  '/api/scan': 800,
  '/api/trends': 5,
  '/api/price-lookup': 20,
  '/api/brand-guidelines': 10,
}

function getRateLimit(pathname: string): number {
  for (const [prefix, limit] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) return limit
  }
  return 30 // default
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.startsWith('/api/')) return NextResponse.next()

  // --- Auth check (skip for SSE streams and /api/auth/* routes) ---
  const isSSE = pathname.endsWith('/stream') && request.method === 'GET'
  const isAuthRoute = pathname.startsWith('/api/auth/')
  const secret = process.env.API_SECRET
  if (!isSSE && !isAuthRoute) {
    if (!secret) {
      // API_SECRET not configured — reject all API requests in production
      console.error('[Middleware] API_SECRET environment variable is not set')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // --- Rate limit ---
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const limit = getRateLimit(pathname)
  if (isRateLimited(ip, pathname, limit)) {
    return NextResponse.json(
      { error: 'Te veel verzoeken. Probeer het over een minuut opnieuw.' },
      { status: 429 },
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
