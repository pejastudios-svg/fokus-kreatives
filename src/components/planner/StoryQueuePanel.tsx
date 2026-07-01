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
  Trash2,
  Paperclip,
  Vote,
} from 'lucide-react'
import type {
  AssetSlot,
  NormalizedFrame,
  StoryIntent,
  StoryQueueItem,
  TextEmphasis,
} from './types'
import { normalizeFrame } from './types'
import { StoryChecklist } from './StoryChecklist'
import { DatePopover } from '@/components/ui/DatePopover'

interface Props {
  items: StoryQueueItem[]
  history?: StoryQueueItem[]
  /** used=true marks consumed; used=false unmarks (moves back to active queue). */
  onUse: (id: string, used: boolean) => Promise<void>
  onGenerate: (seedText?: string, intent?: StoryIntent) => Promise<void>
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
  const [intent, setIntent] = useState<StoryIntent | undefined>(undefined)
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
      await onGenerate(seed.trim() || undefined, intent)
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
    <div className="glass-card rounded-xl flex flex-col sticky top-4 max-h-[calc(100vh-2rem)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--glass-border)] flex items-center justify-between flex-shrink-0">
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
                ? 'glass-chip-active'
                : 'glass-chip',
            ].join(' ')}
            title={showHistory ? 'Hide history' : 'Show history'}
            aria-label={showHistory ? 'Hide history' : 'Show history'}
          >
            <History className="h-4 w-4" />
          </button>
          <button
            onClick={handleRefill}
            disabled={busy !== null}
            className="glass-chip p-1.5 rounded-md disabled:opacity-50"
            title="Refill queue"
          >
            {busy === 'refill' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-[var(--glass-border)] space-y-2 flex-shrink-0">
        <textarea
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="Optional seed idea..."
          rows={2}
          className="glass-field w-full px-2.5 py-1.5 text-xs rounded-md text-[var(--text-primary)] resize-none"
        />
        <IntentPicker value={intent} onChange={setIntent} />
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
          <ul className="divide-y divide-[var(--glass-border)]">
            {items.map((item) => (
              <li
                key={item.id}
                id={`story-${item.id}`}
                className="px-4 py-3 space-y-2 transition-shadow rounded-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <StoryHeaderLabel item={item} />
                  </div>
                </div>

                <StoryBriefView item={item} />

                <StoryChecklist items={item.checklist} />

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
                    className="glass-chip inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
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
                          ? 'glass-chip-active'
                          : 'glass-chip',
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
                      className="glass-chip inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md disabled:opacity-50"
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
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-tertiary)] border-y border-[var(--glass-border)]">
              History
            </div>
            <ul className="divide-y divide-[var(--glass-border)]">
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
                      className="glass-chip inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
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

const INTENT_LABELS: Record<StoryIntent, string> = {
  teach: 'Teach',
  prove: 'Prove',
  launch: 'Launch',
  engage: 'Engage',
  bts_invite: 'BTS',
}

function IntentBadge({ intent }: { intent: StoryIntent }) {
  const isLaunch = intent === 'launch'
  return (
    <span
      className={[
        'inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
        isLaunch
          ? 'bg-[#2B79F7]/15 text-[#2B79F7] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
          : 'glass-chip text-[var(--text-secondary)]',
      ].join(' ')}
    >
      {INTENT_LABELS[intent]}
    </span>
  )
}

function IntentPicker({
  value,
  onChange,
}: {
  value: StoryIntent | undefined
  onChange: (v: StoryIntent | undefined) => void
}) {
  const options: Array<{ key: string; label: string; value: StoryIntent | undefined }> = [
    { key: 'auto', label: 'Auto', value: undefined },
    { key: 'teach', label: 'Teach', value: 'teach' },
    { key: 'prove', label: 'Prove', value: 'prove' },
    { key: 'launch', label: 'Launch', value: 'launch' },
    { key: 'engage', label: 'Engage', value: 'engage' },
    { key: 'bts_invite', label: 'BTS', value: 'bts_invite' },
  ]
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              'px-2 py-0.5 text-[11px] rounded-full transition-colors',
              active ? 'glass-chip-active' : 'glass-chip text-[var(--text-secondary)]',
            ].join(' ')}
            title={o.value === undefined ? 'Auto-pick the archetype' : `Generate a ${o.label} story`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function StoryHeaderLabel({ item }: { item: StoryQueueItem }) {
  // v2: an explicit intent badge leads when present.
  const intentBadge = item.intent ? <IntentBadge intent={item.intent} /> : null
  const frameCount = Array.isArray(item.frames) ? item.frames.length : 0

  // New shape - shows the carrier + the source format being compressed.
  if (item.carrier) {
    if (item.carrier === 'sticker') {
      return (
        <>
          {intentBadge}
          <span className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
            Sticker Story
          </span>
        </>
      )
    }
    // Unified frame model: a story is just "Story · {source format}".
    // (Old rows with carrier='slides' fall through to the same label.)
    const sourceName = item.source_format_name
    return (
      <>
        {intentBadge}
        <span className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
          Story
        </span>
        {sourceName && (
          <span className="text-[10px] text-[var(--text-tertiary)]">· {sourceName}</span>
        )}
        {frameCount > 1 && (
          <span className="text-[10px] text-[var(--text-tertiary)]">· {frameCount} frames</span>
        )}
      </>
    )
  }
  // Legacy shape - just shows the old story-native format name.
  return (
    <>
      {intentBadge}
      <span className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
        {item.format_name ?? 'Story'}
      </span>
      {frameCount > 1 && (
        <span className="text-[10px] text-[var(--text-tertiary)]">· {frameCount} frames</span>
      )}
    </>
  )
}

const ASSET_SLOT_LABELS: Record<AssetSlot, string> = {
  'screenshot-proof': 'Drop the proof screenshot here',
  'dm-testimonial': 'Paste the client DM / testimonial here',
  'result-graphic': 'Drop the result graphic here',
}

function emphasisClass(emphasis?: TextEmphasis): string {
  switch (emphasis) {
    case 'big':
      return 'text-base font-semibold text-[var(--text-primary)] leading-snug'
    case 'highlight':
      return 'inline-block text-sm font-medium text-[var(--text-primary)] leading-snug bg-[#2B79F7]/15 px-1 rounded'
    default:
      return 'text-sm text-[var(--text-primary)] leading-snug'
  }
}

/** Renders the production brief. All on-disk shapes (legacy StoryFrame,
 *  current StoryBeat, v2 StoryFrameV2) collapse through normalizeFrame() into
 *  one structured path; the oldest text-only rows fall back to prompt_text. */
function StoryBriefView({ item }: { item: StoryQueueItem }) {
  const rawFrames = Array.isArray(item.frames) ? (item.frames as unknown[]) : []
  const normalized = rawFrames
    .map(normalizeFrame)
    .filter((f): f is NormalizedFrame => f !== null)

  if (normalized.length > 0) {
    // engage / sticker stays a compact single block.
    if (item.carrier === 'sticker' || item.intent === 'engage') {
      return <StickerBriefView frames={normalized} />
    }
    return (
      <div className="space-y-2">
        {normalized.map((f, idx) => (
          <FrameCard key={idx} frame={f} index={idx} total={normalized.length} />
        ))}
      </div>
    )
  }

  // Oldest legacy: just text + visual direction.
  return (
    <div className="space-y-1">
      <p className="text-sm text-[var(--text-primary)] leading-snug">{item.prompt_text}</p>
      {item.visual_direction && (
        <p className="text-xs text-[var(--text-tertiary)] italic">{item.visual_direction}</p>
      )}
    </div>
  )
}

/** Renders one normalized frame: stacked text overlays, then the visual hint
 *  OR an asset-slot "drop asset" chip, then any sticker, then a legacy
 *  voiceover line. */
function FrameCard({ frame, index, total }: { frame: NormalizedFrame; index: number; total: number }) {
  const showFrameNum = total > 1
  return (
    <div className="glass-inset rounded-md p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
        {showFrameNum && <span>Frame {index + 1}</span>}
        <span className="glass-chip px-1.5 py-0.5 rounded-full">{frame.role}</span>
      </div>

      {frame.textBlocks.length > 0 && (
        <div className="space-y-1">
          {frame.textBlocks.map((b, i) => (
            <p key={i} className={emphasisClass(b.emphasis)}>
              {b.text}
            </p>
          ))}
        </div>
      )}

      {frame.assetSlot ? (
        <div className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md border border-dashed border-[var(--glass-border)] text-[var(--text-secondary)]">
          <Paperclip className="h-3 w-3 shrink-0" />
          <span>{ASSET_SLOT_LABELS[frame.assetSlot]}</span>
        </div>
      ) : (
        frame.visual && (
          <FrameField icon={<Camera className="h-3 w-3" />} label="Visual" value={frame.visual} />
        )
      )}

      {frame.sticker && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Vote className="h-3 w-3 shrink-0" />
          <span className="capitalize">{frame.sticker.type}</span>
          {frame.sticker.options && frame.sticker.options.length > 0 ? (
            <span className="text-[var(--text-tertiary)]">· {frame.sticker.options.join(' / ')}</span>
          ) : (
            frame.sticker.label && (
              <span className="text-[var(--text-tertiary)]">· {frame.sticker.label}</span>
            )
          )}
        </div>
      )}

      {frame.voiceover && (
        <FrameField icon={<Mic className="h-3 w-3" />} label="Voiceover (legacy)" value={frame.voiceover} />
      )}
    </div>
  )
}

function StickerBriefView({ frames }: { frames: NormalizedFrame[] }) {
  // Sticker stories are HOOK + CTA (the sticker IS the CTA). Render as a
  // single block since the two frames are conceptually one.
  const hook = frames.find((f) => f.role === 'HOOK') ?? frames[0]
  const cta = frames.find((f) => f.role === 'CTA')
  const sticker = frames.find((f) => f.sticker)?.sticker
  const hookText = hook?.textBlocks[0]?.text
  const ctaText = cta?.textBlocks[0]?.text
  return (
    <div className="glass-inset rounded-md p-2.5 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
        <span className="glass-chip px-1.5 py-0.5 rounded-full">STICKER STORY</span>
      </div>
      {hook?.visual && (
        <FrameField icon={<Camera className="h-3 w-3" />} label="Visual" value={hook.visual} />
      )}
      {hookText && (
        <FrameField icon={<TypeIcon className="h-3 w-3" />} label="Question" value={hookText} />
      )}
      {sticker && (
        <FrameField icon={<Vote className="h-3 w-3" />} label="Sticker" value={sticker.type} />
      )}
      {ctaText && <FrameField icon={<TypeIcon className="h-3 w-3" />} label="CTA" value={ctaText} />}
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
