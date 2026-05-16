// POST /api/push/test
//
// Fires a single test push to every active subscription belonging to
// the calling user. Used by the Settings toggle's "Send test
// notification" button so users can verify the pipeline end-to-end
// without waiting for real activity.
//
// Returns the count of subscriptions targeted so the UI can
// distinguish "I sent the push but your OS didn't display it" from
// "There's no subscription registered for this user / device".

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendPushToUsers } from '@/lib/webPushServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
  }

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, user_agent')
    .eq('user_id', user.id)

  const count = subs?.length ?? 0

  // Group by domain so the UI can say "1 Mac (fcm.googleapis.com),
  // 0 Android" - the endpoint domain identifies which push service
  // is involved and (loosely) which platform.
  const breakdown = (subs ?? []).map((s) => {
    let host = 'unknown'
    try {
      host = new URL(s.endpoint).host
    } catch {
      /* ignore */
    }
    return {
      id: s.id,
      pushService: host,
      userAgent: (s.user_agent || '').slice(0, 80),
    }
  })

  await sendPushToUsers([user.id], {
    title: 'Test notification',
    body: 'If you see this, push delivery is working end-to-end.',
    url: '/',
  })

  return NextResponse.json({
    success: true,
    subscriptionCount: count,
    subscriptions: breakdown,
  })
}
