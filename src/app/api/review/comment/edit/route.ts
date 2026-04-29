import { NextRequest, NextResponse } from 'next/server'
import {
  reviewAdmin,
  loadApprovalByShareToken,
  readReviewSessionFromRequest,
} from '@/lib/reviewSession'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Edit one of the reviewer's own comments.
 *
 * The reviewer's "identity" is the email they used in the email-gate flow,
 * stored on the comment as `reviewer_email`. Only their own rows are
 * editable - the server compares the comment's reviewer_email against the
 * email on the active session. Agency-side comments (with a real user_id)
 * are off-limits from this route entirely.
 */

interface Body {
  token?: string
  commentId?: string
  body?: string
}

export async function POST(req: NextRequest) {
  try {
    const incoming = (await req.json()) as Body
    const token = (incoming.token || '').trim()
    const commentId = (incoming.commentId || '').trim()
    const text = (incoming.body || '').trim()

    if (!token || !commentId) {
      return NextResponse.json(
        { success: false, error: 'Missing token or commentId' },
        { status: 400 },
      )
    }
    if (!text) {
      return NextResponse.json(
        { success: false, error: 'Comment cannot be empty' },
        { status: 400 },
      )
    }
    if (text.length > 4000) {
      return NextResponse.json(
        { success: false, error: 'Comment too long' },
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

    // Load the target comment and confirm it's the reviewer's own row in
    // this approval. We don't leak whether the comment exists - any failure
    // gets a 404 on this route.
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

    const { data: updated, error } = await reviewAdmin
      .from('approval_comments')
      .update({ content: text, updated_at: new Date().toISOString() })
      .eq('id', commentId)
      .select(
        'id, content, created_at, updated_at, approval_item_id, reviewer_email, attachments, timestamp_seconds, region, attachment_index, parent_comment_id',
      )
      .single()

    if (error || !updated) {
      console.error('review comment edit error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to save edit' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, comment: updated })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('review/comment/edit exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
