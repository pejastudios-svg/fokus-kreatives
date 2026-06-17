// Campaign emails: drafts, review queue, editing, actions.
//
// GET   ?clientId=...&campaignId=...   -> emails (campaignId optional)
// PATCH { clientId, id, subject?, preheader?, hookTitle?, blocks?, ps?,
//         ctaSnapshot?, scheduledFor?, sendTime? }      (drafts + approved)
// POST  { clientId, action, ... } where action is one of:
//   create    { campaignId, scheduledFor?, sendTime?, subject?, ... }  custom email
//   generate  { campaignId, emailId? }   AI (re)generate - emailId = regenerate
//   approve   { id }
//   cancel    { id }
//   send_now  { id }                     approve + schedule for right now
//   test_send { id, to }                 send a test to one address, no tracking
//   preview   { id } or { fields }       render HTML for the composer preview

import { NextRequest, NextResponse } from 'next/server'
import { admin, enqueueEmail } from '@/lib/emailOutbox'
import { renderMarketingEmail } from '@/lib/emailMarketing/render'
import { parseSettings, parseBlocks, type EmailCta } from '@/lib/emailMarketing/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authorize(clientId: string | null | undefined, level: 'member' | 'manager') {
  if (!clientId) return { ok: false as const, status: 400, error: 'Missing clientId' }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  return authorizeForClient(clientId, { level })
}

