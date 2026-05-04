'use client'

import { useId, useMemo, useState } from 'react'

// All charts here are inline SVG: no runtime dep, no client weight, and
// they pick up CSS variables for theming. They are intentionally small -
// "trend at a glance" first, drillable details elsewhere.

// ---------------------------------------------------------------------------
// LineChart - smooth line + filled area, with axis labels.
// ---------------------------------------------------------------------------

export interface LinePoint {
  label: string
  value: number
}

interface LineChartProps {
  data: LinePoint[]
  height?: number
  color?: string
  formatValue?: (n: number) => string
}

export function LineChart({
  data,
  height = 120,
  color = '#2B79F7',
  formatValue = (n) => String(n),
}: LineChartProps) {
  const id = useId()
  const gradientId = `lg-${id.replace(/[:]/g, '')}`

  const stats = useMemo(() => {
    const values = data.map((d) => d.value)
    const max = Math.max(...values, 0)
    const min = Math.min(...values, 0)
    return { max, min }
  }, [data])

  // Empty / all-zero state: show a clear hint instead of an invisible
  // flat line at the bottom edge. The user can't tell the difference
  // between "no data" and "line drawn at min" otherwise.
  const hasAnyValue = stats.max > 0 || stats.min < 0
  if (data.length === 0 || !hasAnyValue) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-tertiary)]/40 text-[var(--text-tertiary)]"
        style={{ height }}
      >
        <span className="text-[11px] font-medium">No data in this window</span>
        <span className="text-[10px] opacity-70">
          New activity will appear here automatically
        </span>
      </div>
    )
  }

  const w = 100
  const h = 60
  const stepX = data.length === 1 ? 0 : w / (data.length - 1)
  // Pad the visible range so a single non-zero point doesn't draw at the
  // very top/bottom edge - keeps the line visually centred even with
  // sparse data.
  const rawRange = stats.max - stats.min
  const range = rawRange > 0 ? rawRange * 1.15 : Math.max(1, stats.max) * 2
  const visualMin = stats.min - rawRange * 0.075

  const points = data.map((d, i) => {
    const x = data.length === 1 ? w / 2 : i * stepX
    const y = h - ((d.value - visualMin) / range) * (h - 6) - 3
    return { x, y, ...d }
  })

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${h} L ${points[0].x.toFixed(2)} ${h} Z`

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* `transition: d` lets the line/area smoothly morph when data
            changes (currency switch, period change). Supported by all
            modern browsers; degrades to a hard cut everywhere else. */}
        <path
          d={areaPath}
          fill={`url(#${gradientId})`}
          style={{ transition: 'd 0.35s ease' }}
        />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ transition: 'd 0.35s ease' }}
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={1.4}
            fill={color}
            style={{ transition: 'cx 0.35s ease, cy 0.35s ease' }}
          >
            <title>{`${p.label}: ${formatValue(p.value)}`}</title>
          </circle>
        ))}
      </svg>
      {data.length > 1 && (
        <div className="flex justify-between mt-2 text-[10px] text-[var(--text-tertiary)]">
          <span>{data[0].label}</span>
          <span>{data[data.length - 1].label}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BarChart - vertical bars with optional today-highlight.
// ---------------------------------------------------------------------------

export interface BarPoint {
  label: string
  value: number
}

interface BarChartProps {
  data: BarPoint[]
  height?: number
  color?: string
  highlightLast?: boolean
  formatValue?: (n: number) => string
}

export function BarChart({
  data,
  height = 120,
  color = '#2B79F7',
  highlightLast = false,
  formatValue = (n) => String(n),
}: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 0)
  const hasAnyValue = max > 0
  const w = 100
  const h = 100
  const step = w / (data.length || 1)

  if (data.length === 0 || !hasAnyValue) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-tertiary)]/40 text-[var(--text-tertiary)]"
        style={{ height }}
      >
        <span className="text-[11px] font-medium">No data in this window</span>
        <span className="text-[10px] opacity-70">
          New activity will appear here automatically
        </span>
      </div>
    )
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
      >
        {data.map((d, i) => {
          const barHeight = (d.value / max) * (h - 6)
          const x = i * step + step * 0.15
          const y = h - barHeight
          const isLast = highlightLast && i === data.length - 1
          return (
            <rect
              key={`${d.label}-${i}`}
              x={x}
              y={y}
              width={step * 0.7}
              height={barHeight}
              rx={1}
              fill={isLast ? color : `${color}59`}
              style={{ transition: 'y 0.3s ease, height 0.3s ease' }}
            >
              <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            </rect>
          )
        })}
      </svg>
      {data.length > 1 && (
        <div className="flex justify-between mt-2 text-[10px] text-[var(--text-tertiary)]">
          <span>{data[0].label}</span>
          <span>{data[data.length - 1].label}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DonutChart - SVG arc segments + center label.
// ---------------------------------------------------------------------------

export interface DonutSlice {
  label: string
  value: number
  color: string
}

interface DonutChartProps {
  data: DonutSlice[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerSubLabel?: string
}

export function DonutChart({
  data,
  size = 140,
  thickness = 18,
  centerLabel,
  centerSubLabel,
}: DonutChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2

  // Skip zero-value slices and pre-compute exact start/end angles per
  // slice. Drawing real arc paths (instead of stroke-dashed circles)
  // gives us pixel-perfect adjacency between segments — no more visible
  // gaps where two slices butt up against each other.
  // Pre-compute exact start/end angles per slice. Reduce keeps the
  // accumulator immutable per step (lint flags reassigned `let` bindings
  // during render).
  const visible = data.filter((d) => d.value > 0)
  const slices = visible.reduce<
    Array<DonutSlice & { start: number; end: number; sweep: number }>
  >((acc, d) => {
    const sweep = (d.value / total) * 360
    const start = acc.length > 0 ? acc[acc.length - 1].end : 0
    const end = start + sweep
    acc.push({ ...d, start, end, sweep })
    return acc
  }, [])

  // When a slice is hovered, the center reflects that slice instead of
  // the default totals. Falls back to the props-supplied labels.
  const hoveredSlice = hovered != null ? slices[hovered] : null
  const activeCenterValue = hoveredSlice
    ? String(hoveredSlice.value)
    : centerLabel
  const activeCenterSub = hoveredSlice
    ? `${hoveredSlice.label} · ${Math.round((hoveredSlice.value / total) * 100)}%`
    : centerSubLabel

  return (
    <div className="flex items-center justify-center relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--bg-tertiary)"
          strokeWidth={thickness}
        />
        {/* Each slice is its own arc path. When there is exactly one
            slice that covers the entire circle we fall back to a plain
            <circle> because SVG arcs of exactly 360° collapse to nothing. */}
        {slices.length === 1 && Math.abs(slices[0].sweep - 360) < 0.001 ? (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={slices[0].color}
            strokeWidth={thickness}
            onMouseEnter={() => setHovered(0)}
            style={{ cursor: 'pointer' }}
          >
            <title>{`${slices[0].label}: ${slices[0].value}`}</title>
          </circle>
        ) : (
          slices.map((s, i) => {
            const isHovered = hovered === i
            const isDimmed = hovered != null && !isHovered
            // Keep stroke-width uniform across all slices so the
            // outer edge stays a clean circle. The hovered slice pops
            // by contrast - everyone else fades to 30%.
            return (
              <path
                key={s.label}
                d={arcPath(cx, cy, r, s.start, s.end)}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeLinecap="butt"
                shapeRendering="geometricPrecision"
                opacity={isDimmed ? 0.3 : 1}
                onMouseEnter={() => setHovered(i)}
                style={{
                  transition: 'd 0.4s ease, opacity 0.18s ease',
                  cursor: 'pointer',
                }}
              >
                <title>{`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}</title>
              </path>
            )
          })
        )}
        {(activeCenterValue || activeCenterSub) && (
          <g>
            {activeCenterValue && (
              <text
                x={cx}
                y={activeCenterSub ? cy - 2 : cy + 4}
                textAnchor="middle"
                className="fill-[var(--text-primary)]"
                style={{ fontSize: 16, fontWeight: 700 }}
              >
                {activeCenterValue}
              </text>
            )}
            {activeCenterSub && (
              <text
                x={cx}
                y={cy + 12}
                textAnchor="middle"
                style={{
                  fontSize: 9,
                  fill: hoveredSlice ? hoveredSlice.color : 'var(--text-tertiary)',
                  fontWeight: hoveredSlice ? 600 : 400,
                }}
              >
                {activeCenterSub}
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  )
}

// Convert a polar coordinate (centered at cx,cy with radius r) to
// cartesian. 0° is at the top (12 o'clock) so segments read clockwise
// the way users expect.
function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
) {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(cx, cy, r, startAngle)
  const end = polarToCartesian(cx, cy, r, endAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

// Legend that pairs nicely with DonutChart - colored dot + label + value.
export function ChartLegend({
  items,
  formatValue,
}: {
  items: { label: string; value: number; color: string }[]
  formatValue?: (n: number) => string
}) {
  const fmt = formatValue || ((n) => String(n))
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li
          key={it.label}
          className="flex items-center justify-between gap-3 text-xs"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: it.color }}
            />
            <span className="text-[var(--text-secondary)] truncate">{it.label}</span>
          </span>
          <span className="text-[var(--text-primary)] tabular-nums font-medium shrink-0">
            {fmt(it.value)}
          </span>
        </li>
      ))}
    </ul>
  )
}
