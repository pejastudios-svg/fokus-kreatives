// Checklist registry for M4 script approval.
//
// Each generated script comes with a checklist - a list of QA items the AI
// self-evaluates against, plus universal items every script must pass. The
// approval gate blocks until every item is `pass` or `human_status in
// ('fixed', 'waived')`.
//
// Spec: docs/content_planner_buildout.md sections 12.2 + 17.
//
// Stable IDs are critical: they let the UI render the same row across
// regenerations and let the recheck endpoint target one item at a time.

export type ChecklistStatus = 'pass' | 'flag' | 'manual_check'
export type ChecklistHumanStatus = 'fixed' | 'waived' | null

export interface ChecklistItem {
  id: string
  label: string
  /** Set by the AI on initial generation. */
  status: ChecklistStatus
  /** AI's reasoning for the status (one or two sentences). Optional. */
  ai_note?: string
  /** Staff override. When 'fixed' or 'waived', the gate counts the item as
   *  resolved regardless of `status`. */
  human_status?: ChecklistHumanStatus
  /** Required when human_status='waived' so we have an audit trail. */
  human_note?: string
  /** User id of the staff member who set human_status. */
  edited_by?: string
  /** ISO timestamp of the last human edit. */
  edited_at?: string
}

/** Item the AI receives in the prompt: id + label + the rule it evaluates. */
export interface ChecklistItemDef {
  id: string
  label: string
  /** What the AI checks for. Plain English; not shown in UI. */
  rule: string
}

// =============================================================================
// UNIVERSAL ITEMS - applied to every script regardless of format.
// =============================================================================
export const UNIVERSAL_ITEMS: ChecklistItemDef[] = [
  {
    id: 'universal.hook_2s',
    label: 'Hook lands in first 2 seconds (no throat-clearing)',
    rule: 'The opening line drops the viewer into a specific moment, number, name, or claim within the first 2 seconds of spoken time. No "hey friends", "today I want to talk about", "in this video", or other preambles.',
  },
  {
    id: 'universal.voice_conversational',
    label: 'Reads as spoken, not written',
    rule: 'The script sounds like a real person talking. Contractions, fragments, and conversational rhythm are present. No textbook tone, no bullet-list cadence.',
  },
  {
    id: 'universal.no_fabrication',
    label: 'Every claim traces to braindump or brand profile',
    rule: 'Every specific fact, number, name, quote, scene, or claim in the script must appear in the raw material (topic answers) or brand profile. Generic stories or invented numbers are not allowed.',
  },
  {
    id: 'universal.no_banned_phrases',
    label: 'No banned phrases or colon-led labels',
    rule: 'Script contains no banned phrases (game-changer, level up, unlock, the truth about, etc.) and no colon-led labels ("What I learned: X").',
  },
  {
    id: 'universal.length_in_target',
    label: 'Length within format target range',
    rule: 'Script length (word count) falls within the format\'s target_length_min..target_length_max range.',
  },
  {
    id: 'universal.profanity_match',
    label: 'Profanity matches brand profile',
    rule: 'Script profanity level matches the brand profile\'s voice.profanity_level. None when brand is "clean", mild only when "mild", anything goes when "spicy".',
  },
  {
    id: 'universal.signature_phrases',
    label: 'Signature phrases used naturally (or absent)',
    rule: 'If the brand profile defines signature phrases, at least one is used naturally. If none defined, this item passes.',
  },
  {
    id: 'universal.forbidden_words',
    label: 'No forbidden words from brand profile',
    rule: 'Script contains none of the words/phrases listed in brand_profile.bans / forbidden_words.',
  },
]

