// Types shared by the planner UI components. Intentionally close to the
// API shape so the page can hand the response object straight through.

import type { ContentFormat } from '@/lib/contentFormats/types'

export type SlotStream = 'long_form' | 'short_form' | 'engagement_reel' | 'carousel'
export type SlotStatus = 'planned' | 'drafted' | 'approved'

export interface PlannerSlot {
  id: string
  stream: SlotStream
  format_id: string | null
  format_slug: string | null
  format_name: string | null
  scheduled_date: string
  status: SlotStatus
  topic_group_id: string | null
  raw_material_refs: string[]
  hook_preview: string | null
  generation_meta: Record<string, unknown>
  locked: boolean
  approved_at: string | null
  bucket: string | null
  /** Order within the same date. Lower = appears first in the cell. Server-
   *  side default is 0; the planner sets a sequential value per-date when
   *  generating, and within-day drag-drop reassigns these. */
  display_order?: number
}

export type StoryFrameBeat = 'HOOK' | 'BODY' | 'OUTRO'

export interface StoryFrame {
  beat: StoryFrameBeat
  /** What to film/screenshot/photograph. Always present. */
  capture: string
  /** Text overlay on the frame. Empty string when none. */
  on_screen_text: string
  /** Spoken voiceover (or what the talking head says). Empty string when none. */
  voiceover: string
}

// New shape (post-redesign): stories are a CARRIER (video / slides /
// sticker) holding a compressed version of a short-form / engagement-reel
// / carousel format. The legacy multi-frame shape (StoryFrame[]) stays for
// backwards compat - rows with carrier=null render the legacy way.
export type StoryCarrier = 'video' | 'slides' | 'sticker'

/** A story beat in the unified frame model. 4 beats by default:
 *  HOOK (open) → VALUE (the meat) → REHOOK (re-engage) → CTA (drive action).
 *  Optional 5th: POLL (sticker question to re-engage at the end).
 *
 *  Stories are TEXT-FIRST: the viewer reads on_screen_text, no voiceover.
 *  `capture` carries a short visual hint ("talking head", "text card",
 *  "b-roll", "screen recording") - not a full production paragraph.
 *  `voiceover` is preserved for backwards compat with rows generated under
 *  the previous model and is always '' on new rows. */
export interface StoryBeat {
  label: 'HOOK' | 'VALUE' | 'REHOOK' | 'CTA' | 'POLL'
  /** Short visual hint - one phrase, no choreography. */
  capture: string
  /** On-screen text - what the viewer reads. Word budget enforced
   *  per-label (HOOK/CTA ≤10 words, VALUE/REHOOK ≤15 words). */
  on_screen_text: string
  /** Always '' on new rows. Kept for legacy carrier='video' rows that had
   *  voiceovers. The renderer hides empty voiceover lines. */
  voiceover: string
}

// ---------------------------------------------------------------------------
// Story Set v2 - flexible intents.
//
// A story is no longer a fixed 4-beat sequence. It's a Story Set: an `intent`
// selecting a variable-length sequence (3-8) of frames. Each frame stacks 1-4
// text overlays, carries a visual hint OR an asset-slot, and may hold a
// sticker. The variable array lives in the SAME `frames` jsonb column the
// legacy/4-beat rows use - the element shape just evolved. Back-compat is
// handled entirely by normalizeFrame() below, so no DB backfill is needed.
// ---------------------------------------------------------------------------

/** The archetype. Selects the role sequence + per-role guidance. */
export type StoryIntent = 'teach' | 'prove' | 'launch' | 'engage' | 'bts_invite'

/** Frame roles across all intents. Superset of the legacy beat labels;
 *  normalizeFrame() maps old labels onto these. */
export type FrameRole =
  | 'HOOK' | 'CONTEXT' | 'VALUE' | 'STEP'
  | 'PROOF' | 'ESCALATE' | 'REHOOK' | 'CTA'

export type TextEmphasis = 'normal' | 'highlight' | 'big'

