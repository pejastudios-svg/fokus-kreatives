import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { topicId, contentId, used } = (await req.json()) as {
      topicId?: string
      contentId?: string | null
      used?: boolean
    }
    if (!topicId) {
      return NextResponse.json({ success: false, error: 'Missing topicId' }, { status: 400 })
    }

    const markUsed = used !== false
    const { error } = await supabase
      .from('topics')
      .update({
        used_at: markUsed ? new Date().toISOString() : null,
        last_used_content_id: markUsed ? contentId ?? null : null,
      })
      .eq('id', topicId)

    if (error) {
      console.error('topics mark-used error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
