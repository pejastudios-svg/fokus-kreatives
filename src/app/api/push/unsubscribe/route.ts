// POST /api/push/unsubscribe
//
// Body: { endpoint }
//
// Removes the caller's Web Push subscription. Scoped to the
// authenticated user so a malicious caller can't drop someone
// else's subscription by guessing endpoints.

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

  if (!body.endpoint) {
    return NextResponse.json(
      { success: false, error: 'Missing endpoint' },
      { status: 400 },
    )
  }

  const { error } = await admin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint)
    .eq('user_id', user.id)

  if (error) {
    console.error('[push/unsubscribe] delete error:', error)
    return NextResponse.json(
      { success: false, error: 'Could not remove subscription' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
