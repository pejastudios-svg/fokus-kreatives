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
export type WhoFilms = 'agency' | 'client'

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
  /** Which side produces the asset. Null on legacy rows. */
  who_films?: WhoFilms | null
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
