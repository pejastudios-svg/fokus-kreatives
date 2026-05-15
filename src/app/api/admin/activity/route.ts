// GET /api/admin/activity
//
// Returns the unioned activity feed for the admin dashboard. All filters
// are query-string params; the heavy lifting happens in lib/admin/events.
//
// Query params:
//   since=<iso>     UTC ISO time, lower bound (required)
//   until=<iso>     UTC ISO time, upper bound (optional)
//   clientId=<id>   filter to one client
//   actorId=<id>    filter to one user
//   categories=ai,slot,...   comma-separated category filter
//   status=ok|failed|all
//   limit=<n>       per-source limit (default 500)
//   q=<string>      free-text search across actor / client / detail (client-side)
//
// Real-time is handled in the page via a Supabase channel subscription
// on ai_usage_log; this endpoint is for the initial render + filter
// changes + 30s background refreshes.

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAccess } from '@/lib/admin/guard'
import {
  loadActivity,
  type ActivityQueryOpts,
  type EventCategory,
  type EventStatus,
} from '@/lib/admin/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await checkAdminAccess()
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const since = url.searchParams.get('since')
  if (!since) {
    return NextResponse.json(
      { success: false, error: '`since` is required' },
      { status: 400 },
    )
  }

  const opts: ActivityQueryOpts = {
    since,
    until: url.searchParams.get('until') ?? undefined,
    clientId: url.searchParams.get('clientId'),
    actorId: url.searchParams.get('actorId'),
    perSourceLimit: Number(url.searchParams.get('limit')) || 500,
    status: (url.searchParams.get('status') as EventStatus | 'all') ?? 'all',
  }

  const catParam = url.searchParams.get('categories')
  if (catParam) {
    opts.categories = catParam.split(',').filter(Boolean) as EventCategory[]
  }

  try {
    const result = await loadActivity(opts)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('admin/activity error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
