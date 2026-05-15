// Re-evaluate a single checklist item against a (possibly edited) script.
// One Flash-Lite call - the eval is mechanical (does the rule hold?), no
// generation craft needed. Used by the per-item recheck endpoint after a
// staff member edits the script and wants to see if a flagged item now
// passes.

import { generateScript } from '@/lib/ai/provider'
import { withContentRetry } from '@/lib/ai/contentRetry'
import type { ChecklistItemDef, ChecklistStatus } from './items'

export interface RecheckOptions {
  script: string
  /** The single item being evaluated. */
  item: ChecklistItemDef
  /** For ai_usage_log. */
  clientId?: string
  /** For ai_usage_log. */
  userId?: string
}

export interface RecheckResult {
  status: ChecklistStatus
  ai_note: string
}

/**
 * Run a focused single-item evaluation. Returns the new status + a
 * one-sentence rationale. On any AI failure (parse, transient), returns
 * 'manual_check' with an explanatory note rather than throwing - the UI
 * surfaces the result and the staff can override.
 */
export async function recheckChecklistItem(opts: RecheckOptions): Promise<RecheckResult> {
  const { script, item, clientId, userId } = opts

  const system = `You are a strict QA evaluator for social media scripts. You receive ONE rule and ONE script. Decide whether the script meets the rule.

Output STRICT JSON:
{
  "status": "pass" | "flag" | "manual_check",
  "ai_note": "one sentence explaining why"
}

- "pass" = rule is satisfied with no caveats.
- "flag" = rule is clearly violated. Be specific in ai_note about what fails.
- "manual_check" = rule depends on context outside the script (e.g. visuals, brand-knowledge). Tell staff what they should check.

Be honest. Don't rubber-stamp. If the rule says "specific" and the script is generic, flag it.`

  const user = `RULE (id: ${item.id}, label: ${item.label}):
${item.rule}

SCRIPT TO EVALUATE:
${script}

TASK: Apply the RULE to the SCRIPT. Output the JSON.`

  try {
    return await withContentRetry(
      `checklist.recheck.${item.id}`,
      async () => {
        const result = await generateScript({
          system,
          user,
          temperature: 0.2,
          maxTokens: 200,
          jsonObject: true,
          quality: 'cheap',
          route: 'checklist.recheck',
          clientId,
          userId,
          usageMeta: { item_id: item.id },
        })
        const parsed = parseRecheckOutput(result.content)
        return parsed
      },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[checklist.recheck] ${item.id} failed: ${msg}`)
    return {
      status: 'manual_check',
      ai_note: 'Re-evaluation failed - please review manually.',
    }
  }
}

function parseRecheckOutput(content: string): RecheckResult {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error('Recheck output was not valid JSON')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Recheck output JSON was not an object')
  }
  const obj = raw as Record<string, unknown>
  const status =
    obj.status === 'pass' || obj.status === 'flag' || obj.status === 'manual_check'
      ? (obj.status as ChecklistStatus)
      : null
  if (!status) throw new Error('Recheck output had invalid status')
  const ai_note = typeof obj.ai_note === 'string' ? obj.ai_note.trim() : ''
  return { status, ai_note: ai_note || 'No reasoning provided.' }
}
