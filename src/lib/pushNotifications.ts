'use client'

// Client-side helpers for the Web Push subscribe / unsubscribe flow.
// Used by the Settings toggle to opt the user into browser pushes.
//
// Flow on subscribe:
//   1. Check Notification.permission - prompt the user if needed.
//   2. Register the service worker (idempotent).
//   3. Ask the SW's PushManager for a subscription, scoped to our
//      VAPID public key.
//   4. POST the subscription's {endpoint, keys.p256dh, keys.auth}
//      to /api/push/subscribe so the server can deliver pushes
//      later.
//
// Flow on unsubscribe:
//   1. Read the current subscription from the SW.
//   2. Call .unsubscribe() (which tells the push service to stop
//      delivering to that endpoint).
//   3. POST the endpoint to /api/push/unsubscribe so the server
//      drops the row.

/** Convert a base64-url-encoded VAPID public key into the
 *  Uint8Array shape `pushManager.subscribe` expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const rawData = typeof window !== 'undefined' ? window.atob(base64) : ''
  const out = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i)
  return out
}

/** Returns true when the browser supports the APIs we need. */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Current Notification permission state. */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

/** Idempotent SW registration. Returns the registration so callers
 *  can chain pushManager operations on it. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null
  try {
    const existing = await navigator.serviceWorker.getRegistration('/sw.js')
    if (existing) return existing
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch (err) {
    console.error('[push] sw register failed:', err)
    return null
  }
}

interface SerializedSubscription {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

function serializeSubscription(sub: PushSubscription): SerializedSubscription {
  const json = sub.toJSON()
  return {
    endpoint: json.endpoint!,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
  }
}

/** Request permission + subscribe to web push. Returns true when the
 *  full flow completes; false on any failure (permission denied,
 *  no VAPID key configured, network error). */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidPublic) {
    console.error('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set')
    return false
  }

  if (Notification.permission === 'denied') {
    return false
  }
  if (Notification.permission !== 'granted') {
    const result = await Notification.requestPermission()
    if (result !== 'granted') return false
  }

  const reg = await ensureServiceWorker()
  if (!reg) return false

  let subscription = await reg.pushManager.getSubscription()
  if (!subscription) {
    try {
      // applicationServerKey wants a BufferSource. Casting to
      // BufferSource because TS' lib.dom doesn't recognize the
      // Uint8Array<ArrayBufferLike> variant the spec actually allows.
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic) as unknown as BufferSource,
      })
    } catch (err) {
      console.error('[push] subscribe failed:', err)
      return false
    }
  }

  const serialized = serializeSubscription(subscription)
  try {
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serialized),
    })
    return res.ok
  } catch (err) {
    console.error('[push] persist subscription failed:', err)
    return false
  }
}

/** Unsubscribe locally + tell the server to drop the row. */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!reg) return true // nothing to do
  const subscription = await reg.pushManager.getSubscription()
  if (!subscription) return true

  const endpoint = subscription.endpoint
  try {
    await subscription.unsubscribe()
  } catch (err) {
    console.warn('[push] local unsubscribe failed (continuing):', err)
  }

  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    })
  } catch (err) {
    console.warn('[push] server unsubscribe failed:', err)
  }
  return true
}

/** Whether the user currently has an active push subscription on
 *  THIS browser. Doesn't check server state - just local SW. */
export async function hasActiveSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}