async function loadClientRenderBits(clientId: string) {
  const { data: client } = await admin()
    .from('clients')
    .select('name, business_name, email_from_name, email_marketing_settings')
    .eq('id', clientId)
    .maybeSingle()
  const settings = parseSettings(client?.email_marketing_settings)
  const fromName =
    (client?.email_from_name as string | null)?.trim() ||
    (client?.business_name as string | null)?.trim() ||
    (client?.name as string | null)?.trim() ||
    'Fokus Kreatives'
  return { settings, fromName }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const clientId = url.searchParams.get('clientId')
  const campaignId = url.searchParams.get('campaignId')
  const status = url.searchParams.get('status')
  const auth = await authorize(clientId, 'member')
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  let query = admin()
    .from('email_campaign_emails')
    .select('*')
    .eq('client_id', clientId!)
    .order('scheduled_for', { ascending: false, nullsFirst: false })
    .limit(200)
  if (campaignId) query = query.eq('campaign_id', campaignId)
  // The review queue passes status=draft so drafts with no date (which sort
  // last) can never fall past the 200-row cap and vanish from review.
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ success: false, error: 'Could not load emails' }, { status: 500 })
  }
  return NextResponse.json({ success: true, emails: data || [] })
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
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const { data: existing } = await admin()
      .from('email_campaign_emails')
      .select('status')
      .eq('id', id)
      .eq('client_id', clientId!)
      .maybeSingle()
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Email not found' }, { status: 404 })
    }
    if (existing.status !== 'draft' && existing.status !== 'approved') {
      return NextResponse.json(
        { success: false, error: 'Only drafts and approved emails can be edited' },
        { status: 400 },
      )
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), error: null }
    if (typeof body.subject === 'string') patch.subject = body.subject.trim()
    if (typeof body.preheader === 'string') patch.preheader = body.preheader.trim()
    if (typeof body.hookTitle === 'string') patch.hook_title = body.hookTitle.trim()
    if (body.blocks !== undefined) patch.blocks = parseBlocks(body.blocks)
    if (typeof body.ps === 'string') patch.ps = body.ps.trim()
    if (Array.isArray(body.ctaSnapshot)) patch.cta_snapshot = body.ctaSnapshot
    if (typeof body.scheduledFor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduledFor)) {
      patch.scheduled_for = body.scheduledFor
    }
    if (typeof body.sendTime === 'string' && /^\d{2}:\d{2}$/.test(body.sendTime)) {
      patch.send_time = body.sendTime
    }
    // Editing an approved email drops it back to draft unless told otherwise:
    // the human should re-confirm what now goes out.
    if (existing.status === 'approved' && body.keepApproved !== true) {
      patch.status = 'draft'
      patch.approved_at = null
    }

    const { error } = await admin()
      .from('email_campaign_emails')
      .update(patch)
      .eq('id', id)
      .eq('client_id', clientId!)
    if (error) {
      return NextResponse.json({ success: false, error: 'Could not save' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const clientId = body.clientId as string | undefined
    const action = String(body.action || '')
    const auth = await authorize(clientId, 'manager')
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    const db = admin()

    // ---- preview: render HTML for the composer (no tracking, no send) ----
    if (action === 'preview') {
      let fields: Record<string, unknown> | null = null
      if (typeof body.id === 'string') {
        const { data } = await db
          .from('email_campaign_emails')
          .select('subject, preheader, hook_title, blocks, ps, cta_snapshot')
          .eq('id', body.id)
          .eq('client_id', clientId!)
          .maybeSingle()
        fields = data
      } else if (body.fields && typeof body.fields === 'object') {
        fields = body.fields as Record<string, unknown>
      }
      if (!fields) {
        return NextResponse.json({ success: false, error: 'Nothing to preview' }, { status: 400 })
      }
      const { settings, fromName } = await loadClientRenderBits(clientId!)
      const rendered = renderMarketingEmail({
        subject: String(fields.subject || ''),
        preheader: String(fields.preheader || ''),
        hookTitle: String(fields.hook_title || fields.hookTitle || ''),
        blocks: parseBlocks(fields.blocks),
        ps: String(fields.ps || ''),
        ctas: (Array.isArray(fields.cta_snapshot)
          ? fields.cta_snapshot
          : Array.isArray(fields.ctaSnapshot)
            ? fields.ctaSnapshot
            : []) as EmailCta[],
        settings,
        fromName,
        appUrl: (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, ''),
        recipient: null,
      })
      return NextResponse.json({ success: true, subject: rendered.subject, html: rendered.html })
    }

    // ---- create: custom (hand-written) email ----
    if (action === 'create') {
      const campaignId = body.campaignId as string | undefined
      if (!campaignId) {
        return NextResponse.json({ success: false, error: 'Missing campaignId' }, { status: 400 })
      }
      const { settings } = await loadClientRenderBits(clientId!)
      const ctaIds = Array.isArray(body.ctaIds) ? (body.ctaIds as string[]) : []
      const ctas = settings.ctas.filter((c) => ctaIds.includes(c.id))

      // Inherit the campaign schedule when the composer didn't set a date.
      const { data: campaignRow } = await db
        .from('email_campaigns')
        .select('schedule_rules')
        .eq('id', campaignId)
        .eq('client_id', clientId!)
        .maybeSingle()
      const { parseScheduleRules } = await import('@/lib/emailMarketing/types')
      const rules = parseScheduleRules(campaignRow?.schedule_rules)
      let scheduledFor =
        typeof body.scheduledFor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduledFor)
          ? body.scheduledFor
          : null
      if (!scheduledFor) {
        const { upcomingSendDates, zonedNow } = await import('@/lib/emailMarketing/schedule')
        const { data: taken } = await db
          .from('email_campaign_emails')
          .select('scheduled_for')
          .eq('campaign_id', campaignId)
        const takenDates = new Set(
          (taken || []).map((t) => t.scheduled_for as string | null).filter(Boolean),
        )
        scheduledFor =
          upcomingSendDates(rules, zonedNow(rules.timezone).ymd, 60).find(
            (d) => !takenDates.has(d),
          ) || null
      }

      const { data, error } = await db
        .from('email_campaign_emails')
        .insert({
          campaign_id: campaignId,
          client_id: clientId,
          scheduled_for: scheduledFor,
          send_time:
            typeof body.sendTime === 'string' && /^\d{2}:\d{2}$/.test(body.sendTime)
              ? body.sendTime
              : rules.send_time,
          subject: String(body.subject || '').trim(),
          preheader: String(body.preheader || '').trim(),
          hook_title: String(body.hookTitle || '').trim(),
          blocks: parseBlocks(body.blocks),
          ps: String(body.ps || '').trim(),
          cta_snapshot: ctas,
          status: 'draft',
        })
        .select('id')
        .single()
      if (error || !data) {
        const code = (error as { code?: string } | null)?.code
        const msg =
          code === '23505'
            ? 'This campaign already has an email on that date'
            : 'Could not create email'
        return NextResponse.json({ success: false, error: msg }, { status: 500 })
      }
      return NextResponse.json({ success: true, id: data.id })
    }

    // ---- generate / regenerate via AI ----
    if (action === 'generate') {
      const campaignId = body.campaignId as string | undefined
      if (!campaignId) {
        return NextResponse.json({ success: false, error: 'Missing campaignId' }, { status: 400 })
      }
      const { data: campaign } = await db
        .from('email_campaigns')
        .select('id, cta_ids, ps_mode, topic_focus, schedule_rules')
        .eq('id', campaignId)
        .eq('client_id', clientId!)
        .maybeSingle()
      if (!campaign) {
        return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
      }
      const rules = (await import('@/lib/emailMarketing/types')).parseScheduleRules(
        campaign.schedule_rules,
      )

      // Backpressure, same rule as the cron: drafts piling up unreviewed
      // means generating more just burns AI credits. Each generate call
      // always creates a NEW email (material is never reused) - regenerate
      // an existing draft from the composer instead.
      if (!body.emailId) {
        const { count: draftCount } = await db
          .from('email_campaign_emails')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .eq('status', 'draft')
        if ((draftCount || 0) >= 3) {
          return NextResponse.json(
            {
              success: false,
              error:
                'This campaign already has 3 drafts waiting for review. Review or delete those before generating more.',
            },
            { status: 400 },
          )
        }
      }
      const { count: pastCount } = await db
        .from('email_campaign_emails')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)

      const { settings } = await loadClientRenderBits(clientId!)
      const { generateCampaignEmail } = await import('@/lib/emailMarketing/generate')
      let draft
      try {
        draft = await generateCampaignEmail({
          clientId: clientId!,
          campaignId,
          topicFocus: (body.topicFocus as string) || (campaign.topic_focus as string | null),
          psMode: (campaign.ps_mode as 'ai' | 'custom' | 'none') || 'ai',
          settings,
          pastEmailCount: pastCount || 0,
          campaignCtaIds: (campaign.cta_ids as string[]) || [],
        })
      } catch (genErr) {
        return NextResponse.json(
          { success: false, error: genErr instanceof Error ? genErr.message : 'Generation failed' },
          { status: 500 },
        )
      }

      const fields = {
        subject: draft.subject,
        preheader: draft.preheader,
        hook_title: draft.hook_title,
        blocks: [{ id: 'body', type: 'text', content: draft.body }],
        ps: draft.ps,
        cta_snapshot: draft.ctas,
        source_refs: draft.source_refs,
        status: 'draft',
        approved_at: null,
        error: null,
        updated_at: new Date().toISOString(),
      }

      const { maybeNotifyLowMaterial } = await import('@/lib/emailMarketing/dispatch')
      void maybeNotifyLowMaterial(clientId!, draft.remainingAnswers, draft.source_refs.length)

      const emailId = body.emailId as string | undefined
      if (emailId) {
        const { error } = await db
          .from('email_campaign_emails')
          .update(fields)
          .eq('id', emailId)
          .eq('client_id', clientId!)
          .in('status', ['draft', 'approved'])
        if (error) {
          return NextResponse.json({ success: false, error: 'Could not regenerate' }, { status: 500 })
        }
        return NextResponse.json({ success: true, id: emailId })
      }

      // No date from the caller -> inherit the campaign schedule: the next
      // eligible date that doesn't already have an email, at the campaign's
      // send time. This is what "Generate now" relies on.
      let scheduledFor =
        typeof body.scheduledFor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduledFor)
          ? body.scheduledFor
          : null
      if (!scheduledFor) {
        const { upcomingSendDates, zonedNow } = await import('@/lib/emailMarketing/schedule')
        const { data: taken } = await db
          .from('email_campaign_emails')
          .select('scheduled_for')
          .eq('campaign_id', campaignId)
        const takenDates = new Set(
          (taken || []).map((t) => t.scheduled_for as string | null).filter(Boolean),
        )
        scheduledFor =
          upcomingSendDates(rules, zonedNow(rules.timezone).ymd, 60).find(
            (d) => !takenDates.has(d),
          ) || null
      }

      const { data, error } = await db
        .from('email_campaign_emails')
        .insert({
          campaign_id: campaignId,
          client_id: clientId,
          scheduled_for: scheduledFor,
          send_time: rules.send_time,
          ...fields,
        })
        .select('id')
        .single()
      if (error || !data) {
        return NextResponse.json({ success: false, error: 'Could not save the draft' }, { status: 500 })
      }
      return NextResponse.json({ success: true, id: data.id })
    }

    // ---- approve / cancel / send_now ----
    if (action === 'approve' || action === 'cancel' || action === 'send_now') {
      const id = body.id as string | undefined
      if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
      const { data: email } = await db
        .from('email_campaign_emails')
        .select('id, campaign_id, status, subject, scheduled_for')
        .eq('id', id)
        .eq('client_id', clientId!)
        .maybeSingle()
      if (!email) {
        return NextResponse.json({ success: false, error: 'Email not found' }, { status: 404 })
      }

      if (action === 'cancel') {
        if (email.status === 'sending' || email.status === 'sent') {
          return NextResponse.json(
            { success: false, error: 'Already sending - too late to cancel' },
            { status: 400 },
          )
        }
        await db
          .from('email_campaign_emails')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('client_id', clientId!)
        return NextResponse.json({ success: true })
      }

      if (email.status !== 'draft' && email.status !== 'approved') {
        return NextResponse.json(
          { success: false, error: `Cannot ${action.replace('_', ' ')} a ${email.status} email` },
          { status: 400 },
        )
      }
      if (!String(email.subject || '').trim()) {
        return NextResponse.json(
          { success: false, error: 'Email needs a subject before it can go out' },
          { status: 400 },
        )
      }

      const now = new Date()
      const patch: Record<string, unknown> = {
        status: 'approved',
        approved_at: now.toISOString(),
        updated_at: now.toISOString(),
      }
      if (action === 'send_now') {
        // Today in the campaign's timezone, due immediately.
        const { data: campaign } = await db
          .from('email_campaigns')
          .select('schedule_rules')
          .eq('id', email.campaign_id as string)
          .maybeSingle()
        const { zonedNow } = await import('@/lib/emailMarketing/schedule')
        const { parseScheduleRules } = await import('@/lib/emailMarketing/types')
        patch.scheduled_for = zonedNow(parseScheduleRules(campaign?.schedule_rules).timezone).ymd
        patch.send_time = '00:00'
      } else if (!email.scheduled_for) {
        return NextResponse.json(
          { success: false, error: 'Set a send date before approving' },
          { status: 400 },
        )
      }
      await db.from('email_campaign_emails').update(patch).eq('id', id).eq('client_id', clientId!)
      return NextResponse.json({ success: true })
    }

    // ---- test send to one address (no tracking, no send rows) ----
    if (action === 'test_send') {
      const id = body.id as string | undefined
      const to = String(body.to || '').trim()
      if (!id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return NextResponse.json({ success: false, error: 'Need an email id and a valid address' }, { status: 400 })
      }
      const { data: email } = await db
        .from('email_campaign_emails')
        .select('subject, preheader, hook_title, blocks, ps, cta_snapshot')
        .eq('id', id)
        .eq('client_id', clientId!)
        .maybeSingle()
      if (!email) {
        return NextResponse.json({ success: false, error: 'Email not found' }, { status: 404 })
      }
      const { settings, fromName } = await loadClientRenderBits(clientId!)
      const rendered = renderMarketingEmail({
        subject: `[Test] ${email.subject}`,
        preheader: String(email.preheader || ''),
        hookTitle: String(email.hook_title || ''),
        blocks: parseBlocks(email.blocks),
        ps: String(email.ps || ''),
        ctas: (Array.isArray(email.cta_snapshot) ? email.cta_snapshot : []) as EmailCta[],
        settings,
        fromName,
        appUrl: (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, ''),
        recipient: null,
      })
      await enqueueEmail({
        type: 'marketing_email',
        payload: {
          clientId,
          to: [to],
          subject: rendered.subject,
          html: rendered.html,
        },
        idempotencyKey: `mkt-test:${id}:${to}:${Date.now()}`,
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
