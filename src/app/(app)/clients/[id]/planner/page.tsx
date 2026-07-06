'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Calendar as CalendarIcon, Loader2, Share2, X, FileText, ChevronDown, Copy, Check as CheckIcon } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { Trash2 } from 'lucide-react'
import { CoverageBar } from '@/components/planner/CoverageBar'
import { PlannerCalendarGrid } from '@/components/planner/PlannerCalendarGrid'
import { PlanGenerationProgress, type PlanGenStatus } from '@/components/planner/PlanGenerationProgress'
import { TopicBatchPickerModal, type TopicBatch } from '@/components/planner/TopicBatchPickerModal'
import { StoryQueuePanel } from '@/components/planner/StoryQueuePanel'
import { SlotDetailDrawer } from '@/components/planner/SlotDetailDrawer'
import type { ChecklistItem } from '@/lib/checklist/items'
import { StageAdvancementBanner } from '@/components/planner/StageAdvancementBanner'
import { ReadinessPanel } from '@/components/planner/ReadinessPanel'
import type { PlannerData, StoryIntent } from '@/components/planner/types'

export default function ClientPlannerPage() {
  const params = useParams()
  const clientId = params.id as string

  const [data, setData] = useState<PlannerData | null>(null)
  const [loading, setLoading] = useState(true)
  const isFirstLoad = useRef(true)
  // Cancels any in-flight refresh when a new one starts. Without this, a
  // slow "from" fetch could resolve AFTER a faster "to" fetch and overwrite
  // it with stale data - the calendar would visibly snap back, then forward
  // again, exactly the "jump and pause" the user reported.
  const abortRef = useRef<AbortController | null>(null)
  const [genStatus, setGenStatus] = useState<PlanGenStatus>('idle')
  const [genError, setGenError] = useState<string | undefined>(undefined)
  // Warnings from the last generate run (skipped slots, dropped streams).
  // Shown in the progress banner - a plan that silently drops carousels
  // must say so.
  const [genWarnings, setGenWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  // Date range for the plan. fromDate / toDate are YYYY-MM-DD strings; both
  // editable via real date pickers in the top bar. Defaults: today through
  // end of the current month (the most common "plan this month" case).
  const [fromDate, setFromDate] = useState<string>(() => todayYmd())
  const [toDate, setToDate] = useState<string>(() => endOfMonthYmd(new Date()))
  // openSlot is derived from data + openSlotId so optimistic updates and
  // post-server refetches both flow into the open drawer without explicit
  // re-syncs. If the slot is deleted from data, openSlot becomes null and
  // the drawer auto-closes.
  const [openSlotId, setOpenSlotId] = useState<string | null>(null)
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [creatingShare, setCreatingShare] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // After a successful export, hold the list of created docs so the user
  // can copy / open each from the planner page without digging through
  // their Drive.
  interface ExportedDoc {
    docUrl: string
    docId: string
    name: string
  }
  const [lastExportDocs, setLastExportDocs] = useState<ExportedDoc[]>([])
  // How many exported slots had no script (they render as "no script
  // generated yet" placeholders in the doc). Shown as a warning line in
  // the export banner so gaps surface here, not inside the doc.
  const [lastExportMissing, setLastExportMissing] = useState(0)
  const [copiedDocId, setCopiedDocId] = useState<string | null>(null)
  // Campaign-picker state for the export dropdown.
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  interface ExportCampaign {
    id: string
    topicGroupId: string | null
    label: string
    firstDate: string
    slotCount: number
  }
  const [exportCampaigns, setExportCampaigns] = useState<ExportCampaign[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  // 'safe' = wipe planned + unlocked; 'purge' = wipe everything in the range.
  const [confirmDelete, setConfirmDelete] = useState<'safe' | 'purge' | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Pending hard-delete on a story queue item. Held until user confirms.
  const [confirmDeleteStory, setConfirmDeleteStory] = useState<string | null>(null)
  // Topic-batch picker. Opens when 2+ batches are available so staff can
  // scope generation. When closed/skipped, the planner uses all unused
  // material as before.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerBatches, setPickerBatches] = useState<TopicBatch[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  // Topic group ids passed to the next generate call. Empty = no filter.
  const [scopedTopicGroupIds, setScopedTopicGroupIds] = useState<string[]>([])

  // Months with slots, fetched from /api/planner/months. Used to render
  // the "active plans" jump strip above the calendar so staff can
  // navigate to any month that has content - even one outside the
  // current picker range. Refreshed on first load and after every
  // plan-mutating action (generate, regenerate, delete, purge).
  interface MonthWithSlots {
    ym: string
    firstDate: string
    lastDate: string
    slotCount: number
  }
  const [monthsWithSlots, setMonthsWithSlots] = useState<MonthWithSlots[]>([])

  const loadMonthsWithSlots = useCallback(async () => {
    try {
      const r = await fetch(`/api/planner/months/${clientId}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.success && Array.isArray(j.months)) {
        setMonthsWithSlots(j.months as MonthWithSlots[])
      }
    } catch (e) {
      // Non-fatal - the strip just stays empty if this fails.
      console.warn('[planner] failed to load months-with-slots:', e)
    }
  }, [clientId])

  const refresh = useCallback(async () => {
    // Optimistic refresh: no spinners, no loading flash. The calendar pulls
    // its visible range from the picker state directly (not from data), and
    // visible slots are filtered client-side, so the UI always reflects the
    // picker the moment you change it. The server response just keeps the
    // underlying dataset honest in the background.

    // Abort any in-flight refresh so an older slow response can't clobber a
    // newer one - this kills the "calendar snaps backward then forward"
    // glitch when a user picks From and To in quick succession.
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // Capture the range this fetch was issued for. Used to MERGE the
    // response into local state (rather than wholesale replacing data)
    // so slots from previously-viewed ranges stay in memory and pop in
    // instantly when the user moves the picker over them. Without this,
    // every range change re-fetched the slot list from scratch and the
    // calendar sat empty until the network landed.
    const fetchFrom = fromDate
    const fetchTo = toDate

    try {
      const res = await fetch(
        `/api/planner/data?clientId=${clientId}&from=${fetchFrom}&to=${fetchTo}`,
        { cache: 'no-store', signal: ctrl.signal },
      )
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Load failed')
      // Merge strategy: keep previously-fetched slots that fall OUTSIDE
      // the current fetch range; replace slots INSIDE the range with the
      // freshly-fetched ones. On first load (no prev data), accept the
      // response wholesale.
      setData((prev) => {
        if (!prev) return j as PlannerData
        const fresh = j as PlannerData
        const inRange = (date: string) => date >= fetchFrom && date <= fetchTo
        const freshIds = new Set(fresh.slots.map((s) => s.id))
        // Keep slots from outside the fetched range (so old views remain
        // instant). Also keep slots that the fresh fetch *did* return -
        // we'll overwrite those below with the fresh copy. Drop slots
        // that are inside the fetched range but missing from the
        // response (they were deleted server-side).
        const keptOutOfRange = prev.slots.filter(
          (s) => !inRange(s.scheduled_date) && !freshIds.has(s.id),
        )
        // For story queue / history / formats / coverage, the server
        // returns the full picture per request, so trust the fresh data.
        return {
          ...fresh,
          slots: [...keptOutOfRange, ...fresh.slots],
        }
      })
      setError('')
    } catch (e) {
      // Aborted fetches were superseded by a newer refresh. Bail out
      // WITHOUT touching first-load state - the newer fetch owns the
      // transition out of "Loading planner..." Otherwise we'd flip
      // loading=false while data is still null and briefly show the
      // "Could not load plan" fallback.
      if (e instanceof DOMException && e.name === 'AbortError') {
        if (abortRef.current === ctrl) abortRef.current = null
        return
      }
      setError(e instanceof Error ? e.message : 'Load failed')
    }

    // Reached only on success or non-abort error. Safe to clear our
    // controller ref and exit the first-load state.
    if (abortRef.current === ctrl) abortRef.current = null
    if (isFirstLoad.current) {
      setLoading(false)
      isFirstLoad.current = false
    }
  }, [clientId, fromDate, toDate])

  // Load the months-with-slots strip once per client. The strip only
  // changes when a plan is generated / deleted / regenerated, so we
  // re-call loadMonthsWithSlots from those handlers - not on every
  // picker change.
  useEffect(() => {
    void loadMonthsWithSlots()
  }, [loadMonthsWithSlots])

  useEffect(() => {
    // First load: fetch immediately so the page mounts with data ASAP.
    if (isFirstLoad.current) {
      refresh()
      return
    }
    // Subsequent loads: debounce 200ms so quick consecutive picker changes
    // (From -> To within a few hundred ms) collapse into a single fetch
    // instead of two racing requests.
    const t = setTimeout(() => refresh(), 200)
    return () => clearTimeout(t)
  }, [refresh])

  // topicGroupIdsArg is passed EXPLICITLY by the confirm modal. Reading
  // scopedTopicGroupIds from the closure here is what silently dropped the
  // user's batch selection: this callback's dependency array didn't include
  // it, so useCallback kept serving a stale closure with the empty initial
  // value and the generate request went out unscoped - the plan then pulled
  // whatever material ranked freshest, including last month's form.
  const handleGenerate = useCallback(async (topicGroupIdsArg?: string[]) => {
    // Close the confirm modal immediately - the floating progress card takes
    // over so the user can keep navigating the planner during generation.
    setConfirmGenerate(false)
    setGenStatus('running')
    setGenError(undefined)
    setGenWarnings([])
    const scope = topicGroupIdsArg ?? scopedTopicGroupIds

    // Past-from auto-extend: if the user picked a from-date in the past
    // (e.g. May 1 when today is May 6), snap from to today and extend the
    // to-date forward by the same number of days so they still get a full
    // intended range of plannable content. The picker state updates to
    // match what's actually getting generated.
    let effectiveFrom = fromDate
    let effectiveTo = toDate
    const today = todayYmd()
    if (fromDate < today) {
      const fromMs = new Date(`${fromDate}T00:00:00Z`).getTime()
      const todayMs = new Date(`${today}T00:00:00Z`).getTime()
      const gapDays = Math.round((todayMs - fromMs) / (24 * 60 * 60 * 1000))
      effectiveFrom = today
      const toDateObj = new Date(`${toDate}T00:00:00Z`)
      toDateObj.setUTCDate(toDateObj.getUTCDate() + gapDays)
      effectiveTo = `${toDateObj.getUTCFullYear()}-${String(toDateObj.getUTCMonth() + 1).padStart(2, '0')}-${String(toDateObj.getUTCDate()).padStart(2, '0')}`
      // Snap the picker so what the user sees matches what we generate.
      setFromDate(effectiveFrom)
      setToDate(effectiveTo)
    }

    try {
      const res = await fetch('/api/planner/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          anchorDate: effectiveFrom,
          endDate: effectiveTo,
          // Empty array = no scope (use all unused). Non-empty = restrict to
          // the picker's selection.
          topicGroupIds: scope.length > 0 ? scope : undefined,
        }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Generation failed')
      await refresh()
      // Plan generation can extend slots into new months - refresh the
      // months-with-slots strip so the new month anchors appear.
      void loadMonthsWithSlots()
      setGenWarnings(Array.isArray(j.warnings) ? (j.warnings as string[]) : [])
      setGenStatus('success')
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed')
      setGenStatus('error')
    }
  }, [clientId, fromDate, toDate, refresh, scopedTopicGroupIds, loadMonthsWithSlots])

  // Slots with a generate/regenerate request in flight, keyed by slot id.
  // Tracked HERE (not in the drawer) so the spinner survives closing and
  // reopening the slot drawer while the request is still running - the drawer
  // unmounts on close, which would otherwise reset its local busy state.
  const [slotInFlight, setSlotInFlight] = useState<Record<string, 'generating' | 'regenerating'>>({})
  const markSlotInFlight = useCallback(
    (id: string, value: 'generating' | 'regenerating' | null) => {
      setSlotInFlight((prev) => {
        if (value === null) {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        }
        return { ...prev, [id]: value }
      })
    },
    [],
  )

  // Fires the script generation for one slot and tracks it in slotInFlight so
  // the drawer's spinner reflects the true state even after close/reopen.
  const handleGenerateScript = useCallback(
    async (slotId: string): Promise<{ script: string; checklist: ChecklistItem[] }> => {
      markSlotInFlight(slotId, 'generating')
      try {
        const res = await fetch(`/api/planner/slot/${slotId}/generate-script`, { method: 'POST' })
        const data = await res.json()
        if (!data.success) throw new Error(data.error || 'Generation failed')
        // Sync generation_meta into parent state so a drawer reopen re-seeds
        // from fresh data rather than stale.
        void refresh()
        return {
          script: typeof data.script === 'string' ? data.script : '',
          checklist: Array.isArray(data.checklist) ? (data.checklist as ChecklistItem[]) : [],
        }
      } finally {
        markSlotInFlight(slotId, null)
      }
    },
    [markSlotInFlight, refresh],
  )

  const handleSlotAction = useCallback(
    async (slotId: string, action: 'regenerate' | 'lock' | 'unlock' | 'delete') => {
      // Lock and delete are fully optimistic - the UI updates instantly and
      // the API runs in background. The drawer's openSlot is computed from
      // data so any local-state edit reflects in it immediately.
      if (action === 'lock' || action === 'unlock') {
        const newLocked = action === 'lock'
        setData((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            slots: prev.slots.map((s) => (s.id === slotId ? { ...s, locked: newLocked } : s)),
          }
        })
        try {
          const res = await fetch(`/api/planner/slot/${slotId}/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locked: newLocked }),
          })
          const j = await res.json()
          if (!j.success) throw new Error(j.error || 'Update failed')
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Lock update failed')
          await refresh()
        }
        return
      }

      if (action === 'delete') {
        // Optimistic: yank the slot out of data and close the drawer (since
        // openSlot is derived from data, openSlot will become null on its own
        // - we set openSlotId to null too so the drawer state stays clean).
        setData((prev) => {
          if (!prev) return prev
          return { ...prev, slots: prev.slots.filter((s) => s.id !== slotId) }
        })
        setOpenSlotId(null)
        try {
          const res = await fetch(`/api/planner/slot/${slotId}`, { method: 'DELETE' })
          const j = await res.json()
          if (!j.success) throw new Error(j.error || 'Delete failed')
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Delete failed')
          await refresh()
        }
        return
      }

      // Regenerate: server-side work that produces a new pick + hook
      // preview. We can't predict the new format / hook so we can't
      // optimistically populate them - BUT we CAN optimistically clear
      // the existing hook_preview + generation_meta + reset status so
      // the card visibly enters a "regenerating" state without waiting
      // for the server.
      const slotBefore = data?.slots.find((s) => s.id === slotId)
      const prev = slotBefore
        ? {
            hook_preview: slotBefore.hook_preview,
            generation_meta: slotBefore.generation_meta,
            status: slotBefore.status,
            format_id: slotBefore.format_id,
          }
        : null

      markSlotInFlight(slotId, 'regenerating')
      setData((prevData) => {
        if (!prevData) return prevData
        return {
          ...prevData,
          slots: prevData.slots.map((s) =>
            s.id === slotId
              ? {
                  ...s,
                  hook_preview: null,
                  generation_meta: {},
                  status: 'planned' as const,
                }
              : s,
          ),
        }
      })

      try {
        const res = await fetch(`/api/planner/slot/${slotId}/regenerate`, { method: 'POST' })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Regenerate failed')
        // Refresh in the background to pull the new format / hook.
        void refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Regenerate failed')
        // Roll back the optimistic clear.
        if (prev) {
          setData((prevData) => {
            if (!prevData) return prevData
            return {
              ...prevData,
              slots: prevData.slots.map((s) =>
                s.id === slotId
                  ? {
                      ...s,
                      hook_preview: prev.hook_preview,
                      generation_meta: prev.generation_meta,
                      status: prev.status,
                      format_id: prev.format_id,
                    }
                  : s,
              ),
            }
          })
        }
      } finally {
        markSlotInFlight(slotId, null)
      }
    },
    [data, refresh, markSlotInFlight],
  )

  // Generate-button click. Pre-fetches available batches; if there's only
  // one (or zero), skips the picker and goes straight to confirm. Otherwise
  // opens the picker so the user can scope the generation.
  const handleGenerateClick = useCallback(async () => {
    setPickerLoading(true)
    setPickerOpen(true)
    try {
      const res = await fetch(`/api/planner/topic-batches?clientId=${clientId}`, {
        cache: 'no-store',
      })
      const j = await res.json()
      const batches = (j.success ? (j.batches as TopicBatch[]) : []) ?? []
      const usableBatches = batches.filter((b) => b.usableTopicCount > 0)
      setPickerBatches(batches)
      // Skip the picker UX when only 1 batch (or none) has usable material.
      if (usableBatches.length <= 1) {
        setPickerOpen(false)
        setScopedTopicGroupIds(usableBatches[0]?.topicGroupIds ?? [])
        setConfirmGenerate(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load batches')
      setPickerOpen(false)
    } finally {
      setPickerLoading(false)
    }
  }, [clientId])

  const handlePickerConfirm = useCallback((topicGroupIds: string[]) => {
    setScopedTopicGroupIds(topicGroupIds)
    setPickerOpen(false)
    setConfirmGenerate(true)
  }, [])

  const handleSlotReorder = useCallback(
    async (date: string, slotIds: string[]) => {
      // Optimistic - reassign display_order in local state immediately so
      // the cards rearrange on the calendar without waiting for the server.
      setData((prev) => {
        if (!prev) return prev
        const orderMap = new Map(slotIds.map((id, i) => [id, i]))
        return {
          ...prev,
          slots: prev.slots.map((s) =>
            s.scheduled_date === date && orderMap.has(s.id)
              ? { ...s, display_order: orderMap.get(s.id) }
              : s,
          ),
        }
      })
      try {
        const res = await fetch('/api/planner/slots/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, date, slotIds }),
        })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Reorder failed')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Reorder failed')
        await refresh()
      }
    },
    [clientId, refresh],
  )

  const handleReschedule = useCallback(
    async (slotId: string, newDate: string) => {
      // Optimistic - move the slot in local state immediately so the card
      // jumps to the new date without waiting for the server. Cooldown
      // warnings still come from the server response and bubble up to the
      // grid for a brief banner.
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          slots: prev.slots.map((s) =>
            s.id === slotId ? { ...s, scheduled_date: newDate } : s,
          ),
        }
      })
      try {
        const res = await fetch(`/api/planner/slot/${slotId}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledDate: newDate }),
        })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Reschedule failed')
        return { warnings: (j.warnings as string[]) || [] }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Reschedule failed')
        await refresh()
        return { warnings: [] }
      }
    },
    [refresh],
  )

  const handleSwapFormat = useCallback(
    async (slotId: string, formatId: string) => {
      // Optimistic - update local slot.format_id immediately so the
      // drawer / card reflect the change without waiting for the server.
      // On failure we surface the error and restore the previous format.
      // Capture the previous format outside the setData callback so the
      // type inference is stable across the closure.
      const slotBefore = data?.slots.find((s) => s.id === slotId)
      const prevFormatId = slotBefore?.format_id ?? null

      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          slots: prev.slots.map((s) =>
            s.id === slotId ? { ...s, format_id: formatId } : s,
          ),
        }
      })
      try {
        const res = await fetch(`/api/planner/slot/${slotId}/swap-format`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formatId }),
        })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Swap failed')
        // Fire-and-forget refresh in the background so any server-side
        // derived fields (hook_preview, generation_meta) come in sync.
        void refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Swap failed')
        // Roll back the format_id change on failure.
        setData((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            slots: prev.slots.map((s) =>
              s.id === slotId ? { ...s, format_id: prevFormatId } : s,
            ),
          }
        })
      }
    },
    [data, refresh],
  )

  // Bulk campaign generation. Click "Generate all in this campaign" in
  // the slot drawer -> we dispatch parallel /generate-script calls for
  // every slot in the campaign that doesn't have a script yet.
  //
  // Progress state is a Map<topicGroupId, { total, done, failed }>. The
  // drawer reads `campaignBulkInFlight` from this to disable its button
  // and the parent renders a banner showing live progress. Each slot's
  // generation runs through the existing endpoint, which means the
  // per-slot lock + retry + polish pipeline all apply normally.
  interface CampaignBulkProgress {
    total: number
    done: number
    failed: number
  }
  const [campaignBulkProgress, setCampaignBulkProgress] = useState<
    Map<string, CampaignBulkProgress>
  >(new Map())

  const handleGenerateCampaign = useCallback(
    async (topicGroupId: string) => {
      // Identify the slots that need scripts in this campaign - fetched
      // server-side so the list covers the WHOLE campaign, not just the
      // slots inside the visible calendar window. data.slots starts at
      // today, so campaign slots scheduled in the past would be silently
      // skipped if we filtered locally (that's how exports ended up with
      // "no script generated yet" placeholders on generated campaigns).
      let needGeneration: { id: string; stream?: string }[] = []
      try {
        const res = await fetch(
          `/api/planner/campaign-pending?clientId=${clientId}&topicGroupId=${topicGroupId}`,
          { cache: 'no-store' },
        )
        const j = await res.json()
        if (!j.success || !Array.isArray(j.slots)) {
          throw new Error(j.error || 'Failed to load campaign slots')
        }
        needGeneration = j.slots
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load campaign slots')
        return
      }

      if (needGeneration.length === 0) {
        setError('No slots in this campaign need a script - all are already drafted.')
        return
      }

      // Interleave streams before batching into waves. The server's
      // cross-slot hook dedup only sees hooks that are ALREADY SAVED, and
      // the pending list is date-ordered which clusters same-stream slots
      // together - a wave of 4 short-forms generates in parallel with none
      // seeing the others' hooks. Round-robin by stream spreads same-stream
      // slots across waves so later ones dedupe against earlier ones.
      {
        const byStream = new Map<string, typeof needGeneration>()
        for (const s of needGeneration) {
          const key = s.stream ?? 'unknown'
          const arr = byStream.get(key) ?? []
          arr.push(s)
          byStream.set(key, arr)
        }
        const interleaved: typeof needGeneration = []
        for (let added = true; added; ) {
          added = false
          for (const arr of byStream.values()) {
            const next = arr.shift()
            if (next) {
              interleaved.push(next)
              added = true
            }
          }
        }
        needGeneration = interleaved
      }

      // Initialize progress.
      setCampaignBulkProgress((prev) => {
        const next = new Map(prev)
        next.set(topicGroupId, { total: needGeneration.length, done: 0, failed: 0 })
        return next
      })

      // Fire generations in waves of 4 (matches the server-side
      // MAX_CONCURRENT_PER_CLIENT cap). Each per-slot generation has its
      // own lock + retry + polish pipeline server-side; throttling here
      // means we never trigger the server's 429 CONCURRENCY_LIMIT during
      // legitimate bulk work. The user still sees per-slot progress
      // landing as each call finishes - the bulk just doesn't stampede.
      const WAVE_SIZE = 4
      const fireOne = async (slot: typeof needGeneration[number]) => {
        const res = await fetch(`/api/planner/slot/${slot.id}/generate-script`, {
          method: 'POST',
        })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Generation failed')

        // Update progress incrementally as each slot lands. The bulk
        // status is fully optimistic - each completion bumps `done`
        // immediately.
        setCampaignBulkProgress((prev) => {
          const next = new Map(prev)
          const cur = next.get(topicGroupId)
          if (cur) next.set(topicGroupId, { ...cur, done: cur.done + 1 })
          return next
        })
        return slot.id
      }

      const failedSlots: typeof needGeneration = []
      for (let i = 0; i < needGeneration.length; i += WAVE_SIZE) {
        const wave = needGeneration.slice(i, i + WAVE_SIZE)
        const waveResults = await Promise.allSettled(wave.map(fireOne))
        waveResults.forEach((r, j) => {
          if (r.status === 'rejected') failedSlots.push(wave[j])
        })
      }

      // Retry pass: failures here are usually one-off bad generation rolls
      // (truncated JSON), so give each failed slot one more sequential shot
      // before reporting it. Sequential on purpose - no wave pressure.
      let failed = 0
      for (const slot of failedSlots) {
        try {
          await fireOne(slot)
        } catch {
          failed += 1
        }
      }
      if (failed > 0) {
        setCampaignBulkProgress((prev) => {
          const next = new Map(prev)
          const cur = next.get(topicGroupId)
          if (cur) next.set(topicGroupId, { ...cur, failed })
          return next
        })
      }

      // Background refresh to sync slot state (status='drafted',
      // generation_meta.script, checklist) into local data.
      void refresh()

      // Clear progress after a short delay so the banner stays up long
      // enough for the user to see the final count before disappearing.
      // When ANY slot failed, the banner stays until dismissed - a 5s
      // flash is how failed slots went unnoticed and exported without
      // scripts.
      if (failed === 0) {
        setTimeout(() => {
          setCampaignBulkProgress((prev) => {
            const next = new Map(prev)
            next.delete(topicGroupId)
            return next
          })
        }, 5000)
      }
    },
    [clientId, refresh],
  )

  const handleApproveSlot = useCallback(
    async (slotId: string) => {
      // Optimistic - flip status to 'approved' immediately so the slot
      // card / drawer reflect the change with no flash. The server
      // validates checklist resolution; on failure (e.g. unresolved
      // items) we roll back and rethrow so the drawer can surface the
      // error to the user.
      //
      // PlannerSlot only tracks `approved_at` on the client side;
      // `approved_by` is server-side metadata that comes back on the
      // background refresh - we don't need to snapshot or roll it back
      // here.
      const slotBefore = data?.slots.find((s) => s.id === slotId)
      const prevStatus = slotBefore?.status ?? 'drafted'
      const prevApprovedAt = slotBefore?.approved_at ?? null

      const nowIso = new Date().toISOString()
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          slots: prev.slots.map((s) =>
            s.id === slotId
              ? { ...s, status: 'approved' as const, approved_at: nowIso }
              : s,
          ),
        }
      })

      try {
        const res = await fetch(`/api/planner/slot/${slotId}/approve`, { method: 'POST' })
        const j = await res.json()
        if (!j.success) {
          const unresolved = Array.isArray(j.unresolved) ? j.unresolved : []
          const detail =
            unresolved.length > 0
              ? `${j.error}: ${unresolved.map((u: { label: string }) => u.label).join(', ')}`
              : j.error || 'Approval failed'
          throw new Error(detail)
        }
        // Refresh in the background so server-derived fields (approved_by,
        // topic consumption) come in sync without blocking the UI.
        void refresh()
      } catch (e) {
        // Roll back the optimistic flip.
        setData((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            slots: prev.slots.map((s) =>
              s.id === slotId
                ? { ...s, status: prevStatus, approved_at: prevApprovedAt }
                : s,
            ),
          }
        })
        throw e instanceof Error ? e : new Error('Approval failed')
      }
    },
    [data, refresh],
  )

  const handleWithdrawApproval = useCallback(
    async (slotId: string) => {
      // Optimistic - flip 'approved' back to 'drafted' immediately, then fire
      // the API. Roll back + rethrow on failure so the drawer surfaces it.
      const slotBefore = data?.slots.find((s) => s.id === slotId)
      const prevStatus = slotBefore?.status ?? 'approved'
      const prevApprovedAt = slotBefore?.approved_at ?? null

      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          slots: prev.slots.map((s) =>
            s.id === slotId ? { ...s, status: 'drafted' as const, approved_at: null } : s,
          ),
        }
      })

      try {
        const res = await fetch(`/api/planner/slot/${slotId}/withdraw-approval`, { method: 'POST' })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Withdraw failed')
        void refresh()
      } catch (e) {
        setData((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            slots: prev.slots.map((s) =>
              s.id === slotId ? { ...s, status: prevStatus, approved_at: prevApprovedAt } : s,
            ),
          }
        })
        throw e instanceof Error ? e : new Error('Withdraw failed')
      }
    },
    [data, refresh],
  )

  const handleStoryUse = useCallback(
    async (id: string, used: boolean) => {
      // Optimistic - flip the item between queue + history immediately, then
      // fire the API. If it fails, refetch to restore the true state.
      setData((prev) => {
        if (!prev) return prev
        if (used) {
          const target = prev.storyQueue.find((s) => s.id === id)
          if (!target) return prev
          const usedNow = { ...target, consumed_at: new Date().toISOString() }
          return {
            ...prev,
            storyQueue: prev.storyQueue.filter((s) => s.id !== id),
            storyHistory: [usedNow, ...(prev.storyHistory ?? [])],
          }
        }
        // used=false -> move from history back to queue, clear consumed_at.
        const target = (prev.storyHistory ?? []).find((s) => s.id === id)
        if (!target) return prev
        const restored = { ...target, consumed_at: null }
        return {
          ...prev,
          storyQueue: [restored, ...prev.storyQueue],
          storyHistory: (prev.storyHistory ?? []).filter((s) => s.id !== id),
        }
      })
      try {
        const res = await fetch(`/api/planner/story-queue/${id}/use`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ used }),
        })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || (used ? 'Mark as used failed' : 'Unmark failed'))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed')
        await refresh()
      }
    },
    [refresh],
  )

  const handleStoryGenerate = useCallback(
    async (seedText?: string, intent?: StoryIntent) => {
      const res = await fetch('/api/planner/story-queue/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, seedText: seedText || null, intent: intent ?? null }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Generate failed')
      await refresh()
    },
    [clientId, refresh],
  )

  const handleStoryDelete = useCallback(async (id: string) => {
    // Optimistic - remove from queue + history immediately. Hard-delete on
    // server so the row is gone for good. Rollback via refetch on failure.
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        storyQueue: prev.storyQueue.filter((s) => s.id !== id),
        storyHistory: (prev.storyHistory ?? []).filter((s) => s.id !== id),
      }
    })
    try {
      const res = await fetch(`/api/planner/story-queue/${id}`, { method: 'DELETE' })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Delete failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
      await refresh()
    }
  }, [refresh])

  const handleStoryRegenerate = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/planner/story-queue/${id}/regenerate`, {
          method: 'POST',
        })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Regenerate failed')
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Regenerate failed')
      }
    },
    [refresh],
  )

  const handleStoryRefill = useCallback(async () => {
    const res = await fetch('/api/planner/story-queue/refill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    })
    const j = await res.json()
    if (j.success) await refresh()
  }, [clientId, refresh])

  const handleStoryPin = useCallback(
    async (id: string, date: string | null) => {
      // Optimistic - flip pinned_to_date in local state immediately so the
      // calendar card appears/disappears/moves without waiting for the API.
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          storyQueue: prev.storyQueue.map((s) =>
            s.id === id ? { ...s, pinned_to_date: date } : s,
          ),
        }
      })
      try {
        const res = await fetch(`/api/planner/story-queue/${id}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledDate: date }),
        })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Pin failed')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Pin failed')
        await refresh()
      }
    },
    [refresh],
  )

  const createShareLink = useCallback(async () => {
    setCreatingShare(true)
    try {
      const res = await fetch('/api/planner/share-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, ttlDays: 90 }),
      })
      const j = await res.json()
      if (!j.success || !j.link) throw new Error(j.error || 'Failed')
      const url = `${window.location.origin}/plan/${j.link.token}`
      await navigator.clipboard.writeText(url)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2500)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Share link failed')
    } finally {
      setCreatingShare(false)
    }
  }, [clientId, refresh])

  const loadExportCampaigns = useCallback(async () => {
    setCampaignsLoading(true)
    try {
      const res = await fetch(`/api/planner/export/${clientId}/campaigns`, {
        cache: 'no-store',
      })
      const j = await res.json()
      if (j.success && Array.isArray(j.campaigns)) {
        setExportCampaigns(j.campaigns)
      }
    } catch (e) {
      // Non-fatal - if loading the campaign list fails, "Export all"
      // still works.
      console.warn('[planner] failed to load export campaigns:', e)
    } finally {
      setCampaignsLoading(false)
    }
  }, [clientId])

  const handleExportToGoogleDoc = useCallback(async (campaignId?: string | null) => {
    setExportError(null)
    setLastExportDocs([])
    setLastExportMissing(0)
    setCopiedDocId(null)
    setExporting(true)
    setExportMenuOpen(false)
    try {
      const res = await fetch(`/api/planner/export/${clientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaignId ? { campaignId } : {}),
      })
      const j = await res.json()
      if (!j.success) {
        throw new Error(j.error || 'Export failed')
      }
      if (typeof j.missingScriptCount === 'number') {
        setLastExportMissing(j.missingScriptCount)
      }

      if (j.mode === 'gdoc' && Array.isArray(j.docs) && j.docs.length > 0) {
        // One doc per campaign. Surface all in the banner so the user
        // can copy / open each. Auto-open the first one for instant
        // gratification.
        setLastExportDocs(j.docs as ExportedDoc[])
        window.open(j.docs[0].docUrl, '_blank', 'noopener,noreferrer')
      } else if (j.mode === 'docx' && j.docxBase64) {
        // Fallback - trigger a browser download of the .docx blob.
        const binary = atob(j.docxBase64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = j.filename || 'export.docx'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        // Surface a soft warning so staff see that Apps Script fell
        // through - means they should check the webhook health.
        if (j.fallbackReason) {
          setExportError(`Downloaded .docx (Google Docs fallback: ${j.fallbackReason})`)
        }
      } else {
        throw new Error('Export response had no docUrl or docxBase64')
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [clientId])

  const handleDeletePlan = useCallback(async (mode: 'safe' | 'purge') => {
    setDeleting(true)
    setError('')
    try {
      const res = await fetch('/api/planner/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          from: fromDate,
          to: toDate,
          purge: mode === 'purge',
        }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Delete failed')
      await refresh()
      // Months may have emptied out entirely - refresh the strip so
      // they drop off the navigation.
      void loadMonthsWithSlots()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [clientId, fromDate, toDate, refresh, loadMonthsWithSlots])

  const stageEvalText = useMemo(() => {
    if (!data?.stage) return null
    const { criteriaMet, criteriaTotal, currentStage, nextStage } = data.stage
    if (!nextStage) return `${capitalize(currentStage)} (max stage reached)`
    return `${capitalize(currentStage)} - ${criteriaMet.length} of ${criteriaTotal} criteria for ${capitalize(nextStage)} met`
  }, [data?.stage])

  // Picker-driven horizon. The grid renders months between fromDate and
  // pickerHorizonEnd (exclusive), so dragging the date pickers updates the
  // calendar immediately while the new server data fetches silently.
  const pickerHorizonEnd = useMemo(() => {
    const d = new Date(`${toDate}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }, [toDate])

  const visibleSlots = useMemo(() => {
    if (!data) return []
    // Client-side sort honors display_order so optimistic reorders are
    // reflected immediately. Fallback to created_at for ties / pre-existing
    // rows where display_order = 0.
    return [...data.slots]
      .filter((s) => s.scheduled_date >= fromDate && s.scheduled_date <= toDate)
      .sort((a, b) => {
        if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date.localeCompare(b.scheduled_date)
        const ao = a.display_order ?? 0
        const bo = b.display_order ?? 0
        if (ao !== bo) return ao - bo
        return a.id.localeCompare(b.id)
      })
  }, [data, fromDate, toDate])

  // Range-aware framing for the Generate/Regenerate button + confirm modal.
  // MUST key off visibleSlots (the selected from/to range), not data.slots -
  // data.slots merges every range viewed this session, so after loading a
  // populated month the button would read "Regenerate plan" on a month
  // that has nothing in it yet. `replace` counts what regeneration would
  // actually wipe (unlocked planned slots); everything else survives.
  const rangePlan = useMemo(() => {
    const replace = visibleSlots.filter((s) => s.status === 'planned' && !s.locked).length
    return { total: visibleSlots.length, replace, keep: visibleSlots.length - replace }
  }, [visibleSlots])

  // Derive openSlot from data + openSlotId. Auto-closes when the slot is
  // gone (e.g. after optimistic delete) and auto-syncs when fields change
  // (e.g. after lock toggle, format swap, regenerate).
  const openSlot = useMemo(() => {
    if (!openSlotId || !data) return null
    return data.slots.find((s) => s.id === openSlotId) ?? null
  }, [data, openSlotId])

  // Campaign-wide "needs script" count for the open slot's campaign,
  // fetched server-side. data.slots is scoped to the visible calendar
  // window (starts at today), so counting locally misses campaign slots
  // scheduled in the past - the drawer's bulk-generate button would hide
  // itself while ungenerated slots still existed. Null while loading or
  // on fetch failure; the drawer falls back to the local count then.
  const [campaignPendingCount, setCampaignPendingCount] = useState<number | null>(null)
  const openSlotGroupId = openSlot?.topic_group_id ?? null
  useEffect(() => {
    setCampaignPendingCount(null)
    if (!openSlotGroupId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/planner/campaign-pending?clientId=${clientId}&topicGroupId=${openSlotGroupId}`,
          { cache: 'no-store' },
        )
        const j = await res.json()
        if (!cancelled && j.success && Array.isArray(j.slots)) {
          setCampaignPendingCount(j.slots.length)
        }
      } catch {
        // Non-fatal - the drawer falls back to the locally-computed count.
      }
    })()
    return () => {
      cancelled = true
    }
    // `data` is a dep so the count refetches after any refresh() - e.g.
    // when a bulk generation finishes and slots flip to drafted.
  }, [openSlotGroupId, clientId, data])

  const visiblePinnedStories = useMemo(
    () =>
      data
        ? data.storyQueue.filter(
            (s) => !!s.pinned_to_date && s.pinned_to_date >= fromDate && s.pinned_to_date <= toDate,
          )
        : [],
    [data, fromDate, toDate],
  )


  if (loading) {
    return (
      <>
        <Header title="Planner" />
        <div className="p-8 flex items-center justify-center text-[var(--text-tertiary)]">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading planner...
        </div>
      </>
    )
  }

  if (!data) {
    // Only show the error fallback when we actually have an error message.
    // Otherwise stay in the loading state - data null without error means
    // a fetch is in flight (e.g. just-aborted refresh waiting for the new
    // one to land), and showing red text in that gap is misleading.
    if (!error) {
      return (
        <>
          <Header title="Planner" />
          <div className="p-8 flex items-center justify-center text-[var(--text-tertiary)]">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading planner...
          </div>
        </>
      )
    }
    return (
      <>
        <Header title="Planner" />
        <div className="p-8 text-red-500">{error}</div>
      </>
    )
  }

  const brandLabel = data.client.business_name || data.client.name || 'Brand'

  return (
    <>
      <Header title={`Planner - ${brandLabel}`} />
      <div className="p-4 md:p-6 space-y-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-[var(--text-primary)]">{brandLabel}</span>
            <StatusPill tone="info">{capitalize(data.stage.currentStage)}</StatusPill>
            {stageEvalText && (
              <span className="text-xs text-[var(--text-tertiary)] hidden md:inline">{stageEvalText}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              from={fromDate}
              to={toDate}
              onChange={(f, t) => {
                setFromDate(f)
                setToDate(t)
              }}
            />

            <Button variant="outline" size="sm" onClick={createShareLink} isLoading={creatingShare}>
              <Share2 className="h-4 w-4 mr-1" />
              {shareCopied ? 'Link copied' : 'Share view-only'}
            </Button>

            <div className="relative">
              <div className="inline-flex">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExportToGoogleDoc(null)}
                  isLoading={exporting}
                  disabled={exporting || data.slots.length === 0}
                  title={
                    data.slots.length === 0
                      ? 'No slots to export'
                      : 'Export all campaigns to a Google Doc (one tab per campaign)'
                  }
                  className="rounded-r-none"
                >
                  <FileText className="h-4 w-4 mr-1" />
                  Export
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!exportMenuOpen) void loadExportCampaigns()
                    setExportMenuOpen((v) => !v)
                  }}
                  disabled={exporting || data.slots.length === 0}
                  title="Pick a specific campaign to export"
                  className="rounded-l-none border-l-0 px-2"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>

              {exportMenuOpen && (
                <div
                  className="absolute right-0 mt-1 z-50 w-72 max-w-[calc(100vw-1rem)] glass-pop rounded-md overflow-hidden"
                  onMouseLeave={() => setExportMenuOpen(false)}
                >
                  <button
                    onClick={() => handleExportToGoogleDoc(null)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 border-b border-[var(--glass-border)]"
                  >
                    <div className="font-semibold text-[var(--text-primary)]">All campaigns</div>
                    <div className="text-[var(--text-tertiary)]">Every campaign on its own Doc tab</div>
                  </button>
                  {campaignsLoading ? (
                    <div className="px-3 py-2 text-xs text-[var(--text-tertiary)] flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading campaigns...
                    </div>
                  ) : exportCampaigns.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">No campaigns yet</div>
                  ) : (
                    exportCampaigns.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleExportToGoogleDoc(c.topicGroupId)}
                        disabled={!c.topicGroupId}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 border-b border-[var(--glass-border)] last:border-b-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={!c.topicGroupId ? 'Untyped slots cannot be exported individually' : undefined}
                      >
                        <div className="font-semibold text-[var(--text-primary)]">{c.label}</div>
                        <div className="text-[var(--text-tertiary)]">{c.slotCount} slots</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <Button size="sm" onClick={handleGenerateClick} disabled={genStatus === 'running' || pickerLoading}>
              {rangePlan.total > 0 ? 'Regenerate plan' : 'Generate plan'}
            </Button>

            <KebabMenu
              items={[
                { type: 'section', label: 'Danger zone' },
                {
                  label: 'Clear unlocked slots',
                  hint: 'Wipes planned + unlocked slots and any un-used pinned stories in the visible range. Locked, drafted, and approved slots are preserved.',
                  icon: <Trash2 className="h-4 w-4" />,
                  tone: 'destructive',
                  disabled: deleting || data.slots.length === 0,
                  onClick: () => setConfirmDelete('safe'),
                },
                {
                  label: 'Purge entire range',
                  hint: 'Deletes EVERY slot in the visible range, including locked and approved. This cannot be undone.',
                  icon: <Trash2 className="h-4 w-4" />,
                  tone: 'destructive',
                  disabled: deleting || data.slots.length === 0,
                  onClick: () => setConfirmDelete('purge'),
                },
              ]}
            />
          </div>
        </div>

        {data.stage.proposed_stage && !data.stage.dismissed_at && (
          <StageAdvancementBanner
            clientId={clientId}
            currentStage={data.stage.currentStage}
            proposedStage={data.stage.proposed_stage}
            criteriaMet={data.stage.criteriaMet.length}
            criteriaTotal={data.stage.criteriaTotal}
            onChange={refresh}
          />
        )}

        {error && (
          <Card>
            <CardContent className="text-sm text-red-500">
              <div className="flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError('')} className="p-1">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {lastExportDocs.length > 0 && (
          <Card>
            <CardContent className="text-sm text-[var(--text-primary)]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                  Last export - {lastExportDocs.length} {lastExportDocs.length === 1 ? 'doc' : 'docs'} created
                </div>
                <button
                  onClick={() => {
                    setLastExportDocs([])
                    setLastExportMissing(0)
                  }}
                  className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/5"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {lastExportMissing > 0 && (
                <div className="mb-2 text-[11px] text-amber-500">
                  {lastExportMissing} slot{lastExportMissing === 1 ? '' : 's'} had no script
                  and exported as placeholders. Open a slot in that campaign and run
                  campaign generation to fill them, then export again.
                </div>
              )}
              <div className="space-y-1.5">
                {lastExportDocs.map((doc) => (
                  <div
                    key={doc.docId}
                    className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-md hover:bg-white/5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-[var(--text-primary)] truncate">{doc.name}</div>
                      <a
                        href={doc.docUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-[#2B79F7] underline truncate inline-block max-w-full"
                      >
                        {doc.docUrl}
                      </a>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(doc.docUrl)
                            setCopiedDocId(doc.docId)
                            setTimeout(() => setCopiedDocId(null), 2000)
                          } catch {
                            setCopiedDocId(null)
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md glass-chip"
                        title="Copy doc URL"
                      >
                        {copiedDocId === doc.docId ? (
                          <>
                            <CheckIcon className="h-3 w-3 text-green-500" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {exportError && (
          <Card>
            <CardContent className="text-sm text-red-500">
              <div className="flex items-center justify-between">
                <span>Export failed: {exportError}</span>
                <button onClick={() => setExportError(null)} className="p-1">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bulk-generate progress banner. One row per active or recently-
            completed campaign-bulk-generate. Clean runs auto-dismiss 5s
            after the last slot finishes (handled in handleGenerateCampaign);
            runs with failures stay until dismissed so failed slots can't
            slip by unnoticed and export without scripts. */}
        {campaignBulkProgress.size > 0 && (
          <Card>
            <CardContent className="text-sm text-[var(--text-primary)] space-y-2">
              {Array.from(campaignBulkProgress.entries()).map(([topicGroupId, progress]) => {
                const finished = progress.done + progress.failed
                const pct = progress.total > 0 ? Math.round((finished / progress.total) * 100) : 0
                const isDone = finished >= progress.total
                return (
                  <div key={topicGroupId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        {isDone ? 'Campaign generation complete' : 'Generating campaign'}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums text-[var(--text-tertiary)]">
                          {progress.done} / {progress.total}
                          {progress.failed > 0 ? ` (${progress.failed} failed)` : ''}
                        </span>
                        {isDone && (
                          <button
                            onClick={() =>
                              setCampaignBulkProgress((prev) => {
                                const next = new Map(prev)
                                next.delete(topicGroupId)
                                return next
                              })
                            }
                            className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                            title="Dismiss"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full glass-rail overflow-hidden">
                      <div
                        className={[
                          'h-full transition-all duration-300',
                          progress.failed > 0 && isDone ? 'bg-amber-500' : 'bg-[#2B79F7]',
                        ].join(' ')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {isDone && progress.failed > 0 && (
                      <div className="text-[11px] text-amber-500">
                        {progress.failed} slot{progress.failed === 1 ? '' : 's'} failed to
                        generate. Open a slot in this campaign and run campaign generation
                        again to retry the missing ones.
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}

        {/* Populated-slots badge strip. Always shows whenever the client has
            ANY generated slots, listing each month with its slot count + date
            range. Click to jump the calendar to that month. */}
        {monthsWithSlots.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto py-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold flex-shrink-0">
              Populated slots
            </span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {monthsWithSlots.map((m) => {
                // Highlight the chip whose range overlaps the current
                // picker - lets the user see which month they're looking
                // at without doing date math in their head.
                const isCurrent = m.firstDate <= toDate && m.lastDate >= fromDate
                const fmtDay = (ymd: string) =>
                  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })
                const monthName = new Date(`${m.ym}-01T00:00:00Z`).toLocaleDateString('en-US', {
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
                })
                const dateRange = `${monthName}: ${fmtDay(m.firstDate)} to ${fmtDay(m.lastDate)}`
                return (
                  <button
                    key={m.ym}
                    type="button"
                    onClick={() => {
                      // Jump the picker to the full month so the calendar
                      // re-centers on the clicked month's plan.
                      setFromDate(m.firstDate)
                      setToDate(m.lastDate)
                    }}
                    title={`${m.firstDate} to ${m.lastDate} (${m.slotCount} slot${m.slotCount === 1 ? '' : 's'})`}
                    className={[
                      'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full transition-colors whitespace-nowrap',
                      isCurrent ? 'glass-chip-active' : 'glass-chip',
                    ].join(' ')}
                  >
                    {dateRange}
                    <span
                      className={[
                        'text-[10px] tabular-nums rounded-full px-1.5',
                        isCurrent ? 'bg-white/20 text-white' : 'bg-white/10 text-[var(--text-tertiary)]',
                      ].join(' ')}
                    >
                      {m.slotCount}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Material readiness: enough usable topics for the tier, and which
            topics have thin/missing answers that will drop a stream's pieces. */}
        <ReadinessPanel
          clientId={clientId}
          months={Math.max(
            1,
            Math.round(
              ((new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) /
                86_400_000 +
                1) /
                30.4,
            ),
          )}
        />

        {/* Coverage bar */}
        <CoverageBar coverage={data.coverage.current} target={data.target} />

        {/* Calendar + sidebar. Horizon is driven by the picker (not server)
            so date changes feel instant. visibleSlots filters out anything
            outside the picker range so the empty/non-empty states stay in
            sync even before the silent refetch lands. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-4">
          <PlannerCalendarGrid
            slots={visibleSlots}
            pinnedStories={visiblePinnedStories}
            horizonStart={fromDate}
            horizonEnd={pickerHorizonEnd}
            onSlotClick={(s) => setOpenSlotId(s.id)}
            onSlotDrop={handleReschedule}
            onSlotReorder={handleSlotReorder}
            onPinnedStoryDrop={(id, newDate) => handleStoryPin(id, newDate)}
          />

          <StoryQueuePanel
            items={data.storyQueue}
            history={data.storyHistory ?? []}
            onUse={handleStoryUse}
            onGenerate={handleStoryGenerate}
            onRefill={handleStoryRefill}
            onPin={handleStoryPin}
            onRegenerate={handleStoryRegenerate}
            onDelete={async (id) => setConfirmDeleteStory(id)}
          />
        </div>

        {visibleSlots.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-[var(--text-tertiary)]">
              <CalendarIcon className="h-8 w-8 mx-auto mb-2 opacity-60" />
              <p>No slots yet. Click Generate plan to populate this month.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmModal
        open={confirmGenerate}
        title={rangePlan.total > 0 ? 'Regenerate plan?' : 'Generate plan'}
        message={
          rangePlan.total === 0
            ? `This will create a content plan from ${fromDate} to ${toDate} using unused material.`
            : rangePlan.replace > 0
              ? `This range (${fromDate} to ${toDate}) has ${rangePlan.total} slot${rangePlan.total === 1 ? '' : 's'}. Regenerating replaces the ${rangePlan.replace} planned unlocked one${rangePlan.replace === 1 ? '' : 's'} with a fresh plan${rangePlan.keep > 0 ? ` and keeps the ${rangePlan.keep} drafted, approved, or locked one${rangePlan.keep === 1 ? '' : 's'}` : ''}.`
              : `All ${rangePlan.total} slot${rangePlan.total === 1 ? '' : 's'} in ${fromDate} to ${toDate} ${rangePlan.total === 1 ? 'is' : 'are'} drafted, approved, or locked and will be kept. New slots will be planned around them using unused material.`
        }
        confirmLabel="Generate"
        // Pass the scope explicitly - the modal re-renders after the picker
        // sets scopedTopicGroupIds, so this arrow always reads the fresh
        // selection regardless of handleGenerate's memoization.
        onConfirm={() => handleGenerate(scopedTopicGroupIds)}
        onClose={() => setConfirmGenerate(false)}
      />

      <ConfirmModal
        open={confirmDelete !== null}
        title={confirmDelete === 'purge' ? 'Purge entire range?' : 'Clear unlocked slots?'}
        tone="danger"
        message={
          confirmDelete === 'purge'
            ? `This will delete EVERY slot between ${fromDate} and ${toDate} (including locked, drafted, approved), all stories pinned in that range, AND clear the entire un-used story queue. This cannot be undone.`
            : `This will delete planned + unlocked slots and any un-used pinned stories between ${fromDate} and ${toDate}. Locked, drafted, and approved slots are preserved.`
        }
        confirmLabel={deleting ? 'Deleting...' : confirmDelete === 'purge' ? 'Purge everything' : 'Clear slots'}
        onConfirm={() => handleDeletePlan(confirmDelete ?? 'safe')}
        onClose={() => !deleting && setConfirmDelete(null)}
      />

      <TopicBatchPickerModal
        open={pickerOpen}
        batches={pickerBatches}
        loading={pickerLoading}
        onConfirm={handlePickerConfirm}
        onClose={() => setPickerOpen(false)}
      />

      <ConfirmModal
        open={confirmDeleteStory !== null}
        title="Delete this prompt?"
        tone="danger"
        message="The prompt will be permanently removed from the queue and history. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (confirmDeleteStory) await handleStoryDelete(confirmDeleteStory)
          setConfirmDeleteStory(null)
        }}
        onClose={() => setConfirmDeleteStory(null)}
      />

      {openSlot && (
        <SlotDetailDrawer
          slot={openSlot}
          formats={data.formats}
          onClose={() => setOpenSlotId(null)}
          onAction={handleSlotAction}
          onSwapFormat={handleSwapFormat}
          onApprove={handleApproveSlot}
          onWithdrawApproval={handleWithdrawApproval}
          onGenerateScript={handleGenerateScript}
          slotGenerating={slotInFlight[openSlot.id] === 'generating'}
          slotRegenerating={slotInFlight[openSlot.id] === 'regenerating'}
          onGenerateCampaign={handleGenerateCampaign}
          campaignSlotsRemaining={
            openSlot.topic_group_id
              ? // Server-fetched campaign-wide count when available; the
                // local count only covers slots in the visible calendar
                // window and misses past-dated ones.
                campaignPendingCount ??
                data.slots.filter((s) => {
                  if (s.topic_group_id !== openSlot.topic_group_id) return false
                  const meta = (s.generation_meta as Record<string, unknown>) ?? {}
                  const script = typeof meta.script === 'string' ? meta.script.trim() : ''
                  return !script
                }).length
              : 0
          }
          campaignBulkInFlight={
            openSlot.topic_group_id
              ? !!campaignBulkProgress.get(openSlot.topic_group_id)
              : false
          }
          onRefresh={refresh}
        />
      )}

      <PlanGenerationProgress
        status={genStatus}
        errorMessage={genError}
        warnings={genWarnings}
        onDismiss={() => {
          setGenStatus('idle')
          setGenError(undefined)
          setGenWarnings([])
        }}
      />
    </>
  )
}

function capitalize(s: string): string {
  if (!s) return ''
  return s[0].toUpperCase() + s.slice(1)
}

// Date helpers - YYYY-MM-DD strings (UTC) so they line up with the rest of
// the planner code (everything else stores dates as YYYY-MM-DD).
function todayYmd(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function endOfMonthYmd(d: Date): string {
  // Day 0 of next month = last day of this month.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`
}

