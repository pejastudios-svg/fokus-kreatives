import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
  }

  const { data: form, error } = await supabase
    .from('series_forms')
    .select(
      'id, client_id, title, series_label, series_length, format, framing, questions, cta_text, brand_line, submitted_at, created_at',
    )
    .eq('token', token)
    .maybeSingle()

  if (error || !form) {
    return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 404 })
  }

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, business_name, profile_picture_url, industry')
    .eq('id', form.client_id)
    .maybeSingle()

  // Pull any saved answers so the client can resume / edit
  const { data: answers } = await supabase
    .from('series_answers')
    .select('question_id, answer, entry_index')
    .eq('series_form_id', form.id)

  return NextResponse.json({
    success: true,
    form: {
      id: form.id,
      title: form.title,
      series_label: form.series_label,
      series_length: form.series_length,
      format: form.format,
      framing: form.framing,
      questions: form.questions,
      cta_text: form.cta_text,
      brand_line: form.brand_line,
      already_submitted: !!form.submitted_at,
    },
    client: client || null,
    answers: answers || [],
  })
}
