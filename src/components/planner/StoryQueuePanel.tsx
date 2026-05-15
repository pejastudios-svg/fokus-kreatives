'use client'

// Story queue sidebar. Lists unconsumed prompts. "+" generates a prompt
// (optional seed input). "Use" marks consumed and triggers a refill ping.

import { useState } from 'react'
import {
  Loader2,
  Plus,
  RefreshCw,
  Calendar as CalendarIcon,
  Check,
  Pin,
  History,
  Undo2,
  RotateCcw,
  Camera,
  Type as TypeIcon,
  Mic,
  Film,
  User as UserIcon,
  Trash2,
} from 'lucide-react'
import type { StoryFrame, StoryQueueItem } from './types'
import { DatePopover } from '@/components/ui/DatePopover'

interface Props {
  items: StoryQueueItem[]
  history?: StoryQueueItem[]
  /** used=true marks consumed; used=false unmarks (moves back to active queue). */
  onUse: (id: string, used: boolean) => Promise<void>
  onGenerate: (seedText?: string) => Promise<void>
  onRefill: () => Promise<void>
  onPin: (id: string, date: string | null) => Promise<void>
  /** Regenerates this prompt in place. Optional - falls back to no Redo button. */
  onRegenerate?: (id: string) => Promise<void>
  /** Hard-deletes the prompt from the DB. Optional - falls back to no Delete button. */
  onDelete?: (id: string) => Promise<void>
}

