'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X } from 'lucide-react'

type Popup = {
  title: string
  subtitle?: string
}

function formatPopup(n: any): Popup {
  const data = n?.data || {}
  switch (n?.type) {
    case 'approval_created':
      return { title: 'New approval created', subtitle: data.title || data.clientName || '' }
    case 'approval_approved':
      return { title: 'Approval approved', subtitle: data.title || data.clientName || '' }
    case 'approval_mention':
      return { title: 'You were mentioned', subtitle: data.title || data.clientName || '' }
    default:
      return { title: 'New notification', subtitle: '' }
  }
}

export function NotificationPopupListener() {
  const supabase = createClient()
  const [popup, setPopup] = useState<Popup | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    audioRef.current = new Audio('/notifications.mp3')
  }, [])

  const playSound = () => {
    if (!audioRef.current) return
    try {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => {})
    } catch {}
  }

  useEffect(() => {
    const run = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

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
            const n = payload.new as any
            setPopup(formatPopup(n))
            playSound()

            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => setPopup(null), 10000)
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    const cleanupPromise = run()
    return () => {
      cleanupPromise?.then((cleanup) => cleanup && cleanup())
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [supabase])

  if (!popup) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] max-w-sm">
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-lg flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{popup.title}</p>
          {popup.subtitle && (
            <p className="text-xs text-gray-500 mt-1 truncate">{popup.subtitle}</p>
          )}
        </div>
        <button
          onClick={() => setPopup(null)}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}