// GET /api/capture/availability?slug=...&date=YYYY-MM-DD
//
// Returns the list of bookable time slots for the host on the given
// date. Slot generation runs server-side because timezone math gets
// hairy on the client.
//
// The endpoint:
//   1. Resolves slug → page → client → availability_settings.
//   2. Looks up the host's working hours for the day-of-week in
//      THEIR timezone (e.g. "Tuesday 9 AM-5 PM in America/New_York").
//   3. Generates candidate slots at `meeting_duration_minutes`
//      intervals.
//   4. Subtracts:
//        a. Cancelled meetings - keep the slot.
//        b. Active meetings in our DB for this client.
//        c. Busy windows from the host's Google Calendar (when Google
//           Meet integration is connected) so meetings the host has
//           outside our app still block the slot.
//   5. Drops any slot that's already in the past.
//   6. Returns slots as ISO timestamps (UTC) - the client formats them
//      in the visitor's local timezone for display.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getConnectedGoogleIntegration } from '@/lib/integrations/googleTokenStore'
import { fetchGoogleFreeBusy } from '@/lib/integrations/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
const WEEKDAY: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

interface DayConfig {
  enabled: boolean
  startHour: number
  endHour: number
}

interface AvailabilitySettings {
  timezone: string
  days: Record<DayKey, DayConfig>
}

function defaultSettings(): AvailabilitySettings {
  const days: Record<DayKey, DayConfig> = {
    sun: { enabled: false, startHour: 9, endHour: 17 },
    mon: { enabled: true, startHour: 9, endHour: 17 },
    tue: { enabled: true, startHour: 9, endHour: 17 },
    wed: { enabled: true, startHour: 9, endHour: 17 },
    thu: { enabled: true, startHour: 9, endHour: 17 },
    fri: { enabled: true, startHour: 9, endHour: 17 },
    sat: { enabled: false, startHour: 9, endHour: 17 },
  }
  return { timezone: 'UTC', days }
}

function normalizeSettings(input: unknown): AvailabilitySettings {
  const fallback = defaultSettings()
  if (!input || typeof input !== 'object') return fallback
  const obj = input as { timezone?: unknown; days?: unknown }
  const tz =
    typeof obj.timezone === 'string' && obj.timezone.trim() ? obj.timezone : fallback.timezone
  const days = { ...fallback.days }
  if (obj.days && typeof obj.days === 'object') {
    const src = obj.days as Record<string, unknown>
    for (const k of WEEKDAY) {
      const raw = src[k]
      if (!raw || typeof raw !== 'object') continue
      const cfg = raw as { enabled?: unknown; startHour?: unknown; endHour?: unknown }
      const sh = typeof cfg.startHour === 'number' ? cfg.startHour : days[k].startHour
      const eh = typeof cfg.endHour === 'number' ? cfg.endHour : days[k].endHour
      days[k] = {
        enabled: !!cfg.enabled,
        startHour: Math.max(0, Math.min(23, Math.floor(sh))),
        endHour: Math.max(1, Math.min(24, Math.floor(eh))),
      }
    }
  }
  return { timezone: tz, days }
}

/** Compute the day-of-week (0=Sun..6=Sat) for the given YYYY-MM-DD
 *  as interpreted in the host's timezone. We format the date back to
 *  a weekday string in the target tz - the only reliable way without
 *  pulling in a tz library. */
function weekdayInTz(dateYmd: string, tz: string): DayKey {
  // Anchor at noon UTC so daylight-saving edges don't flip the day
  // when the tz offset is applied.
  const d = new Date(`${dateYmd}T12:00:00Z`)
  const weekdayName = d.toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).toLowerCase()
  // 'sun', 'mon', etc.
  const key = (weekdayName.slice(0, 3) as DayKey)
  return WEEKDAY.includes(key) ? key : 'mon'
}

/** Convert "host local YYYY-MM-DD HH:MM" to a UTC Date. Works by
 *  asking Intl.DateTimeFormat to spell out what that instant looks
 *  like in the target tz and adjusting until we hit the wanted clock.
 *  Avoids depending on a tz library for a small, predictable use. */
