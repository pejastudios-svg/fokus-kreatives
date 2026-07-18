'use client'

// QA checklist panel rendered inside the slot detail drawer. Shows each
// item the AI evaluated, lets staff:
//   - Recheck (re-runs the AI evaluation on just that item against the
//     current script)
//   - Waive (records human_status='waived' + a required reason)
//   - Mark fixed (records human_status='fixed', no reason required - the
//     edited script is the audit trail)
//
// The panel does NOT save script edits - that happens via the script
// editor. After saving an edit, staff click Recheck on flagged items.

import { useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { CheckCircle2, AlertTriangle, HelpCircle, RefreshCw, Loader2, X } from 'lucide-react'
import type { ChecklistItem, ChecklistStatus } from '@/lib/checklist/items'

export interface ChecklistPanelProps {
  slotId: string
  items: ChecklistItem[]
  /** Disable all actions when the slot is approved or generation hasn't run yet. */
  disabled?: boolean
  /** Callback after a recheck or waive so the drawer can swap in the new item. */
  onItemChanged: (next: ChecklistItem) => void
}

export function ChecklistPanel({ slotId, items, disabled, onItemChanged }: ChecklistPanelProps) {
  const resolvedCount = items.filter(isResolved).length
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
          Checklist · {resolvedCount}/{items.length} resolved
        </div>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <ChecklistRow
            key={item.id}
            slotId={slotId}
            item={item}
            disabled={disabled}
            onChanged={onItemChanged}
          />
        ))}
      </div>
    </div>
  )
}

function ChecklistRow({
  slotId,
  item,
  disabled,
  onChanged,
}: {
  slotId: string
  item: ChecklistItem
  disabled?: boolean
  onChanged: (next: ChecklistItem) => void
}) {
  const [showWaive, setShowWaive] = useState(false)
  const [waiveReason, setWaiveReason] = useState('')
  // Only Re-check uses a loading state - it's an actual AI call. Mark
  // fixed + Waive are cheap mutations and run optimistically (UI flips
  // immediately, network goes background, rolls back on failure).
  const [rechecking, setRechecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(item.status === 'flag')

  const isReady = !rechecking && !disabled
  const resolved = isResolved(item)

  const handleRecheck = async () => {
    setError(null)
    setRechecking(true)
    try {
      const res = await fetch(
        `/api/planner/slot/${slotId}/checklist/${item.id}/recheck`,
        { method: 'POST' },
      )
      const data = await readJsonSafe(res)
      if (!data.success) throw new Error(data.error || 'Recheck failed')
      onChanged(data.item as ChecklistItem)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRechecking(false)
    }
  }

  const handleWaiveSubmit = async () => {
    if (!waiveReason.trim()) {
      setError('Please give a reason')
      return
    }
    setError(null)
    // Optimistic - flip the item immediately so the UI shows "Waived"
    // with the reason. Network runs in the background; on failure we
    // roll back the local change and surface an error.
    const previousItem = item
    const optimisticItem: ChecklistItem = {
      ...item,
      human_status: 'waived',
      human_note: waiveReason,
    }
    onChanged(optimisticItem)
    setShowWaive(false)
    setWaiveReason('')
    try {
      const res = await fetch(
        `/api/planner/slot/${slotId}/checklist/${item.id}/waive`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: optimisticItem.human_note, human_status: 'waived' }),
        },
      )
      const data = await readJsonSafe(res)
      if (!data.success) throw new Error(data.error || 'Waive failed')
      // Server-authoritative copy (includes edited_by/at) - sync silently.
      if (data.item) onChanged(data.item as ChecklistItem)
    } catch (err) {
      onChanged(previousItem)
      setShowWaive(true)
      setWaiveReason(optimisticItem.human_note || '')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleMarkFixed = async () => {
    setError(null)
    // Optimistic - flip locally first.
    const previousItem = item
    const optimisticItem: ChecklistItem = {
      ...item,
      human_status: 'fixed',
      human_note: 'Marked fixed by staff',
    }
    onChanged(optimisticItem)
    try {
      const res = await fetch(
        `/api/planner/slot/${slotId}/checklist/${item.id}/waive`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ human_status: 'fixed', reason: 'Marked fixed by staff' }),
        },
      )
      const data = await readJsonSafe(res)
      if (!data.success) throw new Error(data.error || 'Failed')
      if (data.item) onChanged(data.item as ChecklistItem)
    } catch (err) {
      onChanged(previousItem)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div
      className={[
        'rounded-md p-2.5',
        resolved
          ? 'border border-green-500/30 bg-green-500/5 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]'
          : item.status === 'flag'
          ? 'border border-amber-500/40 bg-amber-500/5 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]'
          : 'glass-inset',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-2 text-left"
      >
        <StatusIcon status={item.status} resolved={resolved} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-[var(--text-primary)] leading-snug">
            {item.label}
          </div>
          {item.human_status && (
            <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
              {item.human_status === 'waived' ? 'Waived' : 'Marked fixed'}
              {item.human_note ? ` · ${item.human_note}` : ''}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="mt-2 pl-6 space-y-2 text-xs text-[var(--text-secondary)]">
          {item.ai_note && (
            <p className="italic leading-snug">{item.ai_note}</p>
          )}

          {!resolved && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                disabled={!isReady}
                onClick={handleRecheck}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded glass-chip disabled:opacity-50"
              >
                {rechecking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Re-check
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={handleMarkFixed}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-green-500/40 text-green-600 hover:bg-green-500/10 disabled:opacity-50 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] hover:-translate-y-px"
              >
                <CheckCircle2 className="h-3 w-3" />
                Mark fixed
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setShowWaive((v) => !v)}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-amber-500/40 text-amber-600 hover:bg-amber-500/10 disabled:opacity-50 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] hover:-translate-y-px"
              >
                Waive
              </button>
            </div>
          )}

          {showWaive && !resolved && (
            <div className="space-y-1.5 pt-1">
              <textarea
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                placeholder="Reason for waiving (required - audit trail)"
                rows={2}
                className="w-full text-xs rounded glass-field p-1.5 text-[var(--text-primary)]"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={disabled || !waiveReason.trim()}
                  onClick={handleWaiveSubmit}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  Confirm waive
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowWaive(false)
                    setWaiveReason('')
                    setError(null)
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded glass-chip text-[var(--text-tertiary)]"
                >
                  <X className="h-3 w-3" />
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-[11px] text-red-500">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status, resolved }: { status: ChecklistStatus; resolved: boolean }) {
  if (resolved) {
    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
  }
  if (status === 'flag') {
    return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
  }
  return <HelpCircle className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
}

function isResolved(item: ChecklistItem): boolean {
  return item.status === 'pass' || item.human_status === 'fixed' || item.human_status === 'waived'
}