// =============================================================================
// FORMAT-SPECIFIC ITEMS - keyed by format slug. Universal items are always
// prepended to the per-format list at lookup time.
// =============================================================================
const FORMAT_ITEMS: Record<string, ChecklistItemDef[]> = {
  // ---- Short-form ----
  'short_form.win': [
    {
      id: 'win.proof_visible',
      label: 'Visible proof shown or referenced',
      rule: 'A specific result (number, screenshot, name, outcome) is shown or directly referenced in the script - not vague.',
    },
  ],
  'short_form.personal_learning': [
    {
      id: 'personal_learning.proof_visible',
      label: 'Visible proof shown or referenced',
      rule: 'A specific result that backs the lesson (number, outcome, named result) is shown or referenced.',
    },
  ],
  'short_form.heros_journey': [
    {
      id: 'heros_journey.failed_attempts_first',
      label: 'Failed attempts established before the solution',
      rule: 'The script names at least one specific failed attempt or wrong path BEFORE revealing the solution. No skipping straight to the answer.',
    },
    {
      id: 'heros_journey.pain_specific',
      label: 'Emotional pain point present and specific',
      rule: 'The script includes an emotionally specific pain moment (a feeling, a scene), not a generic struggle reference.',
    },
  ],
  'short_form.before_after': [
    {
      id: 'before_after.gap_measurable',
      label: 'Gap is measurable, not vague',
      rule: 'The before-vs-after gap is concrete (numbers, time, named outcome). Not "things got better" / "everything changed".',
    },
  ],
  'short_form.lesson_from_others': [
    {
      id: 'lesson_from_others.mentor_named',
      label: 'Third party named or specifically described',
      rule: 'The mentor / source is named or specifically described, not anonymous ("a friend told me" → not enough; "my old boss Mark from the agency" → enough).',
    },
    {
      id: 'lesson_from_others.quote_or_moment',
      label: 'Specific quote or vivid moment present',
      rule: 'Either a direct quote from the third party OR a vivid scene where the lesson landed.',
    },
  ],
  'short_form.hot_take': [
    {
      id: 'hot_take.take_no_hedge',
      label: 'Take stated without hedging in first 3 seconds',
      rule: 'The take is delivered without "maybe", "I think", "this might be controversial but" within the first 3 seconds.',
    },
  ],
  'short_form.myth_bust': [
    {
      id: 'myth_bust.myth_quoted',
      label: 'Myth quoted in audience-recognizable wording',
      rule: 'The myth is stated in the exact wording the audience recognizes - not paraphrased into something abstract.',
    },
  ],
  'short_form.how_to': [
    {
      id: 'how_to.step_specific',
      label: 'Each step is specific, not generic',
      rule: 'Every step gives a concrete action ("open the dashboard, click X, type Y") - not "be consistent" / "stay focused".',
    },
  ],
  'short_form.listicle': [
    {
      id: 'listicle.item_punch',
      label: 'Each item carries a one-line punch',
      rule: 'Every item in the list has a one-line takeaway or sharp framing - not just a label.',
    },
  ],
  'short_form.this_vs_that': [
    {
      id: 'this_vs_that.verdict_earned',
      label: 'Clear verdict, no "it depends"',
      rule: 'The script ends on a clear verdict for ONE side - no "it depends on your situation" cop-out.',
    },
  ],
  'short_form.ranking': [
    {
      id: 'ranking.surprise_pick',
      label: 'At least one surprise rank with a sharp reason',
      rule: 'At least one rank is non-obvious / counter to consensus, with a one-line reason that earns the surprise.',
    },
  ],
  'short_form.qa_mailbag': [
    {
      id: 'qa.real_question',
      label: 'Anchored to a real question',
      rule: 'The script opens with a real question (quoted from a DM, comment, or audience member), not invented.',
    },
  ],
  'short_form.reaction': [
    {
      id: 'reaction.sharper_version',
      label: 'Reframe goes beyond "I disagree"',
      rule: 'The reaction adds a sharper take or new angle - not just "this is wrong" without a reason.',
    },
  ],
  'short_form.behind_the_scenes': [
    {
      id: 'bts.friction_shown',
      label: 'Process friction shown, not sanitized',
      rule: 'The script shows real friction or messiness in the process - not a polished, success-only version.',
    },
  ],
  'short_form.day_in_the_life': [
    {
      id: 'day_in_the_life.unexpected_beat',
      label: 'At least one unexpected beat',
      rule: 'The day includes at least one unexpected moment / detail that surprises the viewer - not a sanitized highlight reel.',
    },
  ],
  'short_form.personal_update': [
    {
      id: 'personal_update.vulnerable_real',
      label: 'Rationale is honest, not a product launch in disguise',
      rule: 'The update reads as a genuine update, not a sales pitch dressed up as one.',
    },
  ],
  'short_form.goal_journey': [
    {
      id: 'goal_journey.goal_unfinished',
      label: 'Goal is genuinely unfinished',
      rule: 'The script frames the goal as in-progress / unfinished - not a fait accompli or "I already won" style.',
    },
  ],
  'short_form.challenge': [
    {
      id: 'challenge.obstacle_specific',
      label: 'Specific obstacles, not a smooth path',
      rule: 'The script names specific obstacles encountered - not a smooth, polished narrative.',
    },
  ],

  // ---- Long-form ----
  'long_form.long_form': [
    {
      id: 'long_form.evr_present',
      label: 'EVR (Expectation vs Reality) tension surfaced',
      rule: 'The script surfaces tension between what was expected and what actually happened, with specifics on both sides.',
    },
    {
      id: 'long_form.midroll_cta_natural',
      label: 'Mid-roll CTA woven conversationally (when present)',
      rule: 'If a mid-roll CTA is included, it lands between INFLECTION and RISING ACTION, framed conversationally ("By the way..."), not as a hard sales break. Passes if no mid-roll CTA was provided.',
    },
  ],
}

