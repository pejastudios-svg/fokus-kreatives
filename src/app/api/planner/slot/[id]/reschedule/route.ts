import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  scheduledDate?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const body = (await req.json()) as Body
    if (!body.scheduledDate || !DATE_RE.test(body.scheduledDate)) {
      return NextResponse.json({ success: false, error: 'scheduledDate must be yyyy-mm-dd' }, { status: 400 })
    }

    const supabase = plannerAdmin()

    // Check cooldown violations against same-format peers within 14 days.
    const { data: slotRow } = await supabase
      .from('content_plan_slots')
      .select('id, client_id, format_id, status')
      .eq('id', id)
      .maybeSingle()
    if (!slotRow) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 })
    }
    if (slotRow.status === 'approved') {
      return NextResponse.json({ success: false, error: 'Cannot move an approved slot' }, { status: 400 })
    }

    const warnings: string[] = []
    if (slotRow.format_id) {
      const { data: peers } = await supabase
        .from('content_plan_slots')
        .select('id, scheduled_date')
        .eq('client_id', slotRow.client_id as string)
        .eq('format_id', slotRow.format_id as string)
        .neq('id', id)
      const target = new Date(body.scheduledDate)
      for (const p of peers ?? []) {
        const diff = Math.abs(
          (new Date(p.scheduled_date as string).getTime() - target.getTime()) /
            (24 * 60 * 60 * 1000),
        )
        if (diff < 7) {
          warnings.push(`Same format scheduled within ${Math.round(diff)} days (${p.scheduled_date})`)
          break
        }
      }
    }

    const { data: updated, error } = await supabase
      .from('content_plan_slots')
      .update({ scheduled_date: body.scheduledDate })
      .eq('id', id)
      .select('id, scheduled_date')
      .single()

    if (error || !updated) {
      return NextResponse.json({ success: false, error: error?.message ?? 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, slot: updated, warnings })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
