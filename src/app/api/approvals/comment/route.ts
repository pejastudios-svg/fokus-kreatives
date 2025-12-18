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

    // Load watchers (assignees)
    const { data: assigneesRows } = await supabase
      .from('approval_assignees')
      .select('user_id')
      .eq('approval_id', approvalId)

    const watcherIds = (assigneesRows || []).map((r: any) => r.user_id).filter(Boolean)
    const uniqueWatcherIds = Array.from(new Set(watcherIds))

    // In-app notifications: approval_commented
    try {
      if (uniqueWatcherIds.length > 0) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userIds: uniqueWatcherIds,
            type: 'approval_commented',
            data: {
              approvalId,
              itemId: approvalItemId || null,
              contentSnippet:
                content.length > 100 ? content.slice(0, 100) + '...' : content,
              clientName: clientDisplayName,
              title: approval?.title || '',
              commentId: commentRow.id,
            },
          }),
        })
      }
    } catch (notifyErr) {
      console.error('Approval comment in-app notification error:', notifyErr)
    }

    // Email notifications via Apps Script
    try {
      const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
      const secret = process.env.APPS_SCRIPT_SECRET

      if (scriptUrl && secret && uniqueWatcherIds.length > 0) {
        const { data: watcherUsers } = await supabase
          .from('users')
          .select('id, email')
          .in('id', uniqueWatcherIds)

        const emails = (watcherUsers || [])
          .map((u: any) => u.email)
          .filter((e: string | null) => !!e)

        if (emails.length > 0) {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'approval_commented',
              payload: {
                secret,
                to: emails,
                clientName: clientDisplayName,
                approvalTitle: approval?.title || '',
                commentSnippet:
                  content.length > 200 ? content.slice(0, 200) + '...' : content,
              },
            }),
          })
        }
      }
    } catch (emailErr) {
      console.error('Approval comment email notification error:', emailErr)
    }

    return NextResponse.json({ success: true, comment: commentRow })
  } catch (err: any) {
    console.error('Create comment error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
}