function hostLocalToUtc(
  dateYmd: string,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // Start from the desired wall-clock interpreted as UTC; the actual
  // tz offset is "wanted - what UTC midnight looks like in tz" away.
  const pad = (n: number) => n.toString().padStart(2, '0')
  const desiredYmd = dateYmd
  const desiredHm = `${pad(hour)}:${pad(minute)}`

  // First guess: treat the input as if it were UTC.
  let guess = new Date(`${desiredYmd}T${desiredHm}:00Z`)

  // Refine twice - one pass usually nails it, two covers DST edges.
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(guess)
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '0'
    const observedYmd = `${get('year')}-${get('month')}-${get('day')}`
    const observedHour = Number(get('hour') === '24' ? '00' : get('hour'))
    const observedMin = Number(get('minute'))

    // Compute drift in minutes between observed and desired.
    const desiredAbs = new Date(`${desiredYmd}T${desiredHm}:00Z`).getTime()
    const observedAbs = new Date(`${observedYmd}T${pad(observedHour)}:${pad(observedMin)}:00Z`).getTime()
    const drift = observedAbs - desiredAbs
    if (drift === 0) break
    guess = new Date(guess.getTime() - drift)
  }
  return guess
}

interface BusyWindow {
  start: number
  end: number
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')
  const date = searchParams.get('date')

  if (!slug || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { success: false, error: 'Missing slug or invalid date' },
      { status: 400 },
    )
  }

  const { data: page } = await admin
    .from('capture_pages')
    .select('client_id, meeting_integration, meeting_duration_minutes')
    .eq('slug', slug)
    .maybeSingle()
  if (!page) {
    return NextResponse.json(
      { success: false, error: 'Page not found' },
      { status: 404 },
    )
  }

  const { data: client } = await admin
    .from('clients')
    .select('availability_settings')
    .eq('id', page.client_id)
    .maybeSingle()

  const settings = normalizeSettings(client?.availability_settings)
  const duration =
    typeof page.meeting_duration_minutes === 'number' ? page.meeting_duration_minutes : 30

  // Day in host's tz: figure out which working-hours config to use,
  // and the host-local start/end for that date.
  const dayKey = weekdayInTz(date, settings.timezone)
  const dayCfg = settings.days[dayKey]

  if (!dayCfg.enabled) {
    return NextResponse.json({
      success: true,
      timezone: settings.timezone,
      slots: [],
      reason: 'day_off',
    })
  }

  const dayStartUtc = hostLocalToUtc(date, dayCfg.startHour, 0, settings.timezone)
  const dayEndUtc = hostLocalToUtc(date, dayCfg.endHour, 0, settings.timezone)

  // Pull busy windows.
  // (a) Our own meetings table for this client.
  const { data: meetings } = await admin
    .from('meetings')
    .select('date_time, duration_minutes, status')
    .eq('client_id', page.client_id)
    .neq('status', 'cancelled')
    .gte('date_time', new Date(dayStartUtc.getTime() - 4 * 60 * 60 * 1000).toISOString())
    .lt('date_time', new Date(dayEndUtc.getTime() + 4 * 60 * 60 * 1000).toISOString())

  const ourBusy: BusyWindow[] = (meetings ?? [])
    .map((m) => {
      const s = Date.parse(m.date_time)
      if (Number.isNaN(s)) return null
      const dur = typeof m.duration_minutes === 'number' && m.duration_minutes > 0 ? m.duration_minutes : 30
      return { start: s, end: s + dur * 60_000 }
    })
    .filter((b): b is BusyWindow => b !== null)

  // (b) Google Calendar freebusy when Google Meet integration is connected.
  // Skipped for Calendly (handled by Calendly) and missing tokens.
  let googleBusy: BusyWindow[] = []
  if (page.meeting_integration === 'google_meet') {
    const integration = await getConnectedGoogleIntegration(page.client_id)
    if (integration) {
      const fb = await fetchGoogleFreeBusy(
        integration.accessToken,
        dayStartUtc.toISOString(),
        dayEndUtc.toISOString(),
      )
      googleBusy = fb
        .map((b) => {
          const s = Date.parse(b.startIso)
          const e = Date.parse(b.endIso)
          if (Number.isNaN(s) || Number.isNaN(e)) return null
          return { start: s, end: e }
        })
        .filter((b): b is BusyWindow => b !== null)
    }
  }

  const busy = [...ourBusy, ...googleBusy]

  // Generate slots from start to (end - duration), stepped by duration.
  const slots: Array<{ startIso: string; endIso: string }> = []
  const stepMs = duration * 60_000
  const now = Date.now()
  for (
    let t = dayStartUtc.getTime();
    t + stepMs <= dayEndUtc.getTime();
    t += stepMs
  ) {
    if (t < now) continue
    const slotEnd = t + stepMs
    const overlapsBusy = busy.some((b) => b.start < slotEnd && b.end > t)
    if (overlapsBusy) continue
    slots.push({
      startIso: new Date(t).toISOString(),
      endIso: new Date(slotEnd).toISOString(),
    })
  }

  return NextResponse.json({
    success: true,
    timezone: settings.timezone,
    durationMinutes: duration,
    slots,
  })
}
