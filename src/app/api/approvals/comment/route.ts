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

    // 2) Load approval + client name
    const { data: approval } = await supabase
      .from('approvals')
      .select('id, title, client_id, clients(name, business_name)')
      .eq('id', approvalId)
      .single()

    const approvalWithClients = approval as unknown as { clients: ClientRef | ClientRef[] | null }
    const relClients = approvalWithClients?.clients
    
    let clientDisplayName = 'Client'
    if (Array.isArray(relClients) && relClients.length > 0) {
      clientDisplayName = relClients[0]?.business_name || relClients[0]?.name || 'Client'
    } else if (relClients && !Array.isArray(relClients)) {
      const singleClient = relClients as ClientRef
      clientDisplayName = singleClient.business_name || singleClient.name || 'Client'
    }

    // Mentions-only notifications (if no @mentions, notify nobody)
    const mentionTokens = extractMentions(content)
    if (mentionTokens.length === 0) {
      return NextResponse.json({ success: true, comment: commentRow })
    }

    // 3) Load approval assignees (to resolve mentions to user IDs)
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

    const mentionTargetIds = Array.from(
      new Set(
        mentionTokens
          .map((t) => tokenToUserId.get(normalizeKey(t)))
          .filter(Boolean) as string[]
      )
    ).filter((id) => id !== userId)

    if (mentionTargetIds.length === 0) {
      return NextResponse.json({ success: true, comment: commentRow })
    }

    // 4) In-app notifications (drives popup + sound)
    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: mentionTargetIds,
          type: 'approval_mention',
          data: {
            approvalId,
            title: approval?.title || '',
            clientName: clientDisplayName,
            commentId: commentRow.id,
            itemId: approvalItemId,
            contentSnippet: content.length > 120 ? content.slice(0, 120) + '...' : content,
          },
        }),
      })
    } catch (notifyErr) {
      console.error('Approval mention in-app notification error:', notifyErr)
    }

    // 5) Email notifications (mentions only; split client/team URLs)
    try {
      const secret = process.env.APPS_SCRIPT_SECRET
      if (!secret) {
        console.warn('APPS_SCRIPT_SECRET not configured')
        return NextResponse.json({ success: true, comment: commentRow })
      }

      const { data: mentionUsers } = await supabase
        .from('users')
        .select('id, email, role')
        .in('id', mentionTargetIds)

      const clientEmails = (mentionUsers || [])
        .filter((u: UserRow) => u.role === 'client')
        .map((u: UserRow) => u.email)
        .filter(Boolean)

      const teamEmails = (mentionUsers || [])
        .filter((u: UserRow) => u.role !== 'client')
        .map((u: UserRow) => u.email)
        .filter(Boolean)

      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/approvals/${approvalId}`
      const agencyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approvals/${approvalId}`

      if (clientEmails.length > 0) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'approval_mention',
            payload: {
              secret,
              to: clientEmails,
              clientName: clientDisplayName,
              approvalTitle: approval?.title || '',
              approvalId,
              commentSnippet: content.length > 200 ? content.slice(0, 200) + '...' : content,
              url: portalUrl,
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
              commentSnippet: content.length > 200 ? content.slice(0, 200) + '...' : content,
              url: agencyUrl,
            },
          }),
        })
      }
    } catch (emailErr) {
      console.error('Approval mention email notification error:', emailErr)
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