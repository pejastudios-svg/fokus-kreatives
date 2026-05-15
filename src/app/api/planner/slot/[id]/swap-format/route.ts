import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'
import { getFormatById } from '@/lib/contentFormats'
import { generateHookPreview } from '@/lib/planner/hookPreview'
import { loadAvailableTopicGroups } from '@/lib/planner/material'
import { pickBestMaterial } from '@/lib/planner/scoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  formatId?: string
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const body = (await req.json()) as Body
    if (!body.formatId) {
      return NextResponse.json({ success: false, error: 'Missing formatId' }, { status: 400 })
    }

    const supabase = plannerAdmin()
    const { data: slotRow } = await supabase
      .from('content_plan_slots')
      .select('id, client_id, status')
      .eq('id', id)
      .maybeSingle()

    if (!slotRow) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 })
    }
    if (slotRow.status === 'approved') {
      return NextResponse.json({ success: false, error: 'Cannot swap format on an approved slot' }, { status: 400 })
    }

    const format = await getFormatById(body.formatId)
    if (!format) {
      return NextResponse.json({ success: false, error: 'Format not found' }, { status: 404 })
    }

    const groups = await loadAvailableTopicGroups(supabase, slotRow.client_id as string)
    const material = pickBestMaterial(format, groups)
    if (material.refs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No usable raw material for this format' },
        { status: 400 },
      )
    }

    const refSet = new Set(material.refs)
    const winnerAnswers = groups
      .find((g) => g.topic_group_id === material.topic_group_id)
      ?.answers.filter((a) => refSet.has(a.id)) ?? []

    const hook = await generateHookPreview({
      format,
      answers: winnerAnswers,
      clientId: slotRow.client_id as string,
    })

    const { data: updated, error: updateErr } = await supabase
      .from('content_plan_slots')
      .update({
        format_id: format.id,
        topic_group_id: material.topic_group_id,
        raw_material_refs: material.refs,
        hook_preview: hook,
        generation_meta: {
          score: material.fit,
          components: {
            material_fit: material.fit,
            coverage_need: 0,
            stage_weight: 0,
            variance_bonus: 0,
            recency_penalty: 0,
            total: material.fit,
          },
          reason: 'manual_format_swap',
        },
        status: 'planned',
      })
      .eq('id', id)
      .select('*')
      .single()

    if (updateErr || !updated) {
      return NextResponse.json({ success: false, error: updateErr?.message ?? 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, slot: updated })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('planner/slot/swap-format error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
