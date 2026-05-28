'use client'

// "Advanced" view for a single capture page. Fetched on demand from
// /api/capture/analytics and rendered when the user expands the
// Advanced panel from the Submissions tab.
//
// Surfaces:
//   - Funnel metrics (visits, submissions, conversion, unique
//     visitors, avg duration)
//   - 30-day trend chart (visits + submissions)
//   - Drop-off bar (which field people bounced from)
//   - Most-chosen answers per select/radio field
//
// Heavy components (Recharts) are imported normally - they're loaded
// only when the Advanced panel mounts.

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Loading'
import { Tooltip as InfoTooltip } from '@/components/ui/Tooltip'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  Cell,
} from 'recharts'
import {
  Users,
  CheckCircle2,
  TrendingUp,
  Timer,
  Eye,
  AlertCircle,
  UserCheck,
  Info,
} from 'lucide-react'

interface Metrics {
  visits: number
  submissions: number
  conversionRate: number
  /** Per-unique-visitor conversion. Different from conversionRate
   *  (per-visit) because the same person reloading 5 times still
   *  counts as one visitor. More resilient to refresh / bot noise. */
  visitorConversionRate: number
  uniqueVisitors: number
  avgDurationSeconds: number
}

interface DropOff {
  fieldId: string
  label: string
  count: number
}

interface MostChosenField {
  fieldId: string
  label: string
  type: string
  total: number
  options: Array<{ option: string; count: number }>
}

interface DailyTrendPoint {
  date: string
  visits: number
  submissions: number
}

interface AnalyticsResponse {
  success: boolean
  error?: string
  metrics?: Metrics
  dropOffs?: DropOff[]
  mostChosen?: MostChosenField[]
  dailyTrend?: DailyTrendPoint[]
}

interface Props {
  clientId: string
  pageId: string
  /** Bump from the parent to force a refetch (e.g. after a submission
   *  delete or an analytics reset changes the underlying sessions). */
  refreshKey?: number
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '–'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function CaptureAdvancedAnalytics({ clientId, pageId, refreshKey }: Props) {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Cancel guard so a fast page switch can't write stale data on
    // top of the newer fetch.
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate reset on deps change
    setLoading(true)
    setError(null)
    fetch(
      `/api/capture/analytics?clientId=${encodeURIComponent(clientId)}&pageId=${encodeURIComponent(pageId)}`,
      { cache: 'no-store' },
    )
      .then((r) => r.json())
      .then((d: AnalyticsResponse) => {
        if (cancelled) return
        if (!d.success) {
          setError(d.error || 'Failed to load analytics')
          setData(null)
        } else {
          setData(d)
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[analytics] fetch error:', err)
        setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [clientId, pageId, refreshKey])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl bg-[var(--bg-card-hover)]" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl bg-[var(--bg-card-hover)]" />
        <Skeleton className="h-64 rounded-xl bg-[var(--bg-card-hover)]" />
      </div>
    )
  }

  if (error || !data?.metrics) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--text-tertiary)]">
          {error || 'No analytics yet for this page.'}
        </CardContent>
      </Card>
    )
  }

  const { metrics, dropOffs = [], mostChosen = [], dailyTrend = [] } = data

  return (
    <div className="space-y-5">
      {/* Top metrics. Six tiles: visits + uniques + submissions are
          volume; visit-conv + visitor-conv + avg time are quality.
          Grid steps up to 6 cols on large screens; falls to 3x2 on
          medium and 2x3 on mobile so nothing wraps awkwardly. Each
          tile has an "i" icon with a plain-English explanation. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricTile
          icon={<Eye className="h-4 w-4 text-[#2B79F7]" />}
          label="Visits"
          value={metrics.visits ?? 0}
          hint="How many times your page was opened. If one person opens it 3 times, that's 3 visits."
        />
        <MetricTile
          icon={<Users className="h-4 w-4 text-amber-500" />}
          label="Unique visitors"
          value={metrics.uniqueVisitors ?? 0}
          hint="How many different people opened your page. One person reloading the page only counts once."
        />
        <MetricTile
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Submissions"
          value={metrics.submissions ?? 0}
          hint="How many people filled out the form and sent it."
        />
        <MetricTile
          icon={<TrendingUp className="h-4 w-4 text-purple-500" />}
          label="Per-visit conv"
          value={`${metrics.conversionRate ?? 0}%`}
          hint="Out of every page view, how often someone sent the form. Example: 10 visits, 1 submission = 10%."
        />
        <MetricTile
          icon={<UserCheck className="h-4 w-4 text-rose-500" />}
          label="Per-visitor conv"
          value={`${metrics.visitorConversionRate ?? 0}%`}
          hint="Out of the different people who saw your page, how many sent the form. Doesn't count the same person reloading - usually the truer number."
        />
        <MetricTile
          icon={<Timer className="h-4 w-4 text-cyan-500" />}
          label="Avg time"
          value={formatDuration(metrics.avgDurationSeconds ?? 0)}
          hint="Average time visitors spent on your page before submitting or leaving."
        />
      </div>

      {/* 30-day visits/submissions trend */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <SectionTitle
            title="Last 30 days"
            hint="Visits and submissions for each of the last 30 days. Spot which days bring you the most traffic and the most form sends - then plan posts and ads around them."
          />
          <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#2B79F7]" /> Visits
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Submissions
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrend}>
                <defs>
                  <linearGradient id="visitsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2B79F7" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#2B79F7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="subsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDayLabel}
                  tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                  stroke="var(--border-primary)"
                  interval="preserveStartEnd"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                  stroke="var(--border-primary)"
                  width={28}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(v) => formatDayLabel(String(v))}
                />
                <Area
                  type="monotone"
                  dataKey="visits"
                  stroke="#2B79F7"
                  fill="url(#visitsGrad)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="submissions"
                  stroke="#10B981"
                  fill="url(#subsGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Drop-offs */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <SectionTitle
              title="Drop-off points"
              hint="The last field someone clicked on before leaving without sending the form. If lots of people drop off at the same field, that field is probably confusing or asking for too much - consider making it shorter, optional, or moving it to the end."
            />
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              Last field visitors interacted with before leaving without
              submitting.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {dropOffs.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">
              No drop-offs recorded yet. Either everyone&apos;s submitting, or
              you don&apos;t have enough traffic.
            </p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dropOffs} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" opacity={0.3} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                    stroke="var(--border-primary)"
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                    stroke="var(--border-primary)"
                    width={140}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="#EF4444" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Most-chosen answers (per select/radio field) */}
      {mostChosen.length > 0 && (
        <Card>
          <CardHeader>
            <SectionTitle
              title="Most common answers"
              hint="For each dropdown or multiple-choice question, the answers people picked most often. Use this to spot patterns - if everyone picks the same option, maybe drop it or split it into more useful choices."
            />
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              Counts across all submissions for each dropdown / option
              field. Useful for spotting trends in what your leads pick.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {mostChosen.map((field) => (
              <div key={field.fieldId}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {field.label}
                  </span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    {field.total} response{field.total === 1 ? '' : 's'}
                  </span>
                </div>
                {field.total === 0 ? (
                  <p className="text-xs text-[var(--text-tertiary)]">
                    No answers yet.
                  </p>
                ) : (
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={field.options} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" opacity={0.3} />
                        <XAxis
                          type="number"
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                          stroke="var(--border-primary)"
                        />
                        <YAxis
                          type="category"
                          dataKey="option"
                          tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                          stroke="var(--border-primary)"
                          width={140}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-primary)',
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                          {field.options.map((_, i) => (
                            <Cell
                              key={i}
                              fill={i === 0 ? '#2B79F7' : i === 1 ? '#8B5CF6' : '#94A3B8'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
          {icon}
          <span className="truncate">{label}</span>
          {hint && (
            <InfoTooltip content={hint} position="top" maxWidth={260}>
              <span className="inline-flex shrink-0 ml-auto cursor-help text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                <Info className="h-3.5 w-3.5" />
              </span>
            </InfoTooltip>
          )}
        </div>
        <p className="mt-2 text-2xl font-bold text-[var(--text-primary)] tabular-nums">
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <InfoTooltip content={hint} position="bottom" maxWidth={320}>
        <span className="inline-flex cursor-help text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
          <Info className="h-3.5 w-3.5" />
        </span>
      </InfoTooltip>
    </div>
  )
}
