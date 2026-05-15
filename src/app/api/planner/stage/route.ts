// Lightweight stage state lookup. The brand profile page renders a
// StageBadge that just needs current_stage + criteria progress - it doesn't
// need the full planner payload (slots, story queue, formats, share links).
// This endpoint is ~50ms vs ~500ms+ for /api/planner/data.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'
import { evaluateStageCriteria } from '@/lib/contentStage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const clientId = url.searchParams.get('clientId')
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const supabase = plannerAdmin()
    const { data: stateRow } = await supabase
      .from('content_stage_state')
      .select('current_stage, proposed_stage, proposed_at, dismissed_at')
      .eq('client_id', clientId)
      .maybeSingle()

    const evaluation = await evaluateStageCriteria(clientId)

    return NextResponse.json({
      success: true,
      stage: {
        ...evaluation,
        proposed_stage: stateRow?.proposed_stage ?? null,
        proposed_at: stateRow?.proposed_at ?? null,
        dismissed_at: stateRow?.dismissed_at ?? null,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
