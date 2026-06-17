import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service key
)

/**
 * Map a notification `type` to the user_preferences column that gates it.
 * Types not in this map are NOT suppressible by the user (e.g. approval
 * comments, mentions) - they always fire regardless of preferences.
 */
const TYPE_TO_PREF_COLUMN: Record<string, keyof PrefRow> = {
  lead_created: 'notify_new_lead',
  meeting_created: 'notify_new_meeting',
  meeting_reminder: 'notify_new_meeting',
  payment_created: 'notify_payment_reminder',
  payment_due: 'notify_payment_reminder',
}

interface PrefRow {
  user_id: string
  notify_new_lead: boolean
  notify_new_meeting: boolean
  notify_payment_reminder: boolean
}

/**
 * Filter `userIds` down to those who haven't opted out of this notification
 * type. Users who have no preferences row yet (never visited Settings)
 * default to ON for every type, matching the column default in the
 * migration. Failures fall back to "send to everyone" so a transient
 * preference-lookup error never silently drops user-visible activity.
 */
async function gateByPreferences(
  userIds: string[],
  type: string,
): Promise<string[]> {
  const column = TYPE_TO_PREF_COLUMN[type]
  if (!column) return userIds // not a gated type
  if (userIds.length === 0) return userIds

  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .select(`user_id, ${column}`)
    .in('user_id', userIds)
  if (error) {
    console.error('preferences lookup error in notifications/create:', error)
    return userIds
  }
  // Build a set of user_ids who have explicitly disabled this type. Users
  // missing from the result default to ON (no row = unset).
  const disabled = new Set<string>()
  for (const row of (data || []) as unknown as PrefRow[]) {
    if (row[column] === false) disabled.add(row.user_id)
  }
  return userIds.filter((id) => !disabled.has(id))
}

/**
 * Resolve recipients when the caller passes a `clientId` instead of an
 * explicit `userIds` array. Used by CRM-scoped events (new lead, new
 * meeting, payment) where the firing site doesn't know the roster.
 *
 * Recipients are the client's own accounts (users.client_id = clientId)
 * PLUS agency workspace owners (client_id null, role admin/manager) - the
 * same audience the email pipeline targets. Agency owners used to be
 * excluded here, which meant payment popups/sounds never fired for them
 * even though they received the emails.
 */
async function resolveClientRecipients(clientId: string): Promise<string[]> {
  const [clientUsers, agencyOwners] = await Promise.all([
    supabaseAdmin.from('users').select('id').eq('client_id', clientId),
    supabaseAdmin
      .from('users')
      .select('id')
      .is('client_id', null)
      .in('role', ['admin', 'manager']),
  ])
  if (clientUsers.error) console.error('client users lookup error:', clientUsers.error)
  if (agencyOwners.error) console.error('agency owners lookup error:', agencyOwners.error)
  return Array.from(
    new Set(
      [...(clientUsers.data ?? []), ...(agencyOwners.data ?? [])].map(
        (r) => (r as { id: string }).id,
      ),
    ),
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, data } = body
    let userIds: string[] = Array.isArray(body.userIds) ? body.userIds : []

    // Optional `clientId` shorthand: if caller provides a clientId and
    // no explicit userIds, resolve to the CRM team for that client.
    // Both can coexist - explicit userIds get unioned with the team.
    const clientId: string | undefined = body.clientId
    if (clientId) {
      const teamIds = await resolveClientRecipients(clientId)
      userIds = Array.from(new Set([...userIds, ...teamIds]))
    }

    if (userIds.length === 0 || !type) {
      return NextResponse.json(
        { success: false, error: 'Missing recipients (userIds or clientId) or type' },
        { status: 400 }
      )
    }

    const filtered = await gateByPreferences(userIds as string[], type as string)

    if (filtered.length === 0) {
      return NextResponse.json({ success: true, suppressed: userIds.length })
    }

    // Stamp clientId into the notification's `data` payload so the
    // per-CRM Inbox page can filter to "only notifications for this
    // client" without needing to re-resolve recipients. Existing
    // `data.clientId` (caller-provided) wins so explicit values
    // aren't overwritten.
    const dataObj: Record<string, unknown> =
      data && typeof data === 'object' ? { ...(data as Record<string, unknown>) } : {}
    if (clientId && typeof dataObj.clientId !== 'string') {
      dataObj.clientId = clientId
    }

    const rows = filtered.map((userId: string) => ({
      user_id: userId,
      type,
      data: dataObj,
    }))

    const { error } = await supabaseAdmin
      .from('notifications')
      .insert(rows)

    if (error) {
      console.error('Notification insert error:', error)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    // Fire web push to every active subscription belonging to the
    // recipients. We AWAIT this rather than fire-and-forget because
    // on serverless platforms (Vercel), pending promises after the
    // response is sent get killed - which means pushes wouldn't
    // actually reach devices, especially when the user's PWA is
    // closed (the only signal that brings them back). Adds 200-500ms
    // to the response but ensures reliable delivery.
    try {
      const { sendPushToUsers } = await import('@/lib/webPushServer')
      const { formatNotificationText, notificationHref } = await import(
        '@/lib/notifications'
      )
      const stub = {
        id: '',
        type: type as string,
        data: dataObj,
        read_at: null,
        created_at: new Date().toISOString(),
      }
      const title = (() => {
        switch (type) {
          case 'lead_created':
            return 'New lead'
          case 'capture_submission':
            return 'New submission'
          case 'meeting_created':
            return 'Meeting booked'
          case 'payment_created':
            return 'Payment recorded'
          case 'payment_due':
            return 'Payment due'
          case 'approval_created':
            return 'Approval created'
          case 'approval_approved':
            return 'Approval approved'
          case 'approval_comment':
            return 'New approval comment'
          case 'approval_mention':
            return 'You were mentioned'
          case 'approval_reminder':
            return 'Approval reminder'
          case 'approval_comment_resolved':
            return 'Comment resolved'
          case 'brand_intake_submitted':
            return 'Brand intake submitted'
          case 'question_form_submitted':
            return 'Braindump submitted'
          case 'series_form_submitted':
            return 'Series form submitted'
          default:
            return 'Fokus Kreatives'
        }
      })()
      const body = formatNotificationText(stub)
      const url = notificationHref(stub) || '/'
      // No `tag` - using the same tag for multiple pushes (e.g.
      // 'lead_created-clientId') made each new toast SILENTLY REPLACE
      // the previous one instead of showing as a fresh notification.
      // That's the canonical "I see one, then they stop" symptom.
      // Each push gets its own toast now.
      await sendPushToUsers(filtered, { title, body, url })
    } catch (e) {
      console.error('[notifications/create] web push fan-out failed:', e)
    }

    return NextResponse.json({
      success: true,
      sent: filtered.length,
      suppressed: userIds.length - filtered.length,
    })
  } catch (err: unknown) {
    console.error('Notification API error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}