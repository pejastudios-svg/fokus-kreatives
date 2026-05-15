// POST /api/admin/reauth
//
// Verifies the user's current password and, on success, sets the
// admin_reauth_until cookie. This is the password gate that protects
// /admin/* in addition to the role check.
//
// Why not just trust the supabase session? Two reasons:
//   1. A stolen laptop with an open session would have admin access
//      without any second factor. The password prompt makes opening the
//      admin page an explicit step that requires knowing the password.
//   2. Defense in depth - role checks happen elsewhere (users.role); the
//      reauth is a separate signal so a compromised role grant alone
//      doesn't expose the dashboard.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildReauthCookie } from '@/lib/admin/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { password } = (await req.json()) as { password?: string }
    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Password required' },
        { status: 400 },
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !user.email) {
      return NextResponse.json(
        { success: false, error: 'Not signed in' },
        { status: 401 },
      )
    }

    // Role check first - non-admins shouldn't even be hitting this.
    const { data: row } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (!row || row.role !== 'admin') {
      // Same error as a wrong password - don't tell non-admins the
      // endpoint exists or distinguish "wrong password" from "not admin".
      return NextResponse.json(
        { success: false, error: 'Incorrect password' },
        { status: 401 },
      )
    }

    // Verify password by re-signing in with the same email. This does
    // NOT replace the existing session - signInWithPassword on a fresh
    // anon client validates the credentials without disturbing the
    // user's current cookies.
    const { createClient: createDirectClient } = await import('@supabase/supabase-js')
    const probe = createDirectClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { error: signInErr } = await probe.auth.signInWithPassword({
      email: user.email,
      password,
    })
    if (signInErr) {
      return NextResponse.json(
        { success: false, error: 'Incorrect password' },
        { status: 401 },
      )
    }

    // Password verified. Set the reauth cookie.
    const cookie = buildReauthCookie()
    const res = NextResponse.json({ success: true })
    res.cookies.set(cookie.name, cookie.value, cookie.options)
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('admin/reauth error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
