import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/emailOutbox'
import {
  createSendsForEmail,
  pumpQueuedSends,
  checkEmailHealth,
  notifyCrm,
  maybeNotifyLowMaterial,
  maybeNudgeUpgrade,
  type CampaignEmailRow,
} from '@/lib/emailMarketing/dispatch'
import { parseScheduleRules, parseSettings } from '@/lib/emailMarketing/types'
import { upcomingSendDates, sendTimeReached, weekKey, zonedNow } from '@/lib/emailMarketing/schedule'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Email campaigns worker. Schedule: every 5-15 minutes (Apps Script time
 * trigger or Vercel Cron), auth via ?secret=<CRON_SECRET> like the other
 * cron routes.
 *
 * Tick phases:
 *  1. GENERATE - active recurring campaigns get their next email drafted
 *     2-3 days ahead of its send date (AI from form answers + brand profile).
 *  2. DISPATCH - approved emails whose date+time arrived resolve their
 *     audience into per-recipient send rows.
 *  3. PUMP - 'sending' emails enqueue outbox rows up to the client's daily
 *     cap; fully-dispatched emails flip to 'sent'.
 *
 * Safety breakers (a cron bug must never spam or burn credits):
 *  - unique (campaign_id, scheduled_for): duplicate generation is a no-op,
 *    and a failed generation leaves a placeholder row so it is NOT retried
 *    every tick - a human regenerates from the UI.
 *  - backpressure: 3+ unapproved drafts on a campaign stops generation.
 *  - monthly per-client generation cap, daily per-client send cap.
 *  - unique (email_id, lead_id) + outbox idempotency: no double-sends.
 *  - failure spike (>20% of 10+ sends) auto-pauses the campaign + notifies.
 */

const DRAFT_AHEAD_DAYS = 3
const MAX_UNAPPROVED_DRAFTS = 3

function todayYmd(): string {
  return zonedNow().ymd
}

