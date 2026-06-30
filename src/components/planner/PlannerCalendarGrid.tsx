'use client'

// Month-grid calendar with stream-colored slot cards. Drag a card to a
// different date to reschedule. Click a card to open the slot detail
// drawer. Mon-Fri are emphasized; weekend cells dim slightly to nudge
// the default placement rule but still accept drops.

import { useMemo, useState } from 'react'
import { Lock, Pin } from 'lucide-react'
import { STREAM_COLORS, type PlannerSlot, type SlotStream, type StoryQueueItem } from './types'

interface Props {
  slots: PlannerSlot[]
  /** Story queue items pinned to a date - rendered as a 5th card type in
   *  their pinned cell. Stories that aren't pinned stay in the queue sidebar. */
  pinnedStories?: StoryQueueItem[]
  horizonStart: string // yyyy-mm-dd, first day of starting month
  horizonEnd: string   // exclusive
  onSlotClick: (slot: PlannerSlot) => void
  onSlotDrop: (slotId: string, newDate: string) => Promise<{ warnings: string[] }>
  /** Within-day reorder: caller receives the FULL ordered list of slot ids
   *  for the given date and persists it. Optional; falls back to no-op if
   *  not wired. */
  onSlotReorder?: (date: string, slotIds: string[]) => Promise<void>
  /** Click handler for pinned story cards. Default behavior is to scroll the
   *  queue item into view via a `#story-{id}` anchor. */
  onPinnedStoryClick?: (story: StoryQueueItem) => void
  /** Drop handler for pinned story cards - re-pins to the new date. Optional;
   *  if absent, pinned stories aren't draggable. */
  onPinnedStoryDrop?: (storyId: string, newDate: string) => Promise<void>
}

interface DayCell {
  date: string
  inMonth: boolean
  isWeekend: boolean
  monthLabel: string | null
}

function buildMonthGrid(start: string): DayCell[] {
  // Calendar grid for one month: 6 rows of 7 days, padded with prev/next month days.
  const [y, m] = start.split('-').map((s) => parseInt(s, 10))
  const first = new Date(Date.UTC(y, m - 1, 1))
  const startWeekday = first.getUTCDay() // 0 = Sunday
  // Anchor grid to Sunday so week rows line up with Sun-Sat.
  const gridStart = new Date(first)
  gridStart.setUTCDate(gridStart.getUTCDate() - startWeekday)

  const out: DayCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setUTCDate(gridStart.getUTCDate() + i)
    const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    const inMonth = d.getUTCMonth() === m - 1
    out.push({
      date: ymd,
      inMonth,
      isWeekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
      monthLabel: inMonth && d.getUTCDate() === 1 ? d.toLocaleString(undefined, { month: 'long', year: 'numeric' }) : null,
    })
  }
  return out
}

