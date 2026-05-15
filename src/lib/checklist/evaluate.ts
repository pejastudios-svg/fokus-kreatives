// Bulk checklist evaluation for an already-generated script.
//
// Used after the long-form generation path to evaluate the full QA
// checklist against the saved plain-text script. The reason this exists
// as a separate step (vs being embedded in the script-generation JSON
// like short-form does): long-form scripts are too large to fit
// inside a single JSON response alongside their checklist - the JSON
// escaping + checklist tokens push past Gemini's effective output
// ceiling and the response truncates mid-script. Splitting into two
// calls (plain-text script first, JSON checklist second) makes both
// reliable.
//
// For short-form / engagement-reel / carousel, the existing combined
// JSON+checklist call works fine - those scripts are smaller. This
// helper is long-form-specific.

import { generateScript } from '@/lib/ai/provider'
import { withContentRetry } from '@/lib/ai/contentRetry'
import {
  reconcileChecklist,
  type ChecklistItem,
  type ChecklistItemDef,
} from './items'

export interface EvaluateChecklistInput {
  /** The full saved script text (bracket-formatted long-form). */
  script: string
  /** Format slug used to look up the registry items. */
  formatSlug: string
  /** Pre-computed list of checklist items for the format. The caller
   *  passes this to keep the registry lookup in one place. */
  checklistDefs: ChecklistItemDef[]
  /** For ai_usage_log. */
  clientId?: string
  /** For ai_usage_log. */
  userId?: string
}

/**
 * Evaluate the checklist items against a generated script. Returns the
 * reconciled `ChecklistItem[]` ready to save into generation_meta.checklist.
 *
 * On any failure the function returns the registry items as 'manual_check'
 * so the UI still renders the full list - the staff can re-evaluate one
 * by one. We never throw; the script is already saved.
 */
export async function evaluateChecklistForScript(
  input: EvaluateChecklistInput,
): Promise<ChecklistItem[]> {
  const { script, formatSlug, checklistDefs, clientId, userId } = input

  // Build the items block the AI evaluates against.
  const itemsBlock = checklistDefs
    .map((d) => `- id: ${d.id}\n  rule: ${d.rule}`)
    .join('\n')

  const system = `You are a strict QA evaluator for a long-form YouTube script. You receive the full script + a list of checklist items. For EACH item, decide whether the script meets the rule.

Output STRICT JSON:
{
  "checklist": [
    { "id": "<exact id from the items list>", "status": "pass" | "flag" | "manual_check", "ai_note": "one short sentence explaining the call" },
    ... one entry per item below ...
  ]
}

Status meanings:
- "pass" = rule is satisfied with no caveats.
- "flag" = rule is clearly violated. ai_note must say what specifically fails.
- "manual_check" = rule needs visual / context / brand-knowledge to verify (e.g. visible proof shown means visible in a video, not in text). Tell staff what to look for.

Be honest. Don't rubber-stamp. Don't elaborate beyond one sentence per item - the staff reads this in a tight UI.

No prose outside the JSON. No markdown fences. The response starts with { and ends with }.`

  const user = `SCRIPT TO EVALUATE:

${script}

CHECKLIST ITEMS (one ai_note per item, by id):

${itemsBlock}`

  try {
    const result = await withContentRetry(
      'planner.script.checklist_eval',
      async () => {
        const r = await generateScript({
          system,
          user,
          temperature: 0.2,
          maxTokens: 1500,
          jsonObject: true,
          // Pro for the eval too - we want strict, honest grading,
          // not Flash rubber-stamping.
          quality: 'high',
          route: 'planner.script.checklist_eval',
          clientId,
          userId,
          usageMeta: { format_slug: formatSlug, items: checklistDefs.length },
        })
        const parsed = parseChecklistOutput(r.content)
        return parsed
      },
    )
    return reconcileChecklist(formatSlug, result)
  } catch (err) {
    console.warn('[checklist.evaluate] failed - falling back to manual_check items:', err)
    // Reconcile against an empty list so every registry item gets the
    // 'manual_check' fallback with an explanatory note.
    return reconcileChecklist(formatSlug, [])
  }
}

function parseChecklistOutput(content: string): unknown[] {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    const snippet = content.length > 200 ? `${content.slice(0, 100)}...${content.slice(-100)}` : content
    throw new Error(`Checklist JSON parse failed (length=${content.length}): ${snippet}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Checklist output JSON was not an object')
  }
  const obj = raw as Record<string, unknown>
  // Accept canonical key first, fall back to common variants.
  for (const key of ['checklist', 'checklist_items', 'qa', 'items']) {
    const v = obj[key]
    if (Array.isArray(v)) return v
  }
  throw new Error(`Checklist output missing checklist array (keys: ${Object.keys(obj).slice(0, 10).join(', ')})`)
}
