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
 * explicit `userIds` array. Used by CRM-team-wide events (new lead,
 * new meeting, payment) where the firing site doesn't know the team
 * roster - just the client. We pull every active member of that CRM
 * via `client_memberships` and let the prefs gate filter from there.
 */
async function resolveClientRecipients(clientId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('client_memberships')
    .select('user_id')
    .eq('client_id', clientId)
  if (error) {
    console.error('client_memberships lookup error:', error)
    return []
  }
  return Array.from(new Set((data ?? []).map((r) => (r as { user_id: string }).user_id)))
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