// POST /api/planner/slot/[id]/save-script
//
// Persists an edited script back into the slot's generation_meta. Does NOT
// touch the checklist - the recheck endpoint handles checklist updates so
// staff can decide which items to re-evaluate after an edit.
//
// Approved slots are immutable. The endpoint returns 409 to the UI so the
// drawer can surface the state instead of silently swallowing the click.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  script?: string
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing slot id' }, { status: 400 })
    }
    const body = (await req.json()) as Body
    const script = typeof body.script === 'string' ? body.script : ''
    if (!script.trim()) {
      return NextResponse.json({ success: false, error: 'Script text is required' }, { status: 400 })
    }

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
        { success: false, error: 'Cannot edit an approved slot' },
        { status: 409 },
      )
    }

    const meta = (slot.generation_meta as Record<string, unknown> | null) ?? {}
    const nextMeta = {
      ...meta,
      script,
      script_edited_at: new Date().toISOString(),
    }

    const { error: updateErr } = await supabase
      .from('content_plan_slots')
      .update({ generation_meta: nextMeta })
      .eq('id', id)

    if (updateErr) {
      console.error('save-script error:', updateErr)
      return NextResponse.json(
        { success: false, error: updateErr.message },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('save-script unhandled:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
