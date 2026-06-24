// Material-readiness assessment, shared by the agency planner panel and (in
// spirit) the client form check. Answers the question the planner can't answer
// after the fact: "does this client have enough usable raw material to fill
// the month for their tier?"
//
// Two failure modes, mirrored from how the planner actually drops slots
// (see scoring.ts FORMAT_CRITICAL_INPUTS + index.ts pickSlotFormat):
//   1. Too few topic groups   -> fewer campaigns than the tier needs.
//   2. Thin / missing pivotal  -> a stream's formats get hard-gated to
//      input types inside a topic    material_fit = 0 and the pieces skip.

import type { TopicInputType } from '@/lib/types/questionForm'

export type StreamKey = 'short_form' | 'engagement_reel' | 'carousel' | 'story'

/** The fixed 6-question arc a topic is generated from. A "complete" topic has
 *  a non-thin answer for each of these. */
export const ARC_INPUT_TYPES: TopicInputType[] = [
  'scene',
  'failed_attempt',
  'turning_point',
  'framework',
  'proof',
  'opinion',
]

/** Streams whose formats critically depend on each input type. If the type is
 *  missing or thin, those streams lose their formats to the hard gate. Derived
 *  from FORMAT_CRITICAL_INPUTS / FORMAT_INPUT_REQUIREMENTS in scoring.ts.
 *  `opinion` is the most load-bearing: every engagement reel needs it. */
export const TYPE_CRITICAL_STREAMS: Record<TopicInputType, StreamKey[]> = {
  opinion: ['engagement_reel', 'short_form', 'story'],
  proof: ['short_form', 'carousel', 'story'],
  turning_point: ['short_form', 'engagement_reel', 'carousel'],
  scene: ['short_form', 'carousel', 'story'],
  failed_attempt: ['story'],
  // engagement_reel.caption_list keys off framework, so framework now backs
  // engagement reels too (not just opinion).
  framework: ['short_form', 'carousel', 'engagement_reel'],
  named_mentor: ['short_form'],
  win_moment: ['short_form', 'story'],
}

export const STREAM_LABEL: Record<StreamKey, string> = {
  short_form: 'short-form reels',
  engagement_reel: 'engagement reels',
  carousel: 'carousels',
  story: 'stories',
}

export interface ReadinessAnswer {
  input_type: TopicInputType | 'untyped'
  thin_flag: boolean
  answer: string
}

export interface ReadinessTopicInput {
  topic_group_id: string
  /** Optional human label; the panel falls back to "Topic N" when absent. */
  title?: string | null
  answers: ReadinessAnswer[]
}

export interface TopicAssessment {
  topic_group_id: string
  title: string | null
  /** Arc types with a non-thin answer. */
  strongTypes: TopicInputType[]
  /** Arc types answered but flagged thin. */
  thinTypes: TopicInputType[]
  /** Arc types with no answer at all. */
  missingTypes: TopicInputType[]
  /** Streams the tier produces that are at risk because a critical type is
   *  thin or missing. */
  atRiskStreams: StreamKey[]
  /** True when no tier stream is at risk - the topic can fill a campaign. */
  ready: boolean
}

export interface ReadinessReport {
  topicsAvailable: number
  topicsNeeded: number
  topicsReady: number
  /** topicsNeeded - topicsReady, floored at 0. */
  shortfall: number
  topics: TopicAssessment[]
}

const hasNonThin = (answers: ReadinessAnswer[], t: TopicInputType) =>
  answers.some((a) => a.input_type === t && !a.thin_flag && a.answer.trim().length > 0)

const hasAny = (answers: ReadinessAnswer[], t: TopicInputType) =>
  answers.some((a) => a.input_type === t && a.answer.trim().length > 0)

/** Assess one topic against the streams the client's tier actually produces. */
export function assessTopic(
  topic: ReadinessTopicInput,
  tierStreams: StreamKey[],
): TopicAssessment {
  const strongTypes: TopicInputType[] = []
  const thinTypes: TopicInputType[] = []
  const missingTypes: TopicInputType[] = []

  for (const t of ARC_INPUT_TYPES) {
    if (hasNonThin(topic.answers, t)) strongTypes.push(t)
    else if (hasAny(topic.answers, t)) thinTypes.push(t)
    else missingTypes.push(t)
  }

  // A stream is at risk when every input type that unlocks it (within the arc)
  // is thin or missing for this topic.
  const weakTypes = new Set<TopicInputType>([...thinTypes, ...missingTypes])
  const atRiskStreams = tierStreams.filter((stream) => {
    const unlockingTypes = ARC_INPUT_TYPES.filter((t) =>
      TYPE_CRITICAL_STREAMS[t]?.includes(stream),
    )
    if (unlockingTypes.length === 0) return false
    return unlockingTypes.every((t) => weakTypes.has(t))
  })

  return {
    topic_group_id: topic.topic_group_id,
    title: topic.title ?? null,
    strongTypes,
    thinTypes,
    missingTypes,
    atRiskStreams,
    ready: atRiskStreams.length === 0,
  }
}

/**
 * Full readiness report for a client: how many topics they have vs how many
 * their tier needs this period, plus the per-topic gaps.
 */
export function assessReadiness(args: {
  topics: ReadinessTopicInput[]
  campaignsPerMonth: number
  monthsAhead?: number
  tierStreams: StreamKey[]
}): ReadinessReport {
  const months = Math.max(1, args.monthsAhead ?? 1)
  const topicsNeeded = Math.max(0, args.campaignsPerMonth) * months
  const topics = args.topics.map((t) => assessTopic(t, args.tierStreams))
  const topicsReady = topics.filter((t) => t.ready).length
  return {
    topicsAvailable: topics.length,
    topicsNeeded,
    topicsReady,
    shortfall: Math.max(0, topicsNeeded - topicsReady),
    topics,
  }
}
