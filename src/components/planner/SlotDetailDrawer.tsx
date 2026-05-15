'use client'

// Right-side detail panel that opens when a slot is clicked. Shows format
// info + scoring breakdown + raw material refs + actions (regenerate, lock,
// swap format, delete) + the M4 script editor and QA checklist panel.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Lock, Unlock, RefreshCw, Trash2, X, ArrowRightLeft, CheckCircle2, Sparkles } from 'lucide-react'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { StatusPill } from '@/components/ui/StatusPill'
import type { ContentFormat } from '@/lib/contentFormats/types'
import { isChecklistResolved, type ChecklistItem } from '@/lib/checklist/items'
import { STREAM_COLORS, type PlannerSlot } from './types'
import { ChecklistPanel } from './ChecklistPanel'
import { ReviewGuidePanel } from './ReviewGuidePanel'
import { ScriptEditor } from './ScriptEditor'

interface Props {
  slot: PlannerSlot
  formats: ContentFormat[]
  onClose: () => void
  onAction: (slotId: string, action: 'regenerate' | 'lock' | 'unlock' | 'delete') => Promise<void>
  onSwapFormat: (slotId: string, formatId: string) => Promise<void>
  /** Optimistic approve. The parent flips slot.status to 'approved' in
   *  local state immediately, fires the API, and rolls back on failure.
   *  Resolves on success, rejects with an Error (whose `.message` may
   *  contain the unresolved-checklist-items detail) on failure. */
  onApprove: (slotId: string) => Promise<void>
  /** Bulk-generate every slot in the campaign (same topic_group_id) that
   *  doesn't yet have a script. Parent dispatches N parallel
   *  /generate-script calls and tracks progress in its own state. */
  onGenerateCampaign: (topicGroupId: string) => Promise<void>
  /** How many slots in the slot's campaign still need scripts. The
   *  parent computes this so the drawer can label the bulk button. */
  campaignSlotsRemaining: number
  /** True while a campaign-bulk-generate is in flight for this slot's
   *  campaign. Disables the button + the per-slot Generate button so a
   *  click on either doesn't double-fire. */
  campaignBulkInFlight: boolean
  /** Triggers a parent refetch after the drawer mutates the slot
   *  (script generation, save, checklist recheck/waive). Without this,
   *  the parent holds a stale slot.generation_meta - so when the user
   *  reopens the drawer, the local state gets re-seeded from the old
   *  meta and the new script appears to "disappear". */
  onRefresh?: () => Promise<void> | void
}

