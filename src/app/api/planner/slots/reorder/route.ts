// Reorder slots within a single date. The body's `slotIds` array represents
// the new top-to-bottom order for that date; we assign display_order = index.
//
// All-or-nothing: if any slot in the list belongs to a different client or
// date than the request claims, we reject. Keeps drag-drop on the calendar
// from accidentally cross-pollinating cells.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface Body {
  clientId?: string
  date?: string
  slotIds?: string[]
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    if (!body.clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }
    if (!body.date || !DATE_RE.test(body.date)) {
      return NextResponse.json({ success: false, error: 'date must be yyyy-mm-dd' }, { status: 400 })
    }
    if (!Array.isArray(body.slotIds) || body.slotIds.length === 0) {
      return NextResponse.json({ success: false, error: 'slotIds is required' }, { status: 400 })
    }

    const supabase = plannerAdmin()
    const { data: rows, error: fetchErr } = await supabase
      .from('content_plan_slots')
      .select('id, client_id, scheduled_date')
      .in('id', body.slotIds)

    if (fetchErr) {
      return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 })
    }
    if (!rows || rows.length !== body.slotIds.length) {
      return NextResponse.json({ success: false, error: 'Some slot ids not found' }, { status: 404 })
    }
    for (const r of rows) {
      if (r.client_id !== body.clientId || r.scheduled_date !== body.date) {
        return NextResponse.json(
          { success: false, error: 'Slot does not belong to the given client/date' },
          { status: 400 },
        )
      }
    }

    // Apply order. One UPDATE per slot keeps it simple; the list is short
    // (almost always < 5 slots per date).
    for (let i = 0; i < body.slotIds.length; i++) {
      const { error } = await supabase
        .from('content_plan_slots')
        .update({ display_order: i })
        .eq('id', body.slotIds[i])
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
