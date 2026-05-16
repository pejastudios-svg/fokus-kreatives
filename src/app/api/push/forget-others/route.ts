// POST /api/push/forget-others
//
// Body: { endpoint }
//
// Deletes every push_subscriptions row belonging to the calling user
// EXCEPT the one whose endpoint matches the caller (i.e. "this
// device's current subscription"). Used by the Settings toggle to
// purge ghost subscriptions accumulated from prior re-link attempts.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
  }

  let body: { endpoint?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad JSON' }, { status: 400 })
  }

  // Two paths:
  //  - With endpoint: delete everything BUT this one (keep current).
  //  - Without endpoint: delete everything (full clear).
  // We do a count query first because Supabase delete-with-count
  // chaining changed shape across versions; this approach works on
  // any version + gives us the exact removed count for the UI.
  const countQuery = admin
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (body.endpoint) {
    countQuery.neq('endpoint', body.endpoint)
  }
  const { count } = await countQuery

  let deleteQuery = admin
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
  if (body.endpoint) {
    deleteQuery = deleteQuery.neq('endpoint', body.endpoint)
  }
  const { error } = await deleteQuery

  if (error) {
    console.error('[push/forget-others] delete error:', error)
    return NextResponse.json(
      { success: false, error: 'Could not clean up' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, removed: count ?? 0 })
}
