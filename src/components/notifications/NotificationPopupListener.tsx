'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { notificationHref } from '@/lib/notifications'

type NotifRow = {
  id: string
  type: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
  created_at: string
}

// CRM-scoped types. When the user is already INSIDE that client's CRM, the
// CRM layout surfaces these itself (its own popup + the Inbox badge), so this
// global listener stays quiet there to avoid double popups for one event.
const CRM_TYPES = new Set([
  'lead_created',
  'capture_submission',
  'meeting_created',
  'meeting_rescheduled',
  'payment_created',
  'payment_due',
  'payment_marked_paid',
])

const TITLES: Record<string, string> = {
  approval_created: 'New approval created',
  approval_approved: 'Approval approved',
  approval_comment: 'New comment',
  approval_mention: 'You were mentioned',
  approval_reminder: 'Approval reminder',
  approval_comment_resolved: 'Comment resolved',
  brand_intake_submitted: 'Brand intake submitted',
  question_form_submitted: 'New form responses',
  series_form_submitted: 'Series form submitted',
  lead_created: 'New lead',
  capture_submission: 'New submission',
  meeting_created: 'Meeting booked',
  meeting_rescheduled: 'Meeting rescheduled',
  payment_created: 'Payment recorded',
  payment_due: 'Payment due',
  payment_marked_paid: 'Invoice marked paid',
}

export function NotificationPopupListener() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const pathname = usePathname()

  const [popup, setPopup] = useState<NotifRow | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // The realtime handler closes over mount-time state, so it reads the
  // current path through a ref instead.
  const pathRef = useRef(pathname)
  useEffect(() => {
    pathRef.current = pathname
  }, [pathname])

  useEffect(() => {
    audioRef.current = new Audio(`/notifications.mp3?v=${Date.now()}`)
  }, [])

  const playSound = () => {
    if (!audioRef.current) return
    try {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => {})
    } catch {}
  }

  useEffect(() => {
    const boot = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: userRow } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single()

      setUserRole(userRow?.role || null)

      const channel = supabase
        .channel(`notif-popup-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as NotifRow
            // Inside that client's CRM, the CRM layout already pops + badges
            // this event - showing it here too reads as a duplicate.
            const rowClientId =
              typeof row.data?.clientId === 'string' ? row.data.clientId : null
            if (
              CRM_TYPES.has(row.type) &&
              rowClientId &&
              (pathRef.current || '').startsWith(`/crm/${rowClientId}`)
            ) {
              return
            }
            setPopup(row)
            playSound()

            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => setPopup(null), 9000)
          }
        )
        .subscribe()

      return () => supabase.removeChannel(channel)
    }

    const cleanupPromise = boot()
    return () => {
      cleanupPromise?.then((cleanup) => cleanup && cleanup())
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [supabase])

  if (!popup) return null

  const approvalId = popup.data?.approvalId as string | undefined
  const clientId = popup.data?.clientId as string | undefined
  const popupUrl = popup.data?.url as string | undefined

  const title = TITLES[popup.type] || 'New notification'

  // Prefer the comment snippet when there is one - it's the most useful
  // piece of info on a popup. Then the most specific name the event has
  // (meeting title, lead name, page, invoice #), then the client name.
  const subtitle =
    popup.data?.contentSnippet ||
    popup.data?.title ||
    popup.data?.approvalTitle ||
    popup.data?.meetingTitle ||
    popup.data?.leadName ||
    popup.data?.pageName ||
    (popup.data?.invoiceNumber ? `#${popup.data.invoiceNumber}` : '') ||
    popup.data?.clientName ||
    ''

  // CRM-scoped events deep-link to the right CRM page (inbox/leads/meetings/
  // revenue) via the shared href resolver; approvals keep their role-aware
  // routes; anything else falls back to the agency client profile / raw url.
  const crmTarget = CRM_TYPES.has(popup.type)
    ? notificationHref(
        { id: popup.id, type: popup.type, data: popup.data, read_at: null, created_at: popup.created_at },
        { isClientRole: userRole === 'client' },
      )
    : null

  const target =
    crmTarget ??
    (approvalId
      ? userRole === 'client'
        ? `/portal/approvals/${approvalId}`
        : `/approvals/${approvalId}`
      : clientId
      ? `/clients/${clientId}`
      : popupUrl || null)

  const go = () => {
    if (!target) return
    router.push(target)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className="bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-xl shadow-lg overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3">
          <button
            type="button"
            onClick={go}
            className="flex-1 min-w-0 text-left"
          >
            <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
            {subtitle && (
              <p className="text-xs text-[var(--text-tertiary)] mt-1 truncate">{subtitle}</p>
            )}
            {target && (
              <p className="text-[11px] text-[#2B79F7] mt-2">Click to open</p>
            )}
          </button>

          <button
            type="button"
            onClick={() => setPopup(null)}
            className="p-1 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}