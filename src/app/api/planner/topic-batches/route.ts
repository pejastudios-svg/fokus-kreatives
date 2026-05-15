// Lists the brand's available topic batches (question_forms with the M2
// topics jsonb populated, plus their derived topic_group_ids). The planner
// page uses this to surface a picker when 2+ batches exist so staff can
// scope which material each plan generation uses.

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { plannerAdmin } from '@/lib/planner/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TopicJson {
  id?: string
  title?: string
}

// Mirrors submit/route.ts:topicGroupIdFor so we can derive which group_ids
// belong to which form without joining tables.
function topicGroupIdFor(formId: string, topicId: string): string {
  const h = createHash('sha256').update(`${formId}:${topicId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const clientId = url.searchParams.get('clientId')
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const supabase = plannerAdmin()

    const { data: forms } = await supabase
      .from('question_forms')
      .select('id, title, topics, created_at, submitted_at')
      .eq('client_id', clientId)
      .not('topics', 'is', null)
      .order('created_at', { ascending: false })

    const rows = (forms ?? []) as Array<{
      id: string
      title: string | null
      topics: unknown
      created_at: string
      submitted_at: string | null
    }>

    // For each form, derive topic_group_ids from the topics jsonb.
    interface BatchInfo {
      formId: string
      title: string | null
      createdAt: string
      submittedAt: string | null
      topicCount: number
      topicGroupIds: string[]
    }
    const batches: BatchInfo[] = []
    for (const r of rows) {
      const topics = Array.isArray(r.topics) ? (r.topics as unknown[]) : []
      const topicGroupIds: string[] = []
      let topicCount = 0
      for (const t of topics) {
        if (!t || typeof t !== 'object') continue
        const obj = t as TopicJson
        if (typeof obj.id !== 'string') continue
        topicGroupIds.push(topicGroupIdFor(r.id, obj.id))
        topicCount += 1
      }
      batches.push({
        formId: r.id,
        title: r.title,
        createdAt: r.created_at,
        submittedAt: r.submitted_at,
        topicCount,
        topicGroupIds,
      })
    }

    // Determine which batches have any answered + unused material. We only
    // care about topic_group_ids that have at least one row in the topics
    // table with answers AND aren't already consumed (used_at IS NULL).
    const allTopicGroupIds = batches.flatMap((b) => b.topicGroupIds)
    const usableSet = new Set<string>()
    if (allTopicGroupIds.length) {
      const { data: usable } = await supabase
        .from('topics')
        .select('topic_group_id')
        .eq('client_id', clientId)
        .is('used_at', null)
        .in('topic_group_id', allTopicGroupIds)
      for (const u of usable ?? []) {
        if (u.topic_group_id) usableSet.add(u.topic_group_id as string)
      }
    }

    const enriched = batches.map((b) => {
      const usableIds = b.topicGroupIds.filter((id) => usableSet.has(id))
      return {
        formId: b.formId,
        title: b.title,
        createdAt: b.createdAt,
        submittedAt: b.submittedAt,
        topicCount: b.topicCount,
        usableTopicCount: usableIds.length,
        topicGroupIds: usableIds, // only the ones with available material
      }
    })

    return NextResponse.json({ success: true, batches: enriched })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
