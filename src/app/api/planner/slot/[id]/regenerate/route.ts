import { NextRequest, NextResponse } from 'next/server'
import { humanizeUpstreamError } from '@/lib/errors/humanize'
import { regenerateSlot } from '@/lib/planner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }
    const slot = await regenerateSlot(id)
    return NextResponse.json({ success: true, slot })
  } catch (err) {
    const msg = humanizeUpstreamError(err)
    console.error('planner/slot/regenerate error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
