// Hard-delete a story queue item. The Mark-as-used + history flow is the
// soft path (item stays in DB, just hidden); this endpoint removes the row
// entirely. Used when a prompt is bad enough that the team doesn't want it
// in history at all.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const supabase = plannerAdmin()
    const { error } = await supabase.from('story_queue_items').delete().eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
