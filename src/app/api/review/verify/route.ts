import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Deprecated. The OTP-based two-step flow was replaced with a simpler
 * email-on-file check (`/api/review/start` now mints the session directly).
 * Kept as a 410 to make any stale clients fail loudly instead of silently
 * authenticating against a flow that no longer exists.
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'OTP verification is no longer used. Reload the review page.',
    },
    { status: 410 },
  )
}
