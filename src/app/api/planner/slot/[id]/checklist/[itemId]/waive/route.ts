// POST /api/planner/slot/[id]/checklist/[itemId]/waive
//
// Records a staff waiver on a checklist item. The AI's `status` stays as-is
// (we want the audit trail to show that the AI flagged it AND a human
// chose to ship anyway). Sets human_status='waived', human_note (required
// reason), edited_by, edited_at.
//
// Pair endpoint to recheck: a flagged item gets EITHER a waiver here OR a
// fresh AI re-eval via the recheck endpoint. Both paths satisfy the
// approval gate.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'
import { getUser } from '@/lib/supabase/server'
import type { ChecklistItem } from '@/lib/checklist/items'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  /** Required reason. Without it the audit log loses meaning. */
  reason?: string
  /** When 'fixed', the staff has hand-edited the script and is asserting the
   *  item now passes. When 'waived', the staff is shipping despite the flag.
   *  Default 'waived'. */
  human_status?: 'fixed' | 'waived'
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await context.params
    if (!id || !itemId) {
      return NextResponse.json(
        { success: false, error: 'Missing slot id or item id' },
        { status: 400 },
      )
    }
    const body = (await req.json().catch(() => ({}))) as Body
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const humanStatus: 'fixed' | 'waived' =
      body.human_status === 'fixed' ? 'fixed' : 'waived'
    if (humanStatus === 'waived' && !reason) {
      return NextResponse.json(
        { success: false, error: 'Waiver reason is required' },
        { status: 400 },
      )
    }

    const user = await getUser()
    const userId = user?.id ?? null

    const supabase = plannerAdmin()
    const { data: slot, error: loadErr } = await supabase
      .from('content_plan_slots')
      .select('id, status, generation_meta')
      .eq('id', id)
      .maybeSingle()
    if (loadErr || !slot) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 })
    }
    if (slot.status === 'approved') {
      return NextResponse.json(
        { success: false, error: 'Cannot edit checklist on an approved slot' },
        { status: 409 },
      )
    }

    const meta = (slot.generation_meta as Record<string, unknown> | null) ?? {}
    const checklist = Array.isArray(meta.checklist)
      ? (meta.checklist as ChecklistItem[])
      : []
    const target = checklist.find((i) => i.id === itemId)
    if (!target) {
      return NextResponse.json(
        { success: false, error: `Unknown checklist item: ${itemId}` },
        { status: 404 },
      )
    }

    const now = new Date().toISOString()
    const updated = checklist.map((item): ChecklistItem => {
      if (item.id !== itemId) return item
      return {
        ...item,
        human_status: humanStatus,
        human_note: reason || undefined,
        edited_by: userId ?? item.edited_by,
        edited_at: now,
      }
    })

    const nextMeta = { ...meta, checklist: updated }
    const { error: saveErr } = await supabase
      .from('content_plan_slots')
      .update({ generation_meta: nextMeta })
      .eq('id', id)
    if (saveErr) {
      console.error('checklist/waive save error:', saveErr)
      return NextResponse.json(
        { success: false, error: saveErr.message },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      item: updated.find((i) => i.id === itemId) ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('checklist/waive unhandled:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
