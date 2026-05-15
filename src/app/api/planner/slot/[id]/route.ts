// DELETE removes a planned (or drafted) slot. Approved slots are not
// deletable - use the regenerate or reschedule paths instead.

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
    const { data: row } = await supabase
      .from('content_plan_slots')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 })
    }
    if (row.status === 'approved') {
      return NextResponse.json({ success: false, error: 'Cannot delete an approved slot' }, { status: 400 })
    }
    const { error } = await supabase.from('content_plan_slots').delete().eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
