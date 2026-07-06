// Generate the ~30-token hook preview shown on the calendar card. Uses
// Flash-Lite. One call per slot is the "Phase A" cost - cheap and bounded.
//
// We could batch all slot previews into a single call but the prompts are
// large enough (each format brings its own structure block) that a single
// call would risk truncation on a top-tier monthly plan with 84+ slots.
// One-call-per-slot keeps the failure mode local: if one preview fails,
// the slot still saves with a deterministic fallback.

import type { ContentFormat } from '@/lib/contentFormats/types'
import { generateScript } from '@/lib/ai/provider'
import type { RawTopicAnswer } from './types'

export interface HookPreviewInput {
  format: ContentFormat
  answers: RawTopicAnswer[]
  /** When set, the hook MUST anchor on this specific answer. The other
   *  entries in `answers` become supporting context only. This is how the
   *  answer-indexed campaign model forces hook uniqueness across pieces:
   *  every piece in a stream within a topic gets a distinct anchor, so no
   *  two hooks can repeat the same moment. */
  anchorAnswer?: RawTopicAnswer | null
  /** Hooks of "sibling" pieces that share this anchor (e.g. the carousel
   *  + engagement reel + story for the same topic+slot). The AI is told
   *  to come at the same moment from a DIFFERENT angle than the siblings
   *  so the four pieces feel like a campaign, not duplicates. */
  siblingHooks?: string[]
  /** When true, the anchor is being recycled because the topic doesn't
   *  have enough fresh answers to fill the tier's quota. The AI is told
   *  to write a TOTALLY different angle than the previous use. */
  recycled?: boolean
  clientId?: string
  brandName?: string
}

export async function generateHookPreview(input: HookPreviewInput): Promise<string | null> {
  const { format, answers, clientId, brandName, anchorAnswer, siblingHooks = [], recycled = false } = input

  if (answers.length === 0) return deterministicFallback(format, null)

  // Anchor preference: caller-supplied anchor first, then most concrete.
  const anchor = anchorAnswer ?? answers.find((a) => !a.thin_flag) ?? answers[0]
  const supporting = answers.filter((a) => a.id !== anchor.id)

  const siblingBlock =
    siblingHooks.length > 0
      ? `\nSIBLING HOOKS (these are other pieces in this campaign that share the SAME anchor moment as you - your hook must come at it from a clearly DIFFERENT angle, not paraphrase any of these):\n${siblingHooks
          .map((h) => `- "${h}"`)
          .join('\n')}\n`
      : ''
  const recycledBlock = recycled
    ? `\nANCHOR IS RECYCLED. This topic has fewer answers than the tier's quota, so this anchor moment is being used for a second piece. Your hook MUST take a totally different angle - different framing, different opening line, different emphasis - than any prior piece using this same anchor.\n`
    : ''

  const system = `You write the FIRST LINE of a piece of social media content. The viewer sees this line in the first 2 seconds - it's the hook that decides whether they keep watching or scroll.

Output exactly ONE line, 6-14 words. No labels, no colons, no quotes around the output, no greetings, no "in this video" / "today I want to talk about" preambles. This line is something the brand actually says or shows on screen as the opening punch.

ANTI-INVENTION RULE (zero tolerance):
- Use ONLY names, numbers, brands, products, and specifics that appear in the RAW MATERIAL below.
- If the raw material doesn't contain a dollar figure, do NOT make one up. Do NOT write "I made $40K in 30 days" or "12 leads in a week" or any other number that isn't in raw material.
- If raw material doesn't mention specific tools/brands (Notion, Slack, Figma, etc.), do NOT introduce them. Stay generic.
- The hook's specifics MUST come from the raw material below.

WHAT MAKES A GOOD HOOK (shape-only patterns - fill in specifics from raw material):
- A specific moment from the brand's actual experience: "[scene from raw material as a single sentence]"
- A counterintuitive claim from the brand's actual position: "[their take rephrased sharply]"
- A direct address that mirrors a real situation in raw material.

WHAT FAILS (these are weak summaries, not hooks):
- "Finally feeling the camera-shy struggle taught me how scripts matter."
- "Today I want to share my journey with content creation."
- "Here's what I learned about scriptwriting."

The line must:
- Drop into a specific moment, number, name, or claim FROM THE RAW MATERIAL - never abstract, never invented.
- Sound like the brand actually saying it out loud (contractions, fragments OK).
- Make someone think "wait, what?" so they keep watching.`

  const user = `FORMAT: ${format.name}
FORMAT'S SECRET SAUCE: ${format.secret_sauce || 'n/a'}
STARTING POINT: ${format.starting_point}

ANCHOR MOMENT (your hook MUST be built from THIS specific moment - this is the one piece of raw material the hook references; do not pivot to a different moment):
- (${anchor.input_type}) ${anchor.answer}
${supporting.length > 0 ? `\nSUPPORTING CONTEXT (use ONLY for body context if the format needs it - your hook does NOT reference these):\n${supporting.map((a) => `- (${a.input_type}) ${a.answer}`).join('\n')}\n` : ''}
${brandName ? `BRAND: ${brandName}\n` : ''}${siblingBlock}${recycledBlock}TASK: Write the one-line opening hook for this content. The hook anchors on the ANCHOR MOMENT above. One line. No commentary.`

  try {
    const { content } = await generateScript({
      system,
      user,
      temperature: 0.5,
      maxTokens: 80,
      quality: 'cheap',
      route: 'planner.hook_preview',
      clientId,
      usageMeta: { format_slug: format.slug, anchor_input_type: anchor?.input_type },
    })
    const cleaned = content
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\n+/g, ' ')
      .trim()
    return cleaned || deterministicFallback(format, anchor)
  } catch (err) {
    console.error('hook preview generation failed:', err)
    return deterministicFallback(format, anchor)
  }
}

/** Exported for the plan generator's Phase B time budget: when hook-preview
 *  generation runs out of time (e.g. the AI provider is down and every call
 *  burns through retries), remaining picks get this fallback directly
 *  instead of another doomed API call. */
export function hookPreviewFallback(format: ContentFormat, anchor: RawTopicAnswer | null): string {
  return deterministicFallback(format, anchor)
}

function deterministicFallback(format: ContentFormat, anchor: RawTopicAnswer | null): string {
  if (!anchor) return format.name
  const trimmed = anchor.answer.replace(/\s+/g, ' ').trim()
  const sliced = trimmed.length > 70 ? trimmed.slice(0, 67) + '...' : trimmed
  return `${format.name} - ${sliced}`
}
