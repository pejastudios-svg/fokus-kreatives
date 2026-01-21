import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service key
)

export async function POST(req: NextRequest) {
  try {
    const { userIds, type, data } = await req.json()

    if (!Array.isArray(userIds) || userIds.length === 0 || !type) {
      return NextResponse.json(
        { success: false, error: 'Missing userIds or type' },
        { status: 400 }
      )
    }

    const rows = userIds.map((userId: string) => ({
      user_id: userId,
      type,
      data,
    }))

    const { error } = await supabaseAdmin
      .from('notifications')
      .insert(rows)

    if (error) {
      console.error('Notification insert error:', error)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('Notification API error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}