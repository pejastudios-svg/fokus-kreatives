// Stage tracking. The brand's progress through foundation -> growing ->
// established. Drives the planner's coverage targets via STAGE_TARGETS.
//
// Advancement is auto-PROPOSED when criteria are met, but only takes effect
// when a manager/admin confirms (or anyone dismisses, which silences the
// proposal until criteria_progress shifts).
//
// Criteria are documented in section 15 of docs/content_planner_buildout.md.

import { createClient } from '@supabase/supabase-js'
import type { ContentStage } from '@/lib/planner/types'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

const NEXT_STAGE: Record<ContentStage, ContentStage | null> = {
  foundation: 'growing',
  growing: 'established',
  established: null,
}

export interface StageEvaluation {
  currentStage: ContentStage
  nextStage: ContentStage | null
  criteriaMet: string[]
  criteriaTotal: number
  criteriaProgress: Record<string, number>
}

interface ApprovedSlotRow {
  format_id: string | null
}

interface FormatRow {
  id: string
  slug: string
  bucket: string
}

export async function evaluateStageCriteria(clientId: string): Promise<StageEvaluation> {
  const supabase = admin()

  const { data: stateRow } = await supabase
    .from('content_stage_state')
    .select('current_stage')
    .eq('client_id', clientId)
    .maybeSingle()
  const currentStage = ((stateRow?.current_stage as ContentStage | undefined) ?? 'foundation')
  const nextStage = NEXT_STAGE[currentStage]

  if (!nextStage) {
    return {
      currentStage,
      nextStage: null,
      criteriaMet: [],
      criteriaTotal: 0,
      criteriaProgress: {},
    }
  }

  const { data: approvedRows } = await supabase
    .from('content_plan_slots')
    .select('format_id')
    .eq('client_id', clientId)
    .eq('status', 'approved')
  const approved = (approvedRows ?? []) as ApprovedSlotRow[]

  const formatIds = Array.from(
    new Set(approved.map((r) => r.format_id).filter((x): x is string => !!x)),
  )

  const formatBySlug = new Map<string, FormatRow>()
  const formatById = new Map<string, FormatRow>()
  if (formatIds.length) {
    const { data: formatRows } = await supabase
      .from('content_formats')
      .select('id, slug, bucket')
      .in('id', formatIds)
    for (const f of (formatRows ?? []) as FormatRow[]) {
      formatBySlug.set(f.slug, f)
      formatById.set(f.id, f)
    }
  }

  // Tally by slug + bucket.
  const slugCounts = new Map<string, number>()
  const bucketCounts = new Map<string, number>()
  for (const r of approved) {
    if (!r.format_id) continue
    const f = formatById.get(r.format_id)
    if (!f) continue
    slugCounts.set(f.slug, (slugCounts.get(f.slug) ?? 0) + 1)
    bucketCounts.set(f.bucket, (bucketCounts.get(f.bucket) ?? 0) + 1)
  }

  if (currentStage === 'foundation') {
    const aboutMeCount = slugCounts.get('short_form.about_me') ?? 0
    const heroCount =
      (slugCounts.get('short_form.heros_journey') ?? 0) +
      (slugCounts.get('short_form.personal_learning') ?? 0)
    const winCount =
      (slugCounts.get('short_form.win') ?? 0) +
      (slugCounts.get('short_form.before_after') ?? 0)
    const total = approved.length

    const met: string[] = []
    if (aboutMeCount >= 1) met.push('about_me')
    if (heroCount >= 2) met.push('heros_or_personal_learning')
    if (winCount >= 1) met.push('win_or_before_after')
    if (total >= 10) met.push('total_posts_floor')

    return {
      currentStage,
      nextStage,
      criteriaMet: met,
      criteriaTotal: 4,
      criteriaProgress: {
        about_me_count: aboutMeCount,
        heros_or_personal_learning_count: heroCount,
        win_or_before_after_count: winCount,
        total_posts: total,
      },
    }
  }

  // currentStage === 'growing'
  const educational = bucketCounts.get('educational') ?? 0
  const opinion = bucketCounts.get('opinion') ?? 0
  const total = approved.length

  const met: string[] = []
  if (educational >= 3) met.push('educational_floor')
  if (opinion >= 2) met.push('opinion_floor')
  if (total >= 30) met.push('total_posts_floor')

  return {
    currentStage,
    nextStage,
    criteriaMet: met,
    criteriaTotal: 3,
    criteriaProgress: {
      educational_count: educational,
      opinion_count: opinion,
      total_posts: total,
    },
  }
}

