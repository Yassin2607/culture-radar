import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ScanSession } from '@/types/scanner'

// Supabase-backed session store — works across Vercel serverless invocations.

interface SessionRow {
  id: string
  status: string
  total: number
  processed: number
  results: unknown
  config: unknown
  created_at: string
}

function rowToSession(row: SessionRow): ScanSession {
  return {
    id: row.id,
    status: row.status as ScanSession['status'],
    total: row.total,
    processed: row.processed,
    results: row.results as ScanSession['results'],
    config: row.config as ScanSession['config'],
    createdAt: new Date(row.created_at).getTime(),
  }
}

export const sessionStore = {
  async get(id: string): Promise<ScanSession | undefined> {
    const { data, error } = await supabaseAdmin
      .from('scan_sessions')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !data) return undefined
    return rowToSession(data as SessionRow)
  },

  async set(session: ScanSession): Promise<void> {
    await supabaseAdmin.from('scan_sessions').upsert({
      id: session.id,
      status: session.status,
      total: session.total,
      processed: session.processed,
      results: session.results,
      config: session.config,
      created_at: new Date(session.createdAt).toISOString(),
    })
  },

  async update(id: string, patch: Partial<ScanSession>): Promise<void> {
    const dbPatch: Record<string, unknown> = {}
    if (patch.status !== undefined) dbPatch.status = patch.status
    if (patch.total !== undefined) dbPatch.total = patch.total
    if (patch.processed !== undefined) dbPatch.processed = patch.processed
    if (patch.results !== undefined) dbPatch.results = patch.results
    if (patch.config !== undefined) dbPatch.config = patch.config
    await supabaseAdmin.from('scan_sessions').update(dbPatch).eq('id', id)
  },

  async delete(id: string): Promise<void> {
    await supabaseAdmin.from('scan_sessions').delete().eq('id', id)
  },

  async has(id: string): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from('scan_sessions')
      .select('id')
      .eq('id', id)
      .single()
    return !!data
  },
}
