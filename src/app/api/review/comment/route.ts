import { NextRequest, NextResponse } from 'next/server'
import { sanitizeRegion } from '@/lib/types/annotations'
import {
  reviewAdmin,
  loadApprovalByShareToken,
  readReviewSessionFromRequest,
} from '@/lib/reviewSession'

export const dynamic = 'force-dynamic'

interface AttachmentInput {
  url?: string
  name?: string
  size?: number
}

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_ATTACHMENTS = 10

interface AssigneeUserRow {
  user_id: string
  users:
    | { name: string | null; email: string | null; role: string | null }
    | { name: string | null; email: string | null; role: string | null }[]
    | null
}

function extractMentions(text: string): string[] {
  const re = /@([a-zA-Z0-9_]+)/g
  const out: string[] = []
  for (const m of text.matchAll(re)) {
    if (m[1]) out.push(m[1].toLowerCase())
  }
  return Array.from(new Set(out))
}

function normalizeMentionKey(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
}

// 10-minute email cooldown per approval. The agency still gets a popup +
// in-app notification for every comment, but we only fire an email when the
// last one is older than this — so a chatty client doesn't generate 20
// emails in 5 minutes.
const EMAIL_COOLDOWN_MS = 10 * 60 * 1000

async function tryClaimEmailSlot(approvalId: string): Promise<boolean> {
  // Atomic-ish: only update the row when last_comment_email_at is null OR
  // older than the cooldown. PostgREST returns the updated row when the
  // filter matches, so a non-empty result means we won the race and own the
  // email send for this window.
  const cutoffIso = new Date(Date.now() - EMAIL_COOLDOWN_MS).toISOString()
  const nowIso = new Date().toISOString()

  // First attempt: rows where last_comment_email_at is null.
  const nullPath = await reviewAdmin
    .from('approvals')
    .update({ last_comment_email_at: nowIso })
    .eq('id', approvalId)
    .is('last_comment_email_at', null)
    .select('id')

  if (!nullPath.error && (nullPath.data?.length || 0) > 0) return true

  // Second attempt: rows where last_comment_email_at is older than cutoff.
  const stalePath = await reviewAdmin
    .from('approvals')
    .update({ last_comment_email_at: nowIso })
    .eq('id', approvalId)
    .lt('last_comment_email_at', cutoffIso)
    .select('id')

  if (!stalePath.error && (stalePath.data?.length || 0) > 0) return true

  // Column missing in older DBs — fall through and just send. Once the
  // migration is applied this branch stops being hit.
  if (
    nullPath.error &&
    ((nullPath.error as { code?: string }).code === '42703' ||
      (nullPath.error as { code?: string }).code === 'PGRST204')
  ) {
    return true
  }

  return false
}

