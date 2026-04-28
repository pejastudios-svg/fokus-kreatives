import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin' && me?.role !== 'manager') {
      return NextResponse.json(
        { success: false, error: 'Admins or managers only' },
        { status: 403 },
      )
    }

    const { id } = (await req.json()) as { id?: string }
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }

    // FK cascades will drop the answers automatically.
    const { error } = await admin.from('series_forms').delete().eq('id', id)
    if (error) {
      console.error('series-form delete error:', error)
      return NextResponse.json({ success: false, error: 'Failed to delete' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('series-form delete exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
