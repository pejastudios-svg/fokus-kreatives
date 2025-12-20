'use client'

import { useState, useEffect } from 'react'
import { UserCircle, Bell } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface HeaderProps {
  title: string
  subtitle?: string
}

export function Header({ title, subtitle }: HeaderProps) {
  const [profilePicture, setProfilePicture] = useState<string | null>(null)
  const [userName, setUserName] = useState<string>('')
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userClientId, setUserClientId] = useState<string | null>(null)
  const supabase = createClient()

    interface NotificationRow {
    id: string
    type: string
    data: any
    read_at: string | null
    created_at: string
  }

  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [showNotif, setShowNotif] = useState(false)

  useEffect(() => {
    loadUserProfile()
  }, [])


  const router = useRouter()
  
  const loadUserProfile = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    const { data } = await supabase
      .from('users')
      .select('name, profile_picture_url, role, client_id')
      .eq('id', user.id)
      .single()

    if (data) {
      setUserName(data.name || '')
      setProfilePicture(data.profile_picture_url)
      setUserRole(data.role || null)
      setUserClientId(data.client_id || null)
    }
  }
}

    useEffect(() => {
    loadNotifications()
  }, [])

  const loadNotifications = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  setCurrentUserId(user.id) // IMPORTANT so realtime subscription starts

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)     // IMPORTANT: only this user's notifications
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Load notifications error:', error)
    return
  }

  const rows = (data || []) as NotificationRow[]
  setNotifications(rows)
  setUnreadCount(rows.filter(n => !n.read_at).length)
}

  useEffect(() => {
  if (!currentUserId) return

  const channel = supabase
    .channel(`notifications-${currentUserId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUserId}`,
      },
      payload => {
        console.log('Realtime: notification change', payload)
        // Just refresh notifications list silently
        loadNotifications()
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [supabase, currentUserId])

    const markAsRead = async (id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    )
    setUnreadCount(prev => Math.max(0, prev - 1))

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      console.error('Mark notification read error:', error)
    }
  }

    const formatNotificationText = (n: NotificationRow) => {
  const data = n.data || {}
  switch (n.type) {
    case 'task_created':
      return `Task created: ${data.title || ''}`
    case 'task_status_changed':
      return `Task "${data.title || ''}" moved to ${data.status || ''}`
    case 'task_mentioned':
      return `You were mentioned in a task`

    case 'approval_created':
      return `Approval created for ${data.clientName || 'client'}: ${
        data.title || ''
      }`

    case 'approval_approved':
      return `Approval approved for ${data.clientName || 'client'}: ${
        data.title || ''
      }`

      case 'approval_commented':
  return `New comment on ${data.clientName || 'client'} approval: ${data.title || ''}`

case 'approval_mention':
  return `You were mentioned in an approval: ${data.title || ''}`

case 'approval_reminder':
  return `Approval reminder: ${data.title || ''}`

    default:
      return 'Notification'
  }
}

  return (
    <header className="flex items-center justify-between h-20 px-8 bg-white border-b border-gray-200">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      
      <div className="flex items-center gap-4">
        {/* Notifications */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotif(prev => !prev)}
            className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <Bell className="h-5 w-5 text-gray-500" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotif && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50">
              <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">
                  Notifications
                </span>
                <button
                  type="button"
                  className="text-xs text-gray-400 hover:text-gray-600"
                  onClick={() => setShowNotif(false)}
                >
                  Close
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-gray-400">
                    No notifications yet.
                  </p>
                ) : (
                  notifications.map(n => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
  markAsRead(n.id)
  setShowNotif(false)

  const data = (n as any).data || {}

  // Task notifications (if you still use them)
  if (data.taskId) {
    router.push(`/tasks?taskId=${data.taskId}`)
    return
  }

  // Approval notifications
  if (
  n.type === 'approval_created' ||
  n.type === 'approval_approved' ||
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

  // Default: nothing special
}}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                        !n.read_at ? 'bg-blue-50/60' : ''
                      }`}
                    >
                      <p className="text-xs text-gray-800">
                        {formatNotificationText(n)}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {new Date(n.created_at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User */}
        <div className="flex items-center gap-3">
          {profilePicture ? (
            <img 
              src={profilePicture}
              alt={userName}
              className="h-10 w-10 rounded-full object-cover ring-2 ring-gray-200"
            />
          ) : (
            <div className="h-10 w-10 rounded-full bg-brand-gradient flex items-center justify-center">
              <UserCircle className="h-6 w-6 text-white" />
            </div>
          )}
          {userName && (
            <span className="text-sm font-medium text-gray-900">{userName}</span>
          )}
        </div>
      </div>
    </header>
  )
}