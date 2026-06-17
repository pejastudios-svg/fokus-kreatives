import { admin, enqueueEmail } from '@/lib/emailOutbox'
import { resolveAudience, loadSuppressedEmails } from './audience'
import { renderMarketingEmail } from './render'
import { parseSettings, parseBlocks, type EmailCta } from './types'

/**
 * Send-side engine for campaign emails. The campaigns cron drives it:
 *
 *   approved email due  -> createSendsForEmail()  (audience -> send rows)
 *   'sending' emails    -> pumpQueuedSends()      (cap-aware outbox enqueue)
 *   outbox result       -> syncMarketingSendResult() (from send-emails cron)
 *   each tick           -> checkEmailHealth()     (failure spike auto-pause)
 *
 * Safety breakers live here on purpose - every path that could mass-send
 * goes through the daily cap, the per-recipient unique constraint, and the
 * suppression re-check.
 */

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')

/** Fire a CRM notification (inbox + popup + push). Never throws. */
export async function notifyCrm(
  clientId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${APP_URL()}/api/notifications/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, type, data: { clientId, ...data } }),
    })
  } catch (e) {
    console.error('[emailMarketing] notification failed:', e)
  }
}

/** Below this many unused form answers, the team gets told to collect more. */
export const LOW_MATERIAL_THRESHOLD = 10

/** Everyone assigned to this client: the client's own accounts plus agency
 *  owners - same audience the in-app notification resolver targets. */
async function loadTeamEmails(clientId: string): Promise<string[]> {
  const db = admin()
  const [clientUsers, agencyOwners] = await Promise.all([
    db.from('users').select('email').eq('client_id', clientId),
    db.from('users').select('email').is('client_id', null).in('role', ['admin', 'manager']),
  ])
  return Array.from(
    new Set(
      [...(clientUsers.data ?? []), ...(agencyOwners.data ?? [])]
        .map((r) => String((r as { email?: string }).email || '').trim())
        .filter(Boolean),
    ),
  )
}

/**
 * Fire the "running low on form answers" alert when generation crosses the
 * threshold: in-app notification plus an email to everyone assigned to the
 * client. Crossing-edge gated (was above, now below) so it fires once per
 * dip, not on every generation while low.
 */
export async function maybeNotifyLowMaterial(
  clientId: string,
  remainingAnswers: number,
  justUsed: number,
): Promise<void> {
  if (remainingAnswers >= LOW_MATERIAL_THRESHOLD) return
  const before = remainingAnswers + justUsed
  if (before < LOW_MATERIAL_THRESHOLD) return // already below before this email

  try {
    const { data: client } = await admin()
      .from('clients')
      .select('business_name, name')
      .eq('id', clientId)
      .maybeSingle()
    const clientName =
      (client?.business_name as string | null) || (client?.name as string | null) || 'this client'

    await notifyCrm(clientId, 'email_material_low', {
      clientName,
      remaining: remainingAnswers,
    })

    const to = await loadTeamEmails(clientId)
    if (to.length > 0) {
      await enqueueEmail({
        type: 'email_material_low',
        payload: {
          to,
          clientName,
          remaining: remainingAnswers,
          url: `${APP_URL()}/clients/${clientId}`,
        },
        // One alert per dip below the threshold. The month stamp lets a
        // later dip to the same count (after the client tops up answers)
        // alert again instead of being swallowed by the unique index.
        idempotencyKey: `mkt-low:${clientId}:${new Date().toISOString().slice(0, 7)}:${remainingAnswers}`,
      })
    }
  } catch (e) {
    console.error('[emailMarketing] low-material alert failed:', e)
  }
}

/**
 * "Time to upgrade" nudge: a client on free Gmail (or the shared account)
 * has more recipients than their plan can deliver in a day, so campaigns are
 * rolling over across multiple days. Notify the team + email them, at most
 * once per ISO week (the idempotency key gates it). Workspace clients never
 * see this - they have the headroom.
 */
export async function maybeNudgeUpgrade(clientId: string, weekKey: string): Promise<void> {
  try {
    const { getSendingPlan } = await import('./plan')
    const plan = await getSendingPlan(clientId)
    if (plan.plan === 'workspace') return

    const { data: client } = await admin()
      .from('clients')
      .select('business_name, name')
      .eq('id', clientId)
      .maybeSingle()
    const clientName =
      (client?.business_name as string | null) || (client?.name as string | null) || 'this client'

    const to = await loadTeamEmails(clientId)
    if (to.length === 0) return

    // Fresh insert (not an idempotency collision) means this is the first
    // nudge this week - fire the in-app notification alongside it.
    const fresh = await enqueueEmail({
      type: 'email_upgrade_nudge',
      payload: { to, clientName, dailyMax: plan.dailyMax, url: 'https://workspace.google.com/' },
      idempotencyKey: `mkt-upgrade:${clientId}:${weekKey}`,
    })
    if (fresh) {
      await notifyCrm(clientId, 'email_plan_upgrade', { clientName, dailyMax: plan.dailyMax })
    }
  } catch (e) {
    console.error('[emailMarketing] upgrade nudge failed:', e)
  }
}

