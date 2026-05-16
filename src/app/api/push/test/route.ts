// POST /api/push/test
//
// Fires a single test push to every active subscription belonging to
// the calling user. Used by the Settings toggle's "Send test
// notification" button so users can verify the pipeline end-to-end
// without waiting for real activity.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToUsers } from '@/lib/webPushServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
  }

  await sendPushToUsers([user.id], {
    title: 'Test notification',
    body: 'If you see this, push delivery is working end-to-end.',
    url: '/',
  })

  return NextResponse.json({ success: true })
}
