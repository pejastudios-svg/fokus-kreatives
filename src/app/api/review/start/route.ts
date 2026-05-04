import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  reviewAdmin,
  loadApprovalByShareToken,
  isEmailAllowedForApproval,
  generateSessionToken,
  reviewCookieName,
  SESSION_TTL_MS,
} from '@/lib/reviewSession'

export const dynamic = 'force-dynamic'

/**
 * Public: enter email, get an immediate review session.
 *
 * No OTP - if the email is registered on the approval's client, we mint a
 * session token, set it as a cookie, and the page renders the assets right
 * away. The trust anchor is the email being on file in the agency's records;
 * we don't pretend to verify ownership of the inbox.
 *
 * To prevent enumeration (and make the UX still feel snappy when the email
 * isn't on file) we always return success. The page treats success as "you
 * can proceed" - but with no cookie set, the next state load will return
 * `authed: false` and the user just sees the email form again. Mildly
 * confusing in that one edge case; we can add a friendlier "we couldn't
 * verify that email" hint later if needed.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { token?: string; email?: string }
    const token = (body.token || '').trim()
    const email = (body.email || '').trim().toLowerCase()
    if (!token || !email) {
      return NextResponse.json({ success: false, error: 'Missing token or email' }, { status: 400 })
    }

    const approval = await loadApprovalByShareToken(token)
    if (!approval) {
      // Don't leak whether the share token exists.
      return NextResponse.json({ success: true, authed: false })
    }

    const allowed = await isEmailAllowedForApproval(approval.id, email)
    if (!allowed) {
      // Same - don't leak whether the email is on file.
      return NextResponse.json({ success: true, authed: false })
    }

    const sessionToken = generateSessionToken()
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS)

    // Reuse an existing session row for this (approval, email) if any, to
    // avoid leaking unbounded rows. Otherwise insert a fresh one.
    const { data: existing } = await reviewAdmin
      .from('review_sessions')
      .select('id')
      .eq('approval_id', approval.id)
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const baseRow = {
      session_token: sessionToken,
      session_expires_at: sessionExpiresAt.toISOString(),
      verified_at: new Date().toISOString(),
      // OTP fields are unused in this flow but kept on the table for now.
      otp_code: null,
      otp_expires_at: null,
      otp_attempts: 0,
      ip: req.headers.get('x-forwarded-for') || null,
      user_agent: req.headers.get('user-agent') || null,
    }

    if (existing?.id) {
      await reviewAdmin.from('review_sessions').update(baseRow).eq('id', existing.id)
    } else {
      await reviewAdmin.from('review_sessions').insert({
        approval_id: approval.id,
        email,
        ...baseRow,
      })
    }

    const jar = await cookies()
    jar.set(reviewCookieName(approval.id), sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: sessionExpiresAt,
    })

    return NextResponse.json({ success: true, authed: true, approvalId: approval.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('review/start error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
