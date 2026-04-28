import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin' && me?.role !== 'manager') {
      return NextResponse.json({ success: false, error: 'Admins or managers only' }, { status: 403 })
    }

    const { approvalId } = await req.json()
    if (!approvalId) {
      return NextResponse.json({ success: false, error: 'Missing approvalId' }, { status: 400 })
    }

    const tables = ['approval_comments', 'approval_items', 'approval_assignees']
    for (const table of tables) {
      const { error } = await admin.from(table).delete().eq('approval_id', approvalId)
      if (error) console.error(`Delete from ${table} error:`, error)
    }

    const { error: approvalError } = await admin.from('approvals').delete().eq('id', approvalId)
    if (approvalError) {
      console.error('Delete approval error:', approvalError)
      return NextResponse.json({ success: false, error: 'Failed to delete approval' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('Delete approval API error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 })
  }
}