function addDaysYmd(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

interface CampaignRow {
  id: string
  client_id: string
  name: string
  kind: string
  status: string
  group_id: string | null
  schedule_rules: unknown
  auto_approve: boolean
  cta_ids: string[]
  ps_mode: 'ai' | 'custom' | 'none'
  topic_focus: string | null
}

async function generatePhase(): Promise<{ generated: number; skipped: number }> {
  const db = admin()
  const today = todayYmd()
  let generated = 0
  let skipped = 0

  const { data: campaigns } = await db
    .from('email_campaigns')
    .select('id, client_id, name, kind, status, group_id, schedule_rules, auto_approve, cta_ids, ps_mode, topic_focus')
    .eq('status', 'active')
    .eq('kind', 'recurring')
  if (!campaigns || campaigns.length === 0) return { generated, skipped }

  // Per-client monthly generation counts (breaker).
  const monthStart = today.slice(0, 8) + '01'
  const genCountByClient = new Map<string, number>()
  for (const c of campaigns as CampaignRow[]) {
    if (genCountByClient.has(c.client_id)) continue
    const { count } = await db
      .from('email_campaign_emails')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', c.client_id)
      .gte('created_at', monthStart + 'T00:00:00Z')
    genCountByClient.set(c.client_id, count || 0)
  }

  for (const campaign of campaigns as CampaignRow[]) {
    try {
      const rules = parseScheduleRules(campaign.schedule_rules)
      // All of this campaign's date math happens in ITS timezone - a US
      // client's "today" is not a Lagos client's "today".
      const today = zonedNow(rules.timezone).ymd

      // Window over -> campaign is done.
      if (rules.date_to && rules.date_to < today) {
        await db
          .from('email_campaigns')
          .update({ status: 'completed' })
          .eq('id', campaign.id)
        continue
      }

      const { data: existing } = await db
        .from('email_campaign_emails')
        .select('id, scheduled_for, status')
        .eq('campaign_id', campaign.id)
        .order('scheduled_for', { ascending: false })

      const drafts = (existing || []).filter((e) => e.status === 'draft')
      if (drafts.length >= MAX_UNAPPROVED_DRAFTS) {
        skipped++
        continue // backpressure: nobody is reviewing, stop producing
      }

      const { data: clientRow } = await db
        .from('clients')
        .select('email_marketing_settings')
        .eq('id', campaign.client_id)
        .maybeSingle()
      const settings = parseSettings(clientRow?.email_marketing_settings)
      if ((genCountByClient.get(campaign.client_id) || 0) >= settings.monthly_generation_cap) {
        skipped++
        continue // monthly AI budget breaker
      }

      // Next send date: strictly after the latest already-created email.
      const latest = (existing || [])
        .map((e) => e.scheduled_for as string | null)
        .filter(Boolean)
        .sort()
        .pop()
      const fromDate = latest && latest >= today ? addDaysYmd(latest, 1) : today
      let candidates = upcomingSendDates(rules, fromDate, 30)
      // Weekly cadence: the latest email's week is already served, even when
      // a later weekday in that same week would also be eligible.
      if (rules.cadence === 'weekly' && latest) {
        candidates = candidates.filter((d) => weekKey(d) !== weekKey(latest))
      }
      const nextDate = candidates[0]
      if (!nextDate || nextDate > addDaysYmd(today, DRAFT_AHEAD_DAYS)) continue

      const pastCount = (existing || []).length
      let draft
      try {
        const { generateCampaignEmail } = await import('@/lib/emailMarketing/generate')
        draft = await generateCampaignEmail({
          clientId: campaign.client_id,
          campaignId: campaign.id,
          topicFocus: campaign.topic_focus,
          psMode: campaign.ps_mode,
          settings,
          pastEmailCount: pastCount,
          campaignCtaIds: campaign.cta_ids || [],
        })
      } catch (genErr) {
        // Placeholder row = the unique constraint stops per-tick retries.
        const msg = genErr instanceof Error ? genErr.message : String(genErr)
        await db.from('email_campaign_emails').insert({
          campaign_id: campaign.id,
          client_id: campaign.client_id,
          scheduled_for: nextDate,
          send_time: rules.send_time,
          status: 'draft',
          error: `Generation failed: ${msg.slice(0, 400)}`,
        })
        await notifyCrm(campaign.client_id, 'email_campaign_failed', {
          campaignId: campaign.id,
          campaignName: campaign.name,
          reason: msg.slice(0, 200),
        })
        continue
      }

      const status = campaign.auto_approve ? 'approved' : 'draft'
      const { error: insertErr } = await db.from('email_campaign_emails').insert({
        campaign_id: campaign.id,
        client_id: campaign.client_id,
        scheduled_for: nextDate,
        send_time: rules.send_time,
        subject: draft.subject,
        preheader: draft.preheader,
        hook_title: draft.hook_title,
        blocks: [{ id: 'body', type: 'text', content: draft.body }],
        ps: draft.ps,
        cta_snapshot: draft.ctas,
        source_refs: draft.source_refs,
        status,
        ...(status === 'approved' ? { approved_at: new Date().toISOString() } : {}),
      })
      if (insertErr) {
        // 23505 = another tick won the race; fine.
        if ((insertErr as { code?: string }).code !== '23505') {
          console.error('[email-campaigns] draft insert error:', insertErr)
        }
        continue
      }

      generated++
      genCountByClient.set(
        campaign.client_id,
        (genCountByClient.get(campaign.client_id) || 0) + 1,
      )
      await maybeNotifyLowMaterial(
        campaign.client_id,
        draft.remainingAnswers,
        draft.source_refs.length,
      )
      if (status === 'draft') {
        await notifyCrm(campaign.client_id, 'email_campaign_review', {
          campaignId: campaign.id,
          campaignName: campaign.name,
          subject: draft.subject,
          scheduledFor: nextDate,
        })
      }
    } catch (e) {
      console.error('[email-campaigns] generate phase error for', campaign.id, e)
    }
  }
  return { generated, skipped }
}

async function dispatchPhase(): Promise<{ dispatched: number; pumped: number }> {
  const db = admin()
  const now = new Date()
  let dispatched = 0
  let pumped = 0

  // Approved emails whose date + time arrived -> create send rows. The
  // query window is UTC-today + 1 so zones ahead of UTC are included; the
  // real due check happens below, per email, in its campaign's timezone.
  const { data: due } = await db
    .from('email_campaign_emails')
    .select('id, campaign_id, client_id, subject, preheader, hook_title, blocks, ps, cta_snapshot, status, scheduled_for, send_time')
    .eq('status', 'approved')
    .lte('scheduled_for', addDaysYmd(todayYmd(), 1))
    .limit(20)

  for (const email of (due || []) as CampaignEmailRow[]) {
    try {
      const { data: campaign } = await db
        .from('email_campaigns')
        .select('group_id, status, schedule_rules')
        .eq('id', email.campaign_id)
        .maybeSingle()
      // Only a pause holds emails. An approved email on a draft campaign is
      // explicit human intent (broadcasts are sent without ever activating).
      if (!campaign || campaign.status === 'paused') continue

      const tz = parseScheduleRules(campaign.schedule_rules).timezone
      const zoneToday = zonedNow(tz, now).ymd
      if (email.scheduled_for && email.scheduled_for > zoneToday) continue
      if (
        email.send_time &&
        email.scheduled_for === zoneToday &&
        !sendTimeReached(email.send_time, now, tz)
      ) {
        continue
      }

      await createSendsForEmail(email, (campaign.group_id as string | null) ?? null)
      dispatched++
    } catch (e) {
      console.error('[email-campaigns] dispatch error for', email.id, e)
    }
  }

  // Pump 'sending' emails within the daily cap.
  const { data: sending } = await db
    .from('email_campaign_emails')
    .select('id, campaign_id, client_id, subject, preheader, hook_title, blocks, ps, cta_snapshot, status, scheduled_for, send_time')
    .eq('status', 'sending')
    .limit(20)

  for (const email of (sending || []) as CampaignEmailRow[]) {
    try {
      const result = await pumpQueuedSends(email)
      pumped += result.enqueued
      // Hit the daily ceiling with recipients still waiting = the list has
      // outgrown this client's plan. Nudge them to upgrade (weekly-gated).
      if (result.capped && !result.done) {
        await maybeNudgeUpgrade(email.client_id, weekKey(todayYmd()))
      }
      if (result.done) {
        await db
          .from('email_campaign_emails')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', email.id)
        // A broadcast campaign is finished once its one email is out.
        const { data: c } = await db
          .from('email_campaigns')
          .select('kind')
          .eq('id', email.campaign_id)
          .maybeSingle()
        if (c?.kind === 'broadcast') {
          await db
            .from('email_campaigns')
            .update({ status: 'completed' })
            .eq('id', email.campaign_id)
        }
      }
      await checkEmailHealth(email)
    } catch (e) {
      console.error('[email-campaigns] pump error for', email.id, e)
    }
  }

  // Health-check recently sent emails too (terminal failures land async).
  const { data: recentSent } = await db
    .from('email_campaign_emails')
    .select('id, campaign_id, client_id, subject, preheader, hook_title, blocks, ps, cta_snapshot, status, scheduled_for, send_time')
    .eq('status', 'sent')
    .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(20)
  for (const email of (recentSent || []) as CampaignEmailRow[]) {
    try {
      await checkEmailHealth(email)
    } catch (e) {
      console.error('[email-campaigns] health check error for', email.id, e)
    }
  }

  return { dispatched, pumped }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const secret = url.searchParams.get('secret')
    const envSecret = process.env.CRON_SECRET
    if (envSecret && secret !== envSecret) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const gen = await generatePhase()
    const disp = await dispatchPhase()

    return NextResponse.json({ success: true, ...gen, ...disp })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('cron/email-campaigns error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
