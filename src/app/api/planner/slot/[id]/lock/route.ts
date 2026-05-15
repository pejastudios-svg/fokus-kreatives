import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  locked?: boolean
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const body = (await req.json().catch(() => ({}))) as Body
    const supabase = plannerAdmin()
    const { data, error } = await supabase
      .from('content_plan_slots')
      .update({ locked: !!body.locked })
      .eq('id', id)
      .select('id, locked')
      .single()
    if (error || !data) {
      return NextResponse.json({ success: false, error: error?.message ?? 'Update failed' }, { status: 500 })
    }
    return NextResponse.json({ success: true, slot: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