/** One stacked overlay line on a frame. 1-4 per frame. */
export interface TextBlock {
  text: string
  emphasis?: TextEmphasis // default 'normal'
}

/** Asset-slot markers: when `visual` equals one of these, the renderer shows a
 *  "drop asset" chip instead of a capture hint - staff paste a REAL screenshot
 *  / DM / result graphic. Any other `visual` string renders as a capture hint. */
export type AssetSlot = 'screenshot-proof' | 'dm-testimonial' | 'result-graphic'

export type StickerKind = 'poll' | 'question' | 'slider' | 'quiz' | 'countdown' | 'link'

export interface FrameSticker {
  type: StickerKind
  /** Free-form sticker config: slider label, countdown date, link url, etc. */
  label?: string
  options?: string[]
}

/** v2 frame. Stored as an element of the `frames` jsonb array. */
export interface StoryFrameV2 {
  role: FrameRole
  /** 1-4 stacked overlays. Replaces the single on_screen_text. */
  text_blocks: TextBlock[]
  /** Capture hint ("talking head", "text card", ...) OR an AssetSlot string. */
  visual: string
  sticker?: FrameSticker
}

export type StoryMechanic = 'reply' | 'dm'

/** Launch campaign metadata. Sourced from brand_content_settings.story_campaign
 *  and copied onto launch story rows. */
export interface StoryCampaign {
  offer: string
  event_date?: string | null
  keyword?: string | null
  mechanic: StoryMechanic // default 'reply'
}

/** Unified render shape the FrameCard consumes. normalizeFrame() collapses all
 *  three on-disk shapes (legacy StoryFrame, current StoryBeat, v2 StoryFrameV2)
 *  into this. */
export interface NormalizedFrame {
  role: FrameRole
  textBlocks: TextBlock[]
  visual: string
  assetSlot: AssetSlot | null
  sticker?: FrameSticker
  /** Legacy voiceover line, '' on v2 rows. Rendered only when non-empty. */
  voiceover: string
}

const LEGACY_LABEL_TO_ROLE: Record<string, FrameRole> = {
  HOOK: 'HOOK',
  VALUE: 'VALUE',
  REHOOK: 'REHOOK',
  CTA: 'CTA',
  POLL: 'CTA', // legacy POLL beat was the ask
  BODY: 'VALUE', // oldest StoryFrame.beat values
  OUTRO: 'CTA',
}

const ASSET_SLOTS = new Set<AssetSlot>(['screenshot-proof', 'dm-testimonial', 'result-graphic'])

/** The entire renderer back-compat strategy. Maps any of the three on-disk
 *  frame shapes to NormalizedFrame. Returns null for unusable rows. */
export function normalizeFrame(raw: unknown): NormalizedFrame | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // v2 shape: has `role` + `text_blocks`.
  if (typeof r.role === 'string' && Array.isArray(r.text_blocks)) {
    const visual = typeof r.visual === 'string' ? r.visual : ''
    const textBlocks = (r.text_blocks as unknown[])
      .map((b) => (b && typeof b === 'object' ? (b as Record<string, unknown>) : null))
      .filter((b): b is Record<string, unknown> => !!b && typeof b.text === 'string')
      .map((b) => ({
        text: b.text as string,
        emphasis: (b.emphasis as TextEmphasis) ?? 'normal',
      }))
    return {
      role: r.role as FrameRole,
      textBlocks,
      visual,
      assetSlot: ASSET_SLOTS.has(visual as AssetSlot) ? (visual as AssetSlot) : null,
      sticker: (r.sticker as FrameSticker) ?? undefined,
      voiceover: '',
    }
  }

  // Legacy StoryBeat {label,...} or oldest StoryFrame {beat,...}.
  const labelStr =
    typeof r.label === 'string' ? r.label : typeof r.beat === 'string' ? r.beat : ''
  const role = LEGACY_LABEL_TO_ROLE[labelStr.toUpperCase()] ?? 'VALUE'
  const ost = typeof r.on_screen_text === 'string' ? r.on_screen_text : ''
  const capture = typeof r.capture === 'string' ? r.capture : ''
  return {
    role,
    textBlocks: ost ? [{ text: ost, emphasis: 'normal' }] : [],
    visual: capture,
    assetSlot: null,
    sticker: undefined,
    voiceover: typeof r.voiceover === 'string' ? r.voiceover : '',
  }
}

