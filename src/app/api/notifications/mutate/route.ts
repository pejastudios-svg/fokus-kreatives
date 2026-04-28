import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * Mutate the caller's own notification rows. We rely on the service-role key
 * for the actual write (so we don't need permissive RLS) and gate every
 * action by `user_id = auth.uid()` to make sure no one can touch another
 * user's notifications.
 *
 * Body shapes:
 *   { action: 'mark_read', id: string }
 *   { action: 'mark_all_read' }
 *   { action: 'delete_one', id: string }
 *   { action: 'clear_all' }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body = (await req.json()) as { action?: string; id?: string }
    const action = body.action

    if (action === 'mark_read') {
      if (!body.id) {
        return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
      }
      const { error } = await admin
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', body.id)
        .eq('user_id', user.id)
      if (error) {
        console.error('mark_read error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'mark_all_read') {
      const { error } = await admin
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .is('read_at', null)
      if (error) {
        console.error('mark_all_read error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'delete_one') {
      if (!body.id) {
        return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
      }
      const { error } = await admin
        .from('notifications')
        .delete()
        .eq('id', body.id)
        .eq('user_id', user.id)
      if (error) {
        console.error('delete_one error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'clear_all') {
      const { error } = await admin
        .from('notifications')
        .delete()
        .eq('user_id', user.id)
      if (error) {
        console.error('clear_all error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('notifications mutate error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
