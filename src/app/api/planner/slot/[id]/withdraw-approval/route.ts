// POST /api/planner/slot/[id]/withdraw-approval
//
// Reverses an approval: flips an 'approved' slot back to 'drafted' so it can
// be edited / regenerated / rescheduled again. Validates:
//   - the slot exists
//   - the slot is currently 'approved' (nothing to withdraw otherwise)
//
// On success:
//   - flips slot.status back to 'drafted'
//   - clears approved_at + approved_by
//
// NOTE: topic consumption (topics.used_at) set at approval time is left as-is.
// The slot still exists and still "owns" those topics - un-consuming them would
// let the planner generate a duplicate against the same material. If the slot
// is later deleted, that path already handles releasing the topics.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

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

    const { data: slot, error: slotErr } = await admin
      .from('content_plan_slots')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()

    if (slotErr || !slot) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 })
    }

    if (slot.status !== 'approved') {
      return NextResponse.json(
        { success: false, error: 'Slot is not approved - nothing to withdraw.' },
        { status: 400 },
      )
    }

    // Compare-and-set on status='approved' so a concurrent withdraw / edit
    // can't double-apply.
    const { data: updated, error: updErr } = await admin
      .from('content_plan_slots')
      .update({
        status: 'drafted',
        approved_at: null,
        approved_by: null,
      })
      .eq('id', id)
      .eq('status', 'approved')
      .select('id, status, approved_at, approved_by')
      .single()

    if (updErr || !updated) {
      console.error('withdraw-approval slot update error:', updErr)
      return NextResponse.json(
        { success: false, error: 'Failed to withdraw approval (it may have changed in another tab)' },
        { status: 409 },
      )
    }

    return NextResponse.json({ success: true, slot: updated })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('planner/slot/withdraw-approval error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
