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
    .from('question_forms')
    .select('id, client_id, title, questions, pillars, submitted_at, created_at')
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

  return NextResponse.json({
    success: true,
    form: {
      id: form.id,
      title: form.title,
      questions: form.questions,
      pillars: form.pillars,
      already_submitted: !!form.submitted_at,
    },
    client: client || null,
  })
}
