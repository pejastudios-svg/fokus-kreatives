// Fokus Kreatives service worker.
//
// Two responsibilities:
//   1. Receive Web Push messages and surface them as OS-level
//      notifications, including when the tab is closed.
//   2. On notification click, focus an existing tab if there is one,
//      otherwise open a new one to the deep-link URL the server sent.
//
// Kept intentionally lean - no offline caching, no precache. The
// only thing we need it for is push delivery; treating it as a
// general PWA cache layer would create stale-asset headaches without
// real upside for an authenticated CRM.

self.addEventListener('install', (event) => {
  // Activate immediately on first install / version bump so users
  // don't need to refresh twice to get the new SW.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (e) {
    // Some push services deliver an empty payload; treat as a
    // "you have new activity" generic ping.
    payload = {}
  }

  const title = payload.title || 'New activity'
  const options = {
    body: payload.body || 'You have a new notification.',
    icon: payload.icon || 'https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png',
    badge: payload.badge || 'https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png',
    tag: payload.tag || undefined, // tag groups notifications - same tag replaces in-place
    data: {
      url: payload.url || '/',
      notificationId: payload.notificationId || null,
    },
    // requireInteraction keeps the toast on desktop until clicked.
    // Mobile ignores it. Leave default (false) so it auto-dismisses.
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientsList) => {
        // If a tab is already open, focus it and post a message so the
        // app can navigate without losing state. Otherwise open a new
        // window pointed at the target URL.
        for (const client of clientsList) {
          if ('focus' in client) {
            client.focus()
            client.postMessage({
              type: 'notification-click',
              url: targetUrl,
              notificationId: event.notification.data?.notificationId || null,
            })
            return
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
      }),
  )
})
