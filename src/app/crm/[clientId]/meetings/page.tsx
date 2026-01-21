'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/Loading'
import {
  Plus,
  Calendar,
  Clock,
  Video,
  Link as LinkIcon,
  CheckCircle,
  XCircle,
  X,
} from 'lucide-react'

type Status = 'scheduled' | 'completed' | 'cancelled'
type LocationType = 'zoom' | 'google_meet' | 'jitsi' | 'custom'

interface Meeting {
  id: string
  client_id: string
  created_by: string | null
  title: string
  description: string | null
  date_time: string
  duration_minutes: number
  status: Status
  location_type: LocationType
  location_url: string | null
  created_at: string
}

export default function CRMMeetingsPage() {
  const params = useParams()
  // Fix: Cast params to Record<string, string> instead of any
  const clientId = ((params as Record<string, string>).clientid || (params as Record<string, string>).clientId) as string
  const supabase = createClient()

  const [isLoading, setIsLoading] = useState(true)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [statusFilter, setStatusFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming')
  const [showAddModal, setShowAddModal] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [meetingToDelete, setMeetingToDelete] = useState<Meeting | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState(30)
  const [mode, setMode] = useState<'schedule' | 'start_now'>('schedule')
  const [locationType, setLocationType] = useState<LocationType>('custom')
  const [locationUrl, setLocationUrl] = useState('')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)
  // Fix: Specific type instead of any
  const [notificationSettings, setNotificationSettings] = useState<{ meetings?: boolean }>({})

  // Fix: Wrap functions in useCallback to satisfy useEffect dependencies
  const loadUserAndClient = useCallback(async () => {
    // Current user for "to" address
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.email) {
      setUserEmail(user.email)
    }

    // Client info + notification settings
    const { data: client } = await supabase
      .from('clients')
      .select('name, business_name, notification_settings')
      .eq('id', clientId)
      .single()

    if (client) {
      setClientName(client.business_name || client.name || null)
      setNotificationSettings(client.notification_settings || {})
    }
  }, [clientId, supabase])

  const loadMeetings = useCallback(async () => {
    setIsLoading(true)

    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('client_id', clientId)
      .order('date_time', { ascending: true })

    if (error) {
      console.error('Failed to load meetings:', error)
      setIsLoading(false)
      return
    }

    setMeetings((data || []) as Meeting[])
    setIsLoading(false)
  }, [clientId, supabase])

  // Fix: Added dependencies to dependency array
  useEffect(() => {
    if (clientId) {
      loadMeetings()
      loadUserAndClient()
    }
  }, [clientId, loadMeetings, loadUserAndClient])

  const filteredMeetings = meetings.filter((m) => {
    const now = new Date()
    const dt = new Date(m.date_time)

    if (statusFilter === 'upcoming') {
      return m.status === 'scheduled' && dt >= now
    }
    if (statusFilter === 'past') {
      return dt < now || m.status !== 'scheduled'
    }
    return true
  })

  const handleAddMeeting = async () => {
  if (!title) return
  setIsSaving(true)

  try {
    // 1) Decide the meeting time based on mode
    let dateTime: Date

    if (mode === 'start_now') {
      // Start immediately
      dateTime = new Date()
    } else {
      // Schedule mode - require date & time
      if (!date || !time) {
        setIsSaving(false)
        return
      }
      dateTime = new Date(`${date}T${time}:00`)
    }

    // 2) Decide final location_url based on platform
    let finalLocationUrl: string | null = null

    if (locationType === 'custom') {
      // Use whatever URL user entered
      finalLocationUrl = locationUrl || null
    } else if (locationType === 'jitsi') {
      // Unique Jitsi room – clicking this starts/joins the call
      const safeTitle = (title || 'meeting')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
      finalLocationUrl = `https://meet.jit.si/fokus-${clientId}-${safeTitle}-${Date.now()}`
    } else if (locationType === 'zoom') {
      // Redirect to Zoom's schedule meeting page
      finalLocationUrl = 'https://zoom.us/meeting/schedule'
    } else if (locationType === 'google_meet') {
      // Redirect to Google Calendar new event (includes Meet)
      finalLocationUrl = 'https://meet.google.com/landing?pli=1'
    } else {
      // Fallback
      finalLocationUrl = locationUrl || null
    }

    // 3) Insert into Supabase
    const { data, error } = await supabase
      .from('meetings')
      .insert({
        client_id: clientId,
        title,
        description: description || null,
        date_time: dateTime.toISOString(),
        duration_minutes: duration,
        status: 'scheduled',
        location_type: locationType,
        location_url: finalLocationUrl,
      })
      .select()
      .single()

    // 4) Handle result
          if (error) {
        console.error('Failed to create meeting:', JSON.stringify(error, null, 2))
      } else if (data) {
        // Update local state/UI
        setMeetings((prev) => [...prev, data as Meeting])
        setShowAddModal(false)
        resetForm()

                // Fire-and-forget email notification (respect client settings)
        try {
          const meetingsEnabled =
            (notificationSettings && notificationSettings.meetings !== false)

          if (userEmail && meetingsEnabled) {
            const dt = new Date(data.date_time)
            const when = dt.toLocaleString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })

            await fetch('/api/notify-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'meeting_created',
                payload: {
                  to: userEmail,
                  title: data.title,
                  when,
                  link: data.location_url,
                  clientName: clientName || '',
                },
              }),
            })
          }
        } catch (notifyErr) {
          console.error('Failed to send meeting_created email', notifyErr)
        }
      }
  } catch (err) {
    console.error('Meeting create exception:', err)
  } finally {
    setIsSaving(false)
  }
}

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setDate('')
    setTime('')
    setDuration(30)
    setLocationType('custom')
    setLocationUrl('')
  }

  const handleStatusChange = async (id: string, status: Status) => {
    const prev = meetings
    setMeetings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status } : m))
    )

    const { error } = await supabase
      .from('meetings')
      .update({ status })
      .eq('id', id)

    if (error) {
      console.error('Failed to update meeting status:', error)
      setMeetings(prev) // rollback
    }
  }

  function MeetingsSkeleton() {
  return (
    <div className="p-6 lg:p-8 min-h-full animate-in fade-in">
      <div className="flex justify-between mb-6">
        <div>
          <Skeleton className="h-8 w-32 mb-2 bg-[#334155]" />
          <Skeleton className="h-4 w-48 bg-[#334155]" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg bg-[#334155]" />
      </div>

      <div className="flex gap-3 mb-6">
        <Skeleton className="h-8 w-24 rounded-full bg-[#334155]" />
        <Skeleton className="h-8 w-24 rounded-full bg-[#334155]" />
      </div>

      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-[#1E293B] rounded-2xl border border-[#334155] p-4 flex justify-between">
            <div className="flex gap-3">
              <Skeleton className="h-10 w-10 rounded-lg bg-[#334155]" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-48 bg-[#334155]" />
                <Skeleton className="h-4 w-32 bg-[#334155]" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Skeleton className="h-6 w-24 rounded-full bg-[#334155]" />
              <Skeleton className="h-4 w-16 bg-[#334155]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

  if (isLoading) {
    return <MeetingsSkeleton />
  }

  const handleDeleteMeeting = async () => {
  if (!meetingToDelete) return
  setIsDeleting(true)

  const id = meetingToDelete.id

  try {
    // Optimistic UI: remove from list immediately
    setMeetings(prev => prev.filter(m => m.id !== id))

    const { error } = await supabase
      .from('meetings')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Failed to delete meeting:', error)
      // Rollback if needed
      await loadMeetings()
    }
  } catch (err) {
    console.error('Delete meeting exception:', err)
    await loadMeetings()
  } finally {
    setIsDeleting(false)
    setMeetingToDelete(null)
  }
}

  return <div className="p-6 lg:p-8 min-h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Meetings</h1>
            <p className="text-gray-400 mt-1">
              See and schedule meetings for this client
            </p>
          </div>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Meeting
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setStatusFilter('upcoming')}
            className={`px-3 py-1.5 text-xs rounded-full ${
              statusFilter === 'upcoming'
                ? 'bg-[#2B79F7] text-white'
                : 'bg-[#1E293B] text-gray-400 hover:text-white'
            }`}
          >
            Upcoming
          </button>
          <button
            onClick={() => setStatusFilter('past')}
            className={`px-3 py-1.5 text-xs rounded-full ${
              statusFilter === 'past'
                ? 'bg-[#2B79F7] text-white'
                : 'bg-[#1E293B] text-gray-400 hover:text-white'
            }`}
          >
            Past
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 text-xs rounded-full ${
              statusFilter === 'all'
                ? 'bg-[#2B79F7] text-white'
                : 'bg-[#1E293B] text-gray-400 hover:text-white'
            }`}
          >
            All
          </button>
        </div>
        

        {/* Meetings List */}
        {filteredMeetings.length === 0 ? (
          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-8 text-center text-gray-400">
            <Calendar className="h-10 w-10 mx-auto mb-3 text-gray-500" />
            <p>No meetings found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMeetings.map((m) => {
              const dt = new Date(m.date_time)
              const dateStr = dt.toLocaleDateString()
              const timeStr = dt.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })

              return (
                <div
                  key={m.id}
                  className="bg-[#1E293B] rounded-2xl border border-[#334155] p-4 flex items-start justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-[#0F172A] text-[#2B79F7]">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        {m.title}
                      </h3>
                      <p className="text-xs text-gray-400 mt-1">
                        <span className="inline-flex items-center gap-1 mr-3">
                          <Clock className="h-3 w-3" />
                          {dateStr} at {timeStr} ({m.duration_minutes} min)
                        </span>
                        {m.location_type !== 'custom' && (
                          <span className="inline-flex items-center gap-1">
                            <Video className="h-3 w-3" />
                            {m.location_type === 'zoom'
                              ? 'Zoom'
                              : m.location_type === 'google_meet'
                              ? 'Google Meet'
                              : 'Jitsi'}
                          </span>
                        )}
                      </p>
                      {m.description && (
                        <p className="text-xs text-gray-400 mt-1">
                          {m.description}
                        </p>
                      )}
                      {m.location_url && (
                        <a
                          href={m.location_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[#2B79F7] hover:underline mt-1"
                        >
                          <LinkIcon className="h-3 w-3" />
                          Join link
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {/* Status */}
                    {m.status === 'scheduled' && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400">
                        <Clock className="h-3 w-3" />
                        Scheduled
                      </span>
                    )}
                    {m.status === 'completed' && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400">
                        <CheckCircle className="h-3 w-3" />
                        Completed
                      </span>
                    )}
                    {m.status === 'cancelled' && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400">
                        <XCircle className="h-3 w-3" />
                        Cancelled
                      </span>
                    )}

                    {/* Status change buttons */}
                    <div className="flex items-center gap-1 mt-1">
                      {m.status !== 'completed' && (
                        <button
                          onClick={() => handleStatusChange(m.id, 'completed')}
                          className="text-xs text-green-400 hover:text-green-300"
                        >
                          Mark done
                        </button>
                      )}
                      {m.status !== 'cancelled' && (
                        <button
                          onClick={() => handleStatusChange(m.id, 'cancelled')}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    {/* NEW: Delete button */}
<button
  onClick={() => setMeetingToDelete(m)}
  className="mt-1 text-xs text-gray-400 hover:text-red-400 hover:bg-red-500/10 px-2 py-1 rounded-lg transition-colors"
>
  Delete
</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Add Meeting Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
                <h3 className="text-lg font-semibold text-white">Add Meeting</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155] transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-4">
                <div className="flex items-center gap-2">
  <span className="text-xs font-medium text-gray-400">Mode:</span>
  <div className="inline-flex rounded-full bg-[#0F172A] border border-[#334155] p-1">
    <button
      type="button"
      onClick={() => setMode('schedule')}
      className={`px-3 py-1 text-xs rounded-full ${
        mode === 'schedule'
          ? 'bg-[#2B79F7] text-white'
          : 'text-gray-400 hover:text-white'
      }`}
    >
      Schedule
    </button>
    <button
      type="button"
      onClick={() => setMode('start_now')}
      className={`px-3 py-1 text-xs rounded-full ${
        mode === 'start_now'
          ? 'bg-[#2B79F7] text-white'
          : 'text-gray-400 hover:text-white'
      }`}
    >
      Start now
    </button>
  </div>
</div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Strategy call"
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Description (optional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this meeting about?"
                    rows={3}
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      Date
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full px-3 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      Time
                    </label>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full px-3 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={480}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value) || 30)}
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Location
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setLocationType('zoom')}
                      className={`px-3 py-2 text-xs rounded-lg border ${
                        locationType === 'zoom'
                          ? 'border-[#2B79F7] bg-[#2B79F7]/20 text-[#2B79F7]'
                          : 'border-[#334155] text-gray-300 hover:bg-[#1E293B]'
                      }`}
                    >
                      Zoom
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocationType('google_meet')}
                      className={`px-3 py-2 text-xs rounded-lg border ${
                        locationType === 'google_meet'
                          ? 'border-[#2B79F7] bg-[#2B79F7]/20 text-[#2B79F7]'
                          : 'border-[#334155] text-gray-300 hover:bg-[#1E293B]'
                      }`}
                    >
                      Google Meet
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocationType('jitsi')}
                      className={`px-3 py-2 text-xs rounded-lg border ${
                        locationType === 'jitsi'
                          ? 'border-[#2B79F7] bg-[#2B79F7]/20 text-[#2B79F7]'
                          : 'border-[#334155] text-gray-300 hover:bg-[#1E293B]'
                      }`}
                    >
                      Jitsi
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocationType('custom')}
                      className={`px-3 py-2 text-xs rounded-lg border ${
                        locationType === 'custom'
                          ? 'border-[#2B79F7] bg-[#2B79F7]/20 text-[#2B79F7]'
                          : 'border-[#334155] text-gray-300 hover:bg-[#1E293B]'
                      }`}
                    >
                      Custom link
                    </button>
                  </div>
                  {locationType === 'custom' && (
                    <input
                      type="url"
                      value={locationUrl}
                      onChange={(e) => setLocationUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#334155]">
                <Button
                  variant="outline"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddMeeting}
                  isLoading={isSaving}
                  disabled={!title || !date || !time}
                >
                  Save Meeting
                </Button>
              </div>
            </div>
          </div>
        )}
        {meetingToDelete && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-md shadow-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
        <h3 className="text-lg font-semibold text-white">Delete Meeting</h3>
        <button
          onClick={() => setMeetingToDelete(null)}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155] transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="px-6 py-4 space-y-3">
        <p className="text-sm text-gray-300">
          Are you sure you want to delete the meeting{' '}
          <span className="font-semibold text-white">
            &quot;{meetingToDelete.title}&quot;
          </span>
          ?
        </p>
        <p className="text-xs text-gray-500">
          This action cannot be undone.
        </p>
      </div>
      <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#334155]">
        <Button
          variant="outline"
          onClick={() => setMeetingToDelete(null)}
          disabled={isDeleting}
        >
          Cancel
        </Button>
        <Button
          onClick={handleDeleteMeeting}
          isLoading={isDeleting}
          className="bg-red-600 hover:bg-red-500"
        >
          Delete
        </Button>
      </div>
    </div>
  </div>
)}
      </div>
}