export function StoryQueuePanel({
  items,
  history = [],
  onUse,
  onGenerate,
  onRefill,
  onPin,
  onRegenerate,
  onDelete,
}: Props) {
  const [seed, setSeed] = useState('')
  const [busy, setBusy] = useState<'generate' | 'refill' | null>(null)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [regenerating, setRegenerating] = useState<string | null>(null)
  // Per-item busy states for the small action buttons (Mark as used, Pin,
  // Delete, Unmark). Each tracks WHICH item is currently mid-action so we
  // only disable the relevant button - other items' buttons stay clickable.
  const [usingItem, setUsingItem] = useState<string | null>(null)
  const [pinningItem, setPinningItem] = useState<string | null>(null)
  const [deletingItem, setDeletingItem] = useState<string | null>(null)

  const handleGenerate = async () => {
    setBusy('generate')
    setError('')
    try {
      await onGenerate(seed.trim() || undefined)
      setSeed('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed')
    } finally {
      setBusy(null)
    }
  }

  const handleRefill = async () => {
    setBusy('refill')
    try { await onRefill() } finally { setBusy(null) }
  }

  return (
    // Sticky-positioned panel that pins to the top of its grid cell and
    // caps its own height to the viewport. The header / seed / refill
    // controls stay frozen at the top; only the prompt list (below) scrolls
    // inside the panel. Without this, a long queue forced the user to
    // scroll the entire page to reach the bottom prompts.
    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)] flex flex-col sticky top-4 max-h-[calc(100vh-2rem)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border-primary)] flex items-center justify-between flex-shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Story queue</h3>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {items.length} ready{history.length > 0 ? ` · ${history.length} in history` : ''}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowHistory((v) => !v)}
            disabled={history.length === 0}
            className={[
              'p-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
              showHistory
                ? 'bg-[#2B79F7]/15 text-[#2B79F7]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
            ].join(' ')}
            title={showHistory ? 'Hide history' : 'Show history'}
            aria-label={showHistory ? 'Hide history' : 'Show history'}
          >
            <History className="h-4 w-4" />
          </button>
          <button
            onClick={handleRefill}
            disabled={busy !== null}
            className="p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
            title="Refill queue"
          >
            {busy === 'refill' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-[var(--border-primary)] space-y-2 flex-shrink-0">
        <textarea
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="Optional seed idea..."
          rows={2}
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] resize-none"
        />
        <button
          onClick={handleGenerate}
          disabled={busy !== null}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-[#2B79F7] text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New prompt
        </button>
      </div>

      {error && <div className="px-4 py-2 text-xs text-red-500">{error}</div>}

      {/* flex-1 fills the remaining height inside the sticky-capped
          panel. The internal scroll is bounded by the parent's
          max-h-[calc(100vh-2rem)] - no separate pixel cap needed. */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--text-tertiary)]">
            No prompts queued yet. Click New prompt or Refill to start.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-primary)]">
            {items.map((item) => (
              <li
                key={item.id}
                id={`story-${item.id}`}
                className="px-4 py-3 space-y-2 transition-shadow rounded-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <StoryHeaderLabel item={item} />
                    {item.who_films && <WhoFilmsChip whoFilms={item.who_films} />}
                  </div>
                </div>

                <StoryBriefView item={item} />

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={async () => {
                      if (usingItem) return
                      setUsingItem(item.id)
                      try {
                        await onUse(item.id, true)
                      } finally {
                        setUsingItem(null)
                      }
                    }}
                    disabled={usingItem === item.id}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {usingItem === item.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}{' '}
                    Mark as used
                  </button>

                  <DatePopover
                    value={item.pinned_to_date}
                    onChange={async (d) => {
                      if (pinningItem) return
                      setPinningItem(item.id)
                      try {
                        await onPin(item.id, d)
                      } finally {
                        setPinningItem(null)
                      }
                    }}
                    allowClear
                    align="left"
                    disabled={pinningItem === item.id}
                  >
                    <span
                      className={[
                        'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors',
                        item.pinned_to_date
                          ? 'bg-[#2B79F7]/15 text-[#2B79F7] hover:bg-[#2B79F7]/25'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
                        pinningItem === item.id ? 'opacity-50 cursor-not-allowed' : '',
                      ].join(' ')}
                    >
                      {pinningItem === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : item.pinned_to_date ? (
                        <>
                          <Pin className="h-3 w-3" />
                          Pinned: {item.pinned_to_date}
                        </>
                      ) : (
                        <>
                          <CalendarIcon className="h-3 w-3" />
                          Pin to date
                        </>
                      )}
                    </span>
                  </DatePopover>

                  {onRegenerate && (
                    <button
                      onClick={async () => {
                        if (regenerating) return
                        setRegenerating(item.id)
                        try {
                          await onRegenerate(item.id)
                        } finally {
                          setRegenerating(null)
                        }
                      }}
                      disabled={regenerating === item.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                      title="Regenerate this prompt"
                    >
                      {regenerating === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      Redo
                    </button>
                  )}

                  {onDelete && (
                    <button
                      onClick={async () => {
                        if (deletingItem) return
                        setDeletingItem(item.id)
                        try {
                          await onDelete(item.id)
                        } finally {
                          setDeletingItem(null)
                        }
                      }}
                      disabled={deletingItem === item.id}
                      className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Delete this prompt permanently"
                    >
                      {deletingItem === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {showHistory && history.length > 0 && (
          <>
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-tertiary)] bg-[var(--bg-secondary)] border-y border-[var(--border-primary)]">
              History
            </div>
            <ul className="divide-y divide-[var(--border-primary)]">
              {history.map((item) => (
                <li key={item.id} id={`story-${item.id}`} className="px-4 py-3 space-y-1.5 opacity-75 hover:opacity-100 transition-opacity">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                      {item.format_name ?? 'Story'}
                    </span>
                    {item.consumed_at && (
                      <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                        Used {formatRelativeShort(item.consumed_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] leading-snug line-clamp-2">{item.prompt_text}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        if (usingItem) return
                        setUsingItem(item.id)
                        try {
                          await onUse(item.id, false)
                        } finally {
                          setUsingItem(null)
                        }
                      }}
                      disabled={usingItem === item.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Move back to the active queue"
                    >
                      {usingItem === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Undo2 className="h-3 w-3" />
                      )}{' '}
                      Unmark
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function formatRelativeShort(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMin = Math.round((now - then) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.round(diffH / 24)
  if (diffD < 30) return `${diffD}d ago`
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function StoryHeaderLabel({ item }: { item: StoryQueueItem }) {
  // New shape - shows the carrier + the source format being compressed.
  if (item.carrier) {
    if (item.carrier === 'sticker') {
      return (
        <span className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
          Sticker Story
        </span>
      )
    }
    // Unified frame model: a story is just "Story · {source format}".
    // (Old rows with carrier='slides' fall through to the same label.)
    const sourceName = item.source_format_name
    return (
      <>
        <span className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
          Story
        </span>
        {sourceName && (
          <span className="text-[10px] text-[var(--text-tertiary)]">
            · {sourceName}
          </span>
        )}
      </>
    )
  }
  // Legacy shape - just shows the old story-native format name.
  return (
    <>
      <span className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
        {item.format_name ?? 'Story'}
      </span>
      {item.frames && item.frames.length > 1 && (
        <span className="text-[10px] text-[var(--text-tertiary)]">
          · {item.frames.length} frames
        </span>
      )}
    </>
  )
}

function WhoFilmsChip({ whoFilms }: { whoFilms: 'agency' | 'client' }) {
  const isClient = whoFilms === 'client'
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium',
        isClient
          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
      ].join(' ')}
      title={isClient ? 'Client must film this' : 'Agency produces in-house'}
    >
      {isClient ? <UserIcon className="h-3 w-3" /> : <Film className="h-3 w-3" />}
      {isClient ? 'Client films' : 'Agency'}
    </span>
  )
}

/** Renders the production brief. New rows have structured `frames`; legacy
 *  rows fall back to the old prompt_text + visual_direction shape. */
function StoryBriefView({ item }: { item: StoryQueueItem }) {
  // New shape: carrier is set, frames jsonb actually holds beats
  // (HOOK / VALUE / REHOOK / CTA in the unified frame model).
  if (item.carrier && Array.isArray(item.frames) && item.frames.length > 0) {
    return (
      <div className="space-y-2">
        {item.carrier === 'sticker' ? (
          <StickerBriefView item={item} />
        ) : (
          item.frames.map((beat, idx) => (
            <BeatView
              key={idx}
              beat={beat as unknown as { label: string; capture: string; on_screen_text: string; voiceover: string }}
              index={idx}
            />
          ))
        )}
      </div>
    )
  }
  // Legacy multi-frame shape (rows generated before the carrier redesign).
  if (Array.isArray(item.frames) && item.frames.length > 0) {
    return (
      <div className="space-y-2">
        {item.frames.map((frame, idx) => (
          <FrameView key={idx} frame={frame} index={idx} total={item.frames!.length} />
        ))}
      </div>
    )
  }
  // Even older legacy: just text + visual direction.
  return (
    <div className="space-y-1">
      <p className="text-sm text-[var(--text-primary)] leading-snug">{item.prompt_text}</p>
      {item.visual_direction && (
        <p className="text-xs text-[var(--text-tertiary)] italic">{item.visual_direction}</p>
      )}
    </div>
  )
}

function BeatView({
  beat,
  index,
}: {
  beat: { label: string; capture: string; on_screen_text: string; voiceover: string }
  index: number
}) {
  // Unified frame model: every beat is a labelled text-first frame. We
  // always show the on-screen text + the visual hint, and only show the
  // voiceover line for legacy rows that still have one (new rows write '').
  const labelText = `FRAME ${index + 1} · ${beat.label}`
  return (
    <div className="rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] p-2.5 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
        <span className="px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
          {labelText}
        </span>
      </div>
      {beat.on_screen_text && (
        <FrameField icon={<TypeIcon className="h-3 w-3" />} label="On-screen" value={beat.on_screen_text} />
      )}
      {beat.capture && (
        <FrameField icon={<Camera className="h-3 w-3" />} label="Visual" value={beat.capture} />
      )}
      {beat.voiceover && (
        <FrameField icon={<Mic className="h-3 w-3" />} label="Voiceover (legacy)" value={beat.voiceover} />
      )}
    </div>
  )
}

function StickerBriefView({ item }: { item: StoryQueueItem }) {
  // Sticker stories are HOOK + CTA (the sticker IS the CTA). Render as a
  // single visual block since the two beats are conceptually one frame.
  const beats = (item.frames ?? []) as unknown as Array<{
    label: string
    capture: string
    on_screen_text: string
  }>
  const hook = beats.find((b) => b.label === 'HOOK')
  const cta = beats.find((b) => b.label === 'CTA')
  return (
    <div className="rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] p-2.5 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
        <span className="px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
          STICKER STORY
        </span>
      </div>
      {hook?.capture && (
        <FrameField icon={<Camera className="h-3 w-3" />} label="Visual" value={hook.capture} />
      )}
      {hook?.on_screen_text && (
        <FrameField icon={<TypeIcon className="h-3 w-3" />} label="Question" value={hook.on_screen_text} />
      )}
      {cta?.on_screen_text && (
        <FrameField icon={<TypeIcon className="h-3 w-3" />} label="CTA" value={cta.on_screen_text} />
      )}
    </div>
  )
}

function FrameView({ frame, index, total }: { frame: StoryFrame; index: number; total: number }) {
  const showFrameLabel = total > 1
  return (
    <div className="rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
        {showFrameLabel && <span>Frame {index + 1}</span>}
        <span className="px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
          {frame.beat}
        </span>
      </div>

      {frame.capture && (
        <FrameField icon={<Camera className="h-3 w-3" />} label="Capture" value={frame.capture} />
      )}
      {frame.on_screen_text && (
        <FrameField icon={<TypeIcon className="h-3 w-3" />} label="On-screen" value={frame.on_screen_text} />
      )}
      {frame.voiceover && (
        <FrameField icon={<Mic className="h-3 w-3" />} label="Voiceover" value={frame.voiceover} />
      )}
    </div>
  )
}

function FrameField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)] mt-0.5 w-20">
        {icon}
        {label}
      </span>
      <span className="flex-1 text-[var(--text-primary)] leading-snug">{value}</span>
    </div>
  )
}
