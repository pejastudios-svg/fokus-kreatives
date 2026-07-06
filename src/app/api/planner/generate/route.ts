import { NextRequest, NextResponse } from 'next/server'
import { generatePlan } from '@/lib/planner'
import { proposeStageAdvancement } from '@/lib/contentStage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Plan generation is the longest request in the app (format picks + hook
// previews + story generation for a full month). Pin the function duration
// so the platform default can't kill a legitimate run mid-way.
export const maxDuration = 300

interface Body {
  clientId?: string
  monthsAhead?: number
  anchorDate?: string
  /** Optional inclusive end date (YYYY-MM-DD). When set, overrides
   *  monthsAhead and lets the planner cover an arbitrary date range. */
  endDate?: string
  /** Optional. Scopes generation to a specific subset of topic groups
   *  (i.e. specific question form batches). Default = use all unused. */
  topicGroupIds?: string[]
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body
    if (!body.clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const result = await generatePlan({
      clientId: body.clientId,
      monthsAhead: body.monthsAhead,
      anchorDate: body.anchorDate,
      endDate: body.endDate,
      topicGroupIds: body.topicGroupIds,
    })

    // Re-evaluate stage criteria so the banner can fire on the next page load.
    proposeStageAdvancement(body.clientId, { origin: new URL(req.url).origin }).catch((err) => {
      console.error('proposeStageAdvancement after plan generate:', err)
    })

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('planner/generate error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
