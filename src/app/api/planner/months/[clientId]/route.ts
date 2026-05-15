// GET /api/planner/months/[clientId]
//
// Returns every month that has at least one slot for this client, with
// slot count and the month's first/last dates. Used by the planner page
// to render the "active plans" jump strip - so staff can navigate to any
// month with content, even ones outside the current picker range.
//
// Goes through the service-role admin client because the
// content_plan_slots RLS policy is service-role-only. We only return
// scheduled_date - no script content, no PII, no generation_meta - so
// the auth gate just verifies the caller is logged in.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface MonthInfo {
  /** YYYY-MM key, used by the UI as a stable identifier. */
  ym: string
  /** Earliest scheduled date that month, YYYY-MM-DD. */
  firstDate: string
  /** Latest scheduled date that month, YYYY-MM-DD. */
  lastDate: string
  /** Number of slots in the month (across all streams). */
  slotCount: number
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing client id' }, { status: 400 })
    }

    // Auth gate.
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: rows, error } = await admin
      .from('content_plan_slots')
      .select('scheduled_date')
      .eq('client_id', clientId)
      .order('scheduled_date', { ascending: true })

    if (error) {
      console.error('months load error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to load months' },
        { status: 500 },
      )
    }

    const dates = (rows ?? []).map((r) => r.scheduled_date as string).filter(Boolean)

    // Bucket dates by YYYY-MM.
    const byMonth = new Map<string, MonthInfo>()
    for (const date of dates) {
      const ym = date.slice(0, 7) // YYYY-MM
      const cur = byMonth.get(ym) ?? {
        ym,
        firstDate: date,
        lastDate: date,
        slotCount: 0,
      }
      cur.slotCount += 1
      if (date < cur.firstDate) cur.firstDate = date
      if (date > cur.lastDate) cur.lastDate = date
      byMonth.set(ym, cur)
    }

    const months = Array.from(byMonth.values()).sort((a, b) => a.ym.localeCompare(b.ym))

    return NextResponse.json({ success: true, months })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
