import { NextRequest, NextResponse } from 'next/server'
import { sanitizeRegion } from '@/lib/types/annotations'
import {
  reviewAdmin,
  loadApprovalByShareToken,
  readReviewSessionFromRequest,
} from '@/lib/reviewSession'
import { enqueueEmail } from '@/lib/emailOutbox'

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

/**
 * Notify all stakeholders when a reviewer posts. Recipients:
 *   - Agency team (assignees + workspace owners) → agencyUrl, in-app + email
 *   - Other client-role users tied to client_id → reviewUrl, email
 *   - The client's primary contact email (clients.email), if different from
 *     the reviewer themselves → reviewUrl, email
 *
 * The author's own email is always excluded from recipients.
 *
 * Mentions extend the recipients map: @firstname / @business / @client all
 * resolve, including the client's canonical name from the clients table.
 *
 * Display name: we resolve the reviewer's email back to a real name via the
 * users table or clients.name when possible, so emails read "Acme Co
 * commented" instead of "noreply@gmail.com commented".
 */
async function notifyOnReviewerComment(args: {
  approvalId: string
  clientId: string | null
  approvalTitle: string
  shareToken: string | null
  reviewerEmail: string
  content: string
  commentId: string
  approvalItemId: string | null
}) {
  try {
    const reviewerLower = args.reviewerEmail.trim().toLowerCase()

    const [assigneesRes, clientRowRes, clientUsersRes] = await Promise.all([
      reviewAdmin
        .from('approval_assignees')
        .select('user_id, users(id, name, email, role)')
        .eq('approval_id', args.approvalId),
      args.clientId
        ? reviewAdmin
            .from('clients')
            .select('name, business_name, email')
            .eq('id', args.clientId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      args.clientId
        ? reviewAdmin
            .from('users')
            .select('id, name, email, role, client_id')
            .eq('client_id', args.clientId)
        : Promise.resolve({ data: [] as { id: string; name: string | null; email: string | null; role: string | null; client_id: string | null }[] }),
    ])

    const assignees = (assigneesRes.data || []) as unknown as AssigneeUserRow[]
    const clientRow = clientRowRes.data as
      | { name: string | null; business_name: string | null; email: string | null }
      | null
    const clientUsers = (clientUsersRes.data || []) as {
      id: string
      name: string | null
      email: string | null
      role: string | null
      client_id: string | null
    }[]

    // ---- Build the mention token map --------------------------------------
    // Tokens can resolve to a user_id (in-app + email via lookup) or a raw
    // email (e.g. clients.email when there's no portal user).
    const tokenToUserId = new Map<string, string>()
    const tokenToRawEmail = new Map<string, string>()
    const userIdToEmail = new Map<string, string>()
    const userIdToRole = new Map<string, string>()
    const teamUserIds: string[] = []
    const otherClientUserIds: string[] = []

    const addUserTokens = (
      uid: string,
      name: string | null,
      email: string | null,
    ) => {
      const first = normalizeMentionKey((name || '').split(' ')[0] || '')
      const full = normalizeMentionKey((name || '').replace(/\s+/g, ''))
      const localPart = normalizeMentionKey((email || '').split('@')[0] || '')
      if (first) tokenToUserId.set(first, uid)
      if (full) tokenToUserId.set(full, uid)
      if (localPart) tokenToUserId.set(localPart, uid)
    }

    for (const row of assignees) {
      if (!row.user_id) continue
      const u = Array.isArray(row.users) ? row.users[0] : row.users
      if (!u) continue
      const isTeam = u.role !== 'client'
      const isReviewerSelf = !!u.email && u.email.trim().toLowerCase() === reviewerLower
      if (u.email) userIdToEmail.set(row.user_id, u.email)
      if (u.role) userIdToRole.set(row.user_id, u.role)
      addUserTokens(row.user_id, u.name, u.email)
      if (isReviewerSelf) continue
      if (isTeam) teamUserIds.push(row.user_id)
      else otherClientUserIds.push(row.user_id)
    }

    // Add every client-role user tied to client_id, even if not on this
    // approval's assignee list - so reviewers can mention each other and so
    // an inactive client teammate still gets the email when broadcasting.
    for (const cu of clientUsers) {
      if (!cu.id) continue
      if (cu.role && cu.role !== 'client') continue
      if (cu.email) userIdToEmail.set(cu.id, cu.email)
      if (cu.role) userIdToRole.set(cu.id, cu.role)
      addUserTokens(cu.id, cu.name, cu.email)
      const isReviewerSelf =
        !!cu.email && cu.email.trim().toLowerCase() === reviewerLower
      if (isReviewerSelf) continue
      if (!otherClientUserIds.includes(cu.id)) otherClientUserIds.push(cu.id)
    }

    // The client's canonical contact (clients.email) may not correspond to
    // any user account. Map their name + business_name + "client" to the
    // raw email so @-mentions reach them either way.
    if (clientRow?.email) {
      const clientEmailLower = clientRow.email.trim().toLowerCase()
      if (clientEmailLower !== reviewerLower) {
        const tokens = [
          normalizeMentionKey((clientRow.name || '').split(' ')[0] || ''),
          normalizeMentionKey((clientRow.name || '').replace(/\s+/g, '')),
          normalizeMentionKey((clientRow.business_name || '').split(' ')[0] || ''),
          normalizeMentionKey((clientRow.business_name || '').replace(/\s+/g, '')),
          normalizeMentionKey((clientRow.email || '').split('@')[0] || ''),
          'client',
        ].filter(Boolean)
        for (const t of tokens) tokenToRawEmail.set(t, clientRow.email)
      }
    }

    // ---- Resolve mentions -------------------------------------------------
    const tokens = extractMentions(args.content)
    const mentionedUserIds = Array.from(
      new Set(
        tokens
          .map((t) => tokenToUserId.get(normalizeMentionKey(t)))
          .filter(Boolean) as string[],
      ),
    )
    const mentionedRawEmails = Array.from(
      new Set(
        tokens
          .map((t) => tokenToRawEmail.get(normalizeMentionKey(t)))
          .filter(Boolean) as string[],
      ),
    )
    const isMentionMode =
      tokens.length > 0 && (mentionedUserIds.length > 0 || mentionedRawEmails.length > 0)

    // ---- Resolve a display name for the reviewer --------------------------
    let actorName = args.reviewerEmail
    for (const cu of clientUsers) {
      if (
        cu.email &&
        cu.email.trim().toLowerCase() === reviewerLower &&
        (cu.name || '').trim()
      ) {
        actorName = cu.name as string
        break
      }
    }
    if (
      actorName === args.reviewerEmail &&
      clientRow?.email &&
      clientRow.email.trim().toLowerCase() === reviewerLower
    ) {
      actorName = clientRow.business_name || clientRow.name || actorName
    }

    // ---- In-app notifications --------------------------------------------
    const inAppType = isMentionMode ? 'approval_mention' : 'approval_comment'
    const inAppRecipients = isMentionMode
      ? mentionedUserIds
      : Array.from(new Set([...teamUserIds, ...otherClientUserIds]))

    const snippet =
      args.content.length > 120 ? args.content.slice(0, 120) + '...' : args.content

    if (inAppRecipients.length > 0) {
      try {
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
              actorName,
              commentId: args.commentId,
              itemId: args.approvalItemId,
              contentSnippet: snippet,
            },
          }),
        })
      } catch (e) {
        console.error('reviewer comment in-app notify error:', e)
      }
    }

    // ---- Email recipients (split by URL) ---------------------------------
    const agencyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approvals/${args.approvalId}`
    const reviewUrl = args.shareToken
      ? `${process.env.NEXT_PUBLIC_APP_URL}/review/${args.shareToken}`
      : `${process.env.NEXT_PUBLIC_APP_URL}/portal/approvals/${args.approvalId}`
    const emailSnippet =
      args.content.length > 200 ? args.content.slice(0, 200) + '...' : args.content

    const basePayload = {
      clientName: actorName,
      approvalTitle: args.approvalTitle,
      approvalId: args.approvalId,
      commentSnippet: emailSnippet,
    }

    const teamFromUserIds = (ids: string[]) =>
      Array.from(
        new Set(
          ids
            .filter((id) => (userIdToRole.get(id) || 'team') !== 'client')
            .map((id) => userIdToEmail.get(id))
            .filter(Boolean) as string[],
        ),
      ).filter((e) => e.trim().toLowerCase() !== reviewerLower)
    const clientFromUserIds = (ids: string[]) =>
      Array.from(
        new Set(
          ids
            .filter((id) => userIdToRole.get(id) === 'client')
            .map((id) => userIdToEmail.get(id))
            .filter(Boolean) as string[],
        ),
      ).filter((e) => e.trim().toLowerCase() !== reviewerLower)

    if (isMentionMode) {
      // Mention path: only the @-targets get email. Bypass the broadcast
      // throttle - a mention is high-signal.
      const teamEmails = teamFromUserIds(mentionedUserIds)
      const clientEmails = Array.from(
        new Set([...clientFromUserIds(mentionedUserIds), ...mentionedRawEmails]),
      ).filter((e) => e.trim().toLowerCase() !== reviewerLower)

      if (teamEmails.length > 0) {
        await enqueueEmail({
          type: 'approval_mention',
          payload: { ...basePayload, to: teamEmails, url: agencyUrl },
          idempotencyKey: `comment:${args.commentId}:team-mention`,
        })
      }
      if (clientEmails.length > 0) {
        await enqueueEmail({
          type: 'approval_mention',
          payload: { ...basePayload, to: clientEmails, url: reviewUrl },
          idempotencyKey: `comment:${args.commentId}:client-mention`,
        })
      }
      return
    }

    // Broadcast path: agency team + every other client. Throttled per-approval.
    const teamEmails = teamFromUserIds([...teamUserIds, ...otherClientUserIds])
    const clientEmails = Array.from(
      new Set([
        ...clientFromUserIds(otherClientUserIds),
        ...(clientRow?.email && clientRow.email.trim().toLowerCase() !== reviewerLower
          ? [clientRow.email]
          : []),
      ]),
    )

    if (teamEmails.length === 0 && clientEmails.length === 0) return

    const canEmail = await tryClaimEmailSlot(args.approvalId)
    if (!canEmail) {
      console.log('Skipping approval_comment email (cooldown)', {
        approvalId: args.approvalId,
      })
      return
    }

    if (teamEmails.length > 0) {
      await enqueueEmail({
        type: 'approval_comment',
        payload: { ...basePayload, to: teamEmails, url: agencyUrl },
        idempotencyKey: `comment:${args.commentId}:team-broadcast`,
      })
    }
    if (clientEmails.length > 0) {
      await enqueueEmail({
        type: 'approval_comment',
        payload: { ...basePayload, to: clientEmails, url: reviewUrl },
        idempotencyKey: `comment:${args.commentId}:client-broadcast`,
      })
    }
  } catch (err) {
    console.error('notifyOnReviewerComment error:', err)
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
      parentCommentId?: string | null
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

    // Validate the parent comment, if any. Must belong to the same approval.
    let parentCommentId: string | null = null
    if (body.parentCommentId) {
      const { data: parent } = await reviewAdmin
        .from('approval_comments')
        .select('id, approval_id')
        .eq('id', body.parentCommentId)
        .maybeSingle()
      if (parent && parent.approval_id === approval.id) {
        parentCommentId = parent.id as string
      }
    }

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
        parent_comment_id: parentCommentId,
      })
      .select(
        'id, content, created_at, updated_at, approval_item_id, user_id, reviewer_email, attachments, resolved, timestamp_seconds, region, attachment_index, parent_comment_id',
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

    // Notify everyone on this approval: agency team + other clients sharing
    // the same review. The reviewer's own email is excluded inside the helper.
    void notifyOnReviewerComment({
      approvalId: approval.id as string,
      clientId: (approval as unknown as { client_id?: string | null }).client_id ?? null,
      approvalTitle: (approval.title as string) || '',
      shareToken: (approval as unknown as { share_token?: string | null }).share_token ?? null,
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
