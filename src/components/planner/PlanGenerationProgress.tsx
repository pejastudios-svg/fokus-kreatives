'use client'

// Floating bottom-right banner that shows plan generation progress.
// Decoupled from the confirm modal so the user can keep navigating the
// planner while generation runs in the background.
//
// Progress is FAKE - a timer fills 0->95% over ~30s (the typical top-tier
// monthly run). When the server response arrives, we jump to 100% and show
// a green check + auto-dismiss after 2s. If it errors, we show the error
// and a manual close button (no auto-dismiss so the user can read it).

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Sparkles, X, AlertTriangle } from 'lucide-react'

export type PlanGenStatus = 'idle' | 'running' | 'success' | 'error'

interface Props {
  status: PlanGenStatus
  errorMessage?: string
  onDismiss: () => void
  /** Expected duration in ms (used for the fake-progress fill speed). Default 30s. */
  expectedDurationMs?: number
  /** Auto-dismiss delay after success. Default 2.5s. */
  successHoldMs?: number
}

const FAKE_CAP = 95 // never go past 95% until the API actually returns

export function PlanGenerationProgress({
  status,
  errorMessage,
  onDismiss,
  expectedDurationMs = 30_000,
  successHoldMs = 2500,
}: Props) {
  const [progress, setProgress] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fill from 0 to FAKE_CAP over expectedDurationMs while running.
  useEffect(() => {
    if (status === 'running') {
      setProgress(0)
      const tickMs = 250
      const totalTicks = expectedDurationMs / tickMs
      const perTick = FAKE_CAP / totalTicks
      intervalRef.current = setInterval(() => {
        setProgress((p) => {
          const next = p + perTick
          // Slow down as we approach the cap so it doesn't visually stall
          // hard at exactly 95%.
          if (next >= FAKE_CAP) return FAKE_CAP - (FAKE_CAP - p) * 0.5
          return next
        })
      }, tickMs)
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    if (status === 'success') {
      setProgress(100)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => onDismiss(), successHoldMs)
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
    if (status === 'error') {
      // Hold whatever progress we'd reached so the user can see "we got
      // most of the way" vs "it failed at start." No auto-dismiss.
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [status, expectedDurationMs, successHoldMs, onDismiss])

  if (status === 'idle') return null

  const pct = Math.round(progress)
  const isSuccess = status === 'success'
  const isError = status === 'error'
  const isRunning = status === 'running'

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)]',
        'glass-pop rounded-xl shadow-premium-lg p-4',
        'transition-opacity duration-300',
        isSuccess
          ? 'border-emerald-500/40'
          : isError
            ? 'border-red-500/40'
            : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          {isRunning && <Loader2 className="h-4 w-4 animate-spin text-[#2B79F7]" />}
          {isSuccess && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          {isError && <AlertTriangle className="h-4 w-4 text-red-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {isRunning && 'Generating plan'}
              {isSuccess && 'Plan generated'}
              {isError && 'Generation failed'}
            </p>
            {!isRunning && (
              <button
                onClick={onDismiss}
                className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/5"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {isRunning && (
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)] flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Picking formats and writing previews...
            </p>
          )}
          {isError && errorMessage && (
            <p className="mt-0.5 text-xs text-red-500 break-words">{errorMessage}</p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 rounded-full overflow-hidden glass-rail">
        <div
          className={[
            'h-full transition-[width] ease-out',
            isRunning ? 'bg-[#2B79F7] duration-300' : '',
            isSuccess ? 'bg-emerald-500 duration-200' : '',
            isError ? 'bg-red-500 duration-200' : '',
          ].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>

      {!isError && (
        <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-tertiary)] tabular-nums">
          <span>{pct}%</span>
          <span>{isSuccess ? 'Done' : isRunning ? 'About 30s total' : ''}</span>
        </div>
      )}
    </div>
  )
}
