// Cooldown bookkeeping: how recently has each format been used in the
// client's plan? Used by the scoring step to drop format candidates that
// would violate their per-format cooldown_posts and to compute the
// recency_penalty for formats that are technically allowed but recently
// posted.
//
// Cooldown is measured in plan-slots, not calendar days. "Plan-slots" =
// approved + drafted + planned slots ordered by scheduled_date asc, with
// the slot currently being scored at position N. A format used at position
// N - k has been used `k` slots ago.

import type { PlannerSlotRow } from './types'

export interface FormatUsageEntry {
  /** Slot index (0 = oldest in horizon). Higher = more recent. */
  index: number
  format_slug: string | null
  format_id: string | null
  topic_group_id: string | null
  scheduled_date: string
}

/** Build the index map. Returns slots sorted oldest-first. */
export function buildUsageHistory(slots: PlannerSlotRow[]): FormatUsageEntry[] {
  const sorted = [...slots].sort((a, b) =>
    a.scheduled_date.localeCompare(b.scheduled_date),
  )
  return sorted.map((s, index) => ({
    index,
    format_slug: s.format_slug ?? null,
    format_id: s.format_id,
    topic_group_id: s.topic_group_id,
    scheduled_date: s.scheduled_date,
  }))
}

/**
 * "Slots ago" lookup: how many positions back was this format last used?
 * Returns Infinity if never used.
 */
export function slotsSinceFormatUsed(
  history: FormatUsageEntry[],
  formatId: string,
  currentIndex: number,
): number {
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (history[i] && history[i].format_id === formatId) {
      return currentIndex - i
    }
  }
  return Number.POSITIVE_INFINITY
}

/** Same shape, for topic_group_id. */
export function slotsSinceTopicGroupUsed(
  history: FormatUsageEntry[],
  topicGroupId: string,
  currentIndex: number,
): number {
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (history[i] && history[i].topic_group_id === topicGroupId) {
      return currentIndex - i
    }
  }
  return Number.POSITIVE_INFINITY
}

export function isOnCooldown(
  history: FormatUsageEntry[],
  formatId: string,
  cooldownPosts: number,
  currentIndex: number,
): boolean {
  return slotsSinceFormatUsed(history, formatId, currentIndex) < cooldownPosts
}

/**
 * recency_penalty per the planner spec:
 *   -5 if used in the last 3 slots
 *   -3 if used 4-7 slots ago
 *   -1 if used 8-14 slots ago
 *    0 if older or never
 *  (additional -5 if same topic_group_id used in last 5 slots)
 */
export function recencyPenalty(
  history: FormatUsageEntry[],
  formatId: string,
  topicGroupId: string | null,
  currentIndex: number,
): number {
  const slotsBack = slotsSinceFormatUsed(history, formatId, currentIndex)
  let penalty = 0
  if (slotsBack <= 3) penalty -= 5
  else if (slotsBack <= 7) penalty -= 3
  else if (slotsBack <= 14) penalty -= 1

  if (topicGroupId) {
    const topicBack = slotsSinceTopicGroupUsed(history, topicGroupId, currentIndex)
    if (topicBack <= 5) penalty -= 5
  }
  return penalty
}
