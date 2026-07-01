import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const INVITE_TTL_DAYS = 7

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { data: me } = await supabase
      .from('users')
      .select('role, name, profile_picture_url')
      .eq('id', user.id)
      .single()
    if (me?.role !== 'admin' && me?.role !== 'manager') {
      return NextResponse.json({ success: false, error: 'Admins or managers only' }, { status: 403 })
    }
    const inviterAvatarUrl =
      me?.profile_picture_url ||
      (user.user_metadata as { avatar_url?: string } | null)?.avatar_url ||
      ''

    const body = (await req.json()) as { userId?: string; origin?: string }
    const userId = body.userId?.trim()
    const origin = body.origin?.trim() || ''
    if (!userId) return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 })

    const { data: target } = await admin
      .from('users')
      .select('id, email, name, role, invitation_accepted')
      .eq('id', userId)
      .single()

    if (!target) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    if (target.invitation_accepted) {
      return NextResponse.json({ success: false, error: 'User has already accepted their invite' }, { status: 400 })
    }

    const token = randomUUID()
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { error: updErr } = await admin
      .from('users')
      .update({ invitation_token: token, invitation_expires_at: expiresAt })
      .eq('id', userId)

    if (updErr) {
      console.error('resend-invite update error:', updErr)
      return NextResponse.json({ success: false, error: 'Failed to refresh invite' }, { status: 500 })
    }

    const inviteLink = origin ? `${origin}/invite/${token}` : `/invite/${token}`

    try {
      await fetch(`${origin || ''}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'workspace_invite',
          payload: {
            to: target.email,
            inviteeName: target.name || target.email,
            inviterName: me?.name || 'Someone',
            inviterAvatarUrl,
            role: target.role,
            workspaceName: 'Fokus Kreativez workspace',
            acceptUrl: inviteLink,
          },
        }),
      })
    } catch (e) {
      console.error('resend-invite email send failed:', e)
    }

    return NextResponse.json({ success: true, token, inviteLink, expiresAt })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
