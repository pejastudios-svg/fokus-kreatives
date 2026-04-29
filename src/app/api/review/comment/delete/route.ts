import { NextRequest, NextResponse } from 'next/server'
import {
  reviewAdmin,
  loadApprovalByShareToken,
  readReviewSessionFromRequest,
} from '@/lib/reviewSession'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Delete one of the reviewer's own comments.
 *
 * Same ownership check as the edit route - the comment must be the
 * reviewer's own row (user_id IS NULL, reviewer_email matches the active
 * session, approval_id matches the share token's approval). Anything else
 * gets a 404 so we don't leak whether the comment exists.
 */

interface Body {
  token?: string
  commentId?: string
}

export async function POST(req: NextRequest) {
  try {
    const incoming = (await req.json()) as Body
    const token = (incoming.token || '').trim()
    const commentId = (incoming.commentId || '').trim()

    if (!token || !commentId) {
      return NextResponse.json(
        { success: false, error: 'Missing token or commentId' },
        { status: 400 },
      )
    }

    const approval = await loadApprovalByShareToken(token)
    if (!approval) {
      return NextResponse.json({ success: false, error: 'Invalid link' }, { status: 404 })
    }

    const session = await readReviewSessionFromRequest(approval.id)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
    }

    const { data: existing } = await reviewAdmin
      .from('approval_comments')
      .select('id, approval_id, reviewer_email, user_id')
      .eq('id', commentId)
      .maybeSingle()

    if (
      !existing ||
      existing.approval_id !== approval.id ||
      existing.user_id !== null ||
      (existing.reviewer_email || '').trim().toLowerCase() !==
        session.email.trim().toLowerCase()
    ) {
      return NextResponse.json(
        { success: false, error: 'Comment not found' },
        { status: 404 },
      )
    }

    const { error } = await reviewAdmin
      .from('approval_comments')
      .delete()
      .eq('id', commentId)

    if (error) {
      console.error('review comment delete error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to delete' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('review/comment/delete exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
