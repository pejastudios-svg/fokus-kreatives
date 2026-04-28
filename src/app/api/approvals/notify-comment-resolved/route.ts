import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * Fire-and-forget notification when a comment is marked resolved.
 *
 * Recipients are the comment's author (if it's a logged-in user) plus every
 * approval assignee, excluding the actor who clicked Resolve. The popup is
 * driven by the existing `/api/notifications/create` flow + the `notifications`
 * realtime channel that NotificationPopupListener subscribes to.
 *
 * Called from both the agency detail page and the client portal page when
 * `toggleResolveComment` flips a comment from unresolved -> resolved.
 */

interface Body {
  commentId?: string
  actorId?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body
    const commentId = body.commentId?.trim()
    const actorId = body.actorId?.trim() || null
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

    // 2) Approval (for title + clientName in the notification body).
    const { data: approval } = await admin
      .from('approvals')
      .select('id, title, client_id, clients(name, business_name)')
      .eq('id', comment.approval_id)
      .maybeSingle()
    const clientObj = (() => {
      const c = (approval as unknown as { clients?: unknown })?.clients
      return Array.isArray(c) ? c[0] : c
    })() as { name?: string; business_name?: string } | null
    const clientName = clientObj?.business_name || clientObj?.name || 'A client'

    // 3) Assignees (admin/manager/employee/client - everyone gets the ping).
    const { data: assignees } = await admin
      .from('approval_assignees')
      .select('user_id')
      .eq('approval_id', comment.approval_id)

    // 4) Recipients = author + assignees, dedupe, drop actor + nulls.
    const ids = new Set<string>()
    if (comment.user_id) ids.add(comment.user_id as string)
    for (const a of assignees || []) {
      if (a.user_id) ids.add(a.user_id as string)
    }
    if (actorId) ids.delete(actorId)
    const userIds = Array.from(ids)

    if (userIds.length === 0) {
      return NextResponse.json({ success: true, sent: 0 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    const url = `${appUrl}/approvals/${comment.approval_id}`

    // Snippet for the popup body.
    const raw = (comment.content || '').toString().trim()
    const commentSnippet = raw.length > 120 ? raw.slice(0, 120) + '…' : raw

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
          commentSnippet,
          url,
        },
      }),
    })

    return NextResponse.json({ success: true, sent: userIds.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('notify-comment-resolved exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
