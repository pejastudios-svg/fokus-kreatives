// Create or revoke a view-only share link for a client's plan.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CreateBody {
  clientId?: string
  ttlDays?: number
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser()
    const body = (await req.json()) as CreateBody
    if (!body.clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const ttl = Math.max(1, Math.min(365, body.ttlDays ?? 90))
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + ttl)

    const supabase = plannerAdmin()
    const { data, error } = await supabase
      .from('content_plan_share_links')
      .insert({
        client_id: body.clientId,
        expires_at: expiresAt.toISOString(),
        created_by: user?.id ?? null,
      })
      .select('id, token, expires_at')
      .single()

    if (error || !data) {
      return NextResponse.json({ success: false, error: error?.message ?? 'Insert failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, link: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

interface RevokeBody {
  linkId?: string
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as RevokeBody
    if (!body.linkId) {
      return NextResponse.json({ success: false, error: 'Missing linkId' }, { status: 400 })
    }
    const supabase = plannerAdmin()
    const { error } = await supabase
      .from('content_plan_share_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', body.linkId)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
