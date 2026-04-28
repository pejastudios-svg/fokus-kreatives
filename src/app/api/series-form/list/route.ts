import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

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
    const clientId = searchParams.get('clientId')

    let query = admin
      .from('series_forms')
      .select(
        'id, client_id, token, title, series_label, series_length, format, framing, submitted_at, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(50)

    if (clientId) query = query.eq('client_id', clientId)

    const { data, error } = await query

    if (error) {
      console.error('series-form list error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to load series forms' },
        { status: 500 },
      )
    }

    // Per-form answer counts
    const ids = (data || []).map((f) => f.id)
    const counts: Record<string, number> = {}
    if (ids.length) {
      const { data: rows } = await admin
        .from('series_answers')
        .select('series_form_id')
        .in('series_form_id', ids)
      for (const r of rows || []) {
        const id = r.series_form_id as string
        counts[id] = (counts[id] || 0) + 1
      }
    }

    const forms = (data || []).map((f) => ({ ...f, answer_count: counts[f.id] || 0 }))
    return NextResponse.json({ success: true, forms })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('series-form list exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