export interface StoryQueueItem {
  id: string
  format_id: string | null
  format_slug: string | null
  format_name: string | null
  prompt_text: string
  visual_direction: string | null
  /** Structured per-frame production brief. Null on legacy rows; populated on
   *  rows generated after the structured-prompt migration. */
  frames?: StoryFrame[] | null
  /** Carrier (video / slides / sticker). Null on legacy rows - those use
   *  the multi-frame `frames` shape instead of the new beat shape. */
  carrier?: StoryCarrier | null
  /** When carrier is set, the story is a compressed version of this format.
   *  Null for sticker carrier and legacy rows. */
  source_format_id?: string | null
  /** Resolved source format (joined client-side from data.formats). */
  source_format_name?: string | null
  source_format_slug?: string | null
  /** New beat structure (HOOK / VALUE / CTA). Used when carrier is set. */
  beats?: StoryBeat[] | null
  /** v2: the archetype. Null/undefined on legacy + current 4-beat rows. The
   *  renderer reads `frames` (which may now hold StoryFrameV2 elements) and
   *  normalizes element shape; `intent` only drives the header badge. */
  intent?: StoryIntent | null
  /** v2: launch campaign metadata. Null except on launch rows. */
  campaign?: StoryCampaign | null
  /** v2: default CTA mechanic for this story ('reply' | 'dm'). */
  mechanic?: StoryMechanic | null
  raw_material_refs: string[]
  pinned_to_date: string | null
  seed_text: string | null
  created_at: string
  /** Set when the item has been marked as used. Null when still active. */
  consumed_at?: string | null
}

export interface CoverageSnapshot {
  storytelling: number
  educational: number
  opinion: number
  proof_community: number
}

export interface PlannerData {
  client: {
    id: string
    name: string | null
    business_name: string | null
    package_tier: 'top' | 'middle' | 'lower' | 'custom' | null
  }
  stage: {
    currentStage: 'foundation' | 'growing' | 'established'
    nextStage: 'foundation' | 'growing' | 'established' | null
    criteriaMet: string[]
    criteriaTotal: number
    criteriaProgress: Record<string, number>
    proposed_stage: 'foundation' | 'growing' | 'established' | null
    proposed_at: string | null
    dismissed_at: string | null
  }
  coverage: {
    current: CoverageSnapshot
    target: CoverageSnapshot
    delta: CoverageSnapshot
  }
  target: CoverageSnapshot
  horizon: { start: string; end: string; monthsAhead: number }
  slots: PlannerSlot[]
  storyQueue: StoryQueueItem[]
  /** Last 50 used prompts, most recent first. Surfaced via the queue panel's
   *  "Show history" toggle. */
  storyHistory: StoryQueueItem[]
  formats: ContentFormat[]
  shareLinks: Array<{
    id: string
    token: string
    expires_at: string
    revoked_at: string | null
    created_at: string
  }>
}

export const STREAM_COLORS: Record<SlotStream, { bg: string; text: string; dot: string; label: string }> = {
  long_form:       { bg: 'bg-blue-600/15',  text: 'text-blue-600',  dot: 'bg-blue-600',  label: 'Long-form' },
  short_form:      { bg: 'bg-sky-500/15',   text: 'text-sky-500',   dot: 'bg-sky-500',   label: 'Short-form' },
  engagement_reel: { bg: 'bg-purple-500/15',text: 'text-purple-500',dot: 'bg-purple-500',label: 'Engagement' },
  carousel:        { bg: 'bg-amber-500/15', text: 'text-amber-500', dot: 'bg-amber-500', label: 'Carousel' },
}

export function streamLabel(stream: SlotStream): string {
  return STREAM_COLORS[stream]?.label ?? stream
}
