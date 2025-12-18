// src/app/api/approvals/comments/delete/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type DeleteCommentBody = {
  commentId: string
  actorId: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteCommentBody
    const { commentId, actorId } = body

    if (!commentId || !actorId) {
      return NextResponse.json(
        { success: false, error: 'Missing commentId or actorId' },
        { status: 400 }
      )
    }

    // Load comment (so we could enforce ownership if needed)
    const { data: comment, error: commentError } = await supabase
      .from('approval_comments')
      .select('id, user_id')
      .eq('id', commentId)
      .single()

    if (commentError || !comment) {
      return NextResponse.json(
        { success: false, error: 'Comment not found' },
        { status: 404 }
      )
    }

    // Optional content-owner check:
    // if (comment.user_id !== actorId) {
    //   return NextResponse.json(
    //     { success: false, error: 'Not allowed to delete this comment' },
    //     { status: 403 }
    //   )
    // }

    const { error: deleteError } = await supabase
      .from('approval_comments')
      .delete()
      .eq('id', commentId)

    if (deleteError) {
      console.error('Delete comment error:', deleteError)
      return NextResponse.json(
        { success: false, error: 'Failed to delete comment' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Delete approval comment error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
}