async function notifyAgencyOfReviewerComment(args: {
  approvalId: string
  approvalTitle: string
  reviewerEmail: string
  content: string
  commentId: string
  approvalItemId: string | null
}) {
  try {
    const { data: rows } = await reviewAdmin
      .from('approval_assignees')
      .select('user_id, users(name, email, role)')
      .eq('approval_id', args.approvalId)

    const assignees = (rows || []) as unknown as AssigneeUserRow[]
    const teamUserIds: string[] = []
    const teamEmails: string[] = []
    const tokenToUserId = new Map<string, string>()
    const userIdToEmail = new Map<string, string>()

    for (const row of assignees) {
      if (!row.user_id) continue
      const u = Array.isArray(row.users) ? row.users[0] : row.users
      if (!u || u.role === 'client') continue
      teamUserIds.push(row.user_id)
      if (u.email) {
        teamEmails.push(u.email)
        userIdToEmail.set(row.user_id, u.email)
      }
      const name = u.name || ''
      const email = u.email || ''
      const first = normalizeMentionKey(name.split(' ')[0] || '')
      const full = normalizeMentionKey(name.replace(/\s+/g, ''))
      const localPart = normalizeMentionKey((email.split('@')[0] || ''))
      if (first) tokenToUserId.set(first, row.user_id)
      if (full) tokenToUserId.set(full, row.user_id)
      if (localPart) tokenToUserId.set(localPart, row.user_id)
    }

    // Resolve any @-mentions to a subset of team user IDs.
    const tokens = extractMentions(args.content)
    const mentionedUserIds = Array.from(
      new Set(
        tokens
          .map((t) => tokenToUserId.get(normalizeMentionKey(t)))
          .filter(Boolean) as string[],
      ),
    )

    const isMentionMode = mentionedUserIds.length > 0
    const inAppType = isMentionMode ? 'approval_mention' : 'approval_comment'
    const inAppRecipients = isMentionMode
      ? mentionedUserIds
      : Array.from(new Set(teamUserIds))

    const snippet =
      args.content.length > 120 ? args.content.slice(0, 120) + '...' : args.content

    // 1) In-app notification — fires every time so the agency sees real-time
    //    activity even when emails are suppressed.
    if (inAppRecipients.length > 0) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: inAppRecipients,
          type: inAppType,
          data: {
            approvalId: args.approvalId,
            title: args.approvalTitle,
            reviewerEmail: args.reviewerEmail,
            commentId: args.commentId,
            itemId: args.approvalItemId,
            contentSnippet: snippet,
          },
        }),
      })
    }

    // 2) Email
    const secret = process.env.APPS_SCRIPT_SECRET
    if (!secret) return
    const agencyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approvals/${args.approvalId}`
    const emailSnippet =
      args.content.length > 200 ? args.content.slice(0, 200) + '...' : args.content

    if (isMentionMode) {
      // Mentions are explicit asks — bypass the cooldown so the @'d person
      // gets the email even if the broadcast slot is closed.
      const mentionEmails = mentionedUserIds
        .map((id) => userIdToEmail.get(id))
        .filter(Boolean) as string[]
      const dedup = Array.from(new Set(mentionEmails))
      if (dedup.length === 0) return

      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approval_mention',
          payload: {
            secret,
            to: dedup,
            clientName: args.reviewerEmail,
            approvalTitle: args.approvalTitle,
            approvalId: args.approvalId,
            commentSnippet: emailSnippet,
            url: agencyUrl,
          },
        }),
      })
      return
    }

    // Broadcast email — throttled.
    const dedupedTeam = Array.from(new Set(teamEmails))
    if (dedupedTeam.length === 0) return

    const canEmail = await tryClaimEmailSlot(args.approvalId)
    if (!canEmail) {
      console.log('Skipping approval_comment email (cooldown)', {
        approvalId: args.approvalId,
      })
      return
    }

    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'approval_comment',
        payload: {
          secret,
          to: dedupedTeam,
          clientName: args.reviewerEmail,
          approvalTitle: args.approvalTitle,
          approvalId: args.approvalId,
          commentSnippet: emailSnippet,
          url: agencyUrl,
        },
      }),
    })
  } catch (err) {
    console.error('notifyAgencyOfReviewerComment error:', err)
  }
}

/**
 * Public: post a comment as the verified-by-email reviewer. Body:
 *   { token, itemId?, body?, attachments? }
 *
 * Either `body` or `attachments` must be non-empty. The reviewer doesn't have
 * a `users` row so `user_id` stays null; we write their email into
 * `reviewer_email` instead.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      token?: string
      itemId?: string | null
      body?: string
      attachments?: AttachmentInput[]
      timestampSeconds?: number | null
      region?: unknown
      attachmentIndex?: number | null
    }
    const token = (body.token || '').trim()
    const text = (body.body || '').trim()
    const incoming = Array.isArray(body.attachments) ? body.attachments : []

    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
    }
    if (!text && incoming.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Add a message or a file' },
        { status: 400 },
      )
    }
    if (text.length > 4000) {
      return NextResponse.json({ success: false, error: 'Comment too long' }, { status: 400 })
    }
    if (incoming.length > MAX_ATTACHMENTS) {
      return NextResponse.json(
        { success: false, error: `Up to ${MAX_ATTACHMENTS} files per comment` },
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

    let approvalItemId: string | null = null
    if (body.itemId) {
      const { data: item } = await reviewAdmin
        .from('approval_items')
        .select('id, approval_id')
        .eq('id', body.itemId)
        .maybeSingle()
      if (!item || item.approval_id !== approval.id) {
        return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 })
      }
      approvalItemId = item.id as string
    }

    // Sanitize attachments — every entry must have a string url, and a size
    // under our cap. Drop anything malformed silently rather than refusing
    // the whole comment.
    const attachments = incoming
      .map((a) => ({
        url: typeof a.url === 'string' ? a.url.trim() : '',
        name: typeof a.name === 'string' ? a.name.trim() : '',
        size: typeof a.size === 'number' ? a.size : null,
      }))
      .filter((a) => a.url && (a.size == null || a.size <= MAX_BYTES))

    // Annotations are optional. Same shape + sanitisation as the agency route.
    const rawTimestamp = body.timestampSeconds
    const timestampSeconds =
      typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp) && rawTimestamp >= 0
        ? rawTimestamp
        : null
    const region = sanitizeRegion(body.region)
    const rawAttachmentIndex = body.attachmentIndex
    const attachmentIndex =
      typeof rawAttachmentIndex === 'number' &&
      Number.isFinite(rawAttachmentIndex) &&
      rawAttachmentIndex >= 0
        ? Math.floor(rawAttachmentIndex)
        : null

    const { data: created, error } = await reviewAdmin
      .from('approval_comments')
      .insert({
        approval_id: approval.id,
        approval_item_id: approvalItemId,
        user_id: null,
        reviewer_email: session.email,
        content: text || '',
        attachments: attachments.length ? attachments : null,
        timestamp_seconds: timestampSeconds,
        region,
        attachment_index: attachmentIndex,
      })
      .select(
        'id, content, created_at, approval_item_id, reviewer_email, attachments, timestamp_seconds, region, attachment_index',
      )
      .single()

    if (error || !created) {
      console.error('review comment insert error:', {
        message: (error as { message?: string } | null)?.message,
        details: (error as { details?: string } | null)?.details,
        hint: (error as { hint?: string } | null)?.hint,
        code: (error as { code?: string } | null)?.code,
        rawJSON: JSON.stringify(error, error ? Object.getOwnPropertyNames(error) : []),
      })
      return NextResponse.json(
        { success: false, error: (error as { message?: string } | null)?.message || 'Failed to post comment' },
        { status: 500 },
      )
    }

    // Notify the agency: in-app + email to every assignee on this approval.
    // Reviewer is anonymous so we never have to exclude them.
    void notifyAgencyOfReviewerComment({
      approvalId: approval.id as string,
      approvalTitle: (approval.title as string) || '',
      reviewerEmail: session.email,
      content: text,
      commentId: created.id as string,
      approvalItemId,
    })

    return NextResponse.json({ success: true, comment: created })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('review/comment error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