export function SlotDetailDrawer({
  slot,
  formats,
  onClose,
  onAction,
  onSwapFormat,
  onApprove,
  onGenerateCampaign,
  campaignSlotsRemaining,
  campaignBulkInFlight,
  onRefresh,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showSwap, setShowSwap] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  // Local mirror of script + checklist so user actions update the UI without
  // refetching the whole slot. Seeded from generation_meta on every slot
  // change.
  const initialMeta = (slot.generation_meta as Record<string, unknown>) ?? {}
  const initialScript = typeof initialMeta.script === 'string' ? initialMeta.script : ''
  const initialChecklist = Array.isArray(initialMeta.checklist)
    ? (initialMeta.checklist as ChecklistItem[])
    : []
  const [script, setScript] = useState(initialScript)
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initialChecklist)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  // Keep local state in sync if the slot prop changes (e.g. after parent
  // re-fetch following a regenerate of the SLOT itself, not the script).
  useEffect(() => {
    const meta = (slot.generation_meta as Record<string, unknown>) ?? {}
    setScript(typeof meta.script === 'string' ? meta.script : '')
    setChecklist(Array.isArray(meta.checklist) ? (meta.checklist as ChecklistItem[]) : [])
  }, [slot.id, slot.generation_meta])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  useBodyScrollLock(true)

  const palette = STREAM_COLORS[slot.stream]
  const formatStreamMatches = formats.filter((f) => {
    if (slot.stream === 'long_form') return false
    return f.content_type === slot.stream
  })

  const meta = slot.generation_meta as Record<string, unknown>
  const components =
    (meta?.components as Record<string, number> | undefined) ?? null
  const score = typeof meta?.score === 'number' ? meta.score : null

  const isApproved = slot.status === 'approved'
  const hasScript = script.trim().length > 0

  const handleGenerateScript = async () => {
    setGenerateError(null)
    setGenerating(true)
    try {
      const res = await fetch(`/api/planner/slot/${slot.id}/generate-script`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Generation failed')
      setScript(typeof data.script === 'string' ? data.script : '')
      setChecklist(
        Array.isArray(data.checklist) ? (data.checklist as ChecklistItem[]) : [],
      )
      // Sync parent so the slot prop reflects the new generation_meta on
      // any re-render. Without this, closing + reopening the drawer would
      // re-seed from stale parent state.
      if (onRefresh) await onRefresh()
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  // Resolution state for the Approve button. A slot can be approved when:
  //   - it's currently 'drafted'
  //   - the script is non-empty
  //   - every checklist item is pass / fixed / waived
  const checklistResolved = useMemo(
    () => checklist.length > 0 && isChecklistResolved(checklist),
    [checklist],
  )
  const canApprove = slot.status === 'drafted' && hasScript && checklistResolved && !isApproved

  const handleApprove = async () => {
    setApproveError(null)
    setApproving(true)
    // Close the confirm modal immediately - the approve runs optimistically
    // from the parent's perspective, so the slot already shows as approved
    // by the time the modal is closing.
    setConfirmApprove(false)
    try {
      await onApprove(slot.id)
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : String(err))
    } finally {
      setApproving(false)
    }
  }

  const handleAction = async (action: 'regenerate' | 'lock' | 'unlock' | 'delete') => {
    setBusy(true)
    try {
      await onAction(slot.id, action)
      if (action === 'delete') onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full overflow-y-auto bg-[var(--bg-card)] border-l border-[var(--border-primary)] shadow-premium-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-5 py-4 border-b border-[var(--border-primary)] bg-[var(--bg-card)] flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-block h-2 w-2 rounded-full ${palette.dot}`} />
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                {palette.label} - {slot.scheduled_date}
              </span>
            </div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              {slot.format_name ?? palette.label}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <StatusPill tone={slot.status === 'approved' ? 'success' : slot.status === 'drafted' ? 'pending' : 'neutral'}>
              {slot.status}
            </StatusPill>
            {slot.locked && (
              <StatusPill tone="warning">
                <Lock className="h-3 w-3 mr-1" /> locked
              </StatusPill>
            )}
          </div>

          {slot.hook_preview && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mb-1">Hook preview</div>
              <p className="text-sm text-[var(--text-primary)] leading-snug">{slot.hook_preview}</p>
            </div>
          )}

          {components && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mb-1">Score</div>
              <div className="text-xs text-[var(--text-secondary)] grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span>Material fit</span><span className="tabular-nums text-right">{components.material_fit?.toFixed(1) ?? '0'}</span>
                <span>Coverage need</span><span className="tabular-nums text-right">{components.coverage_need?.toFixed(1) ?? '0'}</span>
                <span>Stage weight</span><span className="tabular-nums text-right">{components.stage_weight?.toFixed(1) ?? '0'}</span>
                <span>Variance</span><span className="tabular-nums text-right">{components.variance_bonus?.toFixed(1) ?? '0'}</span>
                <span>Recency penalty</span><span className="tabular-nums text-right">{components.recency_penalty?.toFixed(1) ?? '0'}</span>
                <span className="font-semibold text-[var(--text-primary)] mt-1">Total</span>
                <span className="tabular-nums text-right font-semibold text-[var(--text-primary)] mt-1">{score?.toFixed(2) ?? '0'}</span>
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mb-1">Raw material</div>
            {slot.raw_material_refs.length === 0 ? (
              <p className="text-xs text-[var(--text-tertiary)] italic">No material attached</p>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">
                {slot.raw_material_refs.length} answer{slot.raw_material_refs.length === 1 ? '' : 's'} from topic group
              </p>
            )}
          </div>

          <div className="border-t border-[var(--border-primary)] pt-4">
            <ScriptEditor
              slotId={slot.id}
              initialScript={script}
              hasScript={hasScript}
              isGenerating={generating}
              disabled={isApproved}
              onGenerate={handleGenerateScript}
              onSaved={(s) => {
                setScript(s)
                if (onRefresh) void onRefresh()
              }}
            />
            {generateError && (
              <p className="mt-2 text-[11px] text-red-500">{generateError}</p>
            )}
          </div>

          {hasScript && checklist.length > 0 && (
            <div className="border-t border-[var(--border-primary)] pt-4">
              <ChecklistPanel
                slotId={slot.id}
                items={checklist}
                disabled={isApproved}
                onItemChanged={(next) => {
                  setChecklist((prev) =>
                    prev.map((i) => (i.id === next.id ? next : i)),
                  )
                  if (onRefresh) void onRefresh()
                }}
              />
            </div>
          )}

          {/* Review guide is static per-stream content - safe to show before
              the script exists so staff can review the rules ahead of time. */}
          <div className="border-t border-[var(--border-primary)] pt-4">
            <ReviewGuidePanel stream={slot.stream} />
          </div>

          {hasScript && (
            <div className="border-t border-[var(--border-primary)] pt-4 space-y-2">
              <button
                disabled={!canApprove || busy}
                onClick={() => setConfirmApprove(true)}
                title={
                  isApproved
                    ? 'Already approved'
                    : !hasScript
                      ? 'Generate the script first'
                      : !checklistResolved
                        ? 'Resolve every checklist item before approving'
                        : 'Approve this slot'
                }
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {/* No spinner. Approve is optimistic — the slot status
                    flips to 'approved' immediately on click, so isApproved
                    is true the moment the API call kicks off. The button
                    text + icon update instantly; the background request
                    rolls back + surfaces an error if it fails. */}
                <CheckCircle2 className="h-4 w-4" />
                {isApproved ? 'Approved' : 'Approve slot'}
              </button>
              {!isApproved && !checklistResolved && checklist.length > 0 && (
                <p className="text-[11px] text-[var(--text-tertiary)] text-center">
                  Resolve every checklist item to enable approval
                </p>
              )}
              {approveError && (
                <p className="text-[11px] text-red-500">{approveError}</p>
              )}
            </div>
          )}

          <div className="border-t border-[var(--border-primary)] pt-4 space-y-2">
            {/* Bulk-generate every slot in THIS campaign (same
                topic_group_id) that doesn't yet have a script. The
                parent dispatches N parallel /generate-script calls and
                tracks progress in its own state. Hidden when:
                  - the slot has no topic_group_id (untyped slot)
                  - the campaign has no remaining un-generated slots
            */}
            {slot.topic_group_id && campaignSlotsRemaining > 0 && (
              <button
                disabled={busy || campaignBulkInFlight}
                onClick={() => {
                  if (slot.topic_group_id) {
                    void onGenerateCampaign(slot.topic_group_id)
                  }
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md bg-[#2B79F7] text-white hover:bg-[#1f5fcc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={`Generate scripts for all ${campaignSlotsRemaining} slot${campaignSlotsRemaining === 1 ? '' : 's'} in this campaign that don't have one yet. Long-form + variants run in parallel.`}
              >
                {campaignBulkInFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate {campaignSlotsRemaining} slot{campaignSlotsRemaining === 1 ? '' : 's'} in this campaign
              </button>
            )}

            <button
              disabled={busy || slot.status === 'approved'}
              onClick={() => handleAction('regenerate')}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Regenerate
            </button>

            <button
              disabled={busy || slot.status === 'approved'}
              onClick={() => handleAction(slot.locked ? 'unlock' : 'lock')}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
            >
              {slot.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {slot.locked ? 'Unlock' : 'Lock'}
            </button>

            {slot.stream !== 'long_form' && (
              <button
                disabled={busy || slot.status === 'approved'}
                onClick={() => setShowSwap((v) => !v)}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
              >
                <ArrowRightLeft className="h-4 w-4" />
                {showSwap ? 'Hide formats' : 'Swap format'}
              </button>
            )}

            {showSwap && (
              <div className="space-y-1 max-h-60 overflow-y-auto border border-[var(--border-primary)] rounded-md p-2">
                {formatStreamMatches.map((f) => (
                  <button
                    key={f.id}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await onSwapFormat(slot.id, f.id)
                        setShowSwap(false)
                      } finally {
                        setBusy(false)
                      }
                    }}
                    disabled={busy || f.id === slot.format_id}
                    className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                  >
                    <div className="font-semibold text-[var(--text-primary)]">{f.name}</div>
                    <div className="text-[var(--text-tertiary)]">{f.description.slice(0, 80)}{f.description.length > 80 ? '...' : ''}</div>
                  </button>
                ))}
              </div>
            )}

            <button
              disabled={busy || slot.status === 'approved'}
              onClick={() => setConfirmDelete(true)}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border border-red-500/40 text-red-500 hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete slot
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="Delete slot?"
        message="The slot is removed from the plan. The raw material remains available for other slots."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          await handleAction('delete')
          setConfirmDelete(false)
        }}
        onClose={() => setConfirmDelete(false)}
      />

      <ConfirmModal
        open={confirmApprove}
        title="Approve this slot?"
        message="The script is locked from further edits, regeneration, format swaps, and rescheduling. The topic answers used for this slot are marked consumed. This action cannot be undone from the UI."
        confirmLabel="Approve"
        tone="default"
        onConfirm={handleApprove}
        onClose={() => {
          if (!approving) {
            setConfirmApprove(false)
            setApproveError(null)
          }
        }}
      />
    </div>
  )
}
