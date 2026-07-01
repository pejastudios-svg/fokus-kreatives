// QA checklist for a generated Instagram story (Story Set v2).
//
// Mirrors the script checklist (src/lib/checklist/evaluate.ts) but for the
// 4-frame text-first story format. A separate Pro evaluation grades the
// assembled frames against a small set of story-specific rules so the
// planner can flag AI tells / fabrication / bad CTAs per story. Read-only
// in the UI - stories are fixed via "Redo", not per-item edits, so there is
// no recheck/waive flow (unlike scripts).

import { generateScript } from '@/lib/ai/provider'
import { findHardBanHit } from '@/lib/prompt/engine'
import type { ChecklistItem, ChecklistItemDef } from './items'
import type { StoryFrameV2 } from '@/components/planner/types'

// The rules the AI grades a story against. Kept short - a story is ~40 words
// total, so the checklist stays focused on the failures that actually happen.
export const STORY_CHECKLIST_ITEMS: ChecklistItemDef[] = [
  {
    id: 'story.no_fabrication',
    label: 'Every name, number, and quote traces to the raw material',
    rule: 'Every specific fact, number, date, name, brand, product, or quote in the frames must appear in the RAW MATERIAL. Invented figures ("$40K", "60k views"), invented product comparisons, or invented offers/dates are a flag. A launch offer/date supplied by the campaign context is allowed.',
  },
  {
    id: 'story.no_ai_tells',
    label: 'No AI tells (rhetorical-question openers, negation pivots, em-dash, caps)',
    rule: 'No rhetorical-question-plus-fragment openers ("The real shift? ...", "What changed? ...", "It\'s not what you think"). No negation pivots ("X isn\'t Y, it\'s Z", "you\'re not X, you\'re Y"). No em-dash dramatic reframes. No CAPS-for-emphasis words. No "game-changer / level up / unlock / the truth about".',
  },
  {
    id: 'story.hook_specific',
    label: 'Hook drops into a specific moment, not a slogan',
    rule: 'The HOOK frame opens on a concrete moment, number, quote, or scene drawn from the raw material. A generic slogan or headline ("Stop guessing", "Your content is your salesperson") is a flag.',
  },
  {
    id: 'story.frames_coherent',
    label: 'Frames read as ONE story, linked in sequence',
    rule: 'The frames are one voice about one situation. HOOK sets up what VALUE elaborates; REHOOK reframes VALUE (no new topic); frames 2+ link to the previous with a connective. Topic drift between frames is a flag.',
  },
  {
    id: 'story.cta_valid',
    label: 'CTA is valid for a story (reply / share / follow, never "Save")',
    rule: 'The CTA frame uses a valid story CTA: a keyword reply, an engagement reply, a share ("Send this to someone who..."), or a follow. "Save this / bookmark this" is invalid (stories cannot be saved) and is a flag. Trail-off non-CTA endings are a flag.',
  },
]

const STORY_ITEM_BY_ID = new Map(STORY_CHECKLIST_ITEMS.map((d) => [d.id, d]))

/** Flatten the frames into a labelled block the evaluator reads. */
function framesToText(frames: StoryFrameV2[]): string {
  return frames
    .map((f, i) => {
      const lines = (f.text_blocks ?? []).map((b) => b.text).filter(Boolean).join(' / ')
      return `FRAME ${i + 1} [${f.role}] (visual: ${f.visual || 'n/a'}): ${lines}`
    })
    .join('\n')
}

/** Map raw AI output onto the registry, filling labels + backfilling misses. */
function reconcileStoryChecklist(raw: unknown[]): ChecklistItem[] {
  const byId = new Map<string, { status: ChecklistItem['status']; ai_note?: string }>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const id = typeof e.id === 'string' ? e.id : ''
    if (!STORY_ITEM_BY_ID.has(id)) continue
    const status =
      e.status === 'pass' || e.status === 'flag' || e.status === 'manual_check'
        ? e.status
        : 'manual_check'
    byId.set(id, { status, ai_note: typeof e.ai_note === 'string' ? e.ai_note : undefined })
  }
  return STORY_CHECKLIST_ITEMS.map((def) => {
    const hit = byId.get(def.id)
    return {
      id: def.id,
      label: def.label,
      status: hit?.status ?? 'manual_check',
      ai_note: hit?.ai_note ?? 'Not evaluated - check manually.',
    }
  })
}

