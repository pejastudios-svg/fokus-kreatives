'use client'

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { createPortal } from 'react-dom'
import { Bell, Trash2, X, CheckCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface HeaderProps {
  title: string
  subtitle?: string
}

interface NotificationRow {
  id: string
  type: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
  read_at: string | null
  created_at: string
}

const NOTIF_WIDTH = 320

export function Header({ title, subtitle }: HeaderProps) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [userRole, setUserRole] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotif, setShowNotif] = useState(false)
  // Decoupled mount + open so we can run an exit animation before unmounting.
  const [notifMounted, setNotifMounted] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [notifPos, setNotifPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      setUserRole((data?.role as string) ?? null)
    })()
  }, [supabase])

  useEffect(() => {
    let isMounted = true

    const setup = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const fetchNotifications = async () => {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(40)
        if (error) {
          console.error('Load notifications error:', error)
          return
        }
        if (isMounted) {
          // The header bell is the WORKSPACE-level surface (approvals,
          // tasks, brand intake). CRM-scoped notifications (leads,
          // capture submissions, meetings, payments) live inside each
          // client's CRM Inbox instead, so we filter them out here.
          const CRM_SCOPED = new Set([
            'lead_created',
            'capture_submission',
            'meeting_created',
            'payment_created',
            'payment_due',
          ])
          const rows = ((data || []) as NotificationRow[]).filter(
            (n) => !CRM_SCOPED.has(n.type),
          )
          // Cap at 20 visible rows after filtering, to match the
          // dropdown's intended size.
          const trimmed = rows.slice(0, 20)
          setNotifications(trimmed)
          setUnreadCount(trimmed.filter((n) => !n.read_at).length)
        }
      }

      await fetchNotifications()

      const channel = supabase
        .channel(`notifications-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchNotifications()
          },
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    const cleanupPromise = setup()
    return () => {
      isMounted = false
      cleanupPromise.then((cleanup) => cleanup && cleanup())
    }
  }, [supabase])

  // Drive open/close transitions: mount immediately on open, delay unmount on close.
  useEffect(() => {
    if (showNotif) {
      setNotifMounted(true)
      return
    }
    if (!notifMounted) return
    const t = setTimeout(() => setNotifMounted(false), 200)
    return () => clearTimeout(t)
  }, [showNotif, notifMounted])

  // Position the portaled panel under the bell, clamped to the viewport, and
  // keep it anchored on scroll/resize. The panel is portaled to <body> so it
  // escapes the glass topbar's stacking context (backdrop-filter) - otherwise
  // its z-index is trapped at the header's level and page content paints over it.
  useLayoutEffect(() => {
    if (!notifMounted) return
    const update = () => {
      const el = wrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const left = Math.min(Math.max(r.right - NOTIF_WIDTH, 8), window.innerWidth - NOTIF_WIDTH - 8)
      setNotifPos({ top: r.bottom + 8, left })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [notifMounted])

  // Click-outside + ESC to close. The panel lives in a portal, so check both
  // the bell wrapper and the panel itself.
  useEffect(() => {
    if (!showNotif) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setShowNotif(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotif(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showNotif])

  // All notification mutations go through `/api/notifications/mutate`. The
  // direct supabase.client.delete() approach was silently rejected by RLS for
  // some users - rows came back on reload because the DELETE never happened.
  // The server route uses the service-role key + auth.uid() gate so writes
  // always succeed for the caller's own rows.
  const callMutate = async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch('/api/notifications/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await readJsonSafe(res).catch(() => ({ success: false }))
      if (!data.success) {
        console.error('Notification mutate failed:', { ...data, sent: body })
        return false
      }
      return true
    } catch (err) {
      console.error('Notification mutate exception:', err)
      return false
    }
  }

  const markAsRead = async (id: string) => {
    const target = notifications.find((n) => n.id === id)
    if (!target) return
    const wasUnread = !target.read_at
    // Optimistic
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    )
    if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1))
    const ok = await callMutate({ action: 'mark_read', id })
    if (!ok) {
      // Roll back
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: target.read_at } : n)),
      )
      if (wasUnread) setUnreadCount((prev) => prev + 1)
    }
  }

  const markAllAsRead = async () => {
    const previous = notifications
    const previousUnread = unreadCount
    if (previousUnread === 0) return
    const now = new Date().toISOString()
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    setUnreadCount(0)
    const ok = await callMutate({ action: 'mark_all_read' })
    if (!ok) {
      setNotifications(previous)
      setUnreadCount(previousUnread)
    }
  }

  const deleteOne = async (id: string) => {
    const target = notifications.find((n) => n.id === id)
    if (!target) return
    const wasUnread = !target.read_at
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1))
    const ok = await callMutate({ action: 'delete_one', id })
    if (!ok) {
      // Roll back
      setNotifications((prev) => [target, ...prev])
      if (wasUnread) setUnreadCount((prev) => prev + 1)
    }
  }

  const clearAll = async () => {
    if (notifications.length === 0) return
    const previous = notifications
    const previousUnread = unreadCount
    setNotifications([])
    setUnreadCount(0)
    const ok = await callMutate({ action: 'clear_all' })
    if (!ok) {
      setNotifications(previous)
      setUnreadCount(previousUnread)
    }
  }

  const handleNotificationClick = (n: NotificationRow) => {
    void markAsRead(n.id)
    setShowNotif(false)

    const data = n.data || {}

    if (data.taskId) {
      router.push(`/tasks?taskId=${data.taskId}`)
      return
    }

    if (
      n.type === 'brand_intake_submitted' ||
      n.type === 'question_form_submitted' ||
      n.type === 'series_form_submitted'
    ) {
      const clientId = data.clientId
      if (clientId) router.push(`/clients/${clientId}`)
      return
    }

    if (n.type === 'approval_comment_resolved') {
      const approvalId = data.approvalId
      if (approvalId) router.push(`/approvals/${approvalId}`)
      return
    }

    if (
      n.type === 'approval_created' ||
      n.type === 'approval_approved' ||
      n.type === 'approval_comment' ||
      n.type === 'approval_mention' ||
      n.type === 'approval_reminder'
    ) {
      const approvalId = data.approvalId
      if (userRole === 'client') {
        router.push(approvalId ? `/portal/approvals/${approvalId}` : `/portal/approvals`)
      } else {
        router.push(approvalId ? `/approvals/${approvalId}` : `/approvals`)
      }
      return
    }
  }

  return (
    <header className="md:sticky md:top-0 z-30 glass-topbar flex items-center justify-between h-14 px-4 md:px-6 gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-sm md:text-base font-semibold text-[var(--text-primary)] truncate">{title}</h1>
        {subtitle && <p className="text-[11px] text-[var(--text-tertiary)] truncate">{subtitle}</p>}
      </div>

      <div ref={wrapRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setShowNotif((prev) => !prev)}
          className="relative h-9 w-9 inline-flex items-center justify-center rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)] backdrop-blur-sm hover:bg-[var(--bg-card-hover)] transition-colors"
          aria-label="Notifications"
          aria-expanded={showNotif}
        >
          <Bell className="h-4 w-4 text-[var(--text-secondary)]" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-medium flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {notifMounted && notifPos && typeof window !== 'undefined' &&
          createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: notifPos.top, left: notifPos.left, width: NOTIF_WIDTH }}
            className={`glass-pop max-w-[calc(100vw-1rem)] rounded-xl z-[9999] origin-top-right transition-all duration-200 ease-out ${
              showNotif ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
            }`}
          >
            <div className="px-4 py-2 border-b border-[var(--border-primary)] flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--text-primary)]">Notifications</span>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void markAllAsRead()}
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[#2B79F7] px-2 py-1 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Mark all as read"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void clearAll()}
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-red-600 px-2 py-1 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Clear all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowNotif(false)}
                  className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-tertiary)]"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-6 text-xs text-[var(--text-tertiary)] text-center">No notifications yet.</p>
              ) : (
                notifications.map((n) => (
                  <NotificationRowItem
                    key={n.id}
                    notification={n}
                    text={formatNotificationText(n)}
                    onOpen={() => handleNotificationClick(n)}
                    onDelete={() => void deleteOne(n.id)}
                  />
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
      </div>
    </header>
  )
}

function NotificationRowItem({
  notification: n,
  text,
  onOpen,
  onDelete,
}: {
  notification: NotificationRow
  text: string
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={`group relative flex items-start gap-2 border-b border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] ${
        !n.read_at
          ? // Pronounced blue tint with a left accent so unread reads
            // clearly in dark mode without the near-white wash that
            // bg-blue-50/60 produced.
            'bg-[#2B79F7]/15 dark:bg-[#2B79F7]/25 border-l-2 border-l-[#2B79F7]'
          : 'border-l-2 border-l-transparent'
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left px-4 py-3"
      >
        <p className="text-xs text-[var(--text-primary)] break-words">{text}</p>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
          {new Date(n.created_at).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-2 mt-1 mr-2 text-[var(--text-tertiary)] hover:text-red-600 rounded-md hover:bg-red-500/10"
        aria-label="Delete notification"
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function formatNotificationText(n: NotificationRow) {
  const data = n.data || {}
  switch (n.type) {
    case 'task_created':
      return `Task created: ${data.title || ''}`
    case 'task_status_changed':
      return `Task "${data.title || ''}" moved to ${data.status || ''}`
    case 'task_mentioned':
      return `You were mentioned in a task`
    case 'approval_created':
      return `Approval created for ${data.clientName || 'client'}: ${data.title || ''}`
    case 'approval_approved':
      return `Approval approved for ${data.clientName || 'client'}: ${data.title || ''}`
    case 'approval_comment': {
      // Server emits this type from /api/approvals/comment (used to be a
      // typo'd `approval_commented` here, which made every comment fall
      // through to the bare `Notification` label).
      const who = data.clientName || 'client'
      const where = data.title ? ` on "${data.title}"` : ''
      const snippet = typeof data.contentSnippet === 'string' ? `: ${data.contentSnippet}` : ''
      return `New comment from ${who}${where}${snippet}`
    }
    case 'approval_mention': {
      const where = data.title ? ` on "${data.title}"` : ''
      const snippet = typeof data.contentSnippet === 'string' ? `: ${data.contentSnippet}` : ''
      return `You were mentioned${where}${snippet}`
    }
    case 'approval_reminder':
      return `Approval reminder: ${data.title || ''}`
    case 'brand_intake_submitted':
      return `${data.clientName || 'A client'} submitted their brand intake`
    case 'question_form_submitted': {
      const count = typeof data.count === 'number' ? data.count : 0
      const name = data.clientName || 'A client'
      return count
        ? `${name} answered ${count} braindump question${count === 1 ? '' : 's'}`
        : `${name} submitted a braindump`
    }
    case 'series_form_submitted': {
      const count = typeof data.count === 'number' ? data.count : 0
      const name = data.clientName || 'A client'
      const seriesTitle = typeof data.seriesTitle === 'string' ? data.seriesTitle : 'a series'
      return count
        ? `${name} filled out ${count} answer${count === 1 ? '' : 's'} for "${seriesTitle}"`
        : `${name} submitted "${seriesTitle}"`
    }
    case 'approval_comment_resolved': {
      const title = typeof data.approvalTitle === 'string' ? data.approvalTitle : 'an approval'
      const snippet = typeof data.contentSnippet === 'string' && data.contentSnippet
        ? `: ${data.contentSnippet}`
        : ''
      return `A comment on "${title}" was resolved${snippet}`
    }
    default:
      return 'Notification'
  }
}
