'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/Loading'
import {
  Plus,
  Calendar,
  CalendarDays,
  List,
  Clock,
  Video,
  Link as LinkIcon,
  CheckCircle,
  XCircle,
  X,
  Trash2,
  FileDown,
  AlertCircle,
} from 'lucide-react'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { useCrmRole } from '@/components/crm/CrmRoleContext'
import type { MeetingsReportRow } from '@/components/reports/MeetingsReport'
import { MeetingsCalendar } from '@/components/crm/MeetingsCalendar'
import { DateTimePicker } from '@/components/crm/DateTimePicker'
import { EmailChipsInput } from '@/components/crm/EmailChipsInput'
import { toast } from '@/components/ui/Toast'
import { buildCalendarMeta } from '@/lib/calendarLinks'
import { humanizeIntegrationError } from '@/lib/integrations/errorMessages'

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
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  // Meeting opened from a calendar pill - shows a details/actions sheet.
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null)
  // Meeting to ring when jumping from the list into the calendar.
  const [calendarFocusId, setCalendarFocusId] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState(30)
  // Attendee emails as chips, plus the recently-used list (persisted per
  // client) offered as one-tap suggestions in the Add modal.
  const [attendeeEmails, setAttendeeEmails] = useState<string[]>([])
  const [recentEmails, setRecentEmails] = useState<string[]>([])
  const [locationType, setLocationType] = useState<LocationType>('custom')
  const [locationUrl, setLocationUrl] = useState('')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)
  // Fix: Specific type instead of any
  const [notificationSettings, setNotificationSettings] = useState<{ meetings?: boolean }>({})

  // Fix: Wrap functions in useCallback to satisfy useEffect dependencies
  const loadUserAndClient = useCallback(async () => {
    // Recently-used attendee emails (persisted per client) for the Add modal.
    try {
      const stored = localStorage.getItem(`fk:recent-emails:${clientId}`)
      if (stored) setRecentEmails(JSON.parse(stored))
    } catch {
      /* ignore malformed / unavailable storage */
    }

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
      toast.error('Could not generate the PDF. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleAddMeeting = async () => {
    if (!title || !date || !time) return
    setIsSaving(true)

    try {
      const dateTime = new Date(`${date}T${time}:00`)
      const emails = attendeeEmails

      // Don't let the same slot get booked twice. Server enforces this too,
      // but checking here avoids spinning up a platform meeting for nothing.
      const slotTaken = meetings.some(
        (m) => m.status === 'scheduled' && new Date(m.date_time).getTime() === dateTime.getTime(),
      )
      if (slotTaken) {
        toast.error('You already have a meeting at that date and time. Pick a different slot.')
        return
      }

      // Create through the server so Google Meet / Zoom meetings are
      // actually provisioned on the connected platform (real link +
      // invites). Jitsi / custom links are stored as-is.
      const res = await fetch('/api/crm/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          title,
          description: description || null,
          startIso: dateTime.toISOString(),
          durationMinutes: duration,
          locationType,
          locationUrl: locationType === 'custom' ? locationUrl : null,
          attendeeEmails: emails,
        }),
      })
      // Read as text first so a non-JSON response (e.g. a 500 HTML error
      // page) still surfaces a useful message instead of "undefined".
      const raw = await res.text()
      let json: {
        success?: boolean
        error?: string
        meeting?: Meeting
        warning?: string | null
      } = {}
      try {
        json = raw ? JSON.parse(raw) : {}
      } catch {
        json = {}
      }

      if (!res.ok || !json.success) {
        const detail = json.error || (raw ? raw.slice(0, 300) : '') || `${res.status} ${res.statusText}`
        console.error('Failed to create meeting:', res.status, detail)
        toast.error(json.error || `Could not create the meeting (${res.status}).`)
        return
      }

      const data = json.meeting as Meeting
      setMeetings((prev) => [...prev, data])
      // Remember these recipients (most-recent first) for quick re-add later.
      if (emails.length) {
        setRecentEmails((prev) => {
          const merged = [...emails, ...prev.filter((e) => !emails.includes(e))].slice(0, 15)
          try {
            localStorage.setItem(`fk:recent-emails:${clientId}`, JSON.stringify(merged))
          } catch {
            /* ignore storage failures */
          }
          return merged
        })
      }
      setShowAddModal(false)
      resetForm()
      if (json.warning) toast.info(json.warning)
      else toast.success('Meeting created.')

      // Human-readable meeting time, reused for both the owner notification
      // and the attendee invites below.
      const when = new Date(data.date_time).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })

      // Friendly platform label + a calendar block (add-to-calendar buttons
      // and an .ics) the email templates render.
      const platformLabel =
        data.location_type === 'zoom'
          ? 'Zoom'
          : data.location_type === 'jitsi'
          ? 'Jitsi'
          : data.location_type === 'google_meet'
          ? 'Google Meet'
          : ''
      const endIso = new Date(
        new Date(data.date_time).getTime() + (data.duration_minutes || duration) * 60000,
      ).toISOString()
      const calendar = buildCalendarMeta({
        title: data.title,
        description: data.description || '',
        startIso: data.date_time,
        endIso,
        location: data.location_url || undefined,
      })

      // Notify the CRM user (respects their notification setting). This is
      // the team-facing "New Meeting Scheduled" template.
      try {
        const meetingsEnabled =
          notificationSettings && notificationSettings.meetings !== false

        if (userEmail && meetingsEnabled) {
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
                platform: platformLabel,
                calendar,
              },
            }),
          })
        }
      } catch (notifyErr) {
        console.error('Failed to send meeting_created email', notifyErr)
      }

      // Send each attendee the invitee-facing confirmation ("You're booked
      // in / Join meeting" + add-to-calendar), for any platform or custom
      // link. Google Meet already emails them Google's calendar invite with
      // the Meet link, so skip those to avoid a duplicate.
      const isGoogleInvite =
        data.location_type === 'google_meet' || data.integration_provider === 'google_meet'
      if (data.location_url && !isGoogleInvite) {
        for (const to of emails) {
          void fetch('/api/notify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'meeting_invitee_confirmation',
              payload: {
                to,
                title: data.title,
                when,
                link: data.location_url,
                clientName: clientName || '',
                platform: platformLabel,
                calendar,
              },
            }),
          }).catch((e) => console.error('attendee invite email failed:', e))
        }
      }

      // In-app notification to every CRM team member. Fire-and-forget.
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
    } catch (err) {
      console.error('Meeting create exception:', err)
      toast.error('Could not create the meeting. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  // Opens the Add modal pre-filled with a specific day (from the calendar
  // "+" button), defaulting the time to 9:00 AM.
  const openAddOnDate = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    setTime('09:00')
    setShowAddModal(true)
  }

  // Jump from a list row into the calendar with that meeting highlighted.
  const viewMeetingInCalendar = (m: Meeting) => {
    setCalendarFocusId(m.id)
    setViewMode('calendar')
  }

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setDate('')
    setTime('')
    setDuration(30)
    setAttendeeEmails([])
    setLocationType('custom')
    setLocationUrl('')
  }

  const handleStatusChange = async (id: string, status: Status) => {
    const prev = meetings
    // Optimistic update for both the list and any open details sheet.
    setMeetings((cur) => cur.map((m) => (m.id === id ? { ...m, status } : m)))
    setSelectedMeeting((sm) => (sm && sm.id === id ? { ...sm, status } : sm))

    try {
      // Route through the server so cancelling also cancels the meeting
      // on the external platform (Google / Zoom / Calendly).
      const res = await fetch(`/api/crm/meetings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json.success) {
        console.error('Failed to update meeting status:', json.error)
        setMeetings(prev) // rollback
        setSelectedMeeting((sm) => (sm && sm.id === id ? prev.find((m) => m.id === id) ?? sm : sm))
        toast.error(json.error || 'Could not update the meeting.')
      } else if (status === 'cancelled' && json.platformError) {
        // Local cancel succeeded but the platform call didn't - surface a
        // friendly, actionable reason so the user knows what to fix.
        console.warn('Meeting cancelled locally but platform cancel failed:', json.platformError)
        const provider = prev.find((m) => m.id === id)?.integration_provider ?? undefined
        toast.error(humanizeIntegrationError(json.platformError, provider))
      } else if (status === 'cancelled') {
        toast.success('Meeting cancelled.')
      } else if (status === 'completed') {
        toast.success('Meeting marked as done.')
      }
    } catch (err) {
      console.error('Status change exception:', err)
      setMeetings(prev) // rollback
      toast.error('Could not update the meeting.')
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

  const handleDeleteMeeting = () => {
    if (!meetingToDelete) return
    const meeting = meetingToDelete
    const id = meeting.id

    // Optimistic: remove from the list and close the modals immediately.
    // The delete + platform cancel happen in the background and only roll
    // back if the delete itself fails (a platform-cancel hiccup doesn't).
    setMeetings((cur) => cur.filter((m) => m.id !== id))
    setMeetingToDelete(null)
    setSelectedMeeting(null)

    void (async () => {
      try {
        const res = await fetch(`/api/crm/meetings/${id}`, { method: 'DELETE' })
        const json = await res.json().catch(() => ({}))

        if (!res.ok || !json.success) {
          console.error('Failed to delete meeting:', json.error)
          toast.error('Could not delete the meeting. Restored it.')
          await loadMeetings()
        } else if (json.platformError) {
          console.warn('Meeting deleted locally but platform cancel failed:', json.platformError)
          toast.error(
            humanizeIntegrationError(json.platformError, meeting.integration_provider ?? undefined),
          )
        } else {
          toast.success('Meeting deleted.')
        }
      } catch (err) {
        console.error('Delete meeting exception:', err)
        toast.error('Could not delete the meeting. Restored it.')
        await loadMeetings()
      }
    })()
}

  // Local YYYY-MM-DD for "today", used to block scheduling in the past.
  const _now = new Date()
  const todayYmd = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`
  const isPastDate = !!date && date < todayYmd
  // Conflict when the picked date + time exactly matches an existing
  // scheduled meeting. Surfaced inline in the modal before Save is pressed.
  const selectedSlot = date && time ? new Date(`${date}T${time}:00`) : null
  const slotConflict =
    !!selectedSlot &&
    !Number.isNaN(selectedSlot.getTime()) &&
    meetings.some(
      (m) => m.status === 'scheduled' && new Date(m.date_time).getTime() === selectedSlot.getTime(),
    )

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

        {/* View toggle + filters */}
        <div className="flex items-center justify-between gap-2 mb-4">
          {/* List / Calendar toggle */}
          <div className="inline-flex rounded-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] p-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                setViewMode('list')
                setCalendarFocusId(null)
              }}
              className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#2B79F7] text-white'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              List
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode('calendar')
                setCalendarFocusId(null)
              }}
              className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full transition-colors ${
                viewMode === 'calendar'
                  ? 'bg-[#2B79F7] text-white'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Calendar
            </button>
          </div>

          {/* Upcoming / Past / All - only meaningful in list view */}
          {viewMode === 'list' && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
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
          )}
        </div>

        {/* Calendar view - month grid populated by every meeting's date_time
            (not limited by the upcoming/past filter). Pills open the details
            sheet below. */}
        {viewMode === 'calendar' ? (
          meetings.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] p-8 text-center text-[var(--text-tertiary)]">
              <Calendar className="h-10 w-10 mx-auto mb-3 text-[var(--text-tertiary)]" />
              <p className="text-sm">No meetings found.</p>
              <div className="mt-4 flex justify-center">
                <Button onClick={() => setShowAddModal(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Meeting
                </Button>
              </div>
            </div>
          ) : (
            <MeetingsCalendar
              meetings={meetings}
              onSelectMeeting={setSelectedMeeting}
              onAddOnDate={openAddOnDate}
              focusMeetingId={calendarFocusId}
            />
          )
        ) : /* Meetings List - single card with row dividers (no stack of giant
            cards). Each row keeps title + meta on the left, status + actions
            on the right, and collapses cleanly on mobile. */
        filteredMeetings.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] p-8 text-center text-[var(--text-tertiary)]">
            <Calendar className="h-10 w-10 mx-auto mb-3 text-[var(--text-tertiary)]" />
            <p className="text-sm">No meetings found.</p>
            {statusFilter !== 'past' && (
              <div className="mt-4 flex justify-center">
                <Button onClick={() => setShowAddModal(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Meeting
                </Button>
              </div>
            )}
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
                    <button
                      onClick={() => viewMeetingInCalendar(m)}
                      title="View in calendar"
                      className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-[#2B79F7]/10 transition-colors"
                    >
                      <CalendarDays className="h-4 w-4" />
                    </button>
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
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-none">
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
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Date &amp; time
                  </label>
                  <DateTimePicker
                    date={date}
                    time={time}
                    onChange={({ date: d, time: t }) => {
                      setDate(d)
                      setTime(t)
                    }}
                  />
                  {slotConflict && (
                    <p className="text-[11px] text-amber-500 mt-1.5 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      You already have a meeting at this date and time. Pick a different slot.
                    </p>
                  )}
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
                    Attendee emails
                  </label>
                  <EmailChipsInput
                    value={attendeeEmails}
                    onChange={setAttendeeEmails}
                    recent={recentEmails}
                  />
                  {locationType === 'google_meet' && attendeeEmails.length === 0 ? (
                    <p className="text-[11px] text-amber-500 mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      Add at least one attendee email to create a Google Meet invite.
                    </p>
                  ) : (
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                      Press Enter to add each email. Google Meet needs at least one to send invites.
                    </p>
                  )}
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
                  {(locationType === 'google_meet' || locationType === 'zoom') && (
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                      We&apos;ll create this on your connected{' '}
                      {locationType === 'google_meet' ? 'Google Calendar' : 'Zoom'} account and
                      generate the real join link. Connect it first in Integrations if you
                      haven&apos;t.
                    </p>
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
                  disabled={
                    !title ||
                    !date ||
                    !time ||
                    isPastDate ||
                    slotConflict ||
                    (locationType === 'google_meet' && attendeeEmails.length === 0)
                  }
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
        >
          Cancel
        </Button>
        <Button
          onClick={handleDeleteMeeting}
          className="bg-red-600 hover:bg-red-500"
        >
          Delete
        </Button>
      </div>
    </div>
  </div>
)}
        {/* Meeting details sheet - opened from a calendar pill. Mirrors the
            inline list actions (mark done / cancel / delete) so the calendar
            view is fully actionable. */}
        {selectedMeeting && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedMeeting(null)}
          >
            <div
              className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] truncate pr-3">
                  {selectedMeeting.title}
                </h3>
                <button
                  onClick={() => setSelectedMeeting(null)}
                  className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-3">
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Clock className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
                  {new Date(selectedMeeting.date_time).toLocaleString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}{' '}
                  · {selectedMeeting.duration_minutes}m
                </div>
                <div>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      selectedMeeting.status === 'completed'
                        ? 'bg-green-500/15 text-green-500'
                        : selectedMeeting.status === 'cancelled'
                        ? 'bg-red-500/15 text-red-500'
                        : 'bg-[#2B79F7]/15 text-[#2B79F7]'
                    }`}
                  >
                    {selectedMeeting.status === 'completed'
                      ? 'Done'
                      : selectedMeeting.status === 'cancelled'
                      ? 'Cancelled'
                      : 'Scheduled'}
                  </span>
                </div>
                {selectedMeeting.description && (
                  <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                    {selectedMeeting.description}
                  </p>
                )}
                {selectedMeeting.location_url && (
                  <a
                    href={selectedMeeting.location_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-[#2B79F7] hover:underline"
                  >
                    <LinkIcon className="h-4 w-4" />
                    Join link
                  </a>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2 px-6 py-4 border-t border-[var(--border-primary)]">
                {selectedMeeting.status !== 'completed' && (
                  <Button
                    variant="outline"
                    onClick={() => handleStatusChange(selectedMeeting.id, 'completed')}
                  >
                    Mark done
                  </Button>
                )}
                {selectedMeeting.status !== 'cancelled' && (
                  <Button
                    variant="outline"
                    onClick={() => handleStatusChange(selectedMeeting.id, 'cancelled')}
                  >
                    Cancel meeting
                  </Button>
                )}
                <Button
                  onClick={() => {
                    setMeetingToDelete(selectedMeeting)
                    setSelectedMeeting(null)
                  }}
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