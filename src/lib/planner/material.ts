// Pull the client's available raw material into TopicGroups for the planner.
// "Available" = source='form' answers grouped by topic_group_id, excluding
// topic_groups marked in-use earlier in the same plan run.
//
// CONSUMPTION IS GROUP-LEVEL, NOT ANSWER-LEVEL. Answers referenced by an
// approved slot get used_at stamped, but they are still returned here.
// The campaign model anchors pieces on answer positions and gates formats
// on input types (scoring.ts FORMAT_CRITICAL_INPUTS), so hiding consumed
// answers starves a re-planned campaign: approving 2 slots in July stamped
// 4 of 6 answers, and the August run then saw a topic with only opinion +
// failed_attempt left - every carousel format scored fit=0 and the whole
// carousel stream silently dropped. A group only becomes unavailable when
// EVERY answer is consumed (nothing new to say) - and even then an explicit
// scope via the batch picker (includeOnlyTopicGroupIds) overrides, because
// scoping a group IS the "re-plan this campaign topic" intent.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TopicInputType } from '@/lib/types/questionForm'
import type { TopicPillar } from '@/lib/types/topics'
import type { RawTopicAnswer, TopicGroup } from './types'

interface TopicRow {
  id: string
  client_id: string
  question: string | null
  answer: string
  pillar: string
  source: string
  input_type: string
  thin_flag: boolean
  topic_group_id: string | null
  group_position: number | null
  used_at: string | null
  created_at: string
}

export async function loadAvailableTopicGroups(
  supabase: SupabaseClient,
  clientId: string,
  excludeTopicGroupIds: string[] = [],
  /** When set, only topic groups whose id appears in this list are returned.
   *  Used by the planner's batch picker so staff can scope generation to
   *  specific question forms rather than all unused material. */
  includeOnlyTopicGroupIds: string[] | null = null,
): Promise<TopicGroup[]> {
  const { data, error } = await supabase
    .from('topics')
    .select('id, client_id, question, answer, pillar, source, input_type, thin_flag, topic_group_id, group_position, used_at, created_at')
    .eq('client_id', clientId)
    .not('topic_group_id', 'is', null)
  if (error) throw error

  const rows = (data ?? []) as TopicRow[]
  const includeSet = includeOnlyTopicGroupIds ? new Set(includeOnlyTopicGroupIds) : null
  const excludeSet = new Set(excludeTopicGroupIds)
  const filtered = rows.filter((r) => {
    if (!r.topic_group_id) return false
    // Explicit scope WINS over consumption excludes. Scoping a batch in the
    // picker is the deliberate "plan from this topic" action - e.g.
    // extending last month's campaigns into a new month - so a group being
    // consumed elsewhere must not silently drop it from a scoped run.
    if (includeSet) return includeSet.has(r.topic_group_id)
    if (excludeSet.has(r.topic_group_id)) return false
    return true
  })

  const groups = new Map<string, RawTopicAnswer[]>()
  for (const r of filtered) {
    if (!r.topic_group_id) continue
    const arr = groups.get(r.topic_group_id) ?? []
    arr.push({
      id: r.id,
      client_id: r.client_id,
      question: r.question,
      answer: r.answer,
      pillar: (r.pillar as TopicPillar) ?? 'unassigned',
      input_type: (r.input_type as TopicInputType | 'untyped') ?? 'untyped',
      thin_flag: !!r.thin_flag,
      topic_group_id: r.topic_group_id,
      group_position: r.group_position,
      used_at: r.used_at,
      created_at: r.created_at,
    })
    groups.set(r.topic_group_id, arr)
  }

  const out: TopicGroup[] = []
  for (const [topic_group_id, answers] of groups) {
    if (answers.length === 0) continue
    // Fully-consumed group: every answer already anchors approved content,
    // so there's nothing new to plan from. Skip - unless the caller
    // explicitly scoped to this group (deliberate re-plan).
    if (!includeSet?.has(topic_group_id) && answers.every((a) => a.used_at)) continue
    answers.sort((a, b) => (a.group_position ?? 99) - (b.group_position ?? 99))
    const freshness = answers
      .map((a) => a.created_at)
      .sort()
      .reverse()[0] ?? new Date(0).toISOString()
    out.push({ topic_group_id, answers, freshness })
  }

  // Freshest groups first - the variance / dedupe logic still applies to
  // re-using the same group, but newer material gets a tiebreaker advantage.
  out.sort((a, b) => b.freshness.localeCompare(a.freshness))
  return out
}
