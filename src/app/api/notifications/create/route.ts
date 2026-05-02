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

export async function POST(req: NextRequest) {
  try {
    const { userIds, type, data } = await req.json()

    if (!Array.isArray(userIds) || userIds.length === 0 || !type) {
      return NextResponse.json(
        { success: false, error: 'Missing userIds or type' },
        { status: 400 }
      )
    }

    const filtered = await gateByPreferences(userIds as string[], type as string)

    if (filtered.length === 0) {
      return NextResponse.json({ success: true, suppressed: userIds.length })
    }

    const rows = filtered.map((userId: string) => ({
      user_id: userId,
      type,
      data,
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