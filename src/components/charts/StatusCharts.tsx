'use client'

import { useId } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

interface TooltipPayloadItem {
  dataKey?: string | number
  name?: string
  value?: number | string
  color?: string
}
interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string | number
  formatValue?: (n: number) => string
}

// Recharts-backed charts that can render multiple series (e.g. lead
// status breakdown, payment status breakdown). The custom inline-SVG
// charts in MiniCharts.tsx couldn't show multi-series data legibly,
// which made the dashboard show only "total" volume - this fixes that.

export interface SeriesDef {
  key: string
  label: string
  color: string
}

export interface ChartDatum {
  date: string // ISO yyyy-mm-dd
  label: string // human-readable axis label
  [seriesKey: string]: string | number
}

interface CommonProps {
  data: ChartDatum[]
  series: SeriesDef[]
  height?: number
  formatValue?: (n: number) => string
  emptyMessage?: string
  // Pixel width reserved for the left y-axis label column. Default fits
  // small integers; bump to ~72-80 for currency-formatted ticks like
  // "$80,000" so the leading "$" or digits don't get clipped.
  yAxisWidth?: number
}

const AXIS_TICK = { fill: 'var(--text-tertiary)', fontSize: 11 }
const GRID_STROKE = 'var(--border-primary)'

function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  // Reverse so the visual stack order (top→bottom) matches the legend
  const rows = [...payload].reverse()
  const total = rows.reduce(
    (s, p) => s + (typeof p.value === 'number' ? p.value : 0),
    0,
  )
  return (
    <div
      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 shadow-xl text-[11px] tabular-nums"
      style={{ minWidth: 140 }}
    >
      <p className="text-[var(--text-tertiary)] mb-1.5 font-medium">{label}</p>
      <div className="space-y-1">
        {rows.map((p) => {
          const v = typeof p.value === 'number' ? p.value : 0
          return (
            <div
              key={String(p.dataKey)}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: p.color }}
                />
                {p.name}
              </span>
              <span className="text-[var(--text-primary)] font-semibold">
                {formatValue ? formatValue(v) : v.toLocaleString()}
              </span>
            </div>
          )
        })}
        {rows.length > 1 && (
          <div className="flex items-center justify-between gap-3 pt-1 mt-1 border-t border-[var(--border-primary)]">
            <span className="text-[var(--text-tertiary)]">Total</span>
            <span className="text-[var(--text-primary)] font-semibold">
              {formatValue ? formatValue(total) : total.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center text-xs text-[var(--text-tertiary)]"
      style={{ height }}
    >
      {message}
    </div>
  )
}

function isAllZero(data: ChartDatum[], series: SeriesDef[]) {
  for (const d of data) {
    for (const s of series) {
      const v = d[s.key]
      if (typeof v === 'number' && v > 0) return false
    }
  }
  return true
}

// Drop series that are all-zero across the visible window. Recharts
// would otherwise still render the empty series' stroke (a flat line
// pinned to the top of the stack) and a legend entry for it - both
// look like real data and confuse the reader.
function visibleSeries(data: ChartDatum[], series: SeriesDef[]): SeriesDef[] {
  return series.filter((s) =>
    data.some(
      (d) => typeof d[s.key] === 'number' && (d[s.key] as number) > 0,
    ),
  )
}

export function StatusStackedBar({
  data,
  series,
  height = 240,
  formatValue,
  emptyMessage = 'No data in this window',
  yAxisWidth = 36,
}: CommonProps) {
  if (isAllZero(data, series))
    return <EmptyState height={height} message={emptyMessage} />
  const live = visibleSeries(data, series)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: GRID_STROKE }}
          minTickGap={20}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          allowDecimals={false}
          tickFormatter={(n: number) =>
            formatValue ? formatValue(n) : String(n)
          }
        />
        <Tooltip
          cursor={{ fill: 'var(--bg-card-hover)', opacity: 0.4 }}
          content={
            ((props: ChartTooltipProps) => (
              <ChartTooltip {...props} formatValue={formatValue} />
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            )) as unknown as any
          }
        />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: 'var(--text-tertiary)' }}
        />
        {live.map((s, idx) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="status"
            fill={s.color}
            radius={idx === live.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            isAnimationActive
            animationDuration={350}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StatusStackedArea({
  data,
  series,
  height = 240,
  formatValue,
  emptyMessage = 'No data in this window',
  yAxisWidth = 64,
}: CommonProps) {
  const gradId = useId().replace(/:/g, '')
  if (isAllZero(data, series))
    return <EmptyState height={height} message={emptyMessage} />
  const live = visibleSeries(data, series)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {live.map((s) => (
            <linearGradient
              key={s.key}
              id={`grad-${gradId}-${s.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={0.55} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: GRID_STROKE }}
          minTickGap={20}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          tickFormatter={(n: number) =>
            formatValue ? formatValue(n) : String(n)
          }
        />
        <Tooltip
          cursor={{ stroke: 'var(--text-tertiary)', strokeDasharray: '3 3' }}
          content={
            ((props: ChartTooltipProps) => (
              <ChartTooltip {...props} formatValue={formatValue} />
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            )) as unknown as any
          }
        />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: 'var(--text-tertiary)' }}
        />
        {live.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId="status"
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#grad-${gradId}-${s.key})`}
            isAnimationActive
            animationDuration={350}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