export interface CampaignEmailRow {
  id: string
  campaign_id: string
  client_id: string
  subject: string
  preheader: string
  hook_title: string
  blocks: unknown
  ps: string
  cta_snapshot: unknown
  status: string
  scheduled_for: string | null
  send_time: string | null
}

/** Resolve the audience and create per-recipient send rows. Idempotent: the
 *  (email_id, lead_id) unique constraint makes a re-run a no-op. */
export async function createSendsForEmail(
  email: CampaignEmailRow,
  groupId: string | null,
): Promise<{ recipients: number }> {
  const db = admin()
  const audience = await resolveAudience(email.client_id, groupId)

  if (audience.length === 0) {
    await db
      .from('email_campaign_emails')
      .update({ status: 'failed', error: 'No recipients matched this audience' })
      .eq('id', email.id)
    await notifyCrm(email.client_id, 'email_campaign_failed', {
      emailId: email.id,
      campaignId: email.campaign_id,
      subject: email.subject,
      reason: 'No recipients matched the audience',
    })
    return { recipients: 0 }
  }

  // Insert in chunks; ignore duplicate conflicts so reruns are safe.
  const rows = audience.map((r) => ({
    email_id: email.id,
    campaign_id: email.campaign_id,
    client_id: email.client_id,
    lead_id: r.leadId,
    to_email: r.email,
  }))
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db
      .from('email_campaign_sends')
      .upsert(rows.slice(i, i + 200), { onConflict: 'email_id,lead_id', ignoreDuplicates: true })
    if (error) console.error('[emailMarketing] send rows insert error:', error)
  }

  await db
    .from('email_campaign_emails')
    .update({ status: 'sending', error: null })
    .eq('id', email.id)
  return { recipients: audience.length }
}

/** Marketing sends enqueued in the last rolling 24h - the daily-cap meter. */
async function sentInLast24h(clientId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await admin()
    .from('email_campaign_sends')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .not('enqueued_at', 'is', null)
    .gte('enqueued_at', since)
  return count || 0
}

/**
 * Render + enqueue queued sends for one 'sending' email, up to the client's
 * remaining daily capacity. Returns how many were enqueued and whether the
 * email is now fully dispatched.
 */
