// GET /api/capture/analytics?clientId=...&pageId=...
//
// Powers the "Advanced" view on the capture submissions tab.
// Aggregates capture_sessions (visit funnel + drop-off) and
// capture_submissions (most-chosen answers per option-style field).
//
// Returns:
//   - metrics:    { visits, submissions, conversionRate, uniqueVisitors,
//                   avgDurationSeconds }
//   - dropOffs:   per-field count of sessions that bounced on that field
//   - dailyVisits / dailySubmissions: arrays for the trend chart
//   - mostChosen: for each select/radio field, the option counts so the
//                 UI can render "Top answer" bar charts

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface PageRow {
  id: string
  client_id: string
  fields: Array<{ id: string; type: string; label: string; options?: string[] }> | null
}

interface SessionRow {
  id: string
  visitor_id: string
  started_at: string
  duration_seconds: number | null
  submitted: boolean
  last_field_id: string | null
}

interface SubmissionRow {
  data: Record<string, unknown> | null
  field_labels: Record<string, string> | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  const pageId = searchParams.get('pageId')
  if (!clientId || !pageId) {
    return NextResponse.json(
      { success: false, error: 'Missing clientId or pageId' },
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

  // Load the page to know its fields (needed for drop-off labels +
  // which fields are select/radio for most-chosen analysis).
  const { data: pageData, error: pageErr } = await admin
    .from('capture_pages')
    .select('id, client_id, fields')
    .eq('id', pageId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (pageErr || !pageData) {
    return NextResponse.json(
      { success: false, error: 'Capture page not found' },
      { status: 404 },
    )
  }

  const page = pageData as PageRow
  const fields = Array.isArray(page.fields) ? page.fields : []
  const labelById: Record<string, string> = {}
  for (const f of fields) {
    if (f?.id) labelById[String(f.id)] = String(f.label || f.id)
  }

  // Pull sessions + submissions in parallel - both are page-scoped
  // so neither query is expensive.
  const [sessionsRes, submissionsRes] = await Promise.all([
    admin
      .from('capture_sessions')
      .select('id, visitor_id, started_at, duration_seconds, submitted, last_field_id')
      .eq('capture_page_id', pageId),
    admin
      .from('capture_submissions')
      .select('data, field_labels, created_at')
      .eq('capture_page_id', pageId),
  ])

  const sessions = (sessionsRes.data ?? []) as SessionRow[]
  const submissions = (submissionsRes.data ?? []) as SubmissionRow[]

  // ----- Funnel metrics ---------------------------------------------
  const visits = sessions.length
  const submittedSessions = sessions.filter((s) => s.submitted)
  const submittedFromSessions = submittedSessions.length
  // Use the higher of the two counts: a submission can exist without a
  // session (e.g. visitor disabled localStorage) and a session can be
  // marked submitted=true. Submissions table is the source of truth for
  // total conversion volume.
  const totalSubmissions = Math.max(submissions.length, submittedFromSessions)
  const conversionRate = visits === 0 ? 0 : Math.round((totalSubmissions / visits) * 100)
  const uniqueVisitorIds = new Set(sessions.map((s) => s.visitor_id))
  const uniqueVisitors = uniqueVisitorIds.size
  // Visitor-level conversion: of the distinct people who landed on
  // the page, how many submitted. More resilient to refresh-spam +
  // bots than the visit-level rate above. We dedupe submitted
  // sessions by visitor_id so the same person hitting submit twice
  // (which our dedupe-leads logic catches anyway) doesn't double-count.
  const submittedVisitors = new Set(
    submittedSessions.map((s) => s.visitor_id),
  ).size
  const visitorConversionRate =
    uniqueVisitors === 0
      ? 0
      : Math.round((submittedVisitors / uniqueVisitors) * 100)

  const durations = sessions
    .map((s) => s.duration_seconds)
    .filter((d): d is number => typeof d === 'number' && d > 0)
  const avgDurationSeconds =
    durations.length === 0
      ? 0
      : Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)

  // ----- Drop-offs --------------------------------------------------
  // Sessions that didn't submit, grouped by last_field_id.
  const dropMap = new Map<string, number>()
  for (const s of sessions) {
    if (s.submitted) continue
    if (!s.last_field_id) continue
    dropMap.set(s.last_field_id, (dropMap.get(s.last_field_id) || 0) + 1)
  }
  const dropOffs = Array.from(dropMap.entries())
    .map(([fieldId, count]) => ({
      fieldId,
      label: labelById[fieldId] || fieldId,
      count,
    }))
    .sort((a, b) => b.count - a.count)

  // ----- Most-chosen answers ----------------------------------------
  // Only for select + radio fields (the ones with discrete options).
  // For text / textarea / etc we'd be aggregating free text, which
  // isn't useful as a "top answer" chart.
  const optionFields = fields.filter(
    (f) => (f.type === 'select' || f.type === 'radio') && Array.isArray(f.options),
  )

  const mostChosen = optionFields.map((f) => {
    const counts = new Map<string, number>()
    for (const sub of submissions) {
      const raw = sub.data?.[f.id]
      if (raw === null || raw === undefined) continue
      const val = String(raw).trim()
      if (!val) continue
      counts.set(val, (counts.get(val) || 0) + 1)
    }
    // Seed with zero for every defined option so the chart still
    // shows the full set even if no one picked them.
    for (const opt of f.options || []) {
      if (!counts.has(opt)) counts.set(opt, 0)
    }
    const totals = Array.from(counts.entries())
      .map(([option, count]) => ({ option, count }))
      .sort((a, b) => b.count - a.count)
    return {
      fieldId: f.id,
      label: f.label,
      type: f.type,
      total: totals.reduce((sum, t) => sum + t.count, 0),
      options: totals,
    }
  })

  // ----- Daily trend (last 30 days) ---------------------------------
  const trendDays = 30
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startOfRange = new Date(today)
  startOfRange.setDate(startOfRange.getDate() - (trendDays - 1))

  const dayBuckets = new Map<string, { visits: number; submissions: number }>()
  for (let i = 0; i < trendDays; i++) {
    const d = new Date(startOfRange)
    d.setDate(d.getDate() + i)
    dayBuckets.set(d.toISOString().slice(0, 10), { visits: 0, submissions: 0 })
  }

  for (const s of sessions) {
    const day = s.started_at.slice(0, 10)
    const bucket = dayBuckets.get(day)
    if (bucket) bucket.visits += 1
  }
  for (const sub of submissions) {
    const day = sub.created_at.slice(0, 10)
    const bucket = dayBuckets.get(day)
    if (bucket) bucket.submissions += 1
  }
  const dailyTrend = Array.from(dayBuckets.entries()).map(([date, c]) => ({
    date,
    visits: c.visits,
    submissions: c.submissions,
  }))

  return NextResponse.json({
    success: true,
    metrics: {
      visits,
      submissions: totalSubmissions,
      conversionRate,
      visitorConversionRate,
      uniqueVisitors,
      avgDurationSeconds,
    },
    dropOffs,
    mostChosen,
    dailyTrend,
  })
}