/** Returns the full checklist definition list for a given format slug:
 *  universal items prepended to the format-specific items. */
export function getChecklistForFormat(formatSlug: string): ChecklistItemDef[] {
  const formatItems = FORMAT_ITEMS[formatSlug] ?? []
  return [...UNIVERSAL_ITEMS, ...formatItems]
}

/** Validates a checklist returned by the AI: drops items not in the registry,
 *  fills in missing labels from the registry, and ensures every registry
 *  item has an entry (auto-fills 'manual_check' for missing ones). */
export function reconcileChecklist(
  formatSlug: string,
  raw: unknown,
): ChecklistItem[] {
  const defs = getChecklistForFormat(formatSlug)
  const defById = new Map(defs.map((d) => [d.id, d]))
  const incoming = Array.isArray(raw) ? raw : []

  const seen = new Set<string>()
  const out: ChecklistItem[] = []
  for (const entry of incoming) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const id = typeof e.id === 'string' ? e.id : ''
    const def = defById.get(id)
    if (!def) continue
    const status = e.status === 'pass' || e.status === 'flag' || e.status === 'manual_check' ? e.status : 'manual_check'
    const ai_note = typeof e.ai_note === 'string' ? e.ai_note.trim() || undefined : undefined
    out.push({
      id: def.id,
      label: def.label,
      status,
      ai_note,
    })
    seen.add(def.id)
  }
  // Backfill any registry items the AI omitted.
  for (const def of defs) {
    if (seen.has(def.id)) continue
    out.push({
      id: def.id,
      label: def.label,
      status: 'manual_check',
      ai_note: 'AI did not return an evaluation for this item.',
    })
  }
  return out
}

/** Tests whether every item in a saved checklist is "resolved" - either
 *  pass at the AI level OR overridden by staff. Used by the approval gate. */
export function isChecklistResolved(items: ChecklistItem[]): boolean {
  return items.every(
    (i) => i.status === 'pass' || i.human_status === 'fixed' || i.human_status === 'waived',
  )
}

/** Word counter that approximates spoken-word length. Splits on whitespace,
 *  strips bracket labels (e.g. [TITLE], [BODY]) so the structural markers
 *  don't inflate the count, and ignores empty tokens. */
export function countSpokenWords(script: string): number {
  if (!script) return 0
  // Drop bracket labels like [TITLE], [REHOOK 2], [DESCRIPTION] - the AI
  // emits them as section markers, not as spoken words.
  const stripped = script.replace(/\[[A-Z][A-Z0-9 _-]+\]/g, ' ')
  return stripped
    .split(/\s+/)
    .filter((w) => w.replace(/[^\w]/g, '').length > 0).length
}

/** Spoken pace used to convert short-form video DURATION (target_length_min/max
 *  in seconds) into expected WORD COUNT. 3.5 wps ≈ 210 wpm sits in the middle
 *  of real IG/TikTok creator pace - punchy creators run 4-4.5 wps, slower
 *  reflective scripts 2.5-3 wps. Combined with 25% slack each side, the
 *  acceptable window covers both ends. Used only for non-longform streams;
 *  long-form's target_length_min/max is already stored as word counts. */
const WORDS_PER_SECOND = 3.5
const LENGTH_SLACK = 0.25

export interface LengthTargetWindow {
  /** Floor word count (10% slack already applied). */
  minWords: number
  /** Ceiling word count (10% slack already applied). */
  maxWords: number
  /** Human-readable description of the original target for the ai_note. */
  targetLabel: string
}