export async function proposeStageAdvancement(clientId: string, req?: { origin?: string }): Promise<void> {
  const supabase = admin()

  const evaluation = await evaluateStageCriteria(clientId)
  if (!evaluation.nextStage) return
  const allMet = evaluation.criteriaMet.length === evaluation.criteriaTotal
  if (!allMet) {
    // Not yet eligible. Still update criteria_progress so the dismissed
    // banner re-fires when it shifts.
    await supabase
      .from('content_stage_state')
      .upsert({
        client_id: clientId,
        criteria_progress: evaluation.criteriaProgress,
      })
    return
  }

  // Already proposed or already advanced past?
  const { data: stateRow } = await supabase
    .from('content_stage_state')
    .select('current_stage, proposed_stage, dismissed_at')
    .eq('client_id', clientId)
    .maybeSingle()

  if (stateRow?.proposed_stage === evaluation.nextStage) return

  // Was previously dismissed? Re-propose only if criteria_progress shifted.
  // Simplest correct behavior: always re-propose if criteria are now met
  // and there's no active proposal. Dismissals are reset on advancement
  // confirm or stale criteria.

  await supabase
    .from('content_stage_state')
    .upsert({
      client_id: clientId,
      proposed_stage: evaluation.nextStage,
      proposed_at: new Date().toISOString(),
      criteria_progress: evaluation.criteriaProgress,
      dismissed_at: null,
      dismissed_by: null,
    })

  // Notify team. Failures don't block.
  try {
    const origin = req?.origin || process.env.NEXT_PUBLIC_APP_URL || ''
    if (!origin) return
    const { getAgencyRecipientsForClient } = await import('@/lib/clientRecipients')
    const recipients = await getAgencyRecipientsForClient(supabase, clientId)
    const userIds = recipients.map((r) => r.id).filter(Boolean)
    if (userIds.length) {
      await fetch(`${origin}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds,
          type: 'stage_advancement_proposed',
          data: {
            clientId,
            from_stage: evaluation.currentStage,
            to_stage: evaluation.nextStage,
            url: `${origin}/clients/${clientId}/planner`,
          },
        }),
      })
    }
  } catch (err) {
    console.error('stage advancement notification error:', err)
  }
}

export async function confirmStageAdvancement(clientId: string, userId: string | null): Promise<ContentStage> {
  const supabase = admin()
  const { data } = await supabase
    .from('content_stage_state')
    .select('proposed_stage')
    .eq('client_id', clientId)
    .maybeSingle()
  const proposed = data?.proposed_stage as ContentStage | null | undefined
  if (!proposed) throw new Error('No proposal to confirm')

  const { error } = await supabase
    .from('content_stage_state')
    .update({
      current_stage: proposed,
      proposed_stage: null,
      proposed_at: null,
      proposed_by: null,
      confirmed_at: new Date().toISOString(),
      confirmed_by: userId,
      dismissed_at: null,
      dismissed_by: null,
    })
    .eq('client_id', clientId)
  if (error) throw error
  return proposed
}

export async function dismissStageAdvancement(clientId: string, userId: string | null): Promise<void> {
  const supabase = admin()
  const { error } = await supabase
    .from('content_stage_state')
    .update({
      proposed_stage: null,
      proposed_at: null,
      proposed_by: null,
      dismissed_at: new Date().toISOString(),
      dismissed_by: userId,
    })
    .eq('client_id', clientId)
  if (error) throw error
}