export async function pumpQueuedSends(email: CampaignEmailRow): Promise<{
  enqueued: number
  done: boolean
  capped: boolean
}> {
  const db = admin()

  // A paused campaign halts in-flight sends, not just future generation.
  // This is what makes the failure-spike auto-pause (and a manual pause)
  // actually STOP the blast that triggered it - the email stays 'sending'
  // and resumes only when the campaign goes active again.
  const { data: campaign } = await db
    .from('email_campaigns')
    .select('status')
    .eq('id', email.campaign_id)
    .maybeSingle()
  if (campaign?.status === 'paused') return { enqueued: 0, done: false, capped: false }

  const { data: client } = await db
    .from('clients')
    .select('name, business_name, email_from_name, email_marketing_settings')
    .eq('id', email.client_id)
    .maybeSingle()
  if (!client) return { enqueued: 0, done: false, capped: false }

  const settings = parseSettings(client.email_marketing_settings)
  const fromName =
    (client.email_from_name as string | null)?.trim() ||
    (client.business_name as string | null)?.trim() ||
    (client.name as string | null)?.trim() ||
    'Fokus Kreatives'

  // Clamp the configured cap DOWN to what the client's actual sending
  // account can safely handle, so a high setting never pushes a free Gmail
  // account past Gmail's tolerance.
  const { getSendingPlan } = await import('./plan')
  const plan = await getSendingPlan(email.client_id)
  const effectiveCap = Math.min(settings.daily_send_cap, plan.dailyMax)

  const used = await sentInLast24h(email.client_id)
  const capacity = Math.max(0, effectiveCap - used)
  if (capacity === 0) {
    // Out of budget today - the next cron tick after the window slides picks
    // the rest up. Not an error.
    const { count: pending } = await db
      .from('email_campaign_sends')
      .select('id', { count: 'exact', head: true })
      .eq('email_id', email.id)
      .is('enqueued_at', null)
      .eq('status', 'queued')
    return { enqueued: 0, done: (pending || 0) === 0, capped: true }
  }

  const { data: queued } = await db
    .from('email_campaign_sends')
    .select('id, lead_id, to_email, token')
    .eq('email_id', email.id)
    .eq('status', 'queued')
    .is('enqueued_at', null)
    .order('created_at', { ascending: true })
    .limit(capacity)
  if (!queued || queued.length === 0) {
    const { count: pending } = await db
      .from('email_campaign_sends')
      .select('id', { count: 'exact', head: true })
      .eq('email_id', email.id)
      .is('enqueued_at', null)
      .eq('status', 'queued')
    return { enqueued: 0, done: (pending || 0) === 0, capped: false }
  }

  // Re-check suppressions at delivery time - someone may have unsubscribed
  // between audience resolution and this tick.
  const suppressed = await loadSuppressedEmails(email.client_id)

  // Lead names for {{first_name}}.
  const leadIds = queued.map((q) => q.lead_id).filter(Boolean) as string[]
  const namesById = new Map<string, string>()
  if (leadIds.length > 0) {
    const { data: leads } = await db.from('leads').select('id, data').in('id', leadIds)
    for (const l of leads || []) {
      const d = (l.data as Record<string, unknown> | null) || {}
      namesById.set(l.id as string, String(d.name ?? ''))
    }
  }

  const blocks = parseBlocks(email.blocks)
  const ctas = (Array.isArray(email.cta_snapshot) ? email.cta_snapshot : []) as EmailCta[]
  const appUrl = APP_URL()
  let enqueued = 0

  for (const send of queued) {
    if (suppressed.has(send.to_email.toLowerCase())) {
      await db
        .from('email_campaign_sends')
        .update({ status: 'unsubscribed', enqueued_at: new Date().toISOString() })
        .eq('id', send.id)
      continue
    }

    const rendered = renderMarketingEmail({
      subject: email.subject,
      preheader: email.preheader,
      hookTitle: email.hook_title,
      blocks,
      ps: email.ps,
      ctas,
      settings,
      fromName,
      appUrl,
      recipient: {
        token: send.token as string,
        name: namesById.get((send.lead_id as string) || '') || '',
      },
    })

    await enqueueEmail({
      type: 'marketing_email',
      payload: {
        clientId: email.client_id,
        to: [send.to_email],
        subject: rendered.subject,
        html: rendered.html,
        // RFC 8058 one-click target: providers POST here directly, so it
        // must be the API endpoint, not the landing page the footer links to.
        listUnsubscribeUrl: `${appUrl}/api/e/u/${send.token}`,
        sendId: send.id,
        emailId: email.id,
        campaignId: email.campaign_id,
      },
      idempotencyKey: `mkt:${email.id}:${send.id}`,
    })
    await db
      .from('email_campaign_sends')
      .update({ enqueued_at: new Date().toISOString() })
      .eq('id', send.id)
    enqueued++
  }

  const { count: pending } = await db
    .from('email_campaign_sends')
    .select('id', { count: 'exact', head: true })
    .eq('email_id', email.id)
    .is('enqueued_at', null)
    .eq('status', 'queued')
  return { enqueued, done: (pending || 0) === 0, capped: queued.length === capacity }
}

/** Called from the outbox drain when a marketing send reaches a terminal
 *  state. Updates the campaign send row that drives stats. */
export async function syncMarketingSendResult(
  payload: Record<string, unknown>,
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  const sendId = typeof payload.sendId === 'string' ? payload.sendId : ''
  if (!sendId) return
  try {
    if (result.ok) {
      await admin()
        .from('email_campaign_sends')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', sendId)
        .eq('status', 'queued')
    } else {
      await admin()
        .from('email_campaign_sends')
        .update({ status: 'failed', error: result.error.slice(0, 500) })
        .eq('id', sendId)
    }
  } catch (e) {
    console.error('[emailMarketing] send result sync failed:', e)
  }
}

/**
 * Failure-spike breaker: a 'sending'/'sent' email with >=10 terminal sends
 * where over 20% failed pauses its campaign and notifies the CRM. Runs each
 * cron tick; the paused_reason guard makes the notification fire once.
 */
export async function checkEmailHealth(email: CampaignEmailRow): Promise<void> {
  const db = admin()
  const { data: sends } = await db
    .from('email_campaign_sends')
    .select('status')
    .eq('email_id', email.id)
  if (!sends || sends.length < 10) return

  const terminal = sends.filter((s) => s.status === 'sent' || s.status === 'failed')
  if (terminal.length < 10) return
  const failedCount = terminal.filter((s) => s.status === 'failed').length
  if (failedCount / terminal.length <= 0.2) return

  const { data: campaign } = await db
    .from('email_campaigns')
    .select('id, status, paused_reason, name')
    .eq('id', email.campaign_id)
    .maybeSingle()
  if (!campaign || campaign.status === 'paused') return

  const reason = `Auto-paused: ${failedCount} of ${terminal.length} sends failed on "${email.subject}"`
  await db
    .from('email_campaigns')
    .update({ status: 'paused', paused_reason: reason })
    .eq('id', email.campaign_id)
  await notifyCrm(email.client_id, 'email_campaign_paused', {
    campaignId: email.campaign_id,
    campaignName: campaign.name,
    reason,
  })
}
