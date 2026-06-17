// Campaigns: recurring (AI on a schedule) or broadcast (one email, once).
//
// GET    ?clientId=...                 -> campaigns + group names + mini stats
// POST   { clientId, name, kind, groupId, scheduleRules, autoApprove,
//          ctaIds, psMode, topicFocus }
// PATCH  { clientId, id, ...same fields, status? }   status: active|paused|draft
// DELETE { clientId, id }

import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/emailOutbox'
import { parseScheduleRules } from '@/lib/emailMarketing/types'
import { upcomingSendDates, zonedNow } from '@/lib/emailMarketing/schedule'

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
  const db = admin()

  const [{ data: campaigns }, { data: groups }, { data: emails }] = await Promise.all([
    db
      .from('email_campaigns')
      .select('*')
      .eq('client_id', clientId!)
      .order('created_at', { ascending: false }),
    db.from('email_groups').select('id, name').eq('client_id', clientId!),
    db
      .from('email_campaign_emails')
      .select('id, campaign_id, status, scheduled_for, subject, sent_at')
      .eq('client_id', clientId!),
  ])

  const groupNames = new Map((groups || []).map((g) => [g.id as string, g.name as string]))
  const byCampaign = new Map<
    string,
    { drafts: number; sent: number; approved: number; nextDate: string | null }
  >()
  for (const e of emails || []) {
    const entry =
      byCampaign.get(e.campaign_id as string) ||
      { drafts: 0, sent: 0, approved: 0, nextDate: null }
    if (e.status === 'draft') entry.drafts++
    if (e.status === 'sent') entry.sent++
    // Anything past review counts: the campaign has at least one email a
    // human signed off on (gates the Activate button).
    if (e.status === 'approved' || e.status === 'sending' || e.status === 'sent') entry.approved++
    if (
      (e.status === 'approved' || e.status === 'draft') &&
      e.scheduled_for &&
      (!entry.nextDate || (e.scheduled_for as string) < entry.nextDate)
    ) {
      entry.nextDate = e.scheduled_for as string
    }
    byCampaign.set(e.campaign_id as string, entry)
  }

  const result = (campaigns || []).map((c) => {
    const stats =
      byCampaign.get(c.id as string) ||
      { drafts: 0, sent: 0, approved: 0, nextDate: null }
    // For active recurring campaigns with no pending email, project the next
    // date from the rules so the list always answers "when is the next one".
    let nextDate = stats.nextDate
    if (!nextDate && c.status === 'active' && c.kind === 'recurring') {
      const rules = parseScheduleRules(c.schedule_rules)
      nextDate = upcomingSendDates(rules, zonedNow(rules.timezone).ymd, 30)[0] || null
    }
    return {
      ...c,
      group_name: c.group_id ? groupNames.get(c.group_id as string) || null : null,
      pending_drafts: stats.drafts,
      emails_sent: stats.sent,
      approved_emails: stats.approved,
      next_send_date: nextDate,
    }
  })

  return NextResponse.json({ success: true, campaigns: result })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const clientId = body.clientId as string | undefined
    const auth = await authorize(clientId, 'manager')
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    const name = String(body.name || '').trim()
    if (!name) {
      return NextResponse.json({ success: false, error: 'Campaign needs a name' }, { status: 400 })
    }
    const kind = body.kind === 'broadcast' ? 'broadcast' : 'recurring'

    const { data, error } = await admin()
      .from('email_campaigns')
      .insert({
        client_id: clientId,
        name,
        kind,
        status: 'draft',
        group_id: typeof body.groupId === 'string' && body.groupId ? body.groupId : null,
        schedule_rules: parseScheduleRules(body.scheduleRules),
        auto_approve: body.autoApprove === true,
        cta_ids: Array.isArray(body.ctaIds) ? body.ctaIds : [],
        ps_mode: body.psMode === 'custom' ? 'custom' : body.psMode === 'none' ? 'none' : 'ai',
        topic_focus: typeof body.topicFocus === 'string' ? body.topicFocus.trim() || null : null,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error('[email-marketing/campaigns] create error:', error)
      return NextResponse.json({ success: false, error: 'Could not create campaign' }, { status: 500 })
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
    const body = (await req.json()) as Record<string, unknown>
    const clientId = body.clientId as string | undefined
    const auth = await authorize(clientId, 'manager')
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    const id = body.id as string | undefined
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if (body.groupId !== undefined) {
      patch.group_id = typeof body.groupId === 'string' && body.groupId ? body.groupId : null
    }
    if (body.scheduleRules !== undefined) patch.schedule_rules = parseScheduleRules(body.scheduleRules)
    if (typeof body.autoApprove === 'boolean') patch.auto_approve = body.autoApprove
    if (Array.isArray(body.ctaIds)) patch.cta_ids = body.ctaIds
    if (body.psMode === 'ai' || body.psMode === 'custom' || body.psMode === 'none') {
      patch.ps_mode = body.psMode
    }
    if (body.topicFocus !== undefined) {
      patch.topic_focus = typeof body.topicFocus === 'string' ? body.topicFocus.trim() || null : null
    }
    if (body.status === 'active' || body.status === 'paused' || body.status === 'draft') {
      patch.status = body.status
      // Human (re)activation clears the auto-pause reason.
      if (body.status === 'active') patch.paused_reason = null
    }

    const { error } = await admin()
      .from('email_campaigns')
      .update(patch)
      .eq('id', id)
      .eq('client_id', clientId!)
    if (error) {
      return NextResponse.json({ success: false, error: 'Could not update campaign' }, { status: 500 })
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
      .from('email_campaigns')
      .delete()
      .eq('id', body.id)
      .eq('client_id', body.clientId!)
    if (error) {
      return NextResponse.json({ success: false, error: 'Could not delete campaign' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
