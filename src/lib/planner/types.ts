// Shared planner types. Intentionally narrow - the planner is a closed system
// that touches Supabase rows by name and returns shaped objects to API routes.

import type { ContentBucket, ContentFormat, ContentFormatType } from '@/lib/contentFormats/types'
import type { TopicInputType } from '@/lib/types/questionForm'
import type { TopicPillar } from '@/lib/types/topics'

export type SlotStream = 'long_form' | 'short_form' | 'engagement_reel' | 'carousel'
export type SlotStatus = 'planned' | 'drafted' | 'approved'

export type ContentStage = 'foundation' | 'growing' | 'established'

// content_format_type -> SlotStream. story is its own queue.
export const FORMAT_TYPE_TO_STREAM: Record<ContentFormatType, SlotStream | 'story'> = {
  short_form: 'short_form',
  engagement_reel: 'engagement_reel',
  carousel: 'carousel',
  story: 'story',
}

export interface RawTopicAnswer {
  id: string
  client_id: string
  question: string | null
  answer: string
  pillar: TopicPillar
  input_type: TopicInputType | 'untyped'
  thin_flag: boolean
  topic_group_id: string | null
  group_position: number | null
  used_at: string | null
  created_at: string
}

export interface TopicGroup {
  topic_group_id: string
  // Title is reconstructed from the form's `topics` json - the long-form
  // pulls the topic title from there. For planning we only need the answers.
  answers: RawTopicAnswer[]
  // Most recent created_at across the 5 answers, used as a freshness tiebreak.
  freshness: string
}

export interface ScoringComponents {
  material_fit: number
  coverage_need: number
  stage_weight: number
  variance_bonus: number
  recency_penalty: number
  total: number
}

export interface FormatPick {
  format: ContentFormat
  topic_group_id: string | null
  raw_material_refs: string[]
  hook_preview: string | null
  scoring: ScoringComponents
}

export interface PlannerSlotRow {
  id: string
  client_id: string
  stream: SlotStream
  format_id: string | null
  format_slug?: string | null
  scheduled_date: string
  status: SlotStatus
  topic_group_id: string | null
  raw_material_refs: string[]
  hook_preview: string | null
  generation_meta: Record<string, unknown>
  generated_script_id: string | null
  approved_at: string | null
  approved_by: string | null
  locked: boolean
  created_at: string
  updated_at: string
}

export interface CoverageSnapshot {
  storytelling: number
  educational: number
  opinion: number
  proof_community: number
}

export const ZERO_COVERAGE: CoverageSnapshot = {
  storytelling: 0,
  educational: 0,
  opinion: 0,
  proof_community: 0,
}

export const STAGE_TARGETS: Record<ContentStage, CoverageSnapshot> = {
  foundation:  { storytelling: 55, educational: 25, opinion: 10, proof_community: 10 },
  growing:     { storytelling: 35, educational: 30, opinion: 20, proof_community: 15 },
  established: { storytelling: 25, educational: 35, opinion: 25, proof_community: 15 },
}

export function bucketKey(b: ContentBucket): keyof CoverageSnapshot {
  return b
}
