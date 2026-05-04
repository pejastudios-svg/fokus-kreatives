'use client'

// Compact status pill modeled on the Vercel/Heroku-style deployments table:
// colored dot + label, soft tinted background, no border. Use the named
// tones - they map to the brand-consistent green/blue/yellow/red set.

type Tone = 'success' | 'pending' | 'warning' | 'danger' | 'neutral' | 'info'

const TONE_STYLES: Record<Tone, { dot: string; chip: string; text: string }> = {
  success: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-500/12',
    text: 'text-emerald-500',
  },
  pending: {
    dot: 'bg-blue-500',
    chip: 'bg-blue-500/12',
    text: 'text-blue-500',
  },
  warning: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-500/12',
    text: 'text-amber-500',
  },
  danger: {
    dot: 'bg-red-500',
    chip: 'bg-red-500/12',
    text: 'text-red-500',
  },
  info: {
    dot: 'bg-sky-500',
    chip: 'bg-sky-500/12',
    text: 'text-sky-500',
  },
  neutral: {
    dot: 'bg-[var(--text-tertiary)]',
    chip: 'bg-[var(--bg-tertiary)]',
    text: 'text-[var(--text-secondary)]',
  },
}

interface StatusPillProps {
  tone?: Tone
  children: React.ReactNode
  pulse?: boolean
  size?: 'sm' | 'md'
}

export function StatusPill({
  tone = 'neutral',
  children,
  pulse = false,
  size = 'sm',
}: StatusPillProps) {
  const t = TONE_STYLES[tone]
  const sizing =
    size === 'md'
      ? 'px-2.5 py-1 text-xs'
      : 'px-2 py-0.5 text-[10px]'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizing} ${t.chip} ${t.text}`}
    >
      <span className="relative flex h-1.5 w-1.5 items-center justify-center">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${t.dot}`}
          />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${t.dot}`} />
      </span>
      {children}
    </span>
  )
}

// Trend chip used next to KPI numbers. Up arrow + percent on green, down
// arrow on red. Matches the neumorphism dashboard reference style.
export function TrendChip({ change }: { change: number }) {
  if (change === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] tabular-nums">
        0%
      </span>
    )
  }
  const isUp = change > 0
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums ${
        isUp
          ? 'bg-emerald-500/12 text-emerald-500'
          : 'bg-red-500/12 text-red-500'
      }`}
    >
      <span aria-hidden>{isUp ? '↗' : '↘'}</span>
      {isUp ? '+' : ''}
      {change}%
    </span>
  )
}
