'use client'

// Modal that lets staff scope plan generation to specific question form
// batches. The planner page only opens this when 2+ batches are available -
// otherwise we go straight to the existing confirm flow with no friction.
//
// Default state: all batches with usable material checked. User unchecks
// to exclude. Confirm passes the union of selected topicGroupIds to the
// generate API.

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

export interface TopicBatch {
  formId: string
  title: string | null
  createdAt: string
  submittedAt: string | null
  topicCount: number
  usableTopicCount: number
  topicGroupIds: string[]
}

interface Props {
  open: boolean
  batches: TopicBatch[]
  loading: boolean
  /** Called with the union of topicGroupIds across selected batches. Empty
   *  array means "all" (no filter applied server-side). */
  onConfirm: (topicGroupIds: string[]) => void
  onClose: () => void
}

export function TopicBatchPickerModal({ open, batches, loading, onConfirm, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // When the modal opens / batches change, default-select every batch with
  // usable material so the default behavior matches "use everything."
  useEffect(() => {
    if (!open) return
    const defaultSelected = new Set<string>()
    for (const b of batches) {
      if (b.usableTopicCount > 0) defaultSelected.add(b.formId)
    }
    setSelected(defaultSelected)
  }, [open, batches])

  useBodyScrollLock(open)

  if (!open) return null

  const toggle = (formId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(formId)) next.delete(formId)
      else next.add(formId)
      return next
    })
  }

  const selectedCount = selected.size
  const usableTotal = batches
    .filter((b) => selected.has(b.formId))
    .reduce((sum, b) => sum + b.usableTopicCount, 0)

  const handleConfirm = () => {
    const ids: string[] = []
    for (const b of batches) {
      if (selected.has(b.formId)) ids.push(...b.topicGroupIds)
    }
    onConfirm(ids)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-pop relative w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-none rounded-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-5">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Pick material</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Which question batches should this plan use? Default = all batches with available material.
          </p>

          {loading ? (
            <div className="py-8 flex items-center justify-center text-[var(--text-tertiary)]">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading batches...
            </div>
          ) : batches.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
              No question batches found. Generate a question form first.
            </div>
          ) : (
            <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
              {batches.map((b) => {
                const isSelected = selected.has(b.formId)
                const disabled = b.usableTopicCount === 0
                const date = new Date(b.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
                return (
                  <li key={b.formId}>
                    <label
                      className={[
                        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                        isSelected
                          ? 'border-[#2B79F7] bg-[#2B79F7]/5'
                          : 'border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]',
                        disabled && 'opacity-50 cursor-not-allowed',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => !disabled && toggle(b.formId)}
                        className="mt-0.5 h-4 w-4 rounded border-[var(--border-primary)] text-[#2B79F7] focus:ring-[#2B79F7]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {b.title || 'Untitled batch'}
                          </span>
                          <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums shrink-0">
                            {date}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          {b.topicCount} topic{b.topicCount === 1 ? '' : 's'}
                          {' · '}
                          {b.usableTopicCount > 0
                            ? `${b.usableTopicCount} with available material`
                            : 'no available material'}
                          {b.submittedAt ? ' · answered' : ' · not yet answered'}
                        </div>
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--text-tertiary)]">
              {selectedCount} batch{selectedCount === 1 ? '' : 'es'} selected
              {' · '}
              {usableTotal} usable topic{usableTotal === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={selectedCount === 0 || usableTotal === 0}>
                Continue
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
