// src/app/api/approvals/comment/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      approvalId,
      approvalItemId,
      userId,
      content,
      fileUrl,
      fileName,
      parentCommentId,
    } = body

    if (!approvalId || !userId || !content) {
      return NextResponse.json(
        { success: false, error: 'Missing approvalId, userId, or content' },
        { status: 400 }
      )
    }

    // Insert comment
    const { data: commentRow, error: insertError } = await supabase
      .from('approval_comments')
      .insert({
        approval_id: approvalId,
        approval_item_id: approvalItemId || null,
        user_id: userId,
        content,
        file_url: fileUrl || null,
        file_name: fileName || null,
        parent_comment_id: parentCommentId || null,
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

    // Load approval + client for context
    const { data: approval } = await supabase
      .from('approvals')
      .select(
        'id, title, client_id, clients(name, business_name)'
      )
      .eq('id', approvalId)
      .single()

    const clientDisplayName =
      (approval?.clients?.business_name as string) ||
      (approval?.clients?.name as string) ||
      'Client'

    // Load assignees with user info (for mention matching)
const { data: assigneesRows } = await supabase
  .from('approval_assignees')
  .select('user_id, users(name, email)')
  .eq('approval_id', approvalId)

const mentionTokens = extractMentions(content)

// Build map: token -> userId
const tokenToUserId = new Map<string, string>()
for (const row of assigneesRows || []) {
  const u = (row as any).users
  const userId = (row as any).user_id as string
  const name = (Array.isArray(u) ? u[0]?.name : u?.name) || ''
  const email = (Array.isArray(u) ? u[0]?.email : u?.email) || ''

  const first = normalizeKey(name.split(' ')[0] || '')
  const full = normalizeKey(name.replace(/\s+/g, ''))
  const emailLocal = normalizeKey((email.split('@')[0] || ''))

  if (first) tokenToUserId.set(first, userId)
  if (full) tokenToUserId.set(full, userId)
  if (emailLocal) tokenToUserId.set(emailLocal, userId)
}

// Mention targets ONLY
const mentionTargetIds = Array.from(
  new Set(
    mentionTokens
      .map(t => tokenToUserId.get(normalizeKey(t)))
      .filter(Boolean) as string[]
  )
).filter((id) => id !== userId) // don't notify the commenter

    const watcherIds = (assigneesRows || []).map((r: any) => r.user_id).filter(Boolean)
    const uniqueWatcherIds = Array.from(new Set(watcherIds))

    // In-app notifications: approval_mention (mentions only)
try {
  if (mentionTargetIds.length > 0) {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userIds: mentionTargetIds,
        type: 'approval_mention',
        data: {
          approvalId,
          itemId: approvalItemId || null,
          clientName: clientDisplayName,
          title: approval?.title || '',
          commentId: commentRow.id,
          contentSnippet: content.length > 120 ? content.slice(0, 120) + '...' : content,
        },
      }),
    })
  }
} catch (notifyErr) {
  console.error('Approval mention in-app notification error:', notifyErr)
}

// Email notifications: approval_mention (mentions only)
try {
  const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
  const secret = process.env.APPS_SCRIPT_SECRET

  if (scriptUrl && secret && mentionTargetIds.length > 0) {
    const { data: mentionUsers } = await supabase
      .from('users')
      .select('id, email')
      .in('id', mentionTargetIds)

    const emails = (mentionUsers || [])
      .map((u: any) => u.email)
      .filter((e: string | null) => !!e)

    if (emails.length > 0) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approval_mention',
          payload: {
            secret,
            to: emails,
            clientName: clientDisplayName,
            approvalTitle: approval?.title || '',
            commentSnippet: content.length > 200 ? content.slice(0, 200) + '...' : content,
          },
        }),
      })
    }
  }
} catch (emailErr) {
  console.error('Approval mention email notification error:', emailErr)
}

    return NextResponse.json({ success: true, comment: commentRow })
  } catch (err: any) {
    console.error('Create comment error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
  function extractMentions(text: string): string[] {
  const out: string[] = []
  const re = /@([a-zA-Z0-9_]+)/g
  for (const m of text.matchAll(re)) {
    out.push((m[1] || '').toLowerCase())
  }
  return Array.from(new Set(out))
}

function normalizeKey(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
}
}