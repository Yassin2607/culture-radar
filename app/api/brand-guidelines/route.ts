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
  if (!base64) return NextResponse.json({ error: 'No base64 provided' }, { status: 400 })
  if (typeof base64 === 'string' && base64.length > 6_800_000) {
    return NextResponse.json({ error: 'Bestand te groot. Maximum 5MB.' }, { status: 400 })
  }
  if (filename && typeof filename === 'string') {
    const ext = filename.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx', 'txt', 'doc'].includes(ext ?? '')) {
      return NextResponse.json({ error: 'Alleen .pdf, .docx en .txt bestanden zijn toegestaan.' }, { status: 400 })
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
