// src/app/api/approvals/comments/create/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Types for Supabase responses
interface ClientRef {
  name: string | null
  business_name: string | null
}

interface AssigneeRow {
  user_id: string
}

interface UserRow {
  id: string
  email: string | null
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type CreateCommentBody = {
  approvalId: string
  approvalItemId?: string | null
  userId: string
  content: string
  fileUrl?: string | null
  fileName?: string | null
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateCommentBody
    const { approvalId, approvalItemId, userId, content, fileUrl, fileName } = body

    if (!approvalId || !userId || !content.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing approvalId, userId or content' },
        { status: 400 }
      )
    }

    // 1) Insert comment
    const nowIso = new Date().toISOString()

    const { data: commentRow, error: commentError } = await supabase
      .from('approval_comments')
      .insert({
        approval_id: approvalId,
        approval_item_id: approvalItemId || null,
        user_id: userId,
        content: content.trim(),
        file_url: fileUrl || null,
        file_name: fileName || null,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(
        'id, approval_id, approval_item_id, user_id, content, resolved, file_url, file_name, created_at, users(name, profile_picture_url)'
      )
      .single()

    if (commentError || !commentRow) {
      console.error('Create comment error:', commentError)
      return NextResponse.json(
        { success: false, error: 'Failed to create comment' },
        { status: 500 }
      )
    }

    // 2) Load approval and client info (for notifications)
    const { data: approval } = await supabase
      .from('approvals')
      .select('id, title, client_id, clients(name, business_name)')
      .eq('id', approvalId)
      .single()

    let clientDisplayName = 'Client'
    // Cast approval to unknown first, then to the shape we expect
    const approvalWithClients = approval as unknown as { clients: ClientRef | ClientRef[] | null }
    const relClients = approvalWithClients?.clients

    if (Array.isArray(relClients) && relClients.length > 0) {
      clientDisplayName =
        relClients[0].business_name || relClients[0].name || 'Client'
    } else if (relClients && !Array.isArray(relClients)) {
      const singleClient = relClients as ClientRef
      clientDisplayName =
        singleClient.business_name || singleClient.name || 'Client'
    }

    // 3) Load watchers (creator, assignees, client portal users)
    const { data: assigneesRows } = await supabase
      .from('approval_assignees')
      .select('user_id')
      .eq('approval_id', approvalId)

    const watcherIds = (assigneesRows || [])
      .map((r: AssigneeRow) => r.user_id)
      .filter(Boolean)

    const uniqueWatcherIds = Array.from(new Set(watcherIds))

    // 4) In-app notifications (type: approval_comment)
    try {
      if (uniqueWatcherIds.length > 0) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userIds: uniqueWatcherIds,
            type: 'approval_comment',
            data: {
              approvalId,
              title: approval?.title || '',
              clientName: clientDisplayName,
              commentPreview: content.slice(0, 120),
              actorId: userId,
            },
          }),
        })
      }
    } catch (notifyErr) {
      console.error('Approval comment in-app notification error:', notifyErr)
    }

    // 4b) Mention-specific notifications (@FirstName)
try {
  const mentionedFirstNames = content
    .split(/\s+/)
    .filter(w => w.startsWith('@') && w.length > 1)
    .map(w => w.slice(1).toLowerCase())

  if (
    mentionedFirstNames.length > 0 &&
    uniqueWatcherIds.length > 0
  ) {
    const { data: mentionableUsers } = await supabase
      .from('users')
      .select('id, name')
      .in('id', uniqueWatcherIds)

    const mentionedIds =
      (mentionableUsers || [])
        .filter(u => {
          const first = (u.name || '')
            .split(' ')[0]
            .toLowerCase()
          return mentionedFirstNames.includes(first)
        })
        .map(u => u.id)

    if (mentionedIds.length > 0) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: mentionedIds,
          type: 'approval_mention',
          data: {
            approvalId,
            title: approval?.title || '',
            clientName: clientDisplayName,
            commentPreview: content.slice(0, 120),
            actorId: userId,
          },
        }),
      })
    }
  }
} catch (mentionErr) {
  console.error('Approval mention notification error:', mentionErr)
}

    // 5) Email notifications via Apps Script
    try {
      const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
      const secret = process.env.APPS_SCRIPT_SECRET

      if (scriptUrl && secret && uniqueWatcherIds.length > 0) {
        const { data: watcherUsers } = await supabase
          .from('users')
          .select('id, email')
          .in('id', uniqueWatcherIds)

        const emails = (watcherUsers || [])
          .map((u: UserRow) => u.email)
          .filter((e: string | null) => !!e)

        if (emails.length > 0) {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'approval_comment',
              payload: {
                secret,
                to: emails,
                clientName: clientDisplayName,
                approvalTitle: approval?.title || '',
                commentPreview: content.slice(0, 200),
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
    console.error('Create approval comment error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}