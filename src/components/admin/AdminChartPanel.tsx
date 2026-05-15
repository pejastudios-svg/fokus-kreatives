'use client'

// Big multi-metric chart for the admin dashboard. Three tabs - Events,
// Cost, Success - each renders the same AreaChart shape with different
// series + axis formatting. Matches the financial chart aesthetic from
// the CRM: filled gradient under a 2px line, dashed Y grid, custom
// tooltip, animated transitions.

import { useId, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

interface SparklineData {
  eventsPerHour: number[]
  costPerDay: number[]
  successRate: number[]
}

type Metric = 'events' | 'cost' | 'success'

interface MetricConfig {
  key: Metric
  label: string
  color: string
  /** "24h" or "7d" - determines bucket label generation. */
  windowLabel: '24h' | '7d'
  /** Hourly = true for events, daily for cost + success. */
  hourly: boolean
  /** Y-axis + tooltip value formatter. */
  format: (n: number) => string
  yAxisWidth: number
}

// All three metrics are derived from ai_usage_log only - they describe
// AI traffic, not the broader activity feed. Labels are AI-specific so
// the user knows what they're looking at.
const METRICS: Record<Metric, MetricConfig> = {
  events: {
    key: 'events',
    label: 'AI calls',
    color: '#10b981',
    windowLabel: '24h',
    hourly: true,
    format: (n) => Math.round(n).toLocaleString(),
    yAxisWidth: 36,
  },
  cost: {
    key: 'cost',
    label: 'AI cost',
    color: '#f59e0b',
    windowLabel: '7d',
    hourly: false,
    format: (n) => `US$${n < 1 ? n.toFixed(2) : n.toFixed(0)}`,
    yAxisWidth: 60,
  },
  success: {
    key: 'success',
    label: 'AI success rate',
    color: '#3b82f6',
    windowLabel: '7d',
    hourly: false,
    format: (n) => `${Math.round(n * 100)}%`,
    yAxisWidth: 44,
  },
}

interface AxisDatum {
  label: string
  value: number
}

function buildHourlyData(values: number[], now: Date): AxisDatum[] {
  // 24 buckets, oldest first. Labels are hour-of-day (HH:00).
  const out: AxisDatum[] = []
  for (let i = 0; i < values.length; i += 1) {
    const hoursAgo = values.length - 1 - i
    const t = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000)
    const hh = t.getHours().toString().padStart(2, '0')
    out.push({ label: `${hh}:00`, value: values[i] ?? 0 })
  }
  return out
}

function buildDailyData(values: number[], now: Date): AxisDatum[] {
  const out: AxisDatum[] = []
  for (let i = 0; i < values.length; i += 1) {
    const daysAgo = values.length - 1 - i
    const t = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000)
    const label = t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    out.push({ label, value: values[i] ?? 0 })
  }
  return out
}

interface TooltipPayloadItem {
  value?: number | string
  name?: string
  color?: string
}
interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string | number
  formatValue: (n: number) => string
  seriesLabel: string
  color: string
}

function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  seriesLabel,
  color,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const v = typeof payload[0].value === 'number' ? payload[0].value : 0
  return (
    <div
      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 shadow-xl text-[11px] tabular-nums"
      style={{ minWidth: 140 }}
    >
      <p className="text-[var(--text-tertiary)] mb-1.5 font-medium">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
          {seriesLabel}
        </span>
        <span className="text-[var(--text-primary)] font-semibold">
          {formatValue(v)}
        </span>
      </div>
    </div>
  )
}

interface Props {
  data: SparklineData | null
  /** Optional initial metric. Default 'events'. */
  defaultMetric?: Metric
  height?: number
}

export function AdminChartPanel({ data, defaultMetric = 'events', height = 260 }: Props) {
  const [metric, setMetric] = useState<Metric>(defaultMetric)
  const gradId = useId().replace(/:/g, '')

  const config = METRICS[metric]
  const now = useMemo(() => new Date(), [])

  const chartData = useMemo<AxisDatum[]>(() => {
    if (!data) return []
    if (metric === 'events') return buildHourlyData(data.eventsPerHour, now)
    if (metric === 'cost') return buildDailyData(data.costPerDay, now)
    return buildDailyData(data.successRate, now)
  }, [data, metric, now])

  const allZero = chartData.length === 0 || chartData.every((d) => !d.value)

  return (
    <div className="border border-[var(--border-primary)] rounded-md">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-[var(--border-primary)]">
        {(Object.keys(METRICS) as Metric[]).map((m) => {
          const c = METRICS[m]
          const active = m === metric
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={`relative px-3 py-1.5 text-xs rounded transition-colors ${
                active
                  ? 'text-[var(--text-primary)] bg-[var(--bg-tertiary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: c.color }}
                />
                {c.label}
              </span>
            </button>
          )
        })}
        <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
          last {config.windowLabel}
        </span>
      </div>

      <div className="px-2 py-3">
        {allZero ? (
          <div
            className="flex flex-col items-center justify-center gap-1 text-xs text-[var(--text-tertiary)]"
            style={{ height }}
          >
            <span>No {config.label.toLowerCase()} in the {config.windowLabel}.</span>
            <span className="text-[10px]">
              The chart populates as scripts, checklists, and other AI calls fire.
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient
                  id={`admin-grad-${gradId}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={config.color} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={config.color} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="var(--border-primary)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border-primary)' }}
                minTickGap={config.hourly ? 36 : 12}
              />
              <YAxis
                tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={config.yAxisWidth}
                tickFormatter={(n: number) => config.format(n)}
                domain={metric === 'success' ? [0, 1] : undefined}
              />
              <Tooltip
                cursor={{ stroke: 'var(--text-tertiary)', strokeDasharray: '3 3' }}
                content={
                  ((props: ChartTooltipProps) => (
                    <ChartTooltip
                      {...props}
                      formatValue={config.format}
                      seriesLabel={config.label}
                      color={config.color}
                    />
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  )) as unknown as any
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                name={config.label}
                stroke={config.color}
                strokeWidth={2}
                fill={`url(#admin-grad-${gradId})`}
                isAnimationActive
                animationDuration={350}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
