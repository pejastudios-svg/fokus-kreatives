// Material-readiness for a client's planner: do they have enough usable topics
// (and enough non-thin pivotal answers per topic) to fill the month for their
// tier? Surfaced in the planner UI before a generation run so staff see the
// gap up front instead of counting an incomplete calendar afterwards.

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { plannerAdmin } from '@/lib/planner/db'
import { loadAvailableTopicGroups } from '@/lib/planner/material'
import { assessReadiness, type StreamKey, type ReadinessTopicInput } from '@/lib/planner/readiness'
import { resolveTierConfig, type CustomConfig, type TierKey } from '@/lib/campaignTiers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mirrors submit/route.ts + topic-batches: derive a topic_group_id from a
// (formId, topicId) so we can attach human titles to the loaded groups.
function topicGroupIdFor(formId: string, topicId: string): string {
  const h = createHash('sha256').update(`${formId}:${topicId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const clientId = (url.searchParams.get('clientId') || '').trim()
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }
    const months = Math.max(1, Number(url.searchParams.get('months')) || 1)

    const supabase = plannerAdmin()

    const { data: client } = await supabase
      .from('clients')
      .select('package_tier, custom_config')
      .eq('id', clientId)
      .maybeSingle()

    const tierCfg = resolveTierConfig({
      package_tier: (client?.package_tier as TierKey | null) ?? null,
      custom_config: (client?.custom_config as CustomConfig | null) ?? null,
    })

    // Streams this tier actually produces (count > 0).
    const per = tierCfg.perCampaign
    const tierStreams: StreamKey[] = (
      [
        ['short_form', per.shortForm],
        ['engagement_reel', per.engagementReels],
        ['carousel', per.carousels],
        ['story', per.stories],
      ] as [StreamKey, number][]
    )
      .filter(([, n]) => n > 0)
      .map(([s]) => s)

    // Available (unused) topic groups with their typed, thin-flagged answers.
    const groups = await loadAvailableTopicGroups(supabase, clientId)

    // Build a topic_group_id -> title map from the question form definitions.
    const { data: forms } = await supabase
      .from('question_forms')
      .select('id, topics')
      .eq('client_id', clientId)
      .not('topics', 'is', null)
    const titleById = new Map<string, string>()
    for (const f of (forms ?? []) as Array<{ id: string; topics: unknown }>) {
      const topics = Array.isArray(f.topics) ? (f.topics as unknown[]) : []
      for (const t of topics) {
        if (!t || typeof t !== 'object') continue
        const obj = t as { id?: string; title?: string }
        if (typeof obj.id !== 'string') continue
        titleById.set(topicGroupIdFor(f.id, obj.id), obj.title ?? '')
      }
    }

    const topics: ReadinessTopicInput[] = groups.map((g) => ({
      topic_group_id: g.topic_group_id,
      title: titleById.get(g.topic_group_id) || null,
      answers: g.answers.map((a) => ({
        input_type: a.input_type,
        thin_flag: a.thin_flag,
        answer: a.answer,
      })),
    }))

    const report = assessReadiness({
      topics,
      campaignsPerMonth: tierCfg.campaignsPerMonth,
      monthsAhead: months,
      tierStreams,
    })

    return NextResponse.json({ success: true, report, tierStreams })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('GET /api/planner/readiness exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
