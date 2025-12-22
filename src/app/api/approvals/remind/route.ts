import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function hours(n: number) {
  return n * 60 * 60 * 1000
}
function days(n: number) {
  return n * 24 * 60 * 60 * 1000
}

export async function GET(req: NextRequest) {
  // Optional protection: allow Vercel Cron header OR a secret query param
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  const envSecret = process.env.CRON_SECRET
  const vercelCron = req.headers.get('x-vercel-cron')

  if (envSecret && !vercelCron && secret !== envSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // Only pending approvals with auto_approve_at set
  const { data: approvals, error } = await supabase
    .from('approvals')
    .select(
      'id, title, client_id, auto_approve_at, auto_approve_minutes, reminder_3day_sent_at, reminder_1day_sent_at, clients(name, business_name)'
    )
    .eq('status', 'pending')
    .not('auto_approve_at', 'is', null)

  if (error) {
    console.error('remind load approvals error', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  let sent = 0

  for (const a of approvals || []) {
    const approvalId = a.id as string
    const autoAt = a.auto_approve_at ? new Date(a.auto_approve_at as string) : null
    const mins = a.auto_approve_minutes as number | null

    if (!autoAt || !mins) continue

    // Reminder rules:
    // - 24h: no reminders
    // - 3 days: 1 day before
    // - 7 days: "third day" (day 3 after creation ≈ 4 days before expiry) AND 1 day before
    const is24h = mins === 24 * 60
    const is3d = mins === 3 * 24 * 60
    const is7d = mins === 7 * 24 * 60

    if (is24h) continue

    const msToAuto = autoAt.getTime() - now.getTime()

    // helper to send reminder to assignees
    const sendReminder = async (label: string, setField: 'reminder_3day_sent_at' | 'reminder_1day_sent_at') => {
      // Load assignees
      const { data: assignees } = await supabase
        .from('approval_assignees')
        .select('user_id')
        .eq('approval_id', approvalId)

      const userIds = Array.from(new Set((assignees || []).map((r: any) => r.user_id).filter(Boolean)))
      if (userIds.length === 0) return

      // emails
      const secret = process.env.APPS_SCRIPT_SECRET
const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/approvals/${approvalId}`
const agencyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approvals/${approvalId}`

// Create in-app notification rows so popup+sound triggers
await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userIds: userIds, // all assignees
    type: 'approval_reminder',
    data: {
  approvalId,
  title: a.title,
  clientName: clientDisplayName,
},
  }),
})

const { data: users } = await supabase
  .from('users')
  .select('id, email, role')
  .in('id', userIds)

const clientEmails = (users || [])
  .filter((u: any) => u.role === 'client')
  .map((u: any) => u.email)
  .filter(Boolean)

const teamEmails = (users || [])
  .filter((u: any) => u.role !== 'client')
  .map((u: any) => u.email)
  .filter(Boolean)

if (secret && clientEmails.length > 0) {
  await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'approval_reminder',
      payload: {
        secret,
        to: clientEmails,
        clientName: clientDisplayName,
        approvalTitle: a.title,
        approvalId,
        reminderLabel: label,
        url: portalUrl,
      },
    }),
  })
}

if (secret && teamEmails.length > 0) {
  await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'approval_reminder',
      payload: {
        secret,
        to: teamEmails,
        clientName: clientDisplayName,
        approvalTitle: a.title,
        approvalId,
        reminderLabel: label,
        url: agencyUrl,
      },
    }),
  })
}

      // mark sent so it doesn't repeat
      await supabase
        .from('approvals')
        .update({ [setField]: new Date().toISOString() })
        .eq('id', approvalId)

      sent++
    }

    // 3 days: send 1-day-before reminder
    if (is3d && !a.reminder_1day_sent_at) {
      if (msToAuto <= days(1) && msToAuto > 0) {
        await sendReminder('1-day reminder', 'reminder_1day_sent_at')
      }
    }

    // 7 days: send "third day" reminder ~ 4 days before expiry
    if (is7d && !a.reminder_3day_sent_at) {
      // window: between 4 days and 3 days before auto-approve
      if (msToAuto <= days(4) && msToAuto > days(3)) {
        await sendReminder('3rd-day reminder', 'reminder_3day_sent_at')
      }
    }

    // 7 days: send 1-day-before reminder
    if (is7d && !a.reminder_1day_sent_at) {
      if (msToAuto <= days(1) && msToAuto > 0) {
        await sendReminder('1-day reminder', 'reminder_1day_sent_at')
      }
    }
  }

  return NextResponse.json({ success: true, sent })
}