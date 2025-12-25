'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'

type NotifRow = {
  id: string
  type: string
  data: any
  created_at: string
}

export function NotificationPopupListener() {
  const supabase = createClient()
  const router = useRouter()

  const [popup, setPopup] = useState<NotifRow | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

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

  const title =
    popup.type === 'approval_created'
      ? 'New approval created'
      : popup.type === 'approval_approved'
      ? 'Approval approved'
      : popup.type === 'approval_mention'
      ? 'You were mentioned'
      : popup.type === 'approval_reminder'
      ? 'Approval reminder'
      : 'New notification'

  const subtitle =
    popup.data?.title ||
    popup.data?.approvalTitle ||
    popup.data?.clientName ||
    ''

  const go = () => {
    if (!approvalId) return
    const isClient = userRole === 'client'
    router.push(isClient ? `/portal/approvals/${approvalId}` : `/approvals/${approvalId}`)
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] max-w-sm">
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3">
          <button
            type="button"
            onClick={go}
            className="flex-1 min-w-0 text-left"
          >
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            {subtitle && (
              <p className="text-xs text-gray-500 mt-1 truncate">{subtitle}</p>
            )}
            {approvalId && (
              <p className="text-[11px] text-[#2B79F7] mt-2">Click to open</p>
            )}
          </button>

          <button
            type="button"
            onClick={() => setPopup(null)}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}