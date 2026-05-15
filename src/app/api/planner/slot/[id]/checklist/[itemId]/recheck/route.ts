// POST /api/planner/slot/[id]/checklist/[itemId]/recheck
//
// Re-evaluates a single checklist item against the slot's current script.
// Cheap (Flash-Lite) call - the eval is a yes/no judgment, not generation.
// On success, persists the new status + ai_note into generation_meta.checklist
// in place. Other items are untouched.
//
// Failures fall back to status='manual_check' with an explanatory note so
// the UI never gets stuck in a "rechecking..." spinner.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'
import {
  countSpokenWords,
  getChecklistForFormat,
  lengthTargetWindow,
  type ChecklistItem,
} from '@/lib/checklist/items'
import { recheckChecklistItem } from '@/lib/checklist/recheck'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await context.params
    if (!id || !itemId) {
      return NextResponse.json(
        { success: false, error: 'Missing slot id or item id' },
        { status: 400 },
      )
    }

    const supabase = plannerAdmin()

    // Load slot + format slug for the item registry lookup.
    const { data: slot, error: loadErr } = await supabase
      .from('content_plan_slots')
      .select('id, client_id, status, format_id, stream, generation_meta')
      .eq('id', id)
      .maybeSingle()
    if (loadErr || !slot) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 })
    }
    if (slot.status === 'approved') {
      return NextResponse.json(
        { success: false, error: 'Cannot recheck an approved slot' },
        { status: 409 },
      )
    }

    const meta = (slot.generation_meta as Record<string, unknown> | null) ?? {}
    const script = typeof meta.script === 'string' ? meta.script : ''
    if (!script.trim()) {
      return NextResponse.json(
        { success: false, error: 'Slot has no script to recheck' },
        { status: 400 },
      )
    }
    const checklist = Array.isArray(meta.checklist)
      ? (meta.checklist as ChecklistItem[])
      : []

    // Resolve the item definition. Long-form slots have format_id=null;
    // their checklist lives under the synthetic 'long_form.long_form' slug.
    const formatSlug = slot.stream === 'long_form'
      ? 'long_form.long_form'
      : await resolveFormatSlug(slot.format_id as string | null)
    if (!formatSlug) {
      return NextResponse.json(
        { success: false, error: 'Could not resolve format for slot' },
        { status: 500 },
      )
    }
    const def = getChecklistForFormat(formatSlug).find((d) => d.id === itemId)
    if (!def) {
      return NextResponse.json(
        { success: false, error: `Unknown checklist item: ${itemId}` },
        { status: 404 },
      )
    }

    // Special case: universal.length_in_target is deterministic word-count
    // math, not AI judgment. Skip the AI call entirely and compute the truth.
    let result: { status: 'pass' | 'flag' | 'manual_check'; ai_note: string }
    if (itemId === 'universal.length_in_target') {
      result = await computeLengthRecheck(slot.stream as 'long_form' | 'short_form' | 'engagement_reel' | 'carousel' | 'story', formatSlug, script)
    } else {
      result = await recheckChecklistItem({
        script,
        item: def,
        clientId: slot.client_id as string,
      })
    }

    // Update just this item in the checklist; clear any prior human override
    // since the staff has explicitly asked for a fresh AI evaluation. Keep
    // edited_by/edited_at if the user previously fixed/waived - they're
    // still part of the audit trail.
    const updated = checklist.map((item): ChecklistItem => {
      if (item.id !== itemId) return item
      return {
        id: item.id,
        label: item.label,
        status: result.status,
        ai_note: result.ai_note,
        // Drop human override - they re-checked, they want a fresh eval.
        human_status: null,
        human_note: undefined,
        edited_by: item.edited_by,
        edited_at: item.edited_at,
      }
    })

    // Edge case: item id wasn't in saved checklist (registry drift).
    // Add it so the UI can render the result.
    if (!updated.some((i) => i.id === itemId)) {
      updated.push({
        id: def.id,
        label: def.label,
        status: result.status,
        ai_note: result.ai_note,
      })
    }

    const nextMeta = { ...meta, checklist: updated }
    const { error: saveErr } = await supabase
      .from('content_plan_slots')
      .update({ generation_meta: nextMeta })
      .eq('id', id)
    if (saveErr) {
      console.error('checklist/recheck save error:', saveErr)
      return NextResponse.json(
        { success: false, error: saveErr.message },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      item: updated.find((i) => i.id === itemId) ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('checklist/recheck unhandled:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

/** Look up the format slug for a non-longform slot. */
async function resolveFormatSlug(formatId: string | null): Promise<string | null> {
  if (!formatId) return null
  const supabase = plannerAdmin()
  const { data } = await supabase
    .from('content_formats')
    .select('slug')
    .eq('id', formatId)
    .maybeSingle()
  return (data?.slug as string | null) ?? null
}

/** Deterministic length recheck. Looks up the format's target range and
 *  compares against the actual word count. No AI call. Long-form targets
 *  are word counts; short-form targets are seconds (converted at IG pace
 *  via lengthTargetWindow). Engagement reels + carousels skip the math
 *  entirely - they're structurally constrained by scene/slide count, not
 *  word count, so we mark manual_check. */
async function computeLengthRecheck(
  stream: 'long_form' | 'short_form' | 'engagement_reel' | 'carousel' | 'story',
  formatSlug: string,
  script: string,
): Promise<{ status: 'pass' | 'flag' | 'manual_check'; ai_note: string }> {
  const wordCount = countSpokenWords(script)
  if (stream === 'engagement_reel') {
    return {
      status: 'manual_check',
      ai_note: `Computed ${wordCount} words across overlay scenes + caption + hashtags. Engagement reels are structurally constrained: 1-4 scenes (5-14 words each) + 60-120 word caption + 8-14 hashtags. Eyeball the structure.`,
    }
  }
  if (stream === 'carousel') {
    return {
      status: 'manual_check',
      ai_note: `Computed ${wordCount} words across slides + caption + hashtags. Carousels are structurally constrained: exactly 10 slides (max 18 words each) + 90-160 word caption + 12-18 hashtags. Eyeball the structure.`,
    }
  }
  // Long-form pseudo-format isn't in content_formats; hard-code its target.
  let min: number | null = null
  let max: number | null = null
  if (formatSlug === 'long_form.long_form' || stream === 'long_form') {
    min = 1800
    max = 2800
  } else {
    const supabase = plannerAdmin()
    const { data } = await supabase
      .from('content_formats')
      .select('target_length_min, target_length_max')
      .eq('slug', formatSlug)
      .maybeSingle()
    min = (data?.target_length_min as number | null) ?? null
    max = (data?.target_length_max as number | null) ?? null
  }
  const window = lengthTargetWindow(stream, { target_length_min: min, target_length_max: max })
  if (!window) {
    return {
      status: 'manual_check',
      ai_note: `Computed ${wordCount} words. Format has no target range to compare against.`,
    }
  }
  const inRange = wordCount >= window.minWords && wordCount <= window.maxWords
  return {
    status: inRange ? 'pass' : 'flag',
    ai_note: inRange
      ? `Computed ${wordCount} words (target ${window.targetLabel}).`
      : `Computed ${wordCount} words; target ${window.targetLabel}. ${
          wordCount > window.maxWords
            ? `Over by ${wordCount - window.maxWords} words - cut a beat.`
            : `Under by ${window.minWords - wordCount} words - flesh out a beat.`
        }`,
  }
}
