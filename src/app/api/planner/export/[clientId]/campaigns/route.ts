// GET /api/planner/export/[clientId]/campaigns
//
// Returns the list of campaigns (topic_group_ids) available to export
// for this client, ordered chronologically by earliest scheduled date.
// Used by the planner UI to populate the "select campaign" dropdown
// next to the Export button.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface SlotRow {
  topic_group_id: string | null
  scheduled_date: string
  stream: string
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params

    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: slotRows, error } = await admin
      .from('content_plan_slots')
      .select('topic_group_id, scheduled_date, stream')
      .eq('client_id', clientId)
      .order('scheduled_date', { ascending: true })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    const slots = (slotRows ?? []) as SlotRow[]

    // Group by topic_group_id (campaign). Singletons (topic_group_id null)
    // are bucketed under a synthetic 'untyped' key so they're still
    // exportable, but they collapse into one "Untyped slots" entry.
    const byCampaign = new Map<string, { firstDate: string; slotCount: number; streams: Set<string> }>()
    for (const s of slots) {
      const key = s.topic_group_id ?? '__untyped__'
      const cur = byCampaign.get(key) ?? { firstDate: s.scheduled_date, slotCount: 0, streams: new Set<string>() }
      cur.slotCount += 1
      cur.streams.add(s.stream)
      if (s.scheduled_date < cur.firstDate) cur.firstDate = s.scheduled_date
      byCampaign.set(key, cur)
    }

    const campaigns = Array.from(byCampaign.entries())
      .map(([id, info], idx) => ({
        id, // either a topic_group_id or '__untyped__'
        topicGroupId: id === '__untyped__' ? null : id,
        label: id === '__untyped__'
          ? `Untyped (${info.slotCount} slots)`
          : `Campaign ${idx + 1} - starting ${info.firstDate}`,
        firstDate: info.firstDate,
        slotCount: info.slotCount,
        streams: Array.from(info.streams),
      }))
      .sort((a, b) => a.firstDate.localeCompare(b.firstDate))
      // Re-number after sort so "Campaign 1" is the chronologically-first one.
      .map((c, idx) => ({
        ...c,
        label: c.topicGroupId === null
          ? c.label
          : `Campaign ${idx + 1} - starting ${c.firstDate}`,
      }))

    return NextResponse.json({ success: true, campaigns })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
