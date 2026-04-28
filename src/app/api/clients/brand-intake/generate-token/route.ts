import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin' && me?.role !== 'manager') {
      return NextResponse.json({ success: false, error: 'Admins or managers only' }, { status: 403 })
    }

    const body = (await req.json()) as { clientId?: string }
    const clientId = body.clientId?.trim()

    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const token = randomUUID()

    const { error } = await admin
      .from('clients')
      .update({ brand_intake_token: token })
      .eq('id', clientId)

    if (error) {
      console.error('generate intake token error:', error)
      return NextResponse.json({ success: false, error: 'Failed to generate link' }, { status: 500 })
    }

    return NextResponse.json({ success: true, token })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
