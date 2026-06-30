// Regenerate (redo) a single story prompt in place. Picks fresh raw material
// and overwrites the structured frames + summary text. The id and
// pinned_to_date are preserved so the calendar position doesn't move.

import { NextRequest, NextResponse } from 'next/server'
import { regenerateStoryPrompt } from '@/lib/planner/storyQueue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const result = await regenerateStoryPrompt(id)
    if (!result) {
      return NextResponse.json({ success: false, error: 'Regenerate failed' }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: result.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('story-queue regenerate error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
