'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/Loading'
import {
  Users,
  UserCircle as UsersIcon,
  Calendar,
  Globe,
  ChevronRight,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react'
import {
  DonutChart,
  ChartLegend,
} from '@/components/charts/MiniCharts'
import {
  StatusStackedBar,
  StatusStackedArea,
  type SeriesDef,
  type ChartDatum,
} from '@/components/charts/StatusCharts'
import { BucketToggle } from '@/components/charts/BucketToggle'
import {
  bucketize,
  type BucketMode,
  type ChartEvent,
} from '@/lib/charts/bucketize'
import { StatusPill, TrendChip } from '@/components/ui/StatusPill'
import { CurrencyControl } from '@/components/crm/CurrencyControl'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { CombinedReportModal } from '@/components/reports/CombinedReportModal'
import type { CombinedReportRequest } from '@/components/reports/CombinedReportModal'
import { FileDown } from 'lucide-react'
import {
  useExchangeRates,
  convertAmountValue,
  getCurrencySymbol,
} from '@/hooks/useExchangeRates'
import { useDefaultCurrency } from '@/hooks/useDefaultCurrency'

/**
 * CRM dashboard. Reads from Supabase directly via the client helper since
 * the page is signed-in scoped (RLS keeps it to the right client).
 *
 * Metrics chosen to match what agencies actually track:
 *   - lead volume (KPI + 30-day bar chart)
 *   - meeting bookings (KPI + upcoming list)
 *   - pipeline / pending payments (KPI + recent list)
 *   - capture-page performance (top sources list)
 *   - active capture pages (KPI)
 *
 * Charts are inline SVG / Tailwind. No charting lib so the page weight
 * stays low and the visual style matches the rest of the app's design.
 */

interface LeadRow {
  id: string
  data: Record<string, unknown> | null
  created_at: string
  updated_at: string | null
}

interface MeetingRow {
  id: string
  title: string | null
  date_time: string
  duration_minutes?: number | null
}

interface PaymentRow {
  id: string
  amount: number | null
  currency: string | null
  status: string | null
  due_date: string | null
  paid_date: string | null
  created_at: string
}

interface CapturePageRow {
  id: string
  name: string | null
  slug: string | null
  is_active: boolean | null
}

interface CaptureSubmissionRow {
  capture_page_id: string | null
  created_at: string
}

interface TeamMember {
  user_id: string
  role: string
  user: {
    id: string
    name: string | null
    email: string
    profile_picture_url: string | null
  } | null
}

const DAYS = 30

// Stable color mapping for the standard pipeline statuses. Anything
// not in this map falls through to STATUS_PALETTE in index order so
// custom statuses still get a consistent (and distinct) color.
const STATUS_COLORS: Record<string, string> = {
  new: '#3B82F6',
  contacted: '#F59E0B',
  qualified: '#8B5CF6',
  proposal: '#EC4899',
  negotiation: '#F97316',
  closed: '#10B981',
  won: '#10B981',
  lost: '#EF4444',
}
const STATUS_PALETTE = [
  '#2B79F7',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#EF4444',
  '#F97316',
  '#94A3B8',
]
const STATUS_UNSET_COLOR = '#64748B'

function titleCase(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatCurrency(n: number, currency: string | null = 'USD') {
  if (!currency) {
    // No active display currency (mixed) - render a clean number with a
    // ~ prefix to hint that currencies haven't been unified.
    return `~${Math.round(n).toLocaleString()}`
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${Math.round(n).toLocaleString()}`
  }
}

export default function CRMDashboard() {
  const params = useParams()
  const clientId = (params?.clientId || params?.clientid) as string
  const supabase = useMemo(() => createClient(), [])

  const [isLoading, setIsLoading] = useState(true)
  const [clientName, setClientName] = useState<string>('')
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL')
  const [convertTo, setConvertTo] = useState<string | null>(null)
  const fx = useExchangeRates('USD')
  const { defaultCurrency, setDefaultCurrency } = useDefaultCurrency(clientId)
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [capturePages, setCapturePages] = useState<CapturePageRow[]>([])
  const [submissions, setSubmissions] = useState<CaptureSubmissionRow[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [bucketMode, setBucketMode] = useState<BucketMode>('day')
  const [showReportModal, setShowReportModal] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    void (async () => {
      setIsLoading(true)
      try {
        // Pull 2× the period so we have both the current window AND the
        // prior window for trend comparisons. The 1-day buffer keeps the
        // boundary day from being miscounted into both periods.
        const since = new Date()
        since.setDate(since.getDate() - 2 * DAYS - 1)

        const [
          clientRes,
          leadsRes,
          meetingsRes,
          paymentsRes,
          pagesRes,
          subsRes,
          teamRes,
        ] = await Promise.all([
          supabase.from('clients').select('name, business_name').eq('id', clientId).maybeSingle(),
          // Pull the most recent leads regardless of age - the
          // dashboard's "Recent leads" card needs them even if they're
          // months old. The 30-day bar chart filters by date itself
          // when it builds buckets.
          supabase
            .from('leads')
            .select('id, data, created_at, updated_at')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false })
            .limit(50),
          supabase
            .from('meetings')
            .select('id, title, date_time, duration_minutes')
            .eq('client_id', clientId)
            .gte('date_time', new Date().toISOString())
            .order('date_time', { ascending: true })
            .limit(20),
          supabase
            .from('payments')
            .select('id, amount, currency, status, due_date, paid_date, created_at')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false }),
          supabase
            .from('capture_pages')
            .select('id, name, slug, is_active')
            .eq('client_id', clientId),
          supabase
            .from('capture_submissions')
            .select('capture_page_id, created_at')
            .eq('client_id', clientId)
            .gte('created_at', since.toISOString()),
          // Team members come from the server route because the
          // browser join to `users` is blocked by RLS for managers /
          // CRM team members - that's why this card was rendering
          // empty before.
          fetch(`/api/crm/members?clientId=${encodeURIComponent(clientId)}`, {
            cache: 'no-store',
          }).then((r) => r.json()),
        ])

        if (cancelled) return
        const c = clientRes.data as { name: string | null; business_name: string | null } | null
        setClientName(c?.business_name || c?.name || 'Workspace')
        setLeads((leadsRes.data || []) as LeadRow[])
        setMeetings((meetingsRes.data || []) as MeetingRow[])
        setPayments((paymentsRes.data || []) as PaymentRow[])
        setCapturePages((pagesRes.data || []) as CapturePageRow[])
        setSubmissions((subsRes.data || []) as CaptureSubmissionRow[])

        type RouteMember = {
          id: string
          email: string
          name: string | null
          profile_picture_url: string | null
          role: string
        }
        const routeJson = teamRes as { success?: boolean; members?: RouteMember[] }
        const routeMembers: RouteMember[] = routeJson?.members || []
        setTeamMembers(
          routeMembers.map((u) => ({
            user_id: u.id,
            role: u.role,
            user: {
              id: u.id,
              name: u.name,
              email: u.email,
              profile_picture_url: u.profile_picture_url,
            },
          })),
        )
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, supabase])

  // ---- Derived stats ------------------------------------------------------

  // Lead chart. Bucketed via the shared bucketize helper, so the same
  // Day/Week/Month/All control toggles work the same way across pages.
  // Status order is discovered from the actual data, with "unset" as a
  // catch-all.
  const { leadsChartData, leadsChartSeries, leadsTotalInWindow } = useMemo<{
    leadsChartData: ChartDatum[]
    leadsChartSeries: SeriesDef[]
    leadsTotalInWindow: number
  }>(() => {
    const statusOrder: string[] = []
    const seen = new Set<string>()
    for (const l of leads) {
      const raw = (l.data as { status?: unknown } | null)?.status
      const key = typeof raw === 'string' && raw ? raw : 'unset'
      if (!seen.has(key)) {
        seen.add(key)
        statusOrder.push(key)
      }
    }
    if (statusOrder.length === 0) statusOrder.push('unset')

    const series: SeriesDef[] = statusOrder.map((s, i) => ({
      key: s,
      label: s === 'unset' ? 'Unset' : titleCase(s),
      color:
        s === 'unset'
          ? STATUS_UNSET_COLOR
          : STATUS_COLORS[s] || STATUS_PALETTE[i % STATUS_PALETTE.length],
    }))

    const events: ChartEvent[] = leads.map((l) => {
      const ref = l.updated_at || l.created_at
      const raw = (l.data as { status?: unknown } | null)?.status
      const sk = typeof raw === 'string' && raw ? raw : 'unset'
      const values: Record<string, number> = {}
      for (const s of series) values[s.key] = 0
      values[sk] = 1
      return { date: new Date(ref), values }
    })

    const { rows } = bucketize(events, {
      mode: bucketMode,
      seriesKeys: series.map((s) => s.key),
      windowDays: DAYS,
      windowWeeks: 12,
      windowMonths: 12,
    })
    const total = rows.reduce(
      (s, r) =>
        s +
        series.reduce(
          (ss, sd) =>
            ss + (typeof r[sd.key] === 'number' ? (r[sd.key] as number) : 0),
          0,
        ),
      0,
    )
    return {
      leadsChartData: rows,
      leadsChartSeries: series,
      leadsTotalInWindow: total,
    }
  }, [leads, bucketMode])

  // Period boundaries used by all the trend comparisons. "This period"
  // is the most recent DAYS days; "prior period" is the DAYS days before
  // that. Both are inclusive on the start side.
  const periodMs = DAYS * 24 * 60 * 60 * 1000
  const nowMs = Date.now()
  const thisPeriodStart = nowMs - periodMs
  const priorPeriodStart = nowMs - 2 * periodMs

  const leadsThisPeriod = leads.filter(
    (l) => new Date(l.created_at).getTime() >= thisPeriodStart,
  ).length
  const leadsPriorPeriod = leads.filter((l) => {
    const t = new Date(l.created_at).getTime()
    return t >= priorPeriodStart && t < thisPeriodStart
  }).length
  const leadsChange = pctChange(leadsThisPeriod, leadsPriorPeriod)

  const upcomingNext14 = meetings.filter((m) => {
    const t = new Date(m.date_time).getTime()
    return t >= Date.now() && t <= Date.now() + 14 * 24 * 60 * 60 * 1000
  })

  // Active currency resolution: explicit override -> single filtered
  // currency -> per-CRM default. Always non-null so totals always have
  // a currency to render in.
  const availableCurrencies = useMemo(() => {
    const set = new Set<string>()
    for (const p of payments) {
      if (p.currency) set.add(p.currency.toUpperCase())
    }
    return Array.from(set).sort()
  }, [payments])
  const displayCurrencyCode =
    convertTo || (currencyFilter !== 'ALL' ? currencyFilter : defaultCurrency)
  const unreachableCurrencies = availableCurrencies.filter((c) => !fx.rates[c])
  const conversionWarning =
    unreachableCurrencies.length > 0
      ? `No FX rate for ${unreachableCurrencies.join(', ')}. Those payments are shown in their original currency.`
      : null

  // Convert a payment amount into the active display currency. Falls
  // through to the original amount only when the specific row's rate
  // is missing (rare, surfaced as a warning above).
  const moneyOf = (p: { amount: number | null; currency: string | null }) => {
    const amt = Number(p.amount || 0)
    return convertAmountValue(amt, p.currency || 'USD', displayCurrencyCode, fx.rates)
  }

  // Filter payments by the active currency, then apply per-status sums.
  const visiblePayments = payments.filter(
    (p) =>
      currencyFilter === 'ALL' ||
      (p.currency || '').toUpperCase() === currencyFilter,
  )

  const pendingPayments = visiblePayments.filter(
    (p) => p.status === 'pending' || p.status === 'overdue',
  )
  const pendingTotal = pendingPayments.reduce((sum, p) => sum + moneyOf(p), 0)
  const paidThisMonth = useMemo(() => {
    const start = new Date()
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    return visiblePayments
      .filter((p) => p.status === 'paid' && new Date(p.created_at) >= start)
      .reduce((sum, p) => sum + moneyOf(p), 0)
    // moneyOf depends on convertTo + fx.rates; eslint can't see through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePayments, convertTo, fx.rates])

  // Period-over-period collected revenue. Uses paid_date if present,
  // otherwise falls back to created_at - covers older rows that may not
  // have a paid_date set.
  const collectedThisPeriod = visiblePayments
    .filter((p) => {
      if (p.status !== 'paid') return false
      const ref = new Date(p.paid_date || p.created_at).getTime()
      return ref >= thisPeriodStart
    })
    .reduce((s, p) => s + moneyOf(p), 0)
  const collectedPriorPeriod = visiblePayments
    .filter((p) => {
      if (p.status !== 'paid') return false
      const ref = new Date(p.paid_date || p.created_at).getTime()
      return ref >= priorPeriodStart && ref < thisPeriodStart
    })
    .reduce((s, p) => s + moneyOf(p), 0)
  const collectedChange = pctChange(collectedThisPeriod, collectedPriorPeriod)

  const activePages = capturePages.filter((p) => p.is_active).length

  // Revenue trend: amount per day per status (collected / pending /
  // overdue) over an auto-extending window. Auto-extends like the
  // leads chart so older invoices don't render as a flat baseline.
  const REVENUE_SERIES: SeriesDef[] = [
    { key: 'collected', label: 'Collected', color: '#10B981' },
    { key: 'pending', label: 'Pending', color: '#F59E0B' },
    { key: 'overdue', label: 'Overdue', color: '#EF4444' },
  ]
  const { revenueChartData, revenueTotalInWindow } = useMemo<{
    revenueChartData: ChartDatum[]
    revenueTotalInWindow: number
  }>(() => {
    const now = new Date()
    const events: ChartEvent[] = []
    for (const p of visiblePayments) {
      // paid    -> paid_date  (when money came in)
      // pending -> due_date   (when money is expected)
      // overdue -> today      (live exposure, not historical event)
      let ref: Date
      let isOverdue = false
      if (p.status === 'paid') {
        ref = new Date(p.paid_date || p.created_at)
      } else if (p.status === 'pending' || p.status === 'overdue') {
        isOverdue =
          p.status === 'overdue' ||
          (!!p.due_date && new Date(p.due_date) < now)
        ref = isOverdue ? now : new Date(p.due_date || p.created_at)
      } else {
        continue
      }
      const amt = moneyOf(p)
      const values: Record<string, number> = {
        collected: 0,
        pending: 0,
        overdue: 0,
      }
      if (p.status === 'paid') values.collected = amt
      else if (isOverdue) values.overdue = amt
      else values.pending = amt
      events.push({ date: ref, values })
    }
    const { rows } = bucketize(events, {
      mode: bucketMode,
      seriesKeys: ['collected', 'pending', 'overdue'],
      windowDays: DAYS,
      windowWeeks: 12,
      windowMonths: 12,
    })
    const total = rows.reduce(
      (s, r) =>
        s +
        (r.collected as number) +
        (r.pending as number) +
        (r.overdue as number),
      0,
    )
    return { revenueChartData: rows, revenueTotalInWindow: total }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePayments, convertTo, fx.rates, bucketMode])

  // Payments distribution: paid / pending / overdue counts.
  const paymentMix = useMemo(() => {
    const counts = { paid: 0, pending: 0, overdue: 0 }
    for (const p of visiblePayments) {
      if (p.status === 'paid') counts.paid++
      else if (p.status === 'overdue' || (p.status === 'pending' && p.due_date && new Date(p.due_date) < new Date())) {
        counts.overdue++
      } else if (p.status === 'pending') counts.pending++
    }
    return [
      { label: 'Paid', value: counts.paid, color: '#10B981' },
      { label: 'Pending', value: counts.pending, color: '#F59E0B' },
      { label: 'Overdue', value: counts.overdue, color: '#EF4444' },
    ]
  }, [visiblePayments])
  const paymentTotal = paymentMix.reduce((s, x) => s + x.value, 0)

  // Top capture pages by submission volume in the last 30 days.
  const topPages = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of submissions) {
      if (!s.capture_page_id) continue
      counts.set(s.capture_page_id, (counts.get(s.capture_page_id) || 0) + 1)
    }
    const total = submissions.length || 1
    const items = capturePages
      .map((p) => ({
        id: p.id,
        name: p.name || p.slug || 'Untitled',
        slug: p.slug || '',
        count: counts.get(p.id) || 0,
        pct: Math.round(((counts.get(p.id) || 0) / total) * 100),
      }))
      .sort((a, b) => b.count - a.count)
    return items.slice(0, 5)
  }, [submissions, capturePages])

  // ---- Combined-report generation -------------------------------------
  // The modal hands us a date range + selected sections; we refetch the
  // relevant rows scoped to that range, build per-section data, and
  // generate the multi-section PDF. Lives here (not in a hook) because
  // it needs the supabase client + every helper already in scope.

  const handleGenerateReport = async (req: CombinedReportRequest) => {
    try {
      const fromIso = req.fromIso || '1970-01-01'
      // Inclusive `to`: bump by a day so SQL "<" catches all of that day.
      const toExclusive = (() => {
        const d = new Date(req.toIso)
        d.setDate(d.getDate() + 1)
        return d.toISOString().slice(0, 10)
      })()
      const fromStartIso = new Date(fromIso).toISOString()
      const toEndIso = new Date(toExclusive).toISOString()
      const wantSet = new Set(req.sections)
      const generatedAtIso = new Date().toISOString()

      // Fan out the fetches we need. Skip queries for unwanted sections.
      const wantsRevenue = wantSet.has('revenue')
      const wantsLeads = wantSet.has('leads')
      const wantsMeetings = wantSet.has('meetings')
      const wantsCapture = wantSet.has('capture')
      const wantsTeam = wantSet.has('team')

      const [
        paymentsRes,
        leadsInRangeRes,
        leadsAllRes, // Needed for Revenue section's "outstanding now" too
        meetingsRes,
        pagesRes,
        subsRes,
        teamRes,
        invitesRes,
      ] = await Promise.all([
        wantsRevenue
          ? supabase
              .from('payments')
              .select('id, amount, currency, status, due_date, paid_date, created_at, lead_id, invoice_number, lead:leads(data)')
              .eq('client_id', clientId)
          : Promise.resolve({ data: [] }),
        wantsLeads
          ? supabase
              .from('leads')
              .select('id, data, created_at, updated_at')
              .eq('client_id', clientId)
              .gte('created_at', fromStartIso)
              .lt('created_at', toEndIso)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        wantsLeads
          ? supabase
              .from('leads')
              .select('id, data, created_at, updated_at')
              .eq('client_id', clientId)
              .order('created_at', { ascending: false })
              .limit(2000)
          : Promise.resolve({ data: [] }),
        wantsMeetings
          ? supabase
              .from('meetings')
              .select('id, title, date_time, duration_minutes, location_type, status')
              .eq('client_id', clientId)
              .gte('date_time', fromStartIso)
              .lt('date_time', toEndIso)
              .order('date_time', { ascending: false })
          : Promise.resolve({ data: [] }),
        wantsCapture
          ? supabase
              .from('capture_pages')
              .select('id, name, slug, is_active, created_at')
              .eq('client_id', clientId)
          : Promise.resolve({ data: [] }),
        wantsCapture
          ? supabase
              .from('capture_submissions')
              .select('id, capture_page_id, name, email, phone, created_at')
              .eq('client_id', clientId)
              .gte('created_at', fromStartIso)
              .lt('created_at', toEndIso)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        wantsTeam
          ? fetch(`/api/crm/members?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' }).then((r) => r.json())
          : Promise.resolve({ members: [] }),
        wantsTeam
          ? fetch(`/api/crm/team/invites?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' }).then((r) => r.json())
          : Promise.resolve({ invites: [] }),
      ])

      // Lazy-load the heavy PDF deps only when the user actually generates.
      const [{ pdf }, { CombinedReport }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/CombinedReport'),
      ])

      // Build each section's body props.
      const sections: Parameters<typeof CombinedReport>[0]['sections'] = {}

      if (wantsRevenue) {
        type Pmt = {
          id: string
          amount: number | null
          currency: string | null
          status: 'paid' | 'pending' | 'overdue' | 'cancelled'
          due_date: string | null
          paid_date: string | null
          created_at: string
          lead_id: string | null
          invoice_number: string | null
          lead?: { data: Record<string, unknown> } | { data: Record<string, unknown> }[] | null
        }
        const allPayments = (paymentsRes.data || []) as Pmt[]
        // Promote pending+past-due to overdue (matches revenue page).
        const now = new Date()
        const normalized = allPayments.map((p) => {
          if (p.status === 'pending' && p.due_date && new Date(p.due_date) < now) {
            return { ...p, status: 'overdue' as const }
          }
          return p
        })
        // Window membership: a payment "belongs" to the range if its
        // reference date (paid_date for paid, due_date for pending/
        // overdue, created_at fallback) falls inside.
        const fromMs = new Date(fromIso).getTime()
        const toMs = new Date(toExclusive).getTime()
        const inRange = normalized.filter((p) => {
          let ref: string
          if (p.status === 'paid') ref = p.paid_date || p.created_at
          else if (p.status === 'pending' || p.status === 'overdue')
            ref = p.due_date || p.created_at
          else return false
          const t = new Date(ref).getTime()
          return t >= fromMs && t < toMs
        })

        // Convert with the active display currency.
        const conv = (p: Pmt) =>
          convertAmountValue(Number(p.amount || 0), p.currency || 'USD', displayCurrencyCode, fx.rates)

        const byStatus = {
          paid: { count: 0, amount: 0 },
          pending: { count: 0, amount: 0 },
          overdue: { count: 0, amount: 0 },
          cancelled: { count: 0, amount: 0 },
        }
        for (const p of inRange) {
          byStatus[p.status].count++
          byStatus[p.status].amount += conv(p)
        }

        // Period-over-period delta: same window length, immediately prior.
        const windowMs = toMs - fromMs
        let priorCollected = 0
        for (const p of normalized) {
          if (p.status !== 'paid') continue
          const t = new Date(p.paid_date || p.created_at).getTime()
          if (t >= fromMs - windowMs && t < fromMs) priorCollected += conv(p)
        }
        const thisCollected = byStatus.paid.amount
        const delta =
          priorCollected === 0
            ? thisCollected === 0
              ? 0
              : 100
            : Math.round(((thisCollected - priorCollected) / priorCollected) * 100)

        // Outstanding / Overdue: snapshot of NOW, not in-range.
        let outstandingNow = 0
        let overdueNow = 0
        for (const p of normalized) {
          if (p.status === 'pending') outstandingNow += conv(p)
          else if (p.status === 'overdue') {
            outstandingNow += conv(p)
            overdueNow += conv(p)
          }
        }

        const rows = inRange
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 200) // cap so the PDF doesn't balloon
          .map((p) => {
            const lead = Array.isArray(p.lead) ? p.lead[0] : p.lead
            const data = (lead?.data || {}) as Record<string, string>
            const customer =
              data.name || data.email || (p.lead_id ? 'Linked lead' : 'Unassigned')
            return {
              invoiceNumber: p.invoice_number,
              customer,
              amountOriginal: Number(p.amount || 0),
              originalCurrency: (p.currency || displayCurrencyCode).toUpperCase(),
              status: p.status,
              dueDate: p.due_date,
              paidDate: p.paid_date,
            }
          })

        sections.revenue = {
          displayCurrency: displayCurrencyCode,
          metrics: { thisCollected, outstandingNow, overdueNow, delta },
          byStatus,
          rows,
        }
      }

      if (wantsLeads) {
        type LeadRowR = { id: string; data: Record<string, unknown>; created_at: string; updated_at: string | null }
        const leadsInWindow = (leadsInRangeRes.data || []) as LeadRowR[]

        // Discover statuses from the workspace's full leads list (so the
        // breakdown still shows colors / labels even if a status has 0
        // leads in the window). Falls back to a generic palette.
        const allLeads = (leadsAllRes.data || []) as LeadRowR[]
        const statusCounts = new Map<string, number>()
        let unsetCount = 0
        const closedHints = ['closed', 'won', 'paid']
        let closed = 0
        for (const l of leadsInWindow) {
          const raw = (l.data as { status?: unknown })?.status
          const sk = typeof raw === 'string' && raw ? raw : null
          if (sk == null) unsetCount++
          else {
            statusCounts.set(sk, (statusCounts.get(sk) || 0) + 1)
            if (closedHints.some((c) => sk.toLowerCase().includes(c))) closed++
          }
        }

        // Build status meta (label + color) by scanning the workspace's
        // leads for any color hints stored on the row (none in our schema)
        // - so fall back to a stable palette.
        const palette = ['#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#F97316', '#10B981', '#EF4444', '#06B6D4']
        const statusValues = Array.from(statusCounts.keys()).sort()
        const byStatus = statusValues.map((value, i) => ({
          value,
          label: value.charAt(0).toUpperCase() + value.slice(1),
          color: palette[i % palette.length],
          count: statusCounts.get(value) || 0,
        }))

        // Week deltas - relative to "now", not the range. Useful for the
        // last week of the workspace's life regardless of report range.
        const weekMs = 7 * 24 * 60 * 60 * 1000
        const nowMs = Date.now()
        const newThisWeek = allLeads.filter((l) => new Date(l.created_at).getTime() >= nowMs - weekMs).length
        const newPriorWeek = allLeads.filter((l) => {
          const t = new Date(l.created_at).getTime()
          return t < nowMs - weekMs && t >= nowMs - 2 * weekMs
        }).length
        const weekDelta =
          newPriorWeek === 0
            ? newThisWeek === 0
              ? 0
              : 100
            : Math.round(((newThisWeek - newPriorWeek) / newPriorWeek) * 100)

        const total = leadsInWindow.length
        const conversionPct = total === 0 ? 0 : Math.round((closed / total) * 100)

        const rows = leadsInWindow.slice(0, 200).map((l) => {
          const data = (l.data || {}) as Record<string, unknown>
          const name =
            (typeof data.name === 'string' && data.name) ||
            (typeof data.email === 'string' && data.email) ||
            'Unnamed lead'
          const email = typeof data.email === 'string' ? data.email : null
          const raw = data.status
          const statusValue = typeof raw === 'string' && raw ? raw : null
          return {
            name,
            email,
            statusValue,
            createdDate: l.created_at,
            updatedDate: l.updated_at,
          }
        })

        sections.leads = {
          metrics: { total, thisWeek: newThisWeek, weekDelta, closed, conversionPct },
          byStatus,
          unsetCount,
          rows,
        }
      }

      if (wantsMeetings) {
        type MtgRow = {
          id: string
          title: string
          date_time: string
          duration_minutes: number
          location_type: string
          status: 'scheduled' | 'completed' | 'cancelled'
        }
        const meetingsInWindow = (meetingsRes.data || []) as MtgRow[]
        const nowMs = Date.now()
        const weekMs = 7 * 24 * 60 * 60 * 1000
        let upcoming = 0
        let past = 0
        let thisWeek = 0
        const byStatus = { scheduled: 0, completed: 0, cancelled: 0 }
        for (const m of meetingsInWindow) {
          const t = new Date(m.date_time).getTime()
          if (t >= nowMs) upcoming++
          else past++
          if (Math.abs(t - nowMs) <= weekMs) thisWeek++
          byStatus[m.status]++
        }
        const sorted = [...meetingsInWindow].sort(
          (a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime(),
        )
        sections.meetings = {
          metrics: { total: meetingsInWindow.length, upcoming, past, thisWeek },
          byStatus,
          rows: sorted.slice(0, 200).map((m) => ({
            title: m.title,
            dateIso: m.date_time,
            durationMinutes: m.duration_minutes,
            locationType: m.location_type,
            status: m.status,
          })),
        }
      }

      if (wantsCapture) {
        type PageRow = { id: string; name: string; slug: string; is_active: boolean; created_at: string }
        type SubRow = {
          id: string
          capture_page_id: string
          name: string | null
          email: string | null
          phone: string | null
          created_at: string
        }
        const pagesAll = (pagesRes.data || []) as PageRow[]
        const subsInWindow = (subsRes.data || []) as SubRow[]
        const subsByPage = new Map<string, number>()
        for (const s of subsInWindow) {
          subsByPage.set(s.capture_page_id, (subsByPage.get(s.capture_page_id) || 0) + 1)
        }
        const nameById = new Map(pagesAll.map((p) => [p.id, p.name]))

        sections.capture = {
          metrics: {
            totalPages: pagesAll.length,
            activePages: pagesAll.filter((p) => p.is_active).length,
            totalSubmissions: subsInWindow.length,
            submissions30d: subsInWindow.filter(
              (s) => new Date(s.created_at).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000,
            ).length,
          },
          pages: pagesAll.map((p) => ({
            name: p.name,
            slug: p.slug,
            isActive: p.is_active,
            submissionCount: subsByPage.get(p.id) || 0,
            createdDate: p.created_at,
          })),
          submissions: subsInWindow.slice(0, 50).map((s) => ({
            pageName: nameById.get(s.capture_page_id) || '-',
            name: s.name,
            email: s.email,
            phone: s.phone,
            whenIso: s.created_at,
          })),
        }
      }

      if (wantsTeam) {
        type TeamMember = {
          id: string
          email: string
          name: string | null
          role: 'admin' | 'manager' | 'employee'
          created_at: string
        }
        type TeamInvite = {
          id: string
          email: string
          name: string | null
          role: 'admin' | 'manager' | 'employee'
          expires_at: string
          created_at: string
        }
        const teamMembers = (teamRes?.members || []) as TeamMember[]
        const teamInvites = (invitesRes?.invites || []) as TeamInvite[]
        const counts = { admins: 0, managers: 0, employees: 0 }
        for (const m of teamMembers) {
          if (m.role === 'admin') counts.admins++
          else if (m.role === 'manager') counts.managers++
          else if (m.role === 'employee') counts.employees++
        }
        sections.team = {
          metrics: {
            totalMembers: teamMembers.length,
            admins: counts.admins,
            managers: counts.managers,
            employees: counts.employees,
            pendingInvites: teamInvites.length,
          },
          members: teamMembers.map((m) => ({
            name: m.name || m.email,
            email: m.email,
            role: m.role,
            joinedDate: m.created_at,
          })),
          invites: teamInvites.map((inv) => ({
            name: inv.name || '',
            email: inv.email,
            role: inv.role,
            sentDate: inv.created_at,
            expiresDate: inv.expires_at,
          })),
          generatedAtMs: Date.now(),
        }
      }

      const blob = await pdf(
        <CombinedReport
          workspaceName={clientName || 'Workspace'}
          rangeLabel={req.rangeLabel}
          generatedAtIso={generatedAtIso}
          sections={sections}
        />,
      ).toBlob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      const safeName = (clientName || 'workspace').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      a.download = `${safeName}-report-${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setShowReportModal(false)
    } catch (err) {
      console.error('Combined report failed:', err)
      alert('Could not generate report. Check the console for details.')
    }
  }

  if (isLoading) return <DashboardSkeleton />

  const greeting = greetingForHour(new Date().getHours())

  // Health metrics for the system-metrics card. These are intentionally
  // approximate signals - they exist to telegraph "where is this CRM
  // healthy / unhealthy" at a glance, not to be canonical reports.
  const paidCount = paymentMix.find((m) => m.label === 'Paid')?.value || 0
  const overdueCount = paymentMix.find((m) => m.label === 'Overdue')?.value || 0
  const collectionRate = paymentTotal === 0 ? 0 : Math.round((paidCount / paymentTotal) * 100)
  const overdueRate = paymentTotal === 0 ? 0 : Math.round((overdueCount / paymentTotal) * 100)
  const pageHealth =
    capturePages.length === 0 ? 0 : Math.round((activePages / capturePages.length) * 100)

  return (
    <div className="font-[family-name:var(--font-plex-sans)] tabular-nums px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
      {/* Header: greeting on the left, currency control on the right (only
          shown when there's actually mixed-currency data to control). */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            {clientName}
          </h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            {greeting}. Here&rsquo;s the last {DAYS} days at a glance.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-start gap-1">
            <CurrencyControl
              available={availableCurrencies}
              filter={currencyFilter}
              onFilterChange={setCurrencyFilter}
              convertTo={convertTo}
              onConvertToChange={setConvertTo}
              defaultCurrency={defaultCurrency}
              onDefaultCurrencyChange={setDefaultCurrency}
              supportedTargets={Object.keys(fx.rates)}
              loading={fx.loading}
              date={fx.date}
              error={fx.error}
            />
            <KebabMenu
              items={[
                {
                  label: 'Generate report…',
                  icon: <FileDown className="h-4 w-4" />,
                  hint: 'Pick sections + date range',
                  onClick: () => setShowReportModal(true),
                },
              ]}
            />
          </div>
          {conversionWarning && (
            <p className="text-[11px] text-amber-500">{conversionWarning}</p>
          )}
        </div>
      </div>

      <CombinedReportModal
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
        onGenerate={handleGenerateReport}
      />

      {/* Single full-width column: KPIs, charts, activity, then a bottom
          row with leads + team. Page uses the entire viewport so the
          cards have room to stretch. */}
      <div className="space-y-4 sm:space-y-6">

      {/* KPI strip - flat, monochrome icon pucks (same neutral surface
          across all four cards). Trend chips are the only color signal. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <NeoKpi
          icon={Users}
          label="New leads"
          value={String(leadsThisPeriod)}
          sub={`Last ${DAYS} days`}
          change={leadsChange}
        />
        <NeoKpi
          icon={Calendar}
          label="Meetings"
          value={String(upcomingNext14.length)}
          sub="Next 14 days"
        />
        <NeoKpi
          label="Collected"
          value={formatCurrency(collectedThisPeriod, displayCurrencyCode)}
          sub={`Last ${DAYS} days`}
          change={collectedChange}
          symbolCurrency={displayCurrencyCode}
        />
        <NeoKpi
          icon={Globe}
          label="Active pages"
          value={String(activePages)}
          sub={`${capturePages.length} total`}
        />
      </div>

      {/* Chart row: leads + revenue (2/3) + payment donut (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <SoftCard className="lg:col-span-2 p-4 sm:p-5">
          <div className="flex items-start justify-between mb-3 sm:mb-4 gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Leads by status
              </h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">
                {leadsTotalInWindow} leads in window
              </p>
            </div>
            <BucketToggle value={bucketMode} onChange={setBucketMode} />
          </div>
          <StatusStackedBar
            data={leadsChartData}
            series={leadsChartSeries}
            height={220}
          />
          <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
            <div className="flex items-start justify-between mb-2 gap-3">
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-tertiary)]">
                  Revenue trend
                </p>
                <p className="text-base font-semibold text-[var(--text-primary)] tabular-nums mt-0.5">
                  {formatCurrency(revenueTotalInWindow, displayCurrencyCode)}
                </p>
              </div>
            </div>
            <StatusStackedArea
              data={revenueChartData}
              series={REVENUE_SERIES}
              height={180}
              formatValue={(n) => formatCurrency(n, displayCurrencyCode)}
              yAxisWidth={80}
            />
          </div>
        </SoftCard>

        <SoftCard className="p-4 sm:p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Invoice mix</h3>
            <Link
              href={`/crm/${clientId}/revenue`}
              className="text-[11px] text-[#2B79F7] hover:underline inline-flex items-center gap-0.5 font-medium"
            >
              Revenue <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {paymentTotal === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)] py-10 text-center flex-1 flex items-center justify-center">
              No invoices yet.
            </p>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-[260px]">
              <DonutChart
                data={paymentMix}
                size={220}
                thickness={22}
                centerLabel={String(paymentTotal)}
                centerSubLabel="invoices"
              />
              <div className="w-full">
                <ChartLegend items={paymentMix} />
              </div>
            </div>
          )}
        </SoftCard>
      </div>

      {/* Activity row: deployment-style recent activity (2/3) + system metrics (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <SoftCard className="lg:col-span-2 overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-[var(--border-primary)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#2B79F7]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Recent activity</h3>
            </div>
            <Link
              href={`/crm/${clientId}/leads`}
              className="text-[11px] text-[#2B79F7] hover:underline font-medium"
            >
              View all
            </Link>
          </div>
          {leads.length === 0 && upcomingNext14.length === 0 && pendingPayments.length === 0 ? (
            <div className="px-4 sm:px-5 py-10 text-center text-xs text-[var(--text-tertiary)]">
              Nothing here yet.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-primary)]">
              {/* Stitch the three streams into a single time-ordered feed. */}
              {[
                ...leads.slice(0, 4).map((l) => ({
                  kind: 'lead' as const,
                  id: l.id,
                  ts: l.created_at,
                  data: l.data,
                })),
                ...upcomingNext14.slice(0, 3).map((m) => ({
                  kind: 'meeting' as const,
                  id: m.id,
                  ts: m.date_time,
                  title: m.title,
                })),
                ...pendingPayments.slice(0, 3).map((p) => ({
                  kind: 'payment' as const,
                  id: p.id,
                  ts: p.due_date || p.created_at,
                  amount: p.amount,
                  currency: p.currency,
                  status: p.status,
                  due_date: p.due_date,
                })),
              ]
                .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
                .slice(0, 6)
                .map((row) => {
                  if (row.kind === 'lead') {
                    const data = row.data as { name?: string; email?: string; status?: string } | null
                    const name = data?.name || 'Unnamed lead'
                    const email = data?.email || ''
                    return (
                      <ActivityRow
                        key={`lead-${row.id}`}
                        avatarChar={name.charAt(0).toUpperCase()}
                        avatarTone="blue"
                        title={name}
                        subtitle={email || 'No email'}
                        meta={
                          <span className="font-[family-name:var(--font-plex-mono)] text-[10px] text-[var(--text-tertiary)]">
                            lead_{row.id.slice(0, 6)}
                          </span>
                        }
                        chip={<StatusPill tone="info">New lead</StatusPill>}
                        timeAgoText={timeAgo(row.ts)}
                      />
                    )
                  }
                  if (row.kind === 'meeting') {
                    const dt = new Date(row.ts)
                    return (
                      <ActivityRow
                        key={`meet-${row.id}`}
                        avatarChar="M"
                        avatarTone="violet"
                        title={row.title || 'Meeting'}
                        subtitle={`${dt.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })} at ${dt.toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}`}
                        meta={
                          <span className="font-[family-name:var(--font-plex-mono)] text-[10px] text-[var(--text-tertiary)]">
                            mtg_{row.id.slice(0, 6)}
                          </span>
                        }
                        chip={<StatusPill tone="pending" pulse>Scheduled</StatusPill>}
                        timeAgoText={timeAgo(row.ts)}
                      />
                    )
                  }
                  // payment
                  const overdue =
                    row.status === 'overdue' ||
                    (row.due_date != null && new Date(row.due_date) < new Date())
                  return (
                    <ActivityRow
                      key={`pay-${row.id}`}
                      avatarChar="$"
                      avatarTone={overdue ? 'red' : 'amber'}
                      title={formatCurrency(Number(row.amount || 0), row.currency || 'USD')}
                      subtitle={
                        row.due_date
                          ? `Due ${new Date(row.due_date).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}`
                          : 'No due date'
                      }
                      meta={
                        <span className="font-[family-name:var(--font-plex-mono)] text-[10px] text-[var(--text-tertiary)]">
                          inv_{row.id.slice(0, 6)}
                        </span>
                      }
                      chip={
                        overdue ? (
                          <StatusPill tone="danger">Overdue</StatusPill>
                        ) : (
                          <StatusPill tone="warning">Pending</StatusPill>
                        )
                      }
                      timeAgoText={timeAgo(row.ts)}
                    />
                  )
                })}
            </div>
          )}
        </SoftCard>

        {/* System metrics - progress bars for the CRM's overall health */}
        <SoftCard className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">CRM health</h3>
            </div>
            <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
              Last {DAYS}d
            </span>
          </div>
          <div className="space-y-4">
            <Metric
              label="Collection rate"
              value={`${collectionRate}%`}
              percent={collectionRate}
              color="#10B981"
            />
            <Metric
              label="Overdue invoices"
              value={`${overdueRate}%`}
              percent={overdueRate}
              color="#EF4444"
            />
            <Metric
              label="Active capture pages"
              value={`${pageHealth}%`}
              percent={pageHealth}
              color="#2B79F7"
            />
          </div>
          <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-2">
              Top capture pages
            </p>
            {topPages.length === 0 ? (
              <p className="text-[11px] text-[var(--text-tertiary)] py-2">No pages yet.</p>
            ) : (
              <ul className="space-y-2">
                {topPages.slice(0, 3).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate text-[var(--text-secondary)]">{p.name}</span>
                    <span className="font-[family-name:var(--font-plex-mono)] text-[var(--text-tertiary)] tabular-nums shrink-0">
                      {p.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SoftCard>
      </div>

          {/* Pending payments fallback - only shows if there are any and it
              isn't already represented in Recent activity. Kept compact. */}
        {pendingPayments.length === 0 && (
          <SoftCard className="p-4 sm:p-5 flex items-center justify-center gap-2 text-xs text-[var(--text-tertiary)]">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            All invoices are settled.
          </SoftCard>
        )}

        {/* Bottom row: leads (2/3) + team (1/3). Full-width and stretches
            with the page so the cards fill the available space. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
          <SoftCard className="lg:col-span-2 overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-[var(--border-primary)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[#2B79F7]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Recent leads</h3>
              </div>
              <Link
                href={`/crm/${clientId}/leads`}
                className="text-[11px] text-[#2B79F7] hover:underline font-medium"
              >
                View all
              </Link>
            </div>
            {leads.length === 0 ? (
              <div className="px-4 sm:px-5 py-10 text-center text-xs text-[var(--text-tertiary)]">
                No leads yet.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-primary)]">
                {leads.slice(0, 8).map((l) => {
                  const data = (l.data || {}) as {
                    name?: string
                    email?: string
                    status?: string
                    phone?: string
                  }
                  const name = data.name || 'Unnamed lead'
                  const subtitle = data.email || data.phone || timeAgo(l.created_at)
                  const status = (data.status || '').trim()
                  return (
                    <div key={l.id} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs font-semibold flex items-center justify-center shrink-0">
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {name}
                        </p>
                        <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                          {subtitle}
                        </p>
                      </div>
                      <span className="hidden sm:inline text-[10px] text-[var(--text-tertiary)] tabular-nums shrink-0">
                        {timeAgo(l.created_at)}
                      </span>
                      {status ? (
                        <StatusPill tone={leadStatusTone(status)}>{status}</StatusPill>
                      ) : (
                        <StatusPill tone="neutral">No status</StatusPill>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </SoftCard>

          <SoftCard className="overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-[var(--border-primary)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UsersIcon className="h-4 w-4 text-[#2B79F7]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Team</h3>
              </div>
              <Link
                href={`/crm/${clientId}/team`}
                className="text-[11px] text-[#2B79F7] hover:underline font-medium"
              >
                Manage
              </Link>
            </div>
            {teamMembers.length === 0 ? (
              <div className="px-4 sm:px-5 py-10 text-center text-xs text-[var(--text-tertiary)]">
                No team members yet.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-primary)]">
                {teamMembers.slice(0, 8).map((m) => {
                  const u = m.user
                  if (!u) return null
                  const display = u.name || u.email
                  const initial = (u.name || u.email || '?').charAt(0).toUpperCase()
                  return (
                    <div key={m.user_id} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                      {u.profile_picture_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.profile_picture_url}
                          alt={display}
                          className="h-9 w-9 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs font-semibold flex items-center justify-center shrink-0">
                          {initial}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {display}
                        </p>
                        <p className="text-[11px] text-[var(--text-tertiary)] truncate capitalize">
                          {m.role}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SoftCard>
        </div>
      </div>
    </div>
  )
}

// Map a free-form lead status string ("new", "qualified", "won", etc.) to
// one of the StatusPill tones so the chip color always reads correctly
// without per-client config.
function leadStatusTone(
  status: string,
): 'success' | 'pending' | 'warning' | 'danger' | 'info' | 'neutral' {
  const s = status.toLowerCase()
  if (s.includes('won') || s.includes('paid') || s.includes('closed')) return 'success'
  if (s.includes('qualified') || s.includes('hot') || s.includes('progress')) return 'pending'
  if (s.includes('warm') || s.includes('follow')) return 'warning'
  if (s.includes('lost') || s.includes('rejected') || s.includes('cancel')) return 'danger'
  if (s.includes('new') || s.includes('inbound')) return 'info'
  return 'neutral'
}

// ---------------------------------------------------------------------------
// Local presentational helpers - scoped to the dashboard so we can iterate
// the visual language here without leaking it to other pages.
// ---------------------------------------------------------------------------

// Soft card with the neumorphism-leaning shadow stack: a real drop shadow +
// inset top highlight. Reads "raised" in light mode, "subtle bevel" in dark.
function SoftCard({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] shadow-[0_2px_10px_rgb(0_0_0/0.04),inset_0_1px_0_rgb(255_255_255/0.05)] ${className}`}
    >
      {children}
    </div>
  )
}

// KPI card with the neumorphism dashboard reference layout: small soft icon
// puck top-left, trend chip top-right, label + giant tabular value below.
function NeoKpi({
  icon: Icon,
  label,
  value,
  sub,
  change,
  // When set, the puck shows this currency code's symbol (₦/€/$) in
  // place of the lucide icon. Used by money KPIs so the symbol stays
  // in sync with whatever the value is rendering in.
  symbolCurrency,
}: {
  icon?: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  change?: number
  symbolCurrency?: string
}) {
  const symbol = symbolCurrency ? getCurrencySymbol(symbolCurrency) : null
  return (
    <SoftCard className="p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl flex items-center justify-center bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
          {symbol ? (
            <span className="text-sm sm:text-base font-bold tabular-nums leading-none">
              {symbol}
            </span>
          ) : Icon ? (
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          ) : null}
        </div>
        {change !== undefined && <TrendChip change={change} />}
      </div>
      <p className="mt-3 text-[10px] sm:text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold truncate">
        {label}
      </p>
      <p className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] mt-0.5 tabular-nums truncate">
        {value}
      </p>
      {sub && (
        <p className="text-[10px] sm:text-[11px] text-[var(--text-tertiary)] mt-0.5 truncate">
          {sub}
        </p>
      )}
    </SoftCard>
  )
}

// Single row in the deployment-style activity feed.
function ActivityRow({
  avatarChar,
  title,
  subtitle,
  meta,
  chip,
  timeAgoText,
}: {
  avatarChar: string
  // Tone kept in the prop signature for back-compat at call sites but
  // intentionally unused - all activity-row avatars now share one neutral
  // surface so the StatusPill is the only color signal in the row.
  avatarTone?: 'blue' | 'violet' | 'amber' | 'red'
  title: string
  subtitle: string
  meta: React.ReactNode
  chip: React.ReactNode
  timeAgoText: string
}) {
  return (
    <div className="px-4 sm:px-5 py-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] flex items-center justify-center text-xs font-semibold shrink-0">
        {avatarChar}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{title}</p>
          {chip}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[11px] text-[var(--text-tertiary)] truncate">{subtitle}</p>
          <span className="text-[var(--text-tertiary)] text-[10px]">·</span>
          {meta}
        </div>
      </div>
      <span className="text-[10px] text-[var(--text-tertiary)] shrink-0 hidden sm:inline">
        {timeAgoText}
      </span>
    </div>
  )
}

// Progress-bar metric with label + percent.
function Metric({
  label,
  value,
  percent,
  color,
}: {
  label: string
  value: string
  percent: number
  color: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
        <span className="text-xs font-semibold text-[var(--text-primary)] tabular-nums">
          {value}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(Math.min(percent, 100), 2)}%`,
            background: color,
          }}
        />
      </div>
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

// Period-over-period percent change. Returns 0 when both numbers are 0,
// 100 when going from 0 → positive, -100 from positive → 0, or the
// rounded delta otherwise.
function pctChange(now: number, prior: number): number {
  if (prior === 0) {
    if (now === 0) return 0
    return 100
  }
  return Math.round(((now - prior) / prior) * 100)
}

function greetingForHour(h: number): string {
  if (h < 5) return 'Late night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Good night'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ============================================================================
// Skeleton
// ============================================================================

function DashboardSkeleton() {
  return (
    <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      <div>
        <Skeleton className="h-4 w-48 bg-[var(--bg-tertiary)] mb-1.5" />
        <Skeleton className="h-3 w-20 bg-[var(--bg-tertiary)]" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] sm:h-[108px] bg-[var(--bg-tertiary)] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <Skeleton className="h-44 sm:h-56 lg:col-span-2 bg-[var(--bg-tertiary)] rounded-xl" />
        <Skeleton className="h-44 sm:h-56 bg-[var(--bg-tertiary)] rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 sm:h-56 bg-[var(--bg-tertiary)] rounded-xl" />
        ))}
      </div>
    </div>
  )
}
