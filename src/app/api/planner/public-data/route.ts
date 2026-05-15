// Public read of a content plan, gated by share-link token. Returns a
// stripped-down view: dates, formats, hook previews, status pills, color
// streams. Hides scoring math, cooldown state, and any internal rationale.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'
import { listFormats } from '@/lib/contentFormats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
    }

    const supabase = plannerAdmin()
    const { data: link } = await supabase
      .from('content_plan_share_links')
      .select('id, client_id, expires_at, revoked_at')
      .eq('token', token)
      .maybeSingle()

    if (!link) {
      return NextResponse.json({ success: false, error: 'Invalid link' }, { status: 404 })
    }
    if (link.revoked_at) {
      return NextResponse.json({ success: false, error: 'Link revoked' }, { status: 410 })
    }
    if (new Date(link.expires_at as string) < new Date()) {
      return NextResponse.json({ success: false, error: 'Link expired' }, { status: 410 })
    }

    const clientId = link.client_id as string

    const { data: clientRow } = await supabase
      .from('clients')
      .select('id, name, business_name')
      .eq('id', clientId)
      .maybeSingle()

    // Scope: from start-of-current-month forward, no upper bound. We then
    // compute the actual months that have slots from the data itself - the
    // share view renders only populated months instead of a fixed 3-month
    // window where the back two are always empty.
    const today = new Date()
    const horizonStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`

    const { data: slotsRows } = await supabase
      .from('content_plan_slots')
      .select('id, stream, format_id, scheduled_date, status, hook_preview')
      .eq('client_id', clientId)
      .gte('scheduled_date', horizonStart)
      .order('scheduled_date', { ascending: true })

    const formats = await listFormats({ is_active: true })
    const formatById = new Map(formats.map((f) => [f.id, f]))

    const slots = (slotsRows ?? []).map((s) => {
      const format = s.format_id ? formatById.get(s.format_id as string) : null
      return {
        id: s.id,
        stream: s.stream,
        scheduled_date: s.scheduled_date,
        status: s.status,
        hook_preview: s.hook_preview,
        format_name: format?.name ?? (s.stream === 'long_form' ? 'Long-Form' : null),
      }
    })

    // Distinct months that actually contain slots, in calendar order. Empty
    // when the plan hasn't been generated for any month yet.
    const monthSet = new Set<string>()
    for (const s of slots) {
      monthSet.add(`${s.scheduled_date.slice(0, 7)}-01`)
    }
    const months = Array.from(monthSet).sort()

    // horizon.end is exclusive: month after the last populated month, so the
    // grid loop in the page renders all populated months and stops cleanly.
    let horizonEnd = horizonStart
    if (months.length > 0) {
      const last = months[months.length - 1]
      const [ly, lm] = last.split('-').map((p) => parseInt(p, 10))
      const ny = lm === 12 ? ly + 1 : ly
      const nm = lm === 12 ? 1 : lm + 1
      horizonEnd = `${ny}-${String(nm).padStart(2, '0')}-01`
    }

    return NextResponse.json({
      success: true,
      client: { id: clientRow?.id, name: clientRow?.business_name || clientRow?.name || 'Client' },
      slots,
      horizon: { start: months[0] ?? horizonStart, end: horizonEnd },
      months,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
