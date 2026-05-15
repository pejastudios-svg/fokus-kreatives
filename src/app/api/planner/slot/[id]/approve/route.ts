// POST /api/planner/slot/[id]/approve
//
// Marks a planner slot as 'approved'. Validates:
//   - the slot exists
//   - the slot is in 'drafted' status (must have been generated first)
//   - the script is set in generation_meta.script
//   - every checklist item is resolved: status='pass' OR human_status in ('fixed', 'waived')
//
// On success:
//   - flips slot.status to 'approved'
//   - sets approved_at = now()
//   - sets approved_by = caller's user_id
//   - marks each topics row referenced by the slot as consumed (used_at = now())
//     so the planner won't pick the same topic group again for a new slot
//
// Approval is the contractual gate between "AI draft" and "client-ready
// content." Once approved, the slot is immutable - regenerate / edit /
// reschedule / swap-format are all blocked downstream by existing
// status === 'approved' checks.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { isChecklistResolved, type ChecklistItem } from '@/lib/checklist/items'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing slot id' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // Load the slot via service-role admin (content_plan_slots RLS is
    // service-role-only).
    const { data: slot, error: slotErr } = await admin
      .from('content_plan_slots')
      .select('id, client_id, status, generation_meta, raw_material_refs')
      .eq('id', id)
      .maybeSingle()

    if (slotErr || !slot) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 })
    }

    if (slot.status === 'approved') {
      return NextResponse.json({ success: false, error: 'Slot is already approved' }, { status: 400 })
    }

    if (slot.status !== 'drafted') {
      return NextResponse.json(
        { success: false, error: 'Slot must be in drafted state. Generate the script first.' },
        { status: 400 },
      )
    }

    const meta = (slot.generation_meta as Record<string, unknown> | null) ?? {}
    const script = meta.script as string | undefined
    if (!script || !script.trim()) {
      return NextResponse.json(
        { success: false, error: 'Slot has no script saved. Generate before approving.' },
        { status: 400 },
      )
    }

    const checklist = (meta.checklist as ChecklistItem[] | undefined) ?? []
    if (checklist.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Slot has no checklist. Regenerate the script.' },
        { status: 400 },
      )
    }

    if (!isChecklistResolved(checklist)) {
      const unresolved = checklist.filter(
        (i) => !(i.status === 'pass' || i.human_status === 'fixed' || i.human_status === 'waived'),
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Checklist has unresolved items',
          unresolved: unresolved.map((i) => ({ id: i.id, label: i.label, status: i.status })),
        },
        { status: 400 },
      )
    }

    // Approve atomically. The .eq('status', 'drafted') guard makes this a
    // compare-and-set so a parallel approve attempt can't flip an already-
    // approved row.
    const nowIso = new Date().toISOString()
    const { data: approved, error: updErr } = await admin
      .from('content_plan_slots')
      .update({
        status: 'approved',
        approved_at: nowIso,
        approved_by: user.id,
      })
      .eq('id', id)
      .eq('status', 'drafted')
      .select('id, status, approved_at, approved_by')
      .single()

    if (updErr || !approved) {
      console.error('approve slot update error:', updErr)
      return NextResponse.json(
        { success: false, error: 'Failed to approve slot (it may have been approved in another tab)' },
        { status: 409 },
      )
    }

    // Mark the topics referenced by this slot as consumed. Best-effort -
    // a failure here doesn't undo the approval; staff can still re-mark
    // manually if needed.
    const refs = Array.isArray(slot.raw_material_refs)
      ? (slot.raw_material_refs as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
    if (refs.length > 0) {
      const { error: topicsErr } = await admin
        .from('topics')
        .update({ used_at: nowIso })
        .in('id', refs)
        .is('used_at', null)
      if (topicsErr) {
        console.warn('approve slot: topics consume failed (non-fatal):', topicsErr)
      }
    }

    return NextResponse.json({ success: true, slot: approved })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('planner/slot/approve error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
