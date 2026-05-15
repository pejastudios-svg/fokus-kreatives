import { NextRequest, NextResponse } from 'next/server'
import { dismissStageAdvancement } from '@/lib/contentStage'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  clientId?: string
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser()
    const body = (await req.json()) as Body
    if (!body.clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }
    await dismissStageAdvancement(body.clientId, user?.id ?? null)
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
