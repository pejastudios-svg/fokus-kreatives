'use client'

import type { BucketMode } from '@/lib/charts/bucketize'

interface BucketToggleProps {
  value: BucketMode
  onChange: (next: BucketMode) => void
  className?: string
  // Hide options that don't make sense for a given context (e.g. drop
  // 'day' when the lookback is intrinsically months).
  options?: BucketMode[]
}

const LABELS: Record<BucketMode, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  all: 'All',
}

export function BucketToggle({
  value,
  onChange,
  className = '',
  options = ['day', 'week', 'month', 'all'],
}: BucketToggleProps) {
  return (
    <div
      className={`inline-flex items-center gap-0 p-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border-primary)] ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
              active
                ? 'bg-[#2B79F7] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {LABELS[opt]}
          </button>
        )
      })}
    </div>
  )
}
