import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * Operator-side fetch: returns the series form + all answers + client profile,
 * gated on auth so the data stays private. The public /info route is used by
 * the unauthenticated fill page.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }

    const { data: form, error } = await admin
      .from('series_forms')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error || !form) {
      return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 })
    }

    const { data: client } = await admin
      .from('clients')
      .select('*')
      .eq('id', form.client_id)
      .maybeSingle()

    const { data: answers } = await admin
      .from('series_answers')
      .select('*')
      .eq('series_form_id', id)
      .order('entry_index', { ascending: true })

    return NextResponse.json({
      success: true,
      form,
      client,
      answers: answers || [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('series-form get exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
