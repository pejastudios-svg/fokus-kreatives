'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
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
  Trash2,
  FileDown,
} from 'lucide-react'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { useCrmRole } from '@/components/crm/CrmRoleContext'
import type { MeetingsReportRow } from '@/components/reports/MeetingsReport'

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
  /** Which scheduling integration created this meeting (if any).
   *  Used so meetings booked via Calendly are labelled "Calendly"
   *  rather than falling through to the legacy "Jitsi" default. */
  integration_provider?: 'calendly' | 'google_meet' | 'zoom' | null
  created_at: string
  creator?: {
    id: string
    name: string | null
    email: string | null
    profile_picture_url: string | null
  } | null
}

export default function CRMMeetingsPage() {
  const params = useParams()
  // Fix: Cast params to Record<string, string> instead of any
  const clientId = ((params as Record<string, string>).clientid || (params as Record<string, string>).clientId) as string
  // ?focus=<meetingId> deep-link from the Inbox - target card pulses
  // + scrolls into view on mount.
  const searchParams = useSearchParams()
  const focusedMeetingId = searchParams?.get('focus') || null
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
      .select('*, creator:created_by(id, name, email, profile_picture_url)')
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

  // ---- PDF export -------------------------------------------------------

  const { workspaceName } = useCrmRole()
  const [isExporting, setIsExporting] = useState(false)

  const handleExportPdf = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const [{ pdf }, { MeetingsReport }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/MeetingsReport'),
      ])

      const now = Date.now()
      const weekMs = 7 * 24 * 60 * 60 * 1000
      let upcoming = 0
      let past = 0
      let thisWeek = 0
      const byStatus = { scheduled: 0, completed: 0, cancelled: 0 }
      for (const m of filteredMeetings) {
        const t = new Date(m.date_time).getTime()
        if (t >= now) upcoming++
        else past++
        if (Math.abs(t - now) <= weekMs) thisWeek++
        byStatus[m.status]++
      }

      // Sort chronologically (most recent / soonest first depending on tab).
      const sorted = [...filteredMeetings].sort((a, b) => {
        if (statusFilter === 'past') {
          return new Date(b.date_time).getTime() - new Date(a.date_time).getTime()
        }
        return new Date(a.date_time).getTime() - new Date(b.date_time).getTime()
      })

      const rows: MeetingsReportRow[] = sorted.map((m) => ({
        title: m.title,
        dateIso: m.date_time,
        durationMinutes: m.duration_minutes,
        locationType: m.location_type,
        status: m.status,
      }))

      const filters: string[] = [
        statusFilter === 'all'
          ? 'All meetings'
          : statusFilter === 'upcoming'
            ? 'Upcoming only'
            : 'Past only',
      ]

      const blob = await pdf(
        <MeetingsReport
          workspaceName={workspaceName}
          filters={filters}
          metrics={{
            total: filteredMeetings.length,
            upcoming,
            past,
            thisWeek,
          }}
          byStatus={byStatus}
          rows={rows}
        />,
      ).toBlob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      a.download = `${workspaceName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-meetings-${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      console.error('Meetings PDF export failed:', err)
      alert('Could not generate PDF. Check the console for details.')
    } finally {
      setIsExporting(false)
    }
  }

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

        // In-app notification to every CRM team member (separate from
        // the email above). Personal `notify_new_meeting` pref gates
        // it server-side. Fire-and-forget.
        void fetch('/api/notifications/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            type: 'meeting_created',
            data: {
              meetingTitle: data.title,
              dateTime: data.date_time,
              link: data.location_url,
              clientName: clientName || '',
            },
          }),
        }).catch((e) => console.error('in-app meeting notification failed:', e))
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
    <div className="p-3 sm:p-4 lg:p-6 min-h-full animate-in fade-in">
      <div className="flex items-center justify-between mb-4 gap-2">
        <Skeleton className="h-3 w-48 bg-[var(--bg-card-hover)]" />
        {/* Kebab only - Add Meeting now lives inside it. */}
        <Skeleton className="h-8 w-8 rounded-lg bg-[var(--bg-card-hover)]" />
      </div>

      <div className="flex gap-2 mb-4">
        <Skeleton className="h-7 w-20 rounded-full bg-[var(--bg-card-hover)]" />
        <Skeleton className="h-7 w-20 rounded-full bg-[var(--bg-card-hover)]" />
        <Skeleton className="h-7 w-12 rounded-full bg-[var(--bg-card-hover)]" />
      </div>

      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] p-4 flex justify-between gap-3">
            <div className="flex gap-3 min-w-0 flex-1">
              <Skeleton className="h-9 w-9 rounded-lg bg-[var(--bg-card-hover)] shrink-0" />
              <div className="space-y-2 min-w-0 flex-1">
                <Skeleton className="h-4 w-32 sm:w-48 bg-[var(--bg-card-hover)]" />
                <Skeleton className="h-3 w-24 sm:w-32 bg-[var(--bg-card-hover)]" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <Skeleton className="h-5 w-20 rounded-full bg-[var(--bg-card-hover)]" />
              <Skeleton className="h-3 w-12 bg-[var(--bg-card-hover)]" />
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

  return <div className="p-3 sm:p-4 lg:p-6 min-h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-2">
          <p className="text-xs text-[var(--text-tertiary)] truncate">See and schedule meetings for this client</p>
          <KebabMenu
            items={[
              {
                label: 'Add Meeting',
                icon: <Plus className="h-4 w-4" />,
                onClick: () => setShowAddModal(true),
              },
              {
                label: isExporting ? 'Generating PDF…' : 'Export as PDF',
                icon: <FileDown className="h-4 w-4" />,
                disabled: isExporting,
                onClick: handleExportPdf,
              },
            ]}
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
          {(['upcoming', 'past', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors shrink-0 ${
                statusFilter === f
                  ? 'bg-[#2B79F7] text-white'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Meetings List - single card with row dividers (no stack of giant
            cards). Each row keeps title + meta on the left, status + actions
            on the right, and collapses cleanly on mobile. */}
        {filteredMeetings.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] p-8 text-center text-[var(--text-tertiary)]">
            <Calendar className="h-10 w-10 mx-auto mb-3 text-[var(--text-tertiary)]" />
            <p className="text-sm">No meetings found.</p>
          </div>
        ) : (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] overflow-hidden divide-y divide-[var(--border-primary)]">
            {filteredMeetings.map((m) => {
              const dt = new Date(m.date_time)
              const dateStr = dt.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })
              const timeStr = dt.toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })

              const statusChip =
                m.status === 'completed' ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500">
                    <CheckCircle className="h-2.5 w-2.5" />
                    Done
                  </span>
                ) : m.status === 'cancelled' ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-500">
                    <XCircle className="h-2.5 w-2.5" />
                    Cancelled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#2B79F7]/15 text-[#2B79F7]">
                    <Clock className="h-2.5 w-2.5" />
                    Scheduled
                  </span>
                )

              return (
                <div
                  key={m.id}
                  ref={(el) => {
                    if (el && focusedMeetingId === m.id) {
                      el.classList.add('focus-pulse')
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      setTimeout(() => el.classList.remove('focus-pulse'), 3000)
                    }
                  }}
                  className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[#2B79F7] shrink-0">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                          {m.title}
                        </h3>
                        {statusChip}
                      </div>
                      <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {dateStr} · {timeStr} · {m.duration_minutes}m
                        </span>
                        {(m.location_type !== 'custom' || m.integration_provider) && (
                          <span className="inline-flex items-center gap-1">
                            <Video className="h-3 w-3" />
                            {m.location_type === 'zoom'
                              ? 'Zoom'
                              : m.location_type === 'google_meet'
                              ? 'Google Meet'
                              : m.location_type === 'jitsi'
                              ? 'Jitsi'
                              : m.integration_provider === 'calendly'
                              ? 'Calendly'
                              : m.integration_provider === 'google_meet'
                              ? 'Google Meet'
                              : m.integration_provider === 'zoom'
                              ? 'Zoom'
                              : 'Other'}
                          </span>
                        )}
                      </p>
                      {m.description && (
                        <p className="text-xs text-[var(--text-tertiary)] mt-1 line-clamp-2">
                          {m.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 flex-wrap mt-1.5">
                        {m.location_url && (
                          <a
                            href={m.location_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[#2B79F7] hover:underline"
                          >
                            <LinkIcon className="h-3 w-3" />
                            Join link
                          </a>
                        )}
                        {m.creator && (
                          <div className="inline-flex items-center gap-1.5">
                            {m.creator.profile_picture_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={m.creator.profile_picture_url}
                                alt={m.creator.name || m.creator.email || ''}
                                className="h-4 w-4 rounded-full object-cover"
                              />
                            ) : (
                              <div className="h-4 w-4 rounded-full bg-gradient-to-br from-[#2B79F7] to-[#1E54B7] text-white flex items-center justify-center text-[8px] font-semibold">
                                {(m.creator.name || m.creator.email || 'U').charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="text-[10px] text-[var(--text-tertiary)] truncate">
                              {m.creator.name || m.creator.email}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {m.status !== 'completed' && (
                      <button
                        onClick={() => handleStatusChange(m.id, 'completed')}
                        title="Mark done"
                        className="hidden sm:inline-flex p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-green-500 hover:bg-green-500/10 transition-colors"
                      >
                        <CheckCircle className="h-4 w-4" />
                      </button>
                    )}
                    {m.status !== 'cancelled' && (
                      <button
                        onClick={() => handleStatusChange(m.id, 'cancelled')}
                        title="Cancel"
                        className="hidden sm:inline-flex p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setMeetingToDelete(m)}
                      title="Delete"
                      className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
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
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Add Meeting</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-4">
                <div className="flex items-center gap-2">
  <span className="text-xs font-medium text-[var(--text-tertiary)]">Mode:</span>
  <div className="inline-flex rounded-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] p-1">
    <button
      type="button"
      onClick={() => setMode('schedule')}
      className={`px-3 py-1 text-xs rounded-full ${
        mode === 'schedule'
          ? 'bg-[#2B79F7] text-white'
          : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
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
          : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      Start now
    </button>
  </div>
</div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Strategy call"
                    className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Description (optional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this meeting about?"
                    rows={3}
                    className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                      Date
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full px-3 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                      Time
                    </label>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full px-3 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={480}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value) || 30)}
                    className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Location
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setLocationType('zoom')}
                      className={`px-3 py-2 text-xs rounded-lg border ${
                        locationType === 'zoom'
                          ? 'border-[#2B79F7] bg-[#2B79F7]/20 text-[#2B79F7]'
                          : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
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
                          : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
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
                          : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
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
                          : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
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
                      className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-primary)]">
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
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-none shadow-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Delete Meeting</h3>
        <button
          onClick={() => setMeetingToDelete(null)}
          className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="px-6 py-4 space-y-3">
        <p className="text-sm text-[var(--text-secondary)]">
          Are you sure you want to delete the meeting{' '}
          <span className="font-semibold text-[var(--text-primary)]">
            &quot;{meetingToDelete.title}&quot;
          </span>
          ?
        </p>
        <p className="text-xs text-[var(--text-tertiary)]">
          This action cannot be undone.
        </p>
      </div>
      <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-primary)]">
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