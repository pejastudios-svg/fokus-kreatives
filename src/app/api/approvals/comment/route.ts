// src/app/api/approvals/comment/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sanitizeRegion } from '@/lib/types/annotations'
import { enqueueEmail } from '@/lib/emailOutbox'

// Types for Supabase responses
interface ClientRef {
  name: string | null
  business_name: string | null
}

interface UserProfile {
  name: string | null
  email: string | null
}

interface AssigneeRow {
  user_id: string
  users: UserProfile | UserProfile[] | null
}

interface UserRow {
  id: string
  email: string | null
  role: string
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function extractMentions(text: string): string[] {
  const re = /@([a-zA-Z0-9_]+)/g
  const out: string[] = []
  for (const m of text.matchAll(re)) {
    if (m[1]) out.push(m[1].toLowerCase())
  }
  return Array.from(new Set(out))
}

// 10-minute email cooldown per approval - keeps a burst of comments from
// turning into a flood of inbox pings while still letting in-app notifs fire
// every time. Mentions bypass this (a direct @ is high-signal).
const EMAIL_COOLDOWN_MS = 10 * 60 * 1000

async function tryClaimEmailSlot(approvalId: string): Promise<boolean> {
  const cutoffIso = new Date(Date.now() - EMAIL_COOLDOWN_MS).toISOString()
  const nowIso = new Date().toISOString()

  const nullPath = await supabase
    .from('approvals')
    .update({ last_comment_email_at: nowIso })
    .eq('id', approvalId)
    .is('last_comment_email_at', null)
    .select('id')

  if (!nullPath.error && (nullPath.data?.length || 0) > 0) return true

  const stalePath = await supabase
    .from('approvals')
    .update({ last_comment_email_at: nowIso })
    .eq('id', approvalId)
    .lt('last_comment_email_at', cutoffIso)
    .select('id')

  if (!stalePath.error && (stalePath.data?.length || 0) > 0) return true

  if (
    nullPath.error &&
    ((nullPath.error as { code?: string }).code === '42703' ||
      (nullPath.error as { code?: string }).code === 'PGRST204')
  ) {
    return true
  }

  return false
}

function normalizeKey(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const approvalId = body.approvalId as string
    const approvalItemId = (body.approvalItemId as string | null) || null
    const userId = body.userId as string
    const contentRaw = (body.content || '').toString()
    const fileUrl = (body.fileUrl as string | null) || null
    const fileName = (body.fileName as string | null) || null
    const parentCommentId = (body.parentCommentId as string | null) || null

    // Annotations: timestamp on a video, region on an image/video, plus the
    // carousel slide index it applies to. All three are optional.
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

    const content = contentRaw.trim()

    if (!approvalId || !userId || (!content && !fileUrl)) {
      return NextResponse.json(
        { success: false, error: 'Missing approvalId, userId, or content/file' },
        { status: 400 }
      )
    }

    // 1) Insert comment
    const { data: commentRow, error: insertError } = await supabase
      .from('approval_comments')
      .insert({
        approval_id: approvalId,
        approval_item_id: approvalItemId,
        user_id: userId,
        content: content || '',
        file_url: fileUrl,
        file_name: fileName,
        parent_comment_id: parentCommentId,
        timestamp_seconds: timestampSeconds,
        region,
        attachment_index: attachmentIndex,
      })
      .select()
      .single()

    if (insertError || !commentRow) {
      console.error('Insert approval_comment error:', insertError)
      return NextResponse.json(
        { success: false, error: 'Failed to insert comment' },
        { status: 500 }
      )
    }

    // 2) Load approval + client name + share token
    const { data: approval } = await supabase
      .from('approvals')
      .select('id, title, client_id, share_token, clients(name, business_name, email)')
      .eq('id', approvalId)
      .single()

    const approvalWithClients = approval as unknown as {
      clients: (ClientRef & { email?: string | null }) | (ClientRef & { email?: string | null })[] | null
      share_token?: string | null
    }
    const relClients = approvalWithClients?.clients
    const shareToken = approvalWithClients?.share_token || null

    let clientDisplayName = 'Client'
    let clientEmail: string | null = null
    if (Array.isArray(relClients) && relClients.length > 0) {
      const c = relClients[0]
      clientDisplayName = c?.business_name || c?.name || 'Client'
      clientEmail = c?.email || null
    } else if (relClients && !Array.isArray(relClients)) {
      const c = relClients as ClientRef & { email?: string | null }
      clientDisplayName = c.business_name || c.name || 'Client'
      clientEmail = c.email || null
    }

    // 3) Resolve assignees + the @-mention map.
    //
    // Tokens can resolve to either a user (assignee) or a "raw" client-side
    // email address (the client.email column or any user with role='client'
    // tied to this client_id). The latter exists so an agency user can write
    // @ClientName and have the email reach the canonical contact even if
    // they don't yet have a portal user account.
    const { data: assigneesRows } = await supabase
      .from('approval_assignees')
      .select('user_id, users(name, email)')
      .eq('approval_id', approvalId)

    const tokenToUserId = new Map<string, string>()

    for (const row of (assigneesRows || []) as unknown as AssigneeRow[]) {
      const u = row.users
      const uid = row.user_id

      const name = (Array.isArray(u) ? u[0]?.name : u?.name) || ''
      const email = (Array.isArray(u) ? u[0]?.email : u?.email) || ''

      const first = normalizeKey(name.split(' ')[0] || '')
      const full = normalizeKey(name.replace(/\s+/g, ''))
      const emailLocal = normalizeKey((email.split('@')[0] || ''))

      if (first) tokenToUserId.set(first, uid)
      if (full) tokenToUserId.set(full, uid)
      if (emailLocal) tokenToUserId.set(emailLocal, uid)
    }

    // Pull every client-role user tied to this client_id and add them to the
    // mention map. Even if they aren't on approval_assignees, the client's
    // own people are mention-able.
    const clientId = (approval as unknown as { client_id?: string })?.client_id || null
    const tokenToClientEmail = new Map<string, string>()
    if (clientId) {
      const { data: clientUsers } = await supabase
        .from('users')
        .select('id, email, name, role')
        .eq('client_id', clientId)
        .eq('role', 'client')
      for (const cu of (clientUsers || []) as { id: string; email: string | null; name: string | null }[]) {
        if (!cu.email) continue
        const name = cu.name || ''
        const first = normalizeKey(name.split(' ')[0] || '')
        const full = normalizeKey(name.replace(/\s+/g, ''))
        const emailLocal = normalizeKey((cu.email.split('@')[0] || ''))
        if (first) tokenToUserId.set(first, cu.id)
        if (full) tokenToUserId.set(full, cu.id)
        if (emailLocal) tokenToUserId.set(emailLocal, cu.id)
      }

      // The client's own canonical contact (clients.name, clients.business_name,
      // clients.email). May not have a user account at all - resolved as a
      // raw email instead of a user_id.
      const clientName =
        (Array.isArray(relClients) ? relClients[0]?.name : (relClients as ClientRef | null)?.name) || ''
      const clientBusiness =
        (Array.isArray(relClients) ? relClients[0]?.business_name : (relClients as ClientRef | null)?.business_name) || ''
      if (clientEmail) {
        const tokens = [
          normalizeKey(clientName.split(' ')[0] || ''),
          normalizeKey(clientName.replace(/\s+/g, '')),
          normalizeKey(clientBusiness.split(' ')[0] || ''),
          normalizeKey(clientBusiness.replace(/\s+/g, '')),
          normalizeKey((clientEmail.split('@')[0] || '')),
          'client',
        ].filter(Boolean)
        for (const t of tokens) tokenToClientEmail.set(t, clientEmail)
      }
    }

    // Mentions take precedence: if anyone is @-tagged we notify ONLY them.
    // Otherwise we broadcast to every assignee + the client (minus the author).
    const mentionTokens = extractMentions(content)
    const mentionTargetIds = Array.from(
      new Set(
        mentionTokens
          .map((t) => tokenToUserId.get(normalizeKey(t)))
          .filter(Boolean) as string[]
      )
    ).filter((id) => id !== userId)
    const mentionRawEmails = Array.from(
      new Set(
        mentionTokens
          .map((t) => tokenToClientEmail.get(normalizeKey(t)))
          .filter(Boolean) as string[]
      )
    )

    const isMentionMode =
      mentionTokens.length > 0 && (mentionTargetIds.length > 0 || mentionRawEmails.length > 0)
    const notifyType = isMentionMode ? 'approval_mention' : 'approval_comment'

    let inAppTargetIds: string[] = []
    if (isMentionMode) {
      inAppTargetIds = mentionTargetIds
    } else {
      inAppTargetIds = Array.from(
        new Set(
          (assigneesRows || [])
            .map((r) => (r as unknown as AssigneeRow).user_id)
            .filter(Boolean)
        )
      ).filter((id) => id !== userId)
    }

    const snippet = content.length > 120 ? content.slice(0, 120) + '...' : content

    // 4) In-app notifications.
    if (inAppTargetIds.length > 0) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userIds: inAppTargetIds,
            type: notifyType,
            data: {
              approvalId,
              title: approval?.title || '',
              clientName: clientDisplayName,
              commentId: commentRow.id,
              itemId: approvalItemId,
              contentSnippet: snippet,
            },
          }),
        })
      } catch (notifyErr) {
        console.error('Approval in-app notification error:', notifyErr)
      }
    }

    // 5) Email notifications - written to the outbox so a transient Apps
    // Script blip can't lose them. Each row carries a stable idempotency
    // key tied to the comment id, so retried POSTs collapse at the DB.
    try {
      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/approvals/${approvalId}`
      const agencyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approvals/${approvalId}`
      const reviewUrl = shareToken
        ? `${process.env.NEXT_PUBLIC_APP_URL}/review/${shareToken}`
        : portalUrl

      const emailSnippet =
        content.length > 200 ? content.slice(0, 200) + '...' : content

      const basePayload = {
        clientName: clientDisplayName,
        approvalTitle: approval?.title || '',
        approvalId,
        commentSnippet: emailSnippet,
      }

      if (isMentionMode) {
        // Only the @-tagged folks get email. Split team vs client so each
        // recipient gets the right URL (agency dashboard vs review portal).
        const { data: mentionUsers } = mentionTargetIds.length
          ? await supabase
              .from('users')
              .select('id, email, role')
              .in('id', mentionTargetIds)
          : { data: [] as UserRow[] }

        const clientUserEmails = (mentionUsers || [])
          .filter((u: UserRow) => u.role === 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean) as string[]
        const teamEmails = (mentionUsers || [])
          .filter((u: UserRow) => u.role !== 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean) as string[]

        // Raw client emails resolved from @-mentions of the client's own name.
        const clientToList = Array.from(
          new Set([...clientUserEmails, ...mentionRawEmails]),
        )

        if (clientToList.length > 0) {
          await enqueueEmail({
            type: 'approval_mention',
            payload: { ...basePayload, to: clientToList, url: reviewUrl },
            idempotencyKey: `comment:${commentRow.id}:client-mention`,
          })
        }
        if (teamEmails.length > 0) {
          await enqueueEmail({
            type: 'approval_mention',
            payload: { ...basePayload, to: teamEmails, url: agencyUrl },
            idempotencyKey: `comment:${commentRow.id}:team-mention`,
          })
        }
      } else {
        // Broadcast emails are throttled per-approval to keep a chatty
        // session from flooding inboxes. The outbox idempotency key still
        // protects against retries within the same throttle window.
        const canEmail = await tryClaimEmailSlot(approvalId)
        if (!canEmail) {
          console.log('Skipping approval_comment broadcast email (cooldown)', {
            approvalId,
          })
          return NextResponse.json({ success: true, comment: commentRow })
        }

        const { data: assigneeUsers } = inAppTargetIds.length
          ? await supabase
              .from('users')
              .select('id, email, role')
              .in('id', inAppTargetIds)
          : { data: [] as UserRow[] }

        const teamEmails = (assigneeUsers || [])
          .filter((u: UserRow) => u.role !== 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean) as string[]
        const clientUserEmails = (assigneeUsers || [])
          .filter((u: UserRow) => u.role === 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean) as string[]

        if (teamEmails.length > 0) {
          await enqueueEmail({
            type: 'approval_comment',
            payload: { ...basePayload, to: teamEmails, url: agencyUrl },
            idempotencyKey: `comment:${commentRow.id}:team-broadcast`,
          })
        }

        const clientToList = Array.from(
          new Set([...clientUserEmails, clientEmail].filter(Boolean) as string[]),
        )
        if (clientToList.length > 0) {
          await enqueueEmail({
            type: 'approval_comment',
            payload: { ...basePayload, to: clientToList, url: reviewUrl },
            idempotencyKey: `comment:${commentRow.id}:client-broadcast`,
          })
        }
      }
    } catch (emailErr) {
      console.error('Approval comment email enqueue error:', emailErr)
    }

    return NextResponse.json({ success: true, comment: commentRow })
  } catch (err: unknown) {
    console.error('Create comment error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}