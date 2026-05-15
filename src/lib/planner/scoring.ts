// Per-slot format scoring. The planner walks every available format, runs
// it through this scorer, and picks the highest score. See section 14 of
// docs/content_planner_buildout.md for the full algorithm.
//
// Material fit is a DETERMINISTIC rule, not an AI call. It maps the format
// slug to the input_types it requires. A format scores high when the
// available raw material has all the answers it needs, all non-thin.
// Doing this deterministically saves a Flash-Lite call per (slot, format)
// pair, which adds up fast on a top-tier monthly plan.

import type { ContentFormat } from '@/lib/contentFormats/types'
import type { TopicInputType } from '@/lib/types/questionForm'
import {
  bucketKey,
  type ContentStage,
  type CoverageSnapshot,
  type ScoringComponents,
  type TopicGroup,
} from './types'
import { coverageNeed } from './coverage'
import { recencyPenalty, type FormatUsageEntry } from './cooldowns'

// LOAD-BEARING input types per format. Missing OR thin-only on any of
// these = the format physically cannot produce a passable script. We
// gate the format out (fit=0) rather than letting partial-credit scoring
// pick it. Example: short_form.win without a `proof` answer is just an
// affirmation - there's nothing to "win" with - so we refuse to pick it
// even if other input types exist in the topic group.
//
// Formats not in this map have no critical inputs - they can be picked
// with whatever the topic group has.
const FORMAT_CRITICAL_INPUTS: Record<string, TopicInputType[]> = {
  // Short-form formats whose entire premise depends on one specific input.
  'short_form.win': ['proof'],
  'short_form.personal_learning': ['proof'],
  'short_form.before_after': ['proof'],
  'short_form.heros_journey': ['turning_point'],
  'short_form.lesson_from_others': ['named_mentor'],
  'short_form.hot_take': ['opinion'],
  'short_form.this_vs_that': ['opinion'],
  'short_form.myth_bust': ['opinion'],
  'short_form.ranking': ['opinion'],
  'short_form.reaction': ['opinion'],
  'short_form.day_in_the_life': ['scene'],
  'short_form.behind_the_scenes': ['scene'],
  // Engagement reels - all opinion-driven.
  'engagement_reel.poll_reel': ['opinion'],
  'engagement_reel.debate_starter': ['opinion'],
  'engagement_reel.spicy_question': ['opinion'],
  'engagement_reel.tier_list_bait': ['opinion'],
  'engagement_reel.defend_this_take': ['opinion'],
  'engagement_reel.heros_journey_text': ['turning_point'],
  // Carousels.
  'carousel.heros_journey': ['turning_point'],
  'carousel.personal_learning': ['proof'],
  'carousel.story': ['scene'],
  // Stories.
  'story.proof_drop': ['proof'],
  'story.day_moment': ['scene'],
  'story.behind_the_curtain': ['scene'],
  'story.question_for_audience': ['opinion'],
  'story.vulnerable_share': ['failed_attempt'],
}

// What input_types each format leans on. Used by the deterministic
// material-fit scorer. The arc is documented in section 13. Formats absent
// from this map fall back to "any answer works" (fit = 5 if anything
// available, else 0).
const FORMAT_INPUT_REQUIREMENTS: Record<string, TopicInputType[]> = {
  // Short-form
  'short_form.heros_journey':       ['scene', 'failed_attempt', 'turning_point', 'framework', 'proof'],
  'short_form.personal_learning':   ['proof', 'turning_point', 'framework'],
  'short_form.about_me':            ['scene', 'turning_point'],
  'short_form.before_after':        ['scene', 'proof'],
  'short_form.goal_journey':        ['scene', 'framework'],
  'short_form.challenge':           ['scene', 'framework', 'proof'],
  'short_form.win':                 ['proof', 'win_moment'],
  'short_form.day_in_the_life':     ['scene'],
  'short_form.personal_update':     ['turning_point'],
  'short_form.lesson_from_others':  ['named_mentor', 'turning_point', 'framework'],
  'short_form.this_vs_that':        ['opinion', 'framework'],
  'short_form.ranking':             ['opinion'],
  'short_form.hot_take':            ['opinion'],
  'short_form.myth_bust':           ['opinion', 'framework'],
  'short_form.listicle':            ['framework'],
  'short_form.how_to':              ['framework'],
  'short_form.qa_mailbag':          ['framework', 'proof'],
  'short_form.reaction':            ['opinion'],
  'short_form.behind_the_scenes':   ['scene', 'failed_attempt'],

  // Engagement reels
  'engagement_reel.poll_reel':         ['opinion'],
  'engagement_reel.debate_starter':    ['opinion'],
  'engagement_reel.spicy_question':    ['opinion'],
  'engagement_reel.tier_list_bait':    ['opinion'],
  'engagement_reel.defend_this_take':  ['opinion'],
  'engagement_reel.heros_journey_text':['scene', 'failed_attempt', 'turning_point', 'proof'],

  // Carousels
  'carousel.framework':         ['framework'],
  'carousel.list':              ['framework'],
  'carousel.story':             ['scene', 'turning_point'],
  'carousel.heros_journey':     ['scene', 'failed_attempt', 'turning_point', 'framework', 'proof'],
  'carousel.personal_learning': ['proof', 'turning_point', 'framework'],

  // Stories
  'story.proof_drop':           ['proof', 'win_moment'],
  'story.day_moment':           ['scene'],
  'story.behind_the_curtain':   ['scene', 'failed_attempt'],
  'story.question_for_audience':['opinion'],
  'story.vulnerable_share':     ['failed_attempt'],
}

