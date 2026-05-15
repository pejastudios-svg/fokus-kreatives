'use client'

// Horizontal stacked bar showing the current month's bucket distribution
// vs target. Hover any segment for the exact percentage. Empty plan gets
// a target-only ghost. The stream legend below the bar tells you what each
// calendar card color stands for - it lives in the same surface so users
// see "what's the mix" and "what do the colors mean" in one glance.

import { useState } from 'react'
import { STREAM_COLORS, type SlotStream } from './types'
import type { CoverageSnapshot } from './types'

const BUCKET_COLORS: Record<keyof CoverageSnapshot, string> = {
  storytelling: 'bg-rose-500',
  educational: 'bg-emerald-500',
  opinion: 'bg-amber-500',
  proof_community: 'bg-indigo-500',
}

const BUCKET_LABELS: Record<keyof CoverageSnapshot, string> = {
  storytelling: 'Storytelling',
  educational: 'Educational',
  opinion: 'Opinion',
  proof_community: 'Proof / Community',
}

interface CoverageBarProps {
  coverage: CoverageSnapshot
  target: CoverageSnapshot
}

export function CoverageBar({ coverage, target }: CoverageBarProps) {
  const [hover, setHover] = useState<keyof CoverageSnapshot | null>(null)

  const total =
    coverage.storytelling + coverage.educational + coverage.opinion + coverage.proof_community
  const empty = total < 0.5

  const buckets: Array<keyof CoverageSnapshot> = [
    'storytelling',
    'educational',
    'opinion',
    'proof_community',
  ]

  return (
    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)] px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
          Coverage
        </span>
        {hover && (
          <span className="text-xs text-[var(--text-secondary)] tabular-nums">
            {BUCKET_LABELS[hover]}: {coverage[hover].toFixed(0)}% / target {target[hover]}%
          </span>
        )}
      </div>

      <div className="relative h-3 rounded-full overflow-hidden bg-[var(--bg-tertiary)]">
        {!empty &&
          (() => {
            let acc = 0
            return buckets.map((b) => {
              const w = Math.max(0, Math.min(100, coverage[b]))
              const left = acc
              acc += w
              if (w === 0) return null
              return (
                <div
                  key={b}
                  className={`absolute top-0 bottom-0 ${BUCKET_COLORS[b]} transition-opacity ${
                    hover && hover !== b ? 'opacity-50' : 'opacity-100'
                  }`}
                  style={{ left: `${left}%`, width: `${w}%` }}
                  onMouseEnter={() => setHover(b)}
                  onMouseLeave={() => setHover(null)}
                />
              )
            })
          })()}
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {buckets.map((b) => {
          const cur = coverage[b]
          const tgt = target[b]
          const delta = cur - tgt
          return (
            <div
              key={b}
              className="flex items-center gap-1.5 text-xs"
              onMouseEnter={() => setHover(b)}
              onMouseLeave={() => setHover(null)}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${BUCKET_COLORS[b]}`} />
              <span className="text-[var(--text-secondary)]">{BUCKET_LABELS[b]}</span>
              <span className="tabular-nums text-[var(--text-tertiary)]">
                {cur.toFixed(0)}%
                <span className="ml-1">
                  /{tgt}%
                  {Math.abs(delta) >= 1 && (
                    <span className={delta > 0 ? 'ml-1 text-emerald-500' : 'ml-1 text-amber-500'}>
                      {delta > 0 ? '+' : ''}
                      {delta.toFixed(0)}
                    </span>
                  )}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--border-primary)] flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          Streams
        </span>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
          {(['long_form', 'short_form', 'engagement_reel', 'carousel'] as SlotStream[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${STREAM_COLORS[s].dot}`} />
              {STREAM_COLORS[s].label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[var(--text-tertiary)]">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--text-tertiary)] opacity-60" />
            Stories (in queue)
          </span>
        </div>
      </div>
    </div>
  )
}
