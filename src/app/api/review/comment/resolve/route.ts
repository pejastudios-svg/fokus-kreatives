import { NextRequest, NextResponse } from 'next/server'
import {
  reviewAdmin,
  loadApprovalByShareToken,
  readReviewSessionFromRequest,
} from '@/lib/reviewSession'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Toggle the `resolved` flag on a comment. Anyone with a valid review
 * session on this approval can flip it on or off, mirroring the agency +
 * portal behaviour where everyone in the conversation can resolve.
 */

interface Body {
  token?: string
  commentId?: string
  resolved?: boolean
}

export async function POST(req: NextRequest) {
  try {
    const incoming = (await req.json()) as Body
    const token = (incoming.token || '').trim()
    const commentId = (incoming.commentId || '').trim()
    if (!token || !commentId || typeof incoming.resolved !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'Missing fields' },
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
      .select('id, approval_id')
      .eq('id', commentId)
      .maybeSingle()

    if (!existing || existing.approval_id !== approval.id) {
      return NextResponse.json(
        { success: false, error: 'Comment not found' },
        { status: 404 },
      )
    }

    const { data: updated, error } = await reviewAdmin
      .from('approval_comments')
      .update({
        resolved: incoming.resolved,
        updated_at: new Date().toISOString(),
      })
      .eq('id', commentId)
      .select(
        'id, content, created_at, updated_at, approval_item_id, user_id, reviewer_email, attachments, resolved, timestamp_seconds, region, attachment_index, parent_comment_id',
      )
      .single()

    if (error || !updated) {
      console.error('review comment resolve error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update' },
        { status: 500 },
      )
    }

    // Notify the original author when the comment flips false -> true. Pass
    // the reviewer's session email as the actor so they don't get an email
    // for resolving their own comment.
    if (incoming.resolved) {
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL
        if (appUrl) {
          await fetch(`${appUrl}/api/approvals/notify-comment-resolved`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commentId, actorEmail: session.email }),
          })
        }
      } catch (notifyErr) {
        console.error('review resolve notify error:', notifyErr)
      }
    }

    return NextResponse.json({ success: true, comment: updated })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('review/comment/resolve exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
