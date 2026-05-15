// Type surface for the content_formats library. Mirrors the migration in
// sql/migrations/20260505_content_formats.sql; rows seeded from
// sql/seeds/content_formats_seed.sql.

export type ContentFormatType = 'short_form' | 'engagement_reel' | 'carousel' | 'story'

export type ContentBucket = 'storytelling' | 'educational' | 'opinion' | 'proof_community'

export type ContentPillar = 'educational' | 'storytelling' | 'authority' | 'series' | 'doubledown'

export interface FormatBeat {
  label: string
  description: string
}

export interface FormatMadLib {
  beat: string
  lines: string[]
}

export interface HookPattern {
  /** Template the AI fills in. Brackets mark the slots: e.g. "Today I'm
   *  [doing specific thing] as a [role]." */
  pattern: string
  /** A real worked example showing what filling in the slots looks like. */
  example: string
}

export interface ReferenceScript {
  /** Short label for the script (e.g. "1M followers in 4 months"). Helps
   *  the AI understand WHY this is a good example, not just that it is one. */
  label: string
  /** The full transcript. Plain text, no timestamps required. */
  script: string
}

export interface ContentFormat {
  id: string
  slug: string
  content_type: ContentFormatType
  name: string
  description: string
  starting_point: string
  strategy_beats: FormatBeat[]
  secret_sauce: string
  mad_libs: FormatMadLib[]
  gating_rule: string
  pillar: ContentPillar | null
  bucket: ContentBucket
  // For video formats target_length_* is seconds. For carousels it's slide
  // count. For stories it's frame count. The unit is implied by content_type.
  target_length_min: number | null
  target_length_max: number | null
  cooldown_posts: number
  is_active: boolean
  sort_order: number
  /** Pre-defined hook templates per format. The AI picks/adapts one rather
   *  than freelancing. Highest-leverage quality fix for short-form, since
   *  the hook is the single most failure-prone part of any post. */
  hook_patterns: HookPattern[]
  /** Few-shot examples of what good output looks like for this format. The
   *  AI sees these in the system prompt before generating, anchoring quality
   *  to the level of the references. */
  reference_scripts: ReferenceScript[]
}
