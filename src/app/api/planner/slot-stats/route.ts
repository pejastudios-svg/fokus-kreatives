// GET /api/planner/slot-stats
//
// Returns per-client slot aggregates (total, approved, last activity) used
// by the planner index page. Goes through the service-role admin client
// because content_plan_slots RLS is service-role-only - the previous
// browser-side query silently returned empty rows and made every client
// show "No plan yet" even when slots existed.
//
// Caller passes ?clientIds=id1,id2,... so the route returns only the
// stats for clients the user already has access to (the page already
// scopes the client list via client_memberships).

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface SlotStats {
  client_id: string
  total: number
  approved: number
  last_activity: string | null
}

export async function GET(req: NextRequest) {
  try {
    // Require an authenticated session - any logged-in agency user can
    // see slot stats for clients they have access to, which the
    // ?clientIds= filter enforces (caller has already resolved access).
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const url = new URL(req.url)
    const idsParam = url.searchParams.get('clientIds') ?? ''
    const clientIds = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (clientIds.length === 0) {
      return NextResponse.json({ success: true, stats: [] })
    }

    const { data: rows, error } = await admin
      .from('content_plan_slots')
      .select('client_id, status, updated_at')
      .in('client_id', clientIds)

    if (error) {
      console.error('slot-stats load error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load slot stats' }, { status: 500 })
    }

    const acc = new Map<string, SlotStats>()
    for (const r of (rows ?? []) as Array<{ client_id: string; status: string; updated_at: string | null }>) {
      const cur = acc.get(r.client_id) ?? { client_id: r.client_id, total: 0, approved: 0, last_activity: null }
      cur.total += 1
      if (r.status === 'approved') cur.approved += 1
      if (r.updated_at && (!cur.last_activity || r.updated_at > cur.last_activity)) {
        cur.last_activity = r.updated_at
      }
      acc.set(r.client_id, cur)
    }

    return NextResponse.json({ success: true, stats: Array.from(acc.values()) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