export interface EvaluateStoryChecklistInput {
  frames: StoryFrameV2[]
  /** The brand's raw typed answers used to source the story (fabrication check). */
  rawMaterial: string
  /** Launch offer/date context, so a campaign-supplied offer isn't flagged. */
  campaignContext?: string
  /** For ai_usage_log. */
  clientId?: string
  formatSlug?: string
}

/**
 * Grade a generated story's frames against STORY_CHECKLIST_ITEMS. Returns the
 * reconciled ChecklistItem[] to save on the story row. Never throws - on any
 * failure every item falls back to 'manual_check' so the UI still renders.
 * A deterministic hard-ban scan overrides story.no_ai_tells to a hard flag
 * when a banned phrase survived (belt-and-suspenders over the AI grade).
 */
export async function evaluateStoryChecklist(
  input: EvaluateStoryChecklistInput,
): Promise<ChecklistItem[]> {
  const framesText = framesToText(input.frames)
  const itemsBlock = STORY_CHECKLIST_ITEMS.map((d) => `- id: ${d.id}\n  rule: ${d.rule}`).join('\n')

  const system = `You are a strict QA evaluator for a short Instagram story (4 text-first frames read silently). You receive the frames, the raw material they were sourced from, and a list of checklist items. For EACH item, decide whether the story meets the rule.

Output STRICT JSON:
{
  "checklist": [
    { "id": "<exact id>", "status": "pass" | "flag" | "manual_check", "ai_note": "one short sentence" },
    ... one entry per item ...
  ]
}

Status meanings:
- "pass" = rule satisfied, no caveats.
- "flag" = rule clearly violated. ai_note says what specifically fails (quote the offending frame).
- "manual_check" = needs a real asset or brand knowledge to verify (e.g. a PROOF frame's pasted screenshot).

Be honest. Don't rubber-stamp. One sentence per item. No prose outside the JSON. Start with { and end with }.`

  const user = `STORY FRAMES:
${framesText}

RAW MATERIAL (the brand's typed answers - the only allowed source of specifics):
${input.rawMaterial || '(none provided)'}
${input.campaignContext ? `\nCAMPAIGN CONTEXT (this offer/date is allowed even if absent from raw material): ${input.campaignContext}` : ''}

CHECKLIST ITEMS (one ai_note per item, by id):
${itemsBlock}`

  let items: ChecklistItem[]
  try {
    const { content } = await generateScript({
      system,
      user,
      temperature: 0.2,
      maxTokens: 1200,
      jsonObject: true,
      quality: 'high', // Pro - strict honest grading, not a rubber stamp
      route: 'planner.story_checklist',
      clientId: input.clientId,
      usageMeta: { format_slug: input.formatSlug ?? '', items: STORY_CHECKLIST_ITEMS.length },
    })
    const parsed = JSON.parse(content) as Record<string, unknown>
    const arr = Array.isArray(parsed.checklist) ? parsed.checklist : []
    items = reconcileStoryChecklist(arr)
  } catch (err) {
    console.warn('[story_checklist] eval failed - falling back to manual_check:', err)
    items = reconcileStoryChecklist([])
  }

  // Deterministic override: if a hard-banned phrase survived the sanitizer,
  // force the AI-tells item to a flag naming it - the AI grade can't miss it.
  const banHits = input.frames
    .flatMap((f) => (f.text_blocks ?? []).map((b) => findHardBanHit(b.text)))
    .filter((b): b is string => !!b)
  if (banHits.length > 0) {
    items = items.map((it) =>
      it.id === 'story.no_ai_tells'
        ? { ...it, status: 'flag', ai_note: `Banned phrase present: "${banHits[0]}".` }
        : it,
    )
  }

  return items
}
