// Server-side Web Push delivery.
//
// One entry point: `sendPushToUsers(userIds, payload)`. Loads every
// active subscription for those users, signs + encrypts the payload
// with VAPID keys, and dispatches in parallel. Subscriptions that
// come back 404/410 (gone) are auto-deleted so the next round
// doesn't keep hitting them.

import webpush from 'web-push'
import { createClient as createServiceClient } from '@supabase/supabase-js'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

let vapidConfigured = false
function configureVapid() {
  if (vapidConfigured) return
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:hello@fokuskreatives.com'
  if (!publicKey || !privateKey) {
    console.warn(
      '[webpush] Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY - push delivery disabled',
    )
    return
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
}

export interface PushPayload {
  title: string
  body: string
  /** Deep-link URL the SW navigates to on click. */
  url?: string
  /** Optional notification ID to mark-as-read from the SW message. */
  notificationId?: string | null
  /** Optional notification tag - same tag replaces an existing
   *  notification in-place instead of stacking. */
  tag?: string
  icon?: string
  badge?: string
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/** Deliver a push to every active subscription belonging to the
 *  given user IDs. Non-blocking - errors logged, never thrown. */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0) return
  configureVapid()
  if (!vapidConfigured) return

  const { data, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  if (error) {
    console.error('[webpush] load subscriptions error:', error)
    return
  }

  const subs = (data ?? []) as SubscriptionRow[]
  if (subs.length === 0) return

  const bodyStr = JSON.stringify(payload)
  const deadIds: string[] = []
  let sent = 0

  console.log(
    `[webpush] sending to ${subs.length} subscription(s) for ${userIds.length} user(s); payload=${bodyStr.slice(0, 200)}`,
  )

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          bodyStr,
        )
        sent += 1
      } catch (err: unknown) {
        const status =
          err &&
          typeof err === 'object' &&
          'statusCode' in err &&
          typeof (err as { statusCode?: unknown }).statusCode === 'number'
            ? (err as { statusCode: number }).statusCode
            : null
        const message =
          err && typeof err === 'object' && 'body' in err
            ? String((err as { body?: unknown }).body)
            : err instanceof Error
            ? err.message
            : String(err)
        // 404 + 410 = subscription gone. Drop it so we don't keep
        // hammering the push service with a dead endpoint. Anything
        // else (400, 401, 429, 5xx) we KEEP and log loudly - dropping
        // on the first transient failure would silently nuke working
        // subscriptions and look like "push stopped working".
        if (status === 404 || status === 410) {
          deadIds.push(sub.id)
          console.warn(
            `[webpush] dropping expired subscription ${sub.id} (status=${status})`,
          )
        } else {
          console.error(
            `[webpush] send error for sub=${sub.id} status=${status ?? 'unknown'} body=${message}`,
          )
        }
      }
    }),
  )

  console.log(
    `[webpush] complete: sent=${sent}/${subs.length} dropped=${deadIds.length}`,
  )

  if (deadIds.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', deadIds)
  }
}
