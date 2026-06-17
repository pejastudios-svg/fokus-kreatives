// Groups = saved audiences: property rules (status, any leads.data field)
// plus hand-picked lead ids. Resolved live at send time.
//
// GET    ?clientId=...            -> groups with live recipient counts
// POST   { clientId, name, filters, leadIds }
// PATCH  { clientId, id, name?, filters?, leadIds? }
// DELETE { clientId, id }

import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/emailOutbox'
import { resolveAudience } from '@/lib/emailMarketing/audience'
import { parseGroupFilters } from '@/lib/emailMarketing/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authorize(clientId: string | null | undefined, level: 'member' | 'manager') {
  if (!clientId) return { ok: false as const, status: 400, error: 'Missing clientId' }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  return authorizeForClient(clientId, { level })
}

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId')
  const auth = await authorize(clientId, 'member')
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { data: groups, error } = await admin()
    .from('email_groups')
    .select('id, name, filters, lead_ids, created_at')
    .eq('client_id', clientId!)
    .order('created_at', { ascending: true })
  if (error) {
    return NextResponse.json({ success: false, error: 'Could not load groups' }, { status: 500 })
  }

  const withCounts = await Promise.all(
    (groups || []).map(async (g) => {
      const recipients = await resolveAudience(clientId!, g.id as string)
      return { ...g, recipient_count: recipients.length }
    }),
  )
  return NextResponse.json({ success: true, groups: withCounts })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      clientId?: string
      name?: string
      filters?: unknown
      leadIds?: string[]
    }
    const auth = await authorize(body.clientId, 'manager')
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    const name = (body.name || '').trim()
    if (!name) {
      return NextResponse.json({ success: false, error: 'Group needs a name' }, { status: 400 })
    }

    const { data, error } = await admin()
      .from('email_groups')
      .insert({
        client_id: body.clientId,
        name,
        filters: parseGroupFilters(body.filters),
        lead_ids: Array.isArray(body.leadIds) ? body.leadIds : [],
      })
      .select('id')
      .single()
    if (error || !data) {
      return NextResponse.json({ success: false, error: 'Could not create group' }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      clientId?: string
      id?: string
      name?: string
      filters?: unknown
      leadIds?: string[]
    }
    const auth = await authorize(body.clientId, 'manager')
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    if (!body.id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if (body.filters !== undefined) patch.filters = parseGroupFilters(body.filters)
    if (Array.isArray(body.leadIds)) patch.lead_ids = body.leadIds

    const { error } = await admin()
      .from('email_groups')
      .update(patch)
      .eq('id', body.id)
      .eq('client_id', body.clientId!)
    if (error) {
      return NextResponse.json({ success: false, error: 'Could not update group' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { clientId?: string; id?: string }
    const auth = await authorize(body.clientId, 'manager')
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    if (!body.id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }
    const { error } = await admin()
      .from('email_groups')
      .delete()
      .eq('id', body.id)
      .eq('client_id', body.clientId!)
    if (error) {
      return NextResponse.json({ success: false, error: 'Could not delete group' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
