// src/app/api/approvals/comment/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

// 10-minute email cooldown per approval — keeps a burst of comments from
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

    const isMentionMode = mentionTokens.length > 0 && mentionTargetIds.length > 0
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

    // 5) Email notifications.
    try {
      const secret = process.env.APPS_SCRIPT_SECRET
      if (!secret) {
        console.warn('APPS_SCRIPT_SECRET not configured')
        return NextResponse.json({ success: true, comment: commentRow })
      }

      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/approvals/${approvalId}`
      const agencyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approvals/${approvalId}`
      const reviewUrl = shareToken
        ? `${process.env.NEXT_PUBLIC_APP_URL}/review/${shareToken}`
        : portalUrl

      const emailSnippet =
        content.length > 200 ? content.slice(0, 200) + '...' : content

      if (isMentionMode) {
        // Only the @-tagged folks get email.
        const { data: mentionUsers } = await supabase
          .from('users')
          .select('id, email, role')
          .in('id', mentionTargetIds)

        const clientUserEmails = (mentionUsers || [])
          .filter((u: UserRow) => u.role === 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean)
        const teamEmails = (mentionUsers || [])
          .filter((u: UserRow) => u.role !== 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean)

        if (clientUserEmails.length > 0) {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'approval_mention',
              payload: {
                secret,
                to: clientUserEmails,
                clientName: clientDisplayName,
                approvalTitle: approval?.title || '',
                approvalId,
                commentSnippet: emailSnippet,
                url: reviewUrl,
              },
            }),
          })
        }

        if (teamEmails.length > 0) {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'approval_mention',
              payload: {
                secret,
                to: teamEmails,
                clientName: clientDisplayName,
                approvalTitle: approval?.title || '',
                approvalId,
                commentSnippet: emailSnippet,
                url: agencyUrl,
              },
            }),
          })
        }
      } else {
        // Broadcast emails are throttled (mentions don't go through this branch).
        const canEmail = await tryClaimEmailSlot(approvalId)
        if (!canEmail) {
          console.log('Skipping approval_comment broadcast email (cooldown)', {
            approvalId,
          })
          return NextResponse.json({ success: true, comment: commentRow })
        }

        // Broadcast: every assignee + the client.
        const { data: assigneeUsers } = inAppTargetIds.length
          ? await supabase
              .from('users')
              .select('id, email, role')
              .in('id', inAppTargetIds)
          : { data: [] as UserRow[] }

        const teamEmails = (assigneeUsers || [])
          .filter((u: UserRow) => u.role !== 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean)
        const clientUserEmails = (assigneeUsers || [])
          .filter((u: UserRow) => u.role === 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean)

        if (teamEmails.length > 0) {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'approval_comment',
              payload: {
                secret,
                to: teamEmails,
                clientName: clientDisplayName,
                approvalTitle: approval?.title || '',
                approvalId,
                commentSnippet: emailSnippet,
                url: agencyUrl,
              },
            }),
          })
        }

        const clientToList = Array.from(
          new Set(
            [...clientUserEmails, clientEmail].filter(Boolean) as string[],
          ),
        )
        if (clientToList.length > 0) {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'approval_comment',
              payload: {
                secret,
                to: clientToList,
                clientName: clientDisplayName,
                approvalTitle: approval?.title || '',
                approvalId,
                commentSnippet: emailSnippet,
                url: reviewUrl,
              },
            }),
          })
        }
      }
    } catch (emailErr) {
      console.error('Approval comment email notification error:', emailErr)
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