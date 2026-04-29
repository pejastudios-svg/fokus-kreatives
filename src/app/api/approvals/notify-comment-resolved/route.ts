import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { enqueueEmail } from '@/lib/emailOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * Notification + email when a comment is marked resolved.
 *
 * In-app: every assignee + the comment's author (if a user_id exists), minus
 *         the actor. Drives the popup via the realtime `notifications` channel.
 * Email:  the comment's author specifically - they care most that someone
 *         addressed their feedback. Skip if the author IS the actor.
 *
 * Called from the agency detail page, the client portal, and the public
 * review route when `toggleResolveComment` flips false -> true.
 */

interface Body {
  commentId?: string
  actorId?: string
  /** For reviewer-side flips - the session email of whoever clicked Resolve. */
  actorEmail?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body
    const commentId = body.commentId?.trim()
    const actorId = body.actorId?.trim() || null
    const actorEmail = (body.actorEmail || '').trim().toLowerCase() || null
    if (!commentId) {
      return NextResponse.json({ success: false, error: 'Missing commentId' }, { status: 400 })
    }

    // 1) Load the comment so we know the author + which approval it lives on.
    const { data: comment } = await admin
      .from('approval_comments')
      .select('id, approval_id, user_id, content, reviewer_email')
      .eq('id', commentId)
      .maybeSingle()
    if (!comment) {
      return NextResponse.json({ success: false, error: 'Comment not found' }, { status: 404 })
    }

    // 2) Approval (for title + clientName in the notification body, plus the
    //    share token so the email links the reviewer-side recipients straight
    //    into the review page).
    const { data: approval } = await admin
      .from('approvals')
      .select('id, title, client_id, share_token, clients(name, business_name)')
      .eq('id', comment.approval_id)
      .maybeSingle()
    const clientObj = (() => {
      const c = (approval as unknown as { clients?: unknown })?.clients
      return Array.isArray(c) ? c[0] : c
    })() as { name?: string; business_name?: string } | null
    const clientName = clientObj?.business_name || clientObj?.name || 'A client'
    const shareToken = (approval as unknown as { share_token?: string | null })?.share_token || null

    // 3) Assignees (admin/manager/employee/client - everyone gets the ping).
    const { data: assignees } = await admin
      .from('approval_assignees')
      .select('user_id')
      .eq('approval_id', comment.approval_id)

    // 4) In-app recipients = author + assignees, dedupe, drop actor + nulls.
    const ids = new Set<string>()
    if (comment.user_id) ids.add(comment.user_id as string)
    for (const a of assignees || []) {
      if (a.user_id) ids.add(a.user_id as string)
    }
    if (actorId) ids.delete(actorId)
    const userIds = Array.from(ids)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    const agencyUrl = `${appUrl}/approvals/${comment.approval_id}`
    const reviewUrl = shareToken
      ? `${appUrl}/review/${shareToken}`
      : `${appUrl}/portal/approvals/${comment.approval_id}`

    // Snippet for the popup body. Field name matches what the comment route
    // emits (data.contentSnippet) so the popup's subtitle lookup hits.
    const raw = (comment.content || '').toString().trim()
    const contentSnippet = raw.length > 120 ? raw.slice(0, 120) + '…' : raw

    if (userIds.length > 0) {
      await fetch(`${appUrl}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds,
          type: 'approval_comment_resolved',
          data: {
            approvalId: comment.approval_id,
            approvalTitle: approval?.title || 'Approval',
            clientName,
            commentId: comment.id,
            contentSnippet,
            url: agencyUrl,
          },
        }),
      })
    }

    // 5) Email the original author so they know their feedback was addressed.
    //    Skip if the author resolved their own comment.
    let authorEmail: string | null = null
    let authorIsTeam = true
    if (comment.user_id) {
      const { data: authorRow } = await admin
        .from('users')
        .select('id, email, role')
        .eq('id', comment.user_id)
        .maybeSingle()
      if (authorRow?.email) {
        const isActor = actorId && comment.user_id === actorId
        if (!isActor) {
          authorEmail = authorRow.email as string
          authorIsTeam = (authorRow.role as string | null) !== 'client'
        }
      }
    } else if (comment.reviewer_email) {
      const reviewerLower = (comment.reviewer_email as string).trim().toLowerCase()
      if (!actorEmail || actorEmail !== reviewerLower) {
        authorEmail = comment.reviewer_email as string
        authorIsTeam = false
      }
    }

    if (authorEmail) {
      await enqueueEmail({
        type: 'approval_comment_resolved',
        payload: {
          to: [authorEmail],
          clientName,
          approvalTitle: approval?.title || 'Approval',
          approvalId: comment.approval_id,
          commentSnippet: contentSnippet,
          url: authorIsTeam ? agencyUrl : reviewUrl,
        },
        // Per-comment idempotency means the same comment can't fire two
        // resolved-emails even if Resolve is toggled off-then-on.
        idempotencyKey: `resolve:${comment.id}:author`,
      })
    }

    return NextResponse.json({ success: true, sent: userIds.length, emailed: authorEmail ? 1 : 0 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('notify-comment-resolved exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