/** Convert a format's `target_length_min/max` into a word-count window the
 *  length checklist can evaluate against. Long-form formats already store
 *  word counts; short-form / engagement-reel / carousel / story store
 *  SECONDS, which we convert at conversational pace. The 10% slack on
 *  each side absorbs natural delivery variance. */
export function lengthTargetWindow(
  stream: 'long_form' | 'short_form' | 'engagement_reel' | 'carousel' | 'story',
  format: { target_length_min: number | null; target_length_max: number | null },
): LengthTargetWindow | null {
  const min = format.target_length_min ?? null
  const max = format.target_length_max ?? null
  if (min === null || max === null) return null

  if (stream === 'long_form') {
    // Long-form values are already spoken-word counts.
    return {
      minWords: Math.floor(min * (1 - LENGTH_SLACK)),
      maxWords: Math.ceil(max * (1 + LENGTH_SLACK)),
      targetLabel: `${min}-${max} words`,
    }
  }
  // Everything else: target is in seconds. Convert via short-form pace.
  const minWordsRaw = Math.round(min * WORDS_PER_SECOND)
  const maxWordsRaw = Math.round(max * WORDS_PER_SECOND)
  return {
    minWords: Math.floor(minWordsRaw * (1 - LENGTH_SLACK)),
    maxWords: Math.ceil(maxWordsRaw * (1 + LENGTH_SLACK)),
    targetLabel: `${min}-${max}s (~${minWordsRaw}-${maxWordsRaw} words at IG pace)`,
  }
}

/** Replaces the AI's self-evaluation of `universal.length_in_target` with
 *  a deterministic computed result. Word-count math is not AI judgment -
 *  the AI consistently rubber-stamps this item even when the script is way
 *  over budget. We force the truth here.
 *
 *  The resulting item:
 *   - status='pass'         when count is within the converted window
 *   - status='flag'         when count is outside that window
 *   - status='manual_check' when no target is defined
 *
 *  Mutates and returns the items array for caller convenience. */
export function enforceLengthChecklistItem(
  items: ChecklistItem[],
  script: string,
  stream: 'long_form' | 'short_form' | 'engagement_reel' | 'carousel' | 'story',
  format: { target_length_min: number | null; target_length_max: number | null },
): ChecklistItem[] {
  const idx = items.findIndex((i) => i.id === 'universal.length_in_target')
  if (idx === -1) return items
  const wordCount = countSpokenWords(script)

  // Engagement reels + carousels: length is constrained by structure
  // (1-4 scenes / 10 slides), not word count. The output mixes overlay
  // text + caption + hashtags with different word budgets, so a single
  // word-count window is misleading. Mark as manual_check with a
  // breakdown the staff can eyeball.
  if (stream === 'engagement_reel') {
    items[idx] = {
      ...items[idx],
      status: 'manual_check',
      ai_note: `Computed ${wordCount} words across overlay scenes + caption + hashtags. Engagement reels are structurally constrained: 1-4 scenes (5-14 words each) + 60-120 word caption + 8-14 hashtags. Eyeball the structure rather than the total word count.`,
    }
    return items
  }
  if (stream === 'carousel') {
    items[idx] = {
      ...items[idx],
      status: 'manual_check',
      ai_note: `Computed ${wordCount} words across slides + caption + hashtags. Carousels are structurally constrained: exactly 10 slides (max 18 words each) + 90-160 word caption + 12-18 hashtags. Eyeball the structure rather than the total word count.`,
    }
    return items
  }

  const window = lengthTargetWindow(stream, format)
  if (!window) {
    items[idx] = {
      ...items[idx],
      status: 'manual_check',
      ai_note: `Computed ${wordCount} words. Format has no target range to compare against.`,
    }
    return items
  }
  const inRange = wordCount >= window.minWords && wordCount <= window.maxWords
  items[idx] = {
    ...items[idx],
    status: inRange ? 'pass' : 'flag',
    ai_note: inRange
      ? `Computed ${wordCount} words (target ${window.targetLabel}).`
      : `Computed ${wordCount} words; target ${window.targetLabel}. ${
          wordCount > window.maxWords
            ? `Over by ${wordCount - window.maxWords} words - cut a beat.`
            : `Under by ${window.minWords - wordCount} words - flesh out a beat.`
        }`,
  }
  return items
}
