'use client'

// CRM Inbox - notifications scoped to a single client.
//
// Backs onto the same `notifications` table the Header bell uses,
// but filtered by `data.clientId = clientId` so each CRM only shows
// its own activity (leads, meetings, capture submissions, payments
// for that client). The header bell continues to show non-CRM
// stuff (approvals, tasks, brand intake) across the workspace.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loading'
import { createClient } from '@/lib/supabase/client'
import {
  formatNotificationText,
  formatNotificationTime,
  notificationHref,
  type NotificationRow,
} from '@/lib/notifications'
import { Inbox, CheckCheck, Trash2, Circle, CheckCircle2 } from 'lucide-react'

type Filter = 'all' | 'unread'

// Notification types that belong in a CRM Inbox. Anything else stays
// out of this view (it lives in the agency-side Header bell instead).
const CRM_TYPES = new Set([
  'lead_created',
  'capture_submission',
  'meeting_created',
  'payment_created',
  'payment_due',
])

export default function CRMInboxPage() {
  const params = useParams() as Record<string, string>
  const clientId = (params.clientid || params.clientId) as string
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')

  // Filter to "this client's CRM-scoped notifications only" both on
  // initial fetch + on each realtime update. We compare client_id
  // from `data` because that's how the notifications API stores the
  // scope; the notifications table itself doesn't have a client_id
  // column.
  const matchesThisCrm = useCallback(
    (n: NotificationRow): boolean => {
      if (!CRM_TYPES.has(n.type)) return false
      const dataClientId =
        typeof n.data?.clientId === 'string' ? n.data.clientId : null
      return dataClientId === clientId
    },
    [clientId],
  )

  useEffect(() => {
    let isMounted = true
    let cleanup: (() => void) | undefined

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (isMounted) setLoading(false)
        return
      }

      const fetchAll = async () => {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500)
        if (error) {
          console.error('[crm-inbox] load error:', error)
          return
        }
        if (isMounted) {
          const rows = ((data || []) as NotificationRow[]).filter(matchesThisCrm)
          setItems(rows)
        }
      }

      await fetchAll()
      if (isMounted) setLoading(false)

      const channel = supabase
        .channel(`crm-inbox-${clientId}-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void fetchAll()
          },
        )
        .subscribe()

      cleanup = () => {
        supabase.removeChannel(channel)
      }
    })()

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [supabase, clientId, matchesThisCrm])

  const callMutate = useCallback(async (body: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/notifications/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return res.ok
    } catch (e) {
      console.error('[crm-inbox] mutate error:', e)
      return false
    }
  }, [])

  const markRead = useCallback(
    async (id: string) => {
      const target = items.find((n) => n.id === id)
      if (!target || target.read_at) return
      setItems((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, read_at: new Date().toISOString() } : n,
        ),
      )
      const ok = await callMutate({ action: 'mark_read', id })
      if (!ok) {
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: null } : n)))
      }
    },
    [items, callMutate],
  )

  // Marking "all" read here = only the rows visible in THIS CRM
  // Inbox. Workspace-level notifications for other CRMs / approvals
  // stay untouched. We hit mark_read one-by-one (cheap; the inbox
  // caps at the unread subset).
  const markAllReadInThisCrm = useCallback(async () => {
    const unread = items.filter((n) => !n.read_at)
    if (unread.length === 0) return
    const now = new Date().toISOString()
    const prev = items
    setItems((cur) => cur.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    const results = await Promise.all(
      unread.map((n) => callMutate({ action: 'mark_read', id: n.id })),
    )
    if (results.some((r) => !r)) {
      setItems(prev)
    }
  }, [items, callMutate])

  const deleteOne = useCallback(
    async (id: string) => {
      const target = items.find((n) => n.id === id)
      if (!target) return
      setItems((cur) => cur.filter((n) => n.id !== id))
      const ok = await callMutate({ action: 'delete_one', id })
      if (!ok) setItems((cur) => [target, ...cur])
    },
    [items, callMutate],
  )

  // "Clear all in your inbox" = delete only the rows we're showing here.
  const clearAllInThisCrm = useCallback(async () => {
    if (items.length === 0) return
    if (!confirm('Clear all your notifications?')) return
    const prev = items
    setItems([])
    const results = await Promise.all(
      prev.map((n) => callMutate({ action: 'delete_one', id: n.id })),
    )
    if (results.some((r) => !r)) {
      setItems(prev)
    }
  }, [items, callMutate])

  const filtered = useMemo(() => {
    if (filter === 'unread') return items.filter((n) => !n.read_at)
    return items
  }, [items, filter])

  const unreadCount = useMemo(
    () => items.filter((n) => !n.read_at).length,
    [items],
  )

  return (
    <div className="p-3 sm:p-4 lg:p-6 min-h-full max-w-3xl mx-auto">
      <p className="text-xs text-[var(--text-tertiary)] mb-4">
        Your activity. Leads, meetings, submissions, payments.
      </p>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-6 border-b border-[var(--border-primary)] flex-1 min-w-0">
          {(['all', 'unread'] as const).map((f) => {
            const active = filter === f
            const count = f === 'unread' ? unreadCount : items.length
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`relative pb-3 text-sm font-medium capitalize transition-colors ${
                  active
                    ? 'text-[#2B79F7]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {f}
                <span className="ml-1.5 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                  {count}
                </span>
                {active && (
                  <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-[#2B79F7] rounded-full" />
                )}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={markAllReadInThisCrm}
            disabled={unreadCount === 0}
            title="Mark all your notifications as read"
          >
            <CheckCheck className="h-4 w-4 mr-1.5" />
            Mark all read
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={clearAllInThisCrm}
            disabled={items.length === 0}
            title="Delete all your notifications"
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Clear all
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl bg-[var(--bg-card-hover)]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="h-8 w-8 mx-auto text-[var(--text-tertiary)] mb-3" />
            <p className="text-sm text-[var(--text-tertiary)]">
              {filter === 'unread'
                ? "You're all caught up. Nothing unread."
                : 'No notifications yet.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => {
            const isUnread = !n.read_at
            return (
              <div
                key={n.id}
                onClick={() => {
                  // Mark read in background, then navigate to the
                  // destination page with ?focus=<id> appended so it
                  // pulses the exact row / opens the exact modal.
                  void markRead(n.id)
                  const href = notificationHref(n)
                  if (href) router.push(href)
                }}
                className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                  isUnread
                    ? 'bg-[#2B79F7]/5 border-[#2B79F7]/20 hover:bg-[#2B79F7]/10'
                    : 'bg-[var(--bg-card)] border-[var(--border-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
              >
                <div className="pt-1 shrink-0">
                  {isUnread ? (
                    <Circle className="h-2 w-2 fill-[#2B79F7] text-[#2B79F7]" />
                  ) : (
                    <Circle className="h-2 w-2 text-transparent" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm break-words ${
                      isUnread
                        ? 'text-[var(--text-primary)] font-medium'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {formatNotificationText(n)}
                  </p>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                    {formatNotificationTime(n.created_at)}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isUnread && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void markRead(n.id)
                      }}
                      className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-[var(--bg-card-hover)]"
                      title="Mark as read"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteOne(n.id)
                    }}
                    className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
