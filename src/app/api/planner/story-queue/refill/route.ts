import { NextRequest, NextResponse } from 'next/server'
import { refillStoryQueue } from '@/lib/planner/storyQueue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  clientId?: string
  targetCount?: number
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    if (!body.clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }
    const result = await refillStoryQueue(body.clientId, body.targetCount)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('story-queue/refill error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
