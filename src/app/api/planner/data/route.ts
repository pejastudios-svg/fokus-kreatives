// Returns everything the calendar UI needs in one call:
//   * client (id, name, package_tier)
//   * stage state (current + proposed + criteria progress)
//   * slots in the horizon (with format slug + bucket joined)
//   * story queue (unconsumed)
//   * coverage report (current vs target)
//   * format library (so swap-format can list options)

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'
import { listFormats } from '@/lib/contentFormats'
import { evaluateStageCriteria } from '@/lib/contentStage'
import { coverageReport, effectiveTargets } from '@/lib/planner/coverage'
import type { ContentBucket } from '@/lib/contentFormats/types'
import type { ContentStage, CoverageSnapshot } from '@/lib/planner/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const clientId = url.searchParams.get('clientId')
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }
    const monthsAhead = Math.max(1, Math.min(3, parseInt(url.searchParams.get('months') ?? '1', 10) || 1))

    const supabase = plannerAdmin()

    const { data: clientRow } = await supabase
      .from('clients')
      .select('id, name, business_name, package_tier')
      .eq('id', clientId)
      .maybeSingle()
    if (!clientRow) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
    }

    const { data: stageRow } = await supabase
      .from('content_stage_state')
      .select('current_stage, proposed_stage, proposed_at, dismissed_at, criteria_progress')
      .eq('client_id', clientId)
      .maybeSingle()
    const currentStage = ((stageRow?.current_stage as ContentStage | undefined) ?? 'foundation')

    const { data: settingsRow } = await supabase
      .from('brand_content_settings')
      .select('bucket_target_storytelling, bucket_target_educational, bucket_target_opinion, bucket_target_proof_community, plan_horizon_months')
      .eq('client_id', clientId)
      .maybeSingle()

    const overrides: Partial<CoverageSnapshot> = {}
    if (settingsRow?.bucket_target_storytelling != null) overrides.storytelling = settingsRow.bucket_target_storytelling
    if (settingsRow?.bucket_target_educational != null) overrides.educational = settingsRow.bucket_target_educational
    if (settingsRow?.bucket_target_opinion != null) overrides.opinion = settingsRow.bucket_target_opinion
    if (settingsRow?.bucket_target_proof_community != null) overrides.proof_community = settingsRow.bucket_target_proof_community

    // Horizon: from + to are YYYY-MM-DD. Backwards compat: if from is YYYY-MM
    // we treat it as the first of that month, and combine with monthsAhead to
    // derive the end. New callers pass both from and to as full dates.
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')
    const today = new Date()

    let horizonStart: string
    if (fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
      horizonStart = fromParam
    } else if (fromParam && /^\d{4}-\d{2}$/.test(fromParam)) {
      horizonStart = `${fromParam}-01`
    } else {
      horizonStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`
    }

    let horizonEnd: string
    if (toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      // toParam is INCLUSIVE end date - the slot query uses lt() so we add 1 day.
      const t = new Date(`${toParam}T00:00:00Z`)
      t.setUTCDate(t.getUTCDate() + 1)
      horizonEnd = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
    } else {
      const startY = parseInt(horizonStart.slice(0, 4), 10)
      const startM = parseInt(horizonStart.slice(5, 7), 10)
      const endY = startY + Math.floor((startM - 1 + monthsAhead) / 12)
      const endM = ((startM - 1 + monthsAhead) % 12) + 1
      horizonEnd = `${endY}-${String(endM).padStart(2, '0')}-01`
    }

    const { data: slotsRows } = await supabase
      .from('content_plan_slots')
      .select('id, stream, format_id, scheduled_date, status, topic_group_id, raw_material_refs, hook_preview, generation_meta, locked, approved_at, display_order')
      .eq('client_id', clientId)
      .gte('scheduled_date', horizonStart)
      .lt('scheduled_date', horizonEnd)
      .order('scheduled_date', { ascending: true })
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })

    const formats = await listFormats({ is_active: true })
    const formatById = new Map(formats.map((f) => [f.id, f]))

    const slots = (slotsRows ?? []).map((s) => {
      const format = s.format_id ? formatById.get(s.format_id as string) : null
      return {
        ...s,
        format_slug: format?.slug ?? null,
        format_name: format?.name ?? (s.stream === 'long_form' ? 'Long-Form' : null),
        bucket: format?.bucket ?? null,
      }
    })

    // Active queue (unused prompts the team can still act on).
    const { data: storyRows } = await supabase
      .from('story_queue_items')
      .select('id, format_id, source_format_id, carrier, intent, campaign, mechanic, prompt_text, visual_direction, frames, raw_material_refs, pinned_to_date, seed_text, created_at, consumed_at, checklist')
      .eq('client_id', clientId)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })

    // History (last 50 used prompts, most recently used first). Capped to keep
    // payload bounded - older history is in the DB but not returned here.
    const { data: storyHistoryRows } = await supabase
      .from('story_queue_items')
      .select('id, format_id, source_format_id, carrier, intent, campaign, mechanic, prompt_text, visual_direction, frames, raw_material_refs, pinned_to_date, seed_text, created_at, consumed_at, checklist')
      .eq('client_id', clientId)
      .not('consumed_at', 'is', null)
      .order('consumed_at', { ascending: false })
      .limit(50)

    const decorateStory = (s: Record<string, unknown>) => {
      // For legacy rows, format_id points to the old story-native format.
      // For new rows, source_format_id points to the compressed source
      // (short-form / engagement-reel / carousel format). Surface both so
      // the panel can show "compressed from Hero's Journey" or fall back
      // to the legacy format name.
      const sourceFormatId = (s.source_format_id ?? s.format_id) as string | null
      const sourceFormat = sourceFormatId ? formatById.get(sourceFormatId) : null
      const legacyFormat = s.format_id ? formatById.get(s.format_id as string) : null
      return {
        ...s,
        format_slug: legacyFormat?.slug ?? null,
        format_name: legacyFormat?.name ?? null,
        source_format_slug: sourceFormat?.slug ?? null,
        source_format_name: sourceFormat?.name ?? null,
        // The frames jsonb now holds beats for new rows. Just pass through;
        // the UI decides which shape to render based on the carrier field.
        beats: s.frames,
      }
    }

    const storyQueue = (storyRows ?? []).map(decorateStory)
    const storyHistory = (storyHistoryRows ?? []).map(decorateStory)

    const buckets = slots
      .map((s) => s.bucket as ContentBucket | null)
      .filter((b): b is ContentBucket => !!b)
    const coverage = coverageReport({ stage: currentStage, overrides, slotsBuckets: buckets })

    const stageEval = await evaluateStageCriteria(clientId)

    const { data: shareLinks } = await supabase
      .from('content_plan_share_links')
      .select('id, token, expires_at, revoked_at, created_at')
      .eq('client_id', clientId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    return NextResponse.json({
      success: true,
      client: clientRow,
      stage: {
        ...stageEval,
        proposed_stage: stageRow?.proposed_stage ?? null,
        proposed_at: stageRow?.proposed_at ?? null,
        dismissed_at: stageRow?.dismissed_at ?? null,
      },
      coverage,
      target: effectiveTargets(currentStage, overrides),
      horizon: { start: horizonStart, end: horizonEnd, monthsAhead },
      slots,
      storyQueue,
      storyHistory,
      formats,
      shareLinks: shareLinks ?? [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('planner/data error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
