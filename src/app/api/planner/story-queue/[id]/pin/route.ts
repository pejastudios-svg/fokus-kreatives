// Pin a story prompt to a calendar date. Creates a content_plan_slots row
// with stream='engagement_reel'... wait, story isn't a slot_stream. The
// planner enum lists long_form/short_form/engagement_reel/carousel - story
// stays in the queue. Pinning therefore adds a "story" pinned slot that's
// represented purely on story_queue_items.pinned_to_date - the calendar UI
// renders pinned story prompts directly from the queue, not from slots.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface Body {
  scheduledDate?: string | null
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const body = (await req.json()) as Body

    // null/empty unpins
    const date = body.scheduledDate
    if (date && !DATE_RE.test(date)) {
      return NextResponse.json({ success: false, error: 'scheduledDate must be yyyy-mm-dd' }, { status: 400 })
    }

    const supabase = plannerAdmin()
    const { error } = await supabase
      .from('story_queue_items')
      .update({ pinned_to_date: date || null })
      .eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
