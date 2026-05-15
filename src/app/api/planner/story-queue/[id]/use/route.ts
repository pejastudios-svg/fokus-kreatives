import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  /** Default true = mark as used. Pass false to undo (move back to active queue). */
  used?: boolean
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const body = (await req.json().catch(() => ({}))) as Body
    const markAsUsed = body.used !== false

    const user = await getUser()
    const supabase = plannerAdmin()
    const { data: row } = await supabase
      .from('story_queue_items')
      .select('id, client_id, consumed_at')
      .eq('id', id)
      .maybeSingle()
    if (!row) return NextResponse.json({ success: false, error: 'Prompt not found' }, { status: 404 })

    const { error } = await supabase
      .from('story_queue_items')
      .update(
        markAsUsed
          ? { consumed_at: new Date().toISOString(), consumed_by: user?.id ?? null }
          : { consumed_at: null, consumed_by: null },
      )
      .eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // No auto-refill: bulk story generation now happens at plan-generation
    // time (Phase D in generatePlan). The team uses the manual "+ New prompt"
    // or "Refill" buttons for ad-hoc additions.

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
