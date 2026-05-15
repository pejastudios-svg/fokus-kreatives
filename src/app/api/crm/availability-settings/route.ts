// GET / PUT /api/crm/availability-settings?clientId=...
//
// Per-CRM availability config used by the capture-page slot picker.
// Manager+ auth required so employees can't override scheduling.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

interface DayConfig {
  enabled: boolean
  startHour: number
  endHour: number
}

export interface AvailabilitySettings {
  timezone: string
  days: Record<DayKey, DayConfig>
}

function defaultSettings(): AvailabilitySettings {
  const days: Record<DayKey, DayConfig> = {
    mon: { enabled: true, startHour: 9, endHour: 17 },
    tue: { enabled: true, startHour: 9, endHour: 17 },
    wed: { enabled: true, startHour: 9, endHour: 17 },
    thu: { enabled: true, startHour: 9, endHour: 17 },
    fri: { enabled: true, startHour: 9, endHour: 17 },
    sat: { enabled: false, startHour: 9, endHour: 17 },
    sun: { enabled: false, startHour: 9, endHour: 17 },
  }
  return { timezone: 'UTC', days }
}

function normalize(input: unknown): AvailabilitySettings {
  const fallback = defaultSettings()
  if (!input || typeof input !== 'object') return fallback
  const obj = input as { timezone?: unknown; days?: unknown }
  const timezone =
    typeof obj.timezone === 'string' && obj.timezone.trim()
      ? obj.timezone
      : fallback.timezone
  const days = { ...fallback.days }
  if (obj.days && typeof obj.days === 'object') {
    const src = obj.days as Record<string, unknown>
    for (const k of DAY_KEYS) {
      const raw = src[k]
      if (!raw || typeof raw !== 'object') continue
      const cfg = raw as { enabled?: unknown; startHour?: unknown; endHour?: unknown }
      const startHour =
        typeof cfg.startHour === 'number' && cfg.startHour >= 0 && cfg.startHour <= 23
          ? Math.floor(cfg.startHour)
          : days[k].startHour
      const endHour =
        typeof cfg.endHour === 'number' && cfg.endHour >= 1 && cfg.endHour <= 24
          ? Math.floor(cfg.endHour)
          : days[k].endHour
      days[k] = {
        enabled: !!cfg.enabled,
        startHour,
        // endHour must be after startHour - guard against a bad save.
        endHour: endHour > startHour ? endHour : startHour + 1,
      }
    }
  }
  return { timezone, days }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'Missing clientId' },
      { status: 400 },
    )
  }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    )
  }

  const { data } = await admin
    .from('clients')
    .select('availability_settings')
    .eq('id', clientId)
    .maybeSingle()

  return NextResponse.json({
    success: true,
    settings: normalize(data?.availability_settings),
  })
}

export async function PUT(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'Missing clientId' },
      { status: 400 },
    )
  }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  const auth = await authorizeForClient(clientId, { level: 'manager' })
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad JSON' }, { status: 400 })
  }

  const settings = normalize((body as { settings?: unknown })?.settings)
  const { error } = await admin
    .from('clients')
    .update({ availability_settings: settings })
    .eq('id', clientId)

  if (error) {
    console.error('[availability-settings] update error:', error)
    return NextResponse.json(
      { success: false, error: 'Could not save settings' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, settings })
}