function monthsInHorizon(start: string, end: string): string[] {
  // Returns first-of-month dates for every month that overlaps [start, end).
  // Walks forward until the month-start lands on or past end. Lexicographic
  // YYYY-MM-DD comparison works for this since YYYY-MM-DD strings sort
  // chronologically. The previous implementation compared month numbers and
  // returned [] when start and end were in the same month - bug fixed here.
  const out: string[] = []
  let y = parseInt(start.slice(0, 4), 10)
  let m = parseInt(start.slice(5, 7), 10)
  while (true) {
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
    if (monthStart >= end) break
    out.push(monthStart)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

export function PlannerCalendarGrid({
  slots,
  pinnedStories = [],
  horizonStart,
  horizonEnd,
  onSlotClick,
  onSlotDrop,
  onSlotReorder,
  onPinnedStoryClick,
  onPinnedStoryDrop,
}: Props) {
  const months = useMemo(() => monthsInHorizon(horizonStart, horizonEnd), [horizonStart, horizonEnd])
  const slotsByDate = useMemo(() => {
    const map = new Map<string, PlannerSlot[]>()
    for (const s of slots) {
      const arr = map.get(s.scheduled_date) ?? []
      arr.push(s)
      map.set(s.scheduled_date, arr)
    }
    return map
  }, [slots])
  const storiesByDate = useMemo(() => {
    const map = new Map<string, StoryQueueItem[]>()
    for (const s of pinnedStories) {
      if (!s.pinned_to_date) continue
      const arr = map.get(s.pinned_to_date) ?? []
      arr.push(s)
      map.set(s.pinned_to_date, arr)
    }
    return map
  }, [pinnedStories])

  // Default behavior: scroll the queue item with id="story-{id}" into view.
  // Lets users click a pinned story on the calendar and land on its full
  // prompt in the queue panel without us having to pass refs around.
  const handlePinnedClick = (story: StoryQueueItem) => {
    if (onPinnedStoryClick) {
      onPinnedStoryClick(story)
      return
    }
    const el = document.getElementById(`story-${story.id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-[#2B79F7]', 'ring-offset-2', 'ring-offset-[var(--bg-card)]')
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-[#2B79F7]', 'ring-offset-2', 'ring-offset-[var(--bg-card)]')
      }, 1500)
    }
  }

  return (
    <div className="space-y-6">
      {months.map((monthStart) => (
        <MonthBlock
          key={monthStart}
          monthStart={monthStart}
          slotsByDate={slotsByDate}
          storiesByDate={storiesByDate}
          onSlotClick={onSlotClick}
          onSlotDrop={onSlotDrop}
          onSlotReorder={onSlotReorder}
          onPinnedStoryClick={handlePinnedClick}
          onPinnedStoryDrop={onPinnedStoryDrop}
        />
      ))}
    </div>
  )
}

interface MonthBlockProps {
  monthStart: string
  slotsByDate: Map<string, PlannerSlot[]>
  storiesByDate: Map<string, StoryQueueItem[]>
  onSlotClick: (slot: PlannerSlot) => void
  onSlotDrop: (slotId: string, newDate: string) => Promise<{ warnings: string[] }>
  onSlotReorder?: (date: string, slotIds: string[]) => Promise<void>
  onPinnedStoryClick: (story: StoryQueueItem) => void
  onPinnedStoryDrop?: (storyId: string, newDate: string) => Promise<void>
}

interface DragPayload {
  kind: 'slot' | 'story'
  id: string
  /** YYYY-MM-DD source date - used to detect within-day reorder vs cross-day move. */
  sourceDate?: string
}

function parseDragPayload(raw: string): DragPayload | null {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.kind !== 'slot' && parsed.kind !== 'story') return null
    if (typeof parsed.id !== 'string') return null
    return parsed as DragPayload
  } catch {
    return null
  }
}

function MonthBlock({
  monthStart,
  slotsByDate,
  storiesByDate,
  onSlotClick,
  onSlotDrop,
  onSlotReorder,
  onPinnedStoryClick,
  onPinnedStoryDrop,
}: MonthBlockProps) {
  const grid = useMemo(() => buildMonthGrid(monthStart), [monthStart])
  const [dragOver, setDragOver] = useState<string | null>(null)
  // Insertion target: when the drag is hovering over a sibling slot in the
  // SAME date, dropTargetSlot identifies which sibling we'd insert before.
  const [dropTargetSlot, setDropTargetSlot] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const monthLabel = grid.find((c) => c.monthLabel)?.monthLabel

  // Cross-cell drop (or end-of-cell drop). Within-day reorder is handled
  // separately via SlotCard's own drop handler.
  const handleCellDrop = async (date: string, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(null)
    setDropTargetSlot(null)
    const raw = e.dataTransfer.getData('text/plain')
    if (!raw) return
    const payload = parseDragPayload(raw)
    if (!payload) return

    if (payload.kind === 'slot') {
      // Same-date drop on the cell (not on a sibling card): treat as "append
      // to end" if the slot was already on this date, else cross-day move.
      if (payload.sourceDate === date) {
        if (!onSlotReorder) return
        const cellSlots = slotsByDate.get(date) ?? []
        const filtered = cellSlots.filter((s) => s.id !== payload.id)
        const reordered = [...filtered.map((s) => s.id), payload.id]
        await onSlotReorder(date, reordered)
        return
      }
      const res = await onSlotDrop(payload.id, date)
      if (res.warnings.length) {
        setWarning(res.warnings[0])
        setTimeout(() => setWarning(null), 4000)
      }
    } else if (payload.kind === 'story' && onPinnedStoryDrop) {
      await onPinnedStoryDrop(payload.id, date)
    }
  }

  // Drop ON a sibling slot card: insert dragged slot BEFORE the target.
  const handleSlotCardDrop = async (
    targetSlotId: string,
    targetDate: string,
    e: React.DragEvent<HTMLDivElement>,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetSlot(null)
    setDragOver(null)
    const raw = e.dataTransfer.getData('text/plain')
    if (!raw) return
    const payload = parseDragPayload(raw)
    if (!payload || payload.kind !== 'slot') return
    if (payload.id === targetSlotId) return // no-op

    if (payload.sourceDate !== targetDate) {
      // Cross-day drop on a sibling: just route to cross-day handler. The
      // dropped slot lands on the new date; within-day position becomes
      // wherever the server's display_order places it (default = end).
      const res = await onSlotDrop(payload.id, targetDate)
      if (res.warnings.length) {
        setWarning(res.warnings[0])
        setTimeout(() => setWarning(null), 4000)
      }
      return
    }

    if (!onSlotReorder) return
    const cellSlots = slotsByDate.get(targetDate) ?? []
    const without = cellSlots.filter((s) => s.id !== payload.id)
    const targetIndex = without.findIndex((s) => s.id === targetSlotId)
    if (targetIndex < 0) return
    const reordered = [
      ...without.slice(0, targetIndex).map((s) => s.id),
      payload.id,
      ...without.slice(targetIndex).map((s) => s.id),
    ]
    await onSlotReorder(targetDate, reordered)
  }

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--glass-border)] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{monthLabel}</h3>
        {warning && (
          <span className="text-xs text-amber-500">{warning}</span>
        )}
      </div>

      <div className="grid grid-cols-7 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--glass-border)]">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="px-2 py-2 text-center">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {grid.map((cell, idx) => {
          const cellSlots = slotsByDate.get(cell.date) ?? []
          const cellStories = storiesByDate.get(cell.date) ?? []
          const totalCount = cellSlots.length + cellStories.length
          const isDragOver = dragOver === cell.date
          return (
            <div
              key={`${cell.date}-${idx}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(cell.date) }}
              onDragLeave={() => setDragOver((d) => (d === cell.date ? null : d))}
              onDrop={(e) => handleCellDrop(cell.date, e)}
              className={[
                'min-h-[112px] border-b border-r border-[var(--glass-border)] p-1.5 flex flex-col gap-1 transition-colors',
                cell.inMonth ? '' : 'opacity-40',
                cell.isWeekend && cell.inMonth ? 'bg-black/[0.04] dark:bg-white/[0.02]' : '',
                isDragOver ? 'bg-[#2B79F7]/15 ring-1 ring-[#2B79F7] ring-inset' : '',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
                  {parseInt(cell.date.slice(8), 10)}
                </span>
                {totalCount > 0 && (
                  <span className="text-[10px] text-[var(--text-tertiary)]">{totalCount}</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {cellSlots.map((s) => (
                  <SlotCard
                    key={s.id}
                    slot={s}
                    onClick={() => onSlotClick(s)}
                    isDropTarget={dropTargetSlot === s.id}
                    onCardDragOver={(e) => {
                      // Only show insertion line when the drag payload is a
                      // slot from the same date (within-day reorder).
                      e.preventDefault()
                      const types = Array.from(e.dataTransfer.types)
                      if (!types.includes('text/plain')) return
                      // We can't read dataTransfer during drag-over, so we
                      // optimistically show the indicator on hover; the drop
                      // handler will reject if the payload isn't a same-date slot.
                      setDropTargetSlot(s.id)
                    }}
                    onCardDragLeave={() => {
                      setDropTargetSlot((cur) => (cur === s.id ? null : cur))
                    }}
                    onCardDrop={(e) => handleSlotCardDrop(s.id, cell.date, e)}
                  />
                ))}
                {cellStories.map((st) => (
                  <PinnedStoryCard
                    key={st.id}
                    story={st}
                    onClick={() => onPinnedStoryClick(st)}
                    draggable={!!onPinnedStoryDrop}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function storyCardLabel(story: StoryQueueItem): string {
  // Unified frame model. Sticker stays separate; everything else shows
  // the source format name so the team can spot which post the story
  // is compressed from.
  if (story.carrier === 'sticker') return 'Sticker'
  if (story.carrier) {
    return story.source_format_name ? `Story · ${story.source_format_name}` : 'Story'
  }
  // Legacy fallback (pre-carrier rows).
  return story.format_name ?? 'Story'
}

function PinnedStoryCard({
  story,
  onClick,
  draggable,
}: {
  story: StoryQueueItem
  onClick: () => void
  draggable: boolean
}) {
  // Stories are intentionally toned-down vs the four streams - they're a
  // queue-side asset that happens to have a pin date, not a full calendar slot.
  return (
    <div
      draggable={draggable}
      onDragStart={(e) =>
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'story', id: story.id }))
      }
      onClick={onClick}
      className={[
        'group rounded-lg px-2 py-1.5 text-[11px] leading-tight text-left border border-current/20',
        'bg-slate-500/15 text-slate-500 dark:text-slate-300',
        'shadow-[0_2px_8px_-3px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.12)]',
        'hover:brightness-110 hover:-translate-y-px transition',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
      ].join(' ')}
      title={story.prompt_text}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-semibold inline-flex items-center gap-1">
          <Pin className="h-3 w-3 opacity-70" />
          {storyCardLabel(story)}
        </span>
      </div>
      <p className="truncate opacity-80 mt-0.5">{story.prompt_text}</p>
    </div>
  )
}

function SlotCard({
  slot,
  onClick,
  isDropTarget,
  onCardDragOver,
  onCardDragLeave,
  onCardDrop,
}: {
  slot: PlannerSlot
  onClick: () => void
  isDropTarget?: boolean
  onCardDragOver?: (e: React.DragEvent<HTMLDivElement>) => void
  onCardDragLeave?: () => void
  onCardDrop?: (e: React.DragEvent<HTMLDivElement>) => void
}) {
  const stream: SlotStream = slot.stream
  const palette = STREAM_COLORS[stream]
  const isApproved = slot.status === 'approved'
  const isDrafted = slot.status === 'drafted'

  return (
    <div
      draggable={!isApproved}
      onDragStart={(e) =>
        e.dataTransfer.setData(
          'text/plain',
          JSON.stringify({ kind: 'slot', id: slot.id, sourceDate: slot.scheduled_date }),
        )
      }
      onDragOver={onCardDragOver}
      onDragLeave={onCardDragLeave}
      onDrop={onCardDrop}
      onClick={onClick}
      className={[
        // Raised glass chip: stream tint + stream-colored hairline + soft drop
        // shadow + lit top edge (emboss) so it reads as a glass card on the grid.
        'relative group rounded-lg px-2 py-1.5 text-[11px] leading-tight border border-current/25',
        'shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]',
        palette.bg,
        palette.text,
        'hover:brightness-110 hover:-translate-y-px hover:shadow-[0_5px_14px_-4px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.18)] transition',
        isApproved ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
      ].join(' ')}
      title={slot.hook_preview ?? ''}
    >
      {isDropTarget && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 left-0 right-0 h-0.5 rounded-full bg-[#2B79F7] shadow-[0_0_0_2px_rgb(43_121_247_/_0.25)]"
        />
      )}
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-semibold">{slot.format_name ?? palette.label}</span>
        <span className="flex items-center gap-1">
          {slot.locked && <Lock className="h-3 w-3 opacity-70" />}
          {isApproved && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
          {isDrafted && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
        </span>
      </div>
      {slot.hook_preview && (
        <p className="truncate opacity-80 mt-0.5">{slot.hook_preview}</p>
      )}
    </div>
  )
}
