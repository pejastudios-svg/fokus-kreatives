// POST /api/push/subscribe
//
// Body: { endpoint, keys: { p256dh, auth } }
//
// Stores the caller's Web Push subscription so the server-side
// notification fan-out can deliver pushes to this device. Idempotent:
// re-subscribing with the same endpoint updates the existing row
// rather than inserting a duplicate (the endpoint column has a
// unique constraint).

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

  let body: {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad JSON' }, { status: 400 })
  }

  const endpoint = body.endpoint
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { success: false, error: 'Missing endpoint / keys' },
      { status: 400 },
    )
  }

  const userAgent = req.headers.get('user-agent') || null

  // Purge any older subscription rows belonging to this user from the
  // same browser (same user-agent string). Browsers re-issue a new
  // endpoint when:
  //  - VAPID public key rotates
  //  - User clears site data
  //  - Push service marks the old subscription stale
  //  - The user toggles off and back on
  // Without this cleanup, every re-link added a new row while the
  // old one sat orphaned forever - test pushes were going to 11
  // dead endpoints. We keep ONLY the row we're about to upsert.
  if (userAgent) {
    await admin
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('user_agent', userAgent)
      .neq('endpoint', endpoint)
  }

  const { error } = await admin
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )

  if (error) {
    console.error('[push/subscribe] upsert error:', error)
    return NextResponse.json(
      { success: false, error: 'Could not save subscription' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
