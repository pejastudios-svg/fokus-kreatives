// src/app/api/approvals/comments/update/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type UpdateCommentBody = {
  commentId: string
  content?: string
  resolved?: boolean
  actorId: string
}

type CommentUpdates = {
  updated_at: string
  content?: string
  resolved?: boolean
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateCommentBody
    const { commentId, content, resolved, actorId } = body

    if (!commentId || !actorId) {
      return NextResponse.json(
        { success: false, error: 'Missing commentId or actorId' },
        { status: 400 }
      )
    }

    // Load comment
    const { data: comment, error: commentError } = await supabase
      .from('approval_comments')
      .select('id, approval_id, user_id, resolved, content')
      .eq('id', commentId)
      .single()

    if (commentError || !comment) {
      return NextResponse.json(
        { success: false, error: 'Comment not found' },
        { status: 404 }
      )
    }

    // Optional: prevent others from editing content (only owner):
    const updates: CommentUpdates = { updated_at: new Date().toISOString() }

    if (typeof content === 'string' && content.trim() !== '' && comment.user_id === actorId) {
      updates.content = content.trim()
    }

    // Resolve toggle can be done by anyone for now
    if (typeof resolved === 'boolean') {
      updates.resolved = resolved
    }

    const { error: updateError } = await supabase
      .from('approval_comments')
      .update(updates)
      .eq('id', commentId)

    if (updateError) {
      console.error('Update comment error:', updateError)
      return NextResponse.json(
        { success: false, error: 'Failed to update comment' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('Update approval comment error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}