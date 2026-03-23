import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const TABLE = 'brand_guidelines'
const ROW_ID = 'main'

export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from(TABLE)
      .select('base64, filename')
      .eq('id', ROW_ID)
      .single()
    if (!data || !data.base64) {
      return NextResponse.json({ exists: false })
    }
    return NextResponse.json({ exists: true, base64: data.base64, filename: data.filename ?? 'brand-guidelines.pdf' })
  } catch {
    return NextResponse.json({ exists: false })
  }
}

export async function POST(req: NextRequest) {
  const { base64, filename } = await req.json()
  if (!base64 || typeof base64 !== 'string') return NextResponse.json({ error: 'No base64 provided' }, { status: 400 })
  if (base64.length > 6_800_000) {
    return NextResponse.json({ error: 'Bestand te groot. Maximum 5MB.' }, { status: 400 })
  }
  // Validate actual PDF file signature (%PDF-)
  try {
    const header = Buffer.from(base64.slice(0, 12), 'base64').toString('binary')
    if (!header.startsWith('%PDF-')) {
      return NextResponse.json({ error: 'Ongeldig bestand. Alleen PDF bestanden zijn toegestaan.' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Ongeldig bestand.' }, { status: 400 })
  }
  if (filename && typeof filename === 'string') {
    const ext = filename.split('.').pop()?.toLowerCase()
    if (ext !== 'pdf') {
      return NextResponse.json({ error: 'Alleen .pdf bestanden zijn toegestaan.' }, { status: 400 })
    }
  }
  await supabaseAdmin.from(TABLE).upsert({
    id: ROW_ID,
    base64,
    filename: filename ?? 'brand-guidelines.pdf',
  })
  return NextResponse.json({ success: true })
}

export async function DELETE() {
  await supabaseAdmin.from(TABLE).delete().eq('id', ROW_ID)
  return NextResponse.json({ success: true })
}
