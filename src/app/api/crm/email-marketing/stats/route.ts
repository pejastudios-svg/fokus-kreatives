// GET /api/crm/email-marketing/stats?clientId=...&emailId=...(optional)
//
// Campaign statistics. Click-based - opens are not tracked (Gmail's image
// proxy makes them unreliable); CTR here means unique clickers / delivered.
// With emailId: adds the per-link breakdown (which CTA got the clicks).

import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/emailOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const clientId = url.searchParams.get('clientId')
  const emailId = url.searchParams.get('emailId')
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const db = admin()

  if (emailId) {
    const [{ data: sends }, { data: email }] = await Promise.all([
      db
        .from('email_campaign_sends')
        .select('id, status, first_clicked_at, click_count')
        .eq('email_id', emailId)
        .eq('client_id', clientId),
      db
        .from('email_campaign_emails')
        .select('id, subject, status, sent_at')
        .eq('id', emailId)
        .eq('client_id', clientId)
        .maybeSingle(),
    ])
    if (!email) {
      return NextResponse.json({ success: false, error: 'Email not found' }, { status: 404 })
    }
    const rows = sends || []
    const delivered = rows.filter((s) => s.status === 'sent').length
    // Only count clicks among delivered emails so CTR can never exceed 100%.
    const uniqueClickers = rows.filter((s) => s.status === 'sent' && s.first_clicked_at).length
    // "Recipients" = addresses we actually attempted; rows skipped at send
    // time because already suppressed never received anything.
    const recipients = rows.filter((s) => s.status !== 'unsubscribed').length

    // Real unsubscribes (people who clicked unsubscribe on THIS email);
    // send rows with status 'unsubscribed' are addresses skipped at send
    // time because they were already suppressed.
    const allSendIds = rows.map((s) => s.id as string)
    let unsubscribed = 0
    for (let i = 0; i < allSendIds.length; i += 200) {
      const { count } = await db
        .from('email_suppressions')
        .select('id', { count: 'exact', head: true })
        .in('source_send_id', allSendIds.slice(i, i + 200))
      unsubscribed += count || 0
    }

    // Per-link breakdown.
    const sendIds = rows.map((s) => s.id as string)
    const linkTotals: Record<string, { url: string; label: string; clicks: number }> = {}
    if (sendIds.length > 0) {
      for (let i = 0; i < sendIds.length; i += 200) {
        const { data: clicks } = await db
          .from('email_link_clicks')
          .select('url, label')
          .in('send_id', sendIds.slice(i, i + 200))
        for (const c of clicks || []) {
          const key = `${c.label || ''}|${c.url}`
          if (!linkTotals[key]) {
            linkTotals[key] = { url: c.url as string, label: (c.label as string) || '', clicks: 0 }
          }
          linkTotals[key].clicks++
        }
      }
    }

    return NextResponse.json({
      success: true,
      email: {
        id: email.id,
        subject: email.subject,
        status: email.status,
        sent_at: email.sent_at,
        recipients,
        delivered,
        failed: rows.filter((s) => s.status === 'failed').length,
        unsubscribed,
        unique_clicks: uniqueClickers,
        total_clicks: rows.reduce((sum, s) => sum + (s.click_count || 0), 0),
        ctr: delivered > 0 ? Math.round((uniqueClickers / delivered) * 1000) / 10 : 0,
        links: Object.values(linkTotals).sort((a, b) => b.clicks - a.clicks),
      },
    })
  }

  // Per-campaign rollup.
  const [{ data: campaigns }, { data: sends }, { data: suppressions }] = await Promise.all([
    db.from('email_campaigns').select('id, name').eq('client_id', clientId),
    db
      .from('email_campaign_sends')
      .select('id, campaign_id, status, first_clicked_at, click_count')
      .eq('client_id', clientId),
    db
      .from('email_suppressions')
      .select('source_send_id')
      .eq('client_id', clientId)
      .not('source_send_id', 'is', null),
  ])

  const unsubSendIds = new Set((suppressions || []).map((s) => s.source_send_id as string))
  const byCampaign = new Map<
    string,
    { recipients: number; delivered: number; failed: number; unsubscribed: number; clickers: number; clicks: number }
  >()
  for (const s of sends || []) {
    const key = s.campaign_id as string
    const e =
      byCampaign.get(key) ||
      { recipients: 0, delivered: 0, failed: 0, unsubscribed: 0, clickers: 0, clicks: 0 }
    // Skipped-at-send (already suppressed) rows aren't real recipients.
    if (s.status !== 'unsubscribed') e.recipients++
    if (s.status === 'sent') e.delivered++
    if (s.status === 'failed') e.failed++
    if (unsubSendIds.has(s.id as string)) e.unsubscribed++
    // Clicks only count among delivered, so CTR stays <= 100%.
    if (s.status === 'sent' && s.first_clicked_at) e.clickers++
    e.clicks += s.click_count || 0
    byCampaign.set(key, e)
  }

  const stats = (campaigns || []).map((c) => {
    const e =
      byCampaign.get(c.id as string) ||
      { recipients: 0, delivered: 0, failed: 0, unsubscribed: 0, clickers: 0, clicks: 0 }
    return {
      campaign_id: c.id,
      name: c.name,
      ...e,
      ctr: e.delivered > 0 ? Math.round((e.clickers / e.delivered) * 1000) / 10 : 0,
    }
  })

  return NextResponse.json({ success: true, stats })
}
