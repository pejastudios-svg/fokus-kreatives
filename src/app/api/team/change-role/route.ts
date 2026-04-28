import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const VALID_ROLES = ['admin', 'manager', 'employee'] as const

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admins only' }, { status: 403 })
    }

    const body = (await req.json()) as { userId?: string; role?: string; password?: string }
    const userId = body.userId?.trim()
    const role = body.role?.trim() as (typeof VALID_ROLES)[number] | undefined
    const password = body.password ?? ''

    if (!userId) return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 })
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 })
    }
    if (userId === user.id) {
      return NextResponse.json({ success: false, error: 'Cannot change your own role' }, { status: 400 })
    }
    if (!user.email) return NextResponse.json({ success: false, error: 'No email on session' }, { status: 400 })

    const { error: pwErr } = await supabase.auth.signInWithPassword({ email: user.email, password })
    if (pwErr) return NextResponse.json({ success: false, error: 'Incorrect password' }, { status: 403 })

    const { error: updErr } = await admin
      .from('users')
      .update({ role })
      .eq('id', userId)

    if (updErr) {
      console.error('change-role error:', updErr)
      return NextResponse.json({ success: false, error: 'Failed to change role' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
