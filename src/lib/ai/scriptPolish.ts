// Hybrid Flash + Pro polish for short-form scripts. Flash drafts the full
// script (cheap, structurally correct via format scaffolding); Pro then
// polishes ONLY the hook (first sentence) and the close (last sentence) -
// the two highest-leverage sections per script. Body is left intact.
//
// Why this hybrid instead of pure Pro:
//   - Body is ~70% of script tokens and benefits least from Pro craft when
//     format scaffolding is good. Pure Flash bodies are solid.
//   - Hook is ~5% of tokens and decides whether anyone watches at all.
//     This is where Pro's literary craft compounds.
//   - Close is ~5% of tokens and decides save/share/follow rates.
//   - Polishing only hook + close means a tiny Pro call (~80 output tokens)
//     gets you ~85% of pure-Pro quality at ~25% of pure-Pro cost.
//
// Applies to ALL clients, not just top tier. Quality consistency matters more
// than per-client cost optimization here.

import { generateScript } from './provider'
import type { ContentFormat } from '@/lib/contentFormats/types'

export interface PolishInput {
  /** The full script Flash drafted. We replace the first + last sentences. */
  script: string
  /** Format module (used to pull hook patterns + secret sauce). */
  format: ContentFormat
  /** Brand voice block (already-rendered text). The exact same string passed
   *  to Flash for the body call - keeps voice consistent. */
  brandVoiceBlock: string
  /** For usage logging. */
  clientId?: string
  userId?: string
}

export interface PolishResult {
  /** The script with hook + close replaced (when Pro decided to rewrite them).
   *  Body unchanged. */
  polishedScript: string
  /** Whether Pro actually rewrote each piece (false = original was already
   *  9/10 in Pro's evaluation). Useful for telemetry / A-B comparison. */
  hookRewritten: boolean
  closeRewritten: boolean
  /** What Pro replaced. Empty when not rewritten. */
  newHook: string
  newClose: string
}

/**
 * Run a single Pro call that evaluates and (optionally) rewrites the hook
 * and close. The body of the script is NEVER touched by Pro - that stays
 * exactly as Flash produced it.
 *
 * Returns the polished script + which sections were rewritten. Caller
 * decides whether to log the deltas for telemetry.
 */
export async function polishHookAndClose(input: PolishInput): Promise<PolishResult> {
  const { script, format, brandVoiceBlock, clientId, userId } = input

  // Split the script into first sentence (hook) + middle (body) + last
  // sentence (close). Sentence boundary = . ! or ? followed by space + capital.
  const segments = splitFirstAndLast(script)
  if (!segments) {
    // Couldn't safely split (e.g. script is one sentence). Skip the polish
    // pass and return the original.
    return {
      polishedScript: script,
      hookRewritten: false,
      closeRewritten: false,
      newHook: '',
      newClose: '',
    }
  }

  const { hook, body, close } = segments

  // Render hook patterns + secret sauce so Pro knows the format's quality bar.
  const patternBlock = format.hook_patterns.length
    ? format.hook_patterns
        .map((h, i) => `${i + 1}. PATTERN: ${h.pattern}\n   EXAMPLE: ${h.example}`)
        .join('\n')
    : '(no hook patterns defined for this format)'

  const system = `You polish the hook and close of a short-form social media script.

You receive a draft script that's already structurally correct. Your ONLY job is to evaluate the FIRST SENTENCE (the hook) and the LAST SENTENCE (the close). Leave the body alone.

EVALUATE THE HOOK against this bar:
- Drops viewer into a specific moment, number, name, or claim in the first 2 seconds
- Sounds like the brand actually saying it (contractions, fragments OK)
- Makes someone think "wait, what?" so they keep watching
- No throat-clearing ("hey friends", "today I want to talk about", "in this video")
- No abstract summaries ("Finally feeling the X struggle taught me how Y matters")

The format's hook patterns are:
${patternBlock}

EVALUATE THE CLOSE against this bar:
- Either a CTA that earns attention (save, share, comment, follow for X), or a punchline that lands the post on its own, or an invitation
- Not a generic "thanks for watching"
- Not a wrap-up summary
- Echoes the hook's energy

For each section, decide:
- 9/10 or higher already - return unchanged
- 8/10 or below - rewrite to 9/10+ using the hook patterns and brand voice

Output STRICT JSON:
{
  "hook_rewritten": boolean,
  "new_hook": "(rewritten hook, or empty string if not rewritten)",
  "close_rewritten": boolean,
  "new_close": "(rewritten close, or empty string if not rewritten)"
}

BRAND VOICE:
${brandVoiceBlock}

FORMAT SECRET SAUCE: ${format.secret_sauce}`

  const user = `DRAFT SCRIPT (Flash output):

HOOK (current first sentence):
${hook}

BODY (do not touch):
${body}

CLOSE (current last sentence):
${close}

TASK: Evaluate the hook and close. Rewrite ONLY what falls below 9/10. Strict JSON only.`

  let parsed: {
    hook_rewritten?: boolean
    new_hook?: string
    close_rewritten?: boolean
    new_close?: string
  } = {}

  try {
    const { content } = await generateScript({
      system,
      user,
      temperature: 0.5,
      maxTokens: 300,
      jsonObject: true,
      // High-quality polish - the whole point is to use Pro craft on the
      // 5% of tokens where it matters.
      quality: 'high',
      route: 'm4.script_polish',
      clientId,
      userId,
      usageMeta: { format_slug: format.slug },
    })
    parsed = JSON.parse(content)
  } catch (err) {
    console.error('script polish failed - returning original:', err)
    return {
      polishedScript: script,
      hookRewritten: false,
      closeRewritten: false,
      newHook: '',
      newClose: '',
    }
  }

  const newHook = typeof parsed.new_hook === 'string' ? parsed.new_hook.trim() : ''
  const newClose = typeof parsed.new_close === 'string' ? parsed.new_close.trim() : ''
  const hookRewritten = !!parsed.hook_rewritten && !!newHook
  const closeRewritten = !!parsed.close_rewritten && !!newClose

  const finalHook = hookRewritten ? newHook : hook
  const finalClose = closeRewritten ? newClose : close
  const polishedScript = `${finalHook} ${body} ${finalClose}`.replace(/\s+/g, ' ').trim()

  return {
    polishedScript,
    hookRewritten,
    closeRewritten,
    newHook: hookRewritten ? newHook : '',
    newClose: closeRewritten ? newClose : '',
  }
}

/**
 * Split a script into (first sentence, middle, last sentence). Sentence
 * boundary is `.`/`!`/`?` followed by whitespace. Returns null when the
 * script has fewer than 3 sentences (no safe way to slice off ends without
 * mauling the body).
 */
function splitFirstAndLast(
  script: string,
): { hook: string; body: string; close: string } | null {
  const trimmed = script.trim()
  // Match sentence terminators followed by whitespace OR end of string.
  // The lookbehind keeps the terminator with the preceding sentence.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (sentences.length < 3) return null
  const hook = sentences[0]
  const close = sentences[sentences.length - 1]
  const body = sentences.slice(1, -1).join(' ')
  return { hook, body, close }
}