// Stage-weight boosts per the spec. Empty entry = 0.
const STAGE_FORMAT_BOOST: Record<ContentStage, Record<string, number>> = {
  foundation: {
    'short_form.about_me': 5,
    'short_form.personal_learning': 5,
    'short_form.win': 5,
    'short_form.before_after': 5,
    'short_form.heros_journey': 3,
    'carousel.heros_journey': 3,
    'engagement_reel.heros_journey_text': 3,
  },
  growing: {},
  established: {
    'short_form.hot_take': 3,
    'short_form.this_vs_that': 3,
    'short_form.ranking': 3,
    'short_form.reaction': 3,
  },
}

export interface MaterialFitResult {
  fit: number
  topic_group_id: string | null
  refs: string[]
}

/**
 * Pick the best-fitting topic_group + answer ids for a format.
 *
 * Score from 0-10:
 *   * 10: every required input_type has a non-thin answer in one topic group
 *   * partial credit per matched type (each match adds requiredScore = 10 / requiredTypes.length)
 *   * thin_flag answers count as 0.5 of a match
 *   * format with no specific requirements falls to 5 if any answer exists
 *
 * CRITICAL INPUT GATE: a format whose entire premise depends on a specific
 * input type (FORMAT_CRITICAL_INPUTS) returns fit=0 against any group that
 * lacks a non-thin answer of that type. This is a HARD gate, not partial
 * credit - "Win" without proof, "Hot Take" without an opinion, "Hero's
 * Journey" without a turning point cannot work, no matter how many other
 * inputs are present.
 */
/** A topic group satisfies a critical input list when, for EVERY input
 *  type in the list, the group has at least one non-thin answer of that
 *  type. Thin-flagged answers don't count - they're explicitly marked as
 *  insufficient to anchor a script. */
function groupSatisfiesCritical(
  group: TopicGroup,
  critical: TopicInputType[],
): boolean {
  return critical.every((t) =>
    group.answers.some((a) => a.input_type === t && !a.thin_flag),
  )
}

export function pickBestMaterial(
  format: ContentFormat,
  groups: TopicGroup[],
): MaterialFitResult {
  const required = FORMAT_INPUT_REQUIREMENTS[format.slug] ?? []
  const critical = FORMAT_CRITICAL_INPUTS[format.slug] ?? []
  let best: MaterialFitResult = { fit: 0, topic_group_id: null, refs: [] }

  if (groups.length === 0) return best

  if (required.length === 0) {
    // Format has no specific input requirements - pick the freshest available
    // group with at least one non-thin answer.
    for (const g of groups) {
      // Critical-input gate still applies even when there are no scored
      // requirements (some formats only have a critical input and nothing
      // else listed).
      if (critical.length > 0 && !groupSatisfiesCritical(g, critical)) {
        continue
      }
      const usable = g.answers.filter((a) => !a.thin_flag)
      const fit = usable.length > 0 ? 5 : 2
      if (fit > best.fit) {
        best = {
          fit,
          topic_group_id: g.topic_group_id,
          refs: usable.length ? [usable[0].id] : g.answers[0] ? [g.answers[0].id] : [],
        }
      }
    }
    return best
  }

  const perMatch = 10 / required.length

  for (const g of groups) {
    // Hard gate: missing or thin-only on any critical input means this
    // format cannot work for this group, regardless of partial-credit math.
    if (critical.length > 0 && !groupSatisfiesCritical(g, critical)) continue

    const refs: string[] = []
    let score = 0
    for (const t of required) {
      const match = g.answers.find((a) => a.input_type === t)
      if (!match) continue
      refs.push(match.id)
      score += match.thin_flag ? perMatch * 0.5 : perMatch
    }
    score = Math.max(0, Math.min(10, score))
    if (score > best.fit) {
      best = {
        fit: Number(score.toFixed(2)),
        topic_group_id: g.topic_group_id,
        refs,
      }
    }
  }

  return best
}

export interface ScoreFormatInput {
  format: ContentFormat
  stage: ContentStage
  currentCoverage: CoverageSnapshot
  targetCoverage: CoverageSnapshot
  /** Bucket of the immediately previous slot (for variance bonus). */
  previousBucket: keyof CoverageSnapshot | null
  history: FormatUsageEntry[]
  currentIndex: number
  topicGroups: TopicGroup[]
}

export interface ScoreFormatResult {
  components: ScoringComponents
  topic_group_id: string | null
  refs: string[]
}

export function scoreFormat(input: ScoreFormatInput): ScoreFormatResult {
  const { format, stage, currentCoverage, targetCoverage, previousBucket, history, currentIndex, topicGroups } = input

  const material = pickBestMaterial(format, topicGroups)

  const need = coverageNeed(format.bucket, currentCoverage, targetCoverage)
  const stageWeight = STAGE_FORMAT_BOOST[stage][format.slug] ?? 0

  let variance = 0
  const fmtBucket = bucketKey(format.bucket)
  if (previousBucket) {
    if (previousBucket === fmtBucket) variance -= 2
    else variance += 2
  }
  // Clamp variance to spec range 0-3 floor at 0 / cap at 3 if positive.
  // The spec lists range 0-3 but allows -2 (when previous bucket matches)
  // implicitly. Keep both directions but cap magnitudes.
  variance = Math.max(-2, Math.min(3, variance))

  const recency = recencyPenalty(history, format.id, material.topic_group_id, currentIndex)

  const total =
    material.fit + need + stageWeight + variance + recency

  return {
    components: {
      material_fit: material.fit,
      coverage_need: Number(need.toFixed(2)),
      stage_weight: stageWeight,
      variance_bonus: variance,
      recency_penalty: recency,
      total: Number(total.toFixed(2)),
    },
    topic_group_id: material.topic_group_id,
    refs: material.refs,
  }
}

export function inputRequirementsFor(slug: string): TopicInputType[] {
  return FORMAT_INPUT_REQUIREMENTS[slug] ?? []
}
