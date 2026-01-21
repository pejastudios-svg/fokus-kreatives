import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { approvalId } = await req.json()

    if (!approvalId) {
      return NextResponse.json(
        { success: false, error: 'Missing approvalId' },
        { status: 400 }
      )
    }

    // Delete children first
    const tables = ['approval_comments', 'approval_items', 'approval_assignees']
    for (const table of tables) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('approval_id', approvalId)

      if (error) {
        console.error(`Delete from ${table} error:`, error)
      }
    }

    const { error: approvalError } = await supabase
      .from('approvals')
      .delete()
      .eq('id', approvalId)

    if (approvalError) {
      console.error('Delete approval error:', approvalError)
      return NextResponse.json(
        { success: false, error: 'Failed to delete approval' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
    } catch (err: unknown) {
    console.error('Delete approval API error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}