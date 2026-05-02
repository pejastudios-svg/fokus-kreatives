'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Loading'
import {
  Users,
  Calendar,
  DollarSign,
  Globe,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Clock,
  CheckCircle2,
} from 'lucide-react'

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

interface DayBucket {
  date: string // ISO yyyy-mm-dd
  count: number
}

const DAYS = 30

function formatCurrency(n: number, currency: string = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `$${Math.round(n).toLocaleString()}`
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Build an empty bucket array for the last `n` days, with today as the
 * rightmost slot. Caller fills counts in by isoDay key.
 */
function emptyDayBuckets(n: number): DayBucket[] {
  const out: DayBucket[] = []
  const today = startOfDay(new Date())
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push({ date: isoDay(d), count: 0 })
  }
  return out
}

export default function CRMDashboard() {
  const params = useParams()
  const clientId = (params?.clientId || params?.clientid) as string
  const supabase = useMemo(() => createClient(), [])

  const [isLoading, setIsLoading] = useState(true)
  const [clientName, setClientName] = useState<string>('')
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [capturePages, setCapturePages] = useState<CapturePageRow[]>([])
  const [submissions, setSubmissions] = useState<CaptureSubmissionRow[]>([])

  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    void (async () => {
      setIsLoading(true)
      try {
        const since = new Date()
        since.setDate(since.getDate() - DAYS - 1)

        const [
          clientRes,
          leadsRes,
          meetingsRes,
          paymentsRes,
          pagesRes,
          subsRes,
        ] = await Promise.all([
          supabase.from('clients').select('name, business_name').eq('id', clientId).maybeSingle(),
          supabase
            .from('leads')
            .select('id, data, created_at')
            .eq('client_id', clientId)
            .gte('created_at', since.toISOString())
            .order('created_at', { ascending: false }),
          supabase
            .from('meetings')
            .select('id, title, date_time, duration_minutes')
            .eq('client_id', clientId)
            .gte('date_time', new Date().toISOString())
            .order('date_time', { ascending: true })
            .limit(20),
          supabase
            .from('payments')
            .select('id, amount, currency, status, due_date, created_at')
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
        ])

        if (cancelled) return
        const c = clientRes.data as { name: string | null; business_name: string | null } | null
        setClientName(c?.business_name || c?.name || 'Workspace')
        setLeads((leadsRes.data || []) as LeadRow[])
        setMeetings((meetingsRes.data || []) as MeetingRow[])
        setPayments((paymentsRes.data || []) as PaymentRow[])
        setCapturePages((pagesRes.data || []) as CapturePageRow[])
        setSubmissions((subsRes.data || []) as CaptureSubmissionRow[])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, supabase])

  // ---- Derived stats ------------------------------------------------------

  const dailyLeadCounts = useMemo<DayBucket[]>(() => {
    const buckets = emptyDayBuckets(DAYS)
    const idx = new Map(buckets.map((b, i) => [b.date, i]))
    for (const l of leads) {
      const key = isoDay(new Date(l.created_at))
      const i = idx.get(key)
      if (i != null) buckets[i].count++
    }
    return buckets
  }, [leads])

  // Lead totals: this period vs prior period (used for the % change chip)
  const leadsThisPeriod = leads.filter(
    (l) =>
      new Date(l.created_at) >=
      new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000),
  ).length
  const leadsPriorPeriod = leads.length - leadsThisPeriod
  const leadsChange =
    leadsPriorPeriod === 0
      ? leadsThisPeriod === 0
        ? 0
        : 100
      : Math.round(((leadsThisPeriod - leadsPriorPeriod) / leadsPriorPeriod) * 100)

  const upcomingNext14 = meetings.filter((m) => {
    const t = new Date(m.date_time).getTime()
    return t >= Date.now() && t <= Date.now() + 14 * 24 * 60 * 60 * 1000
  })

  const pendingPayments = payments.filter((p) => p.status === 'pending' || p.status === 'overdue')
  const pendingTotal = pendingPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const paidThisMonth = useMemo(() => {
    const start = new Date()
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    return payments
      .filter((p) => p.status === 'paid' && new Date(p.created_at) >= start)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0)
  }, [payments])

  const activePages = capturePages.filter((p) => p.is_active).length

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

  if (isLoading) return <DashboardSkeleton />

  const greeting = greetingForHour(new Date().getHours())

  return (
    <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* Hero greeting */}
      <div>
        <p className="text-sm text-[var(--text-secondary)]">
          <span className="text-[var(--text-tertiary)]">{greeting},</span>{' '}
          <span className="font-semibold text-[var(--text-primary)]">{clientName}</span>
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
          Last {DAYS} days
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        <KpiCard
          icon={Users}
          label="New leads"
          value={String(leadsThisPeriod)}
          sub={`Last ${DAYS} days`}
          change={leadsChange}
        />
        <KpiCard
          icon={Calendar}
          label="Meetings"
          value={String(upcomingNext14.length)}
          sub="Booked next 14 days"
        />
        <KpiCard
          icon={DollarSign}
          label="Pending"
          value={pendingPayments.length === 0 ? '$0' : formatCurrency(pendingTotal)}
          sub={`${pendingPayments.length} invoice${pendingPayments.length === 1 ? '' : 's'}`}
        />
        <KpiCard
          icon={Globe}
          label="Active pages"
          value={String(activePages)}
          sub={`${capturePages.length} total`}
        />
      </div>

      {/* Chart row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <Card className="lg:col-span-2">
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Leads — last {DAYS} days
                </h3>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  {leadsThisPeriod} total · {formatCurrency(paidThisMonth)} paid this month
                </p>
              </div>
            </div>
            <BarChart data={dailyLeadCounts} />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Top capture pages</h3>
              <Link
                href={`/crm/${clientId}/capture`}
                className="text-xs text-[#2B79F7] hover:underline inline-flex items-center gap-0.5"
              >
                All <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {topPages.length === 0 ? (
              <p className="text-xs text-[var(--text-tertiary)] py-6 text-center">
                No capture pages yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {topPages.map((p) => (
                  <li key={p.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-[var(--text-primary)] truncate flex-1 min-w-0">
                        {p.name}
                      </span>
                      <span className="text-xs text-[var(--text-tertiary)] tabular-nums shrink-0">
                        {p.count}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#2B79F7] to-[#5A9AFF] rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(p.pct, 4)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lists row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        {/* Recent leads */}
        <Card>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Recent leads</h3>
              <Link
                href={`/crm/${clientId}/leads`}
                className="text-xs text-[#2B79F7] hover:underline inline-flex items-center gap-0.5"
              >
                View all <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {leads.length === 0 ? (
              <EmptyRow>No leads yet.</EmptyRow>
            ) : (
              <ul className="space-y-3">
                {leads.slice(0, 5).map((l) => {
                  const name = (l.data as { name?: string } | null)?.name || 'Unnamed lead'
                  const email = (l.data as { email?: string } | null)?.email || ''
                  return (
                    <li key={l.id} className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#2B79F7] to-[#1E54B7] text-white flex items-center justify-center text-xs font-semibold shrink-0">
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{name}</p>
                        <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                          {email || timeAgo(l.created_at)}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Upcoming meetings */}
        <Card>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming meetings</h3>
              <Link
                href={`/crm/${clientId}/meetings`}
                className="text-xs text-[#2B79F7] hover:underline inline-flex items-center gap-0.5"
              >
                View all <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {upcomingNext14.length === 0 ? (
              <EmptyRow>Nothing on the calendar.</EmptyRow>
            ) : (
              <ul className="space-y-3">
                {upcomingNext14.slice(0, 5).map((m) => {
                  const dt = new Date(m.date_time)
                  return (
                    <li key={m.id} className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-full bg-[var(--bg-tertiary)] text-[#2B79F7] flex items-center justify-center shrink-0">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {m.title || 'Meeting'}
                        </p>
                        <p className="text-[11px] text-[var(--text-tertiary)]">
                          {dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ·{' '}
                          {dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Pending payments */}
        <Card>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Pending payments</h3>
              <Link
                href={`/crm/${clientId}/revenue`}
                className="text-xs text-[#2B79F7] hover:underline inline-flex items-center gap-0.5"
              >
                Revenue <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {pendingPayments.length === 0 ? (
              <EmptyRow>
                <CheckCircle2 className="h-4 w-4 text-green-500 inline mr-1" />
                All clear.
              </EmptyRow>
            ) : (
              <ul className="space-y-3">
                {pendingPayments.slice(0, 5).map((p) => {
                  const overdue =
                    p.status === 'overdue' ||
                    (p.due_date != null && new Date(p.due_date) < new Date())
                  return (
                    <li key={p.id} className="flex items-start gap-3">
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                          overdue
                            ? 'bg-red-500/15 text-red-500'
                            : 'bg-orange-500/15 text-orange-500'
                        }`}
                      >
                        <DollarSign className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {formatCurrency(Number(p.amount || 0), p.currency || 'USD')}
                        </p>
                        <p className="text-[11px] text-[var(--text-tertiary)]">
                          {p.due_date
                            ? `Due ${new Date(p.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                            : 'No due date'}
                          {overdue && ' · overdue'}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  change,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  change?: number
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-[var(--bg-tertiary)] text-[#2B79F7] flex items-center justify-center">
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </div>
          {change !== undefined && change !== 0 && (
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                change > 0
                  ? 'bg-green-500/15 text-green-500'
                  : 'bg-red-500/15 text-red-500'
              }`}
            >
              {change > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(change)}%
            </span>
          )}
        </div>
        <p className="mt-2 sm:mt-3 text-[10px] sm:text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold truncate">
          {label}
        </p>
        <p className="text-lg sm:text-2xl font-bold text-[var(--text-primary)] mt-1 tabular-nums truncate">{value}</p>
        {sub && <p className="text-[10px] sm:text-[11px] text-[var(--text-tertiary)] mt-0.5 truncate">{sub}</p>}
      </CardContent>
    </Card>
  )
}

/**
 * Tiny inline-SVG bar chart. One bar per day, height proportional to the
 * day's count vs the max in the window. Today's bar is highlighted.
 *
 * Returns the SVG and the date labels as siblings (no wrapping div with a
 * fixed height) so the labels render in normal document flow inside the
 * parent CardContent and don't overflow below the card.
 */
function BarChart({ data }: { data: DayBucket[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const w = 100 / data.length
  return (
    <>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="block w-full h-28"
      >
        {data.map((d, i) => {
          const h = (d.count / max) * 90
          const x = i * w
          const y = 100 - h
          const isToday = i === data.length - 1
          return (
            <rect
              key={d.date}
              x={x + w * 0.15}
              y={y}
              width={w * 0.7}
              height={h}
              rx={1}
              fill={isToday ? '#2B79F7' : 'rgba(43, 121, 247, 0.35)'}
            >
              <title>
                {new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: {d.count}
              </title>
            </rect>
          )
        })}
      </svg>
      <div className="flex justify-between mt-2 text-[10px] text-[var(--text-tertiary)]">
        <span>
          {new Date(data[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
        <span>Today</span>
      </div>
    </>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-[var(--text-tertiary)] py-6 text-center">{children}</p>
  )
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
