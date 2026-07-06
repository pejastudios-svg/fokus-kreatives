// GET /api/planner/campaign-pending?clientId=...&topicGroupId=...
//
// Returns every slot in the campaign (topic_group_id) that has no saved
// script - regardless of scheduled_date. The planner UI's slot list is
// scoped to the visible calendar window (fromDate defaults to today), so
// campaign slots scheduled in the past fall outside it. Bulk campaign
// generation and the "N slots remaining" drawer count both use THIS
// endpoint so past-dated slots aren't silently skipped - that skip is
// exactly how campaigns ended up exporting with "no script generated yet"
// placeholders for assets the user believed were done.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const clientId = url.searchParams.get('clientId')
    const topicGroupId = url.searchParams.get('topicGroupId')
    if (!clientId || !topicGroupId) {
      return NextResponse.json(
        { success: false, error: 'Missing clientId or topicGroupId' },
        { status: 400 },
      )
    }

    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: rows, error } = await admin
      .from('content_plan_slots')
      .select('id, stream, scheduled_date, status, generation_meta')
      .eq('client_id', clientId)
      .eq('topic_group_id', topicGroupId)
      .order('scheduled_date', { ascending: true })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    const pending = (rows ?? [])
      .filter((s) => {
        const meta = (s.generation_meta as Record<string, unknown> | null) ?? {}
        const script = typeof meta.script === 'string' ? meta.script.trim() : ''
        return !script
      })
      .map((s) => ({
        id: s.id as string,
        stream: s.stream as string,
        scheduled_date: s.scheduled_date as string,
        status: s.status as string,
      }))

    return NextResponse.json({ success: true, slots: pending })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
