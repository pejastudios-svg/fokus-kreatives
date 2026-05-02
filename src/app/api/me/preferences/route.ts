import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Read + write the signed-in user's preferences row. We auto-create the row
 * on first GET if it doesn't exist yet, so the client never has to handle a
 * "not found" path - always returns a populated row with defaults.
 *
 * The route uses the SSR server client (cookie-bound auth) to identify the
 * user, then writes through the service-role admin client so RLS doesn't
 * block first-time insert before the auth-rls policy can match.
 */

const admin = () =>
  createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

interface PreferencesRow {
  user_id: string
  theme: 'light' | 'dark'
  nav_mode: 'fixed' | 'hover'
  notify_new_lead: boolean
  notify_new_meeting: boolean
  notify_payment_reminder: boolean
  created_at: string
  updated_at: string
}

const DEFAULTS: Omit<PreferencesRow, 'user_id' | 'created_at' | 'updated_at'> = {
  theme: 'dark',
  nav_mode: 'fixed',
  notify_new_lead: true,
  notify_new_meeting: true,
  notify_payment_reminder: true,
}

async function getUserId(): Promise<string | null> {
  const sb = await createServerClient()
  const { data } = await sb.auth.getUser()
  return data.user?.id || null
}

export async function GET() {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
    }
    const sb = admin()
    const { data, error } = await sb
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('preferences select error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    if (data) {
      return NextResponse.json({ success: true, preferences: data })
    }
    // First visit - seed the row with defaults so future GETs are cheap.
    const { data: created, error: insertErr } = await sb
      .from('user_preferences')
      .insert({ user_id: userId, ...DEFAULTS })
      .select('*')
      .single()
    if (insertErr || !created) {
      console.error('preferences insert error:', insertErr)
      return NextResponse.json(
        { success: true, preferences: { user_id: userId, ...DEFAULTS } },
      )
    }
    return NextResponse.json({ success: true, preferences: created })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('GET /api/me/preferences exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
    }
    const body = (await req.json().catch(() => ({}))) as Partial<PreferencesRow>

    // Whitelist - never let the client write to user_id, timestamps.
    const patch: Record<string, unknown> = {}
    if (body.theme === 'light' || body.theme === 'dark') patch.theme = body.theme
    if (body.nav_mode === 'fixed' || body.nav_mode === 'hover') patch.nav_mode = body.nav_mode
    if (typeof body.notify_new_lead === 'boolean') patch.notify_new_lead = body.notify_new_lead
    if (typeof body.notify_new_meeting === 'boolean') patch.notify_new_meeting = body.notify_new_meeting
    if (typeof body.notify_payment_reminder === 'boolean')
      patch.notify_payment_reminder = body.notify_payment_reminder

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields' }, { status: 400 })
    }

    const sb = admin()
    // Upsert so a missing row gets created with defaults + the patched
    // fields in one call.
    const { data, error } = await sb
      .from('user_preferences')
      .upsert(
        { user_id: userId, ...DEFAULTS, ...patch },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single()
    if (error || !data) {
      console.error('preferences upsert error:', error)
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to save' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true, preferences: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('PATCH /api/me/preferences exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
