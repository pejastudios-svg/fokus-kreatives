import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  reviewAdmin,
  loadApprovalByShareToken,
  readReviewSessionFromRequest,
  reviewCookieName,
} from '@/lib/reviewSession'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { token?: string }
    const token = (body.token || '').trim()
    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
    }

    const approval = await loadApprovalByShareToken(token)
    if (!approval) {
      return NextResponse.json({ success: true })
    }

    const session = await readReviewSessionFromRequest(approval.id)
    if (session) {
      // Expire the row server-side so the cookie can't be re-used.
      await reviewAdmin
        .from('review_sessions')
        .update({
          session_expires_at: new Date().toISOString(),
          session_token: null,
        })
        .eq('id', session.id)
    }

    const jar = await cookies()
    jar.set(reviewCookieName(approval.id), '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(0),
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('review/logout error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
