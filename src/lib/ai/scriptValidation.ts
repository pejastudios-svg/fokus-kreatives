// Mechanical safety nets that run on every generated script. Three checks:
//   1. detectFabricatedNumbers - flags specific numbers (subscriber counts,
//      revenue figures, named quantities) that don't appear in raw material.
//   2. detectPersonMixing - detects when the script switches between
//      first-person singular (I/me/my) and plural (we/us/our) mid-script.
//      Pairs with rewriteForPersonConsistency to do the actual fix.
//   3. autoTighten - if the script exceeds the format's word ceiling by more
//      than 10%, runs a single Flash compression call to cut a body beat.
//
// Pro is doing the heavy lifting now (full body, not just polish), but
// these mechanical checks catch the residual class of failures Pro still
// occasionally produces under specific conditions (long context, multiple
// competing rules, etc).

import { generateScript } from './provider'
import { withContentRetry } from './contentRetry'

// =============================================================================
// 1. NUMBER FABRICATION CHECK
// =============================================================================

/** Flags numbers that look like load-bearing claims (subscriber counts,
 *  revenue, named quantities) when they don't appear in raw material.
 *
 *  We deliberately ignore small structural numbers like "5 questions",
 *  "3 columns", "Step 1" - those are part of the framework being taught,
 *  not facts about the brand. The check targets:
 *    - Numbers >= 100 with optional comma separators
 *    - Numbers with currency or magnitude suffix ($40K, 1M, 10k)
 *    - Numbers followed by certain "social proof" nouns (subscribers,
 *      followers, clients, leads, customers, dollars, revenue)
 *
 *  Returns the list of fabricated numbers. Empty when all numbers in
 *  the script trace back to raw material. Caller decides whether to flag
 *  the slot, strip the offending sentences, or regenerate.
 */
export function detectFabricatedNumbers(script: string, rawMaterial: string): string[] {
  const claims = extractLoadBearingNumbers(script)
  if (claims.length === 0) return []
  // Build a lower-case haystack from raw material with all whitespace
  // normalized so "100K" matches "100k" and "$40,000" matches "$40000".
  const haystack = normalizeForMatch(rawMaterial)
  const out: string[] = []
  for (const claim of claims) {
    const needles = numberVariants(claim)
    if (!needles.some((n) => haystack.includes(n))) {
      out.push(claim)
    }
  }
  return out
}

const SOCIAL_PROOF_NOUNS = [
  'subscriber', 'subscribers', 'follower', 'followers',
  'client', 'clients', 'lead', 'leads', 'customer', 'customers',
  'view', 'views', 'sale', 'sales', 'user', 'users',
  'dollar', 'dollars', 'revenue', 'profit', 'visitor', 'visitors',
  'student', 'students', 'reader', 'readers', 'listener', 'listeners',
]

function extractLoadBearingNumbers(text: string): string[] {
  const out = new Set<string>()
  // Currency or magnitude-suffixed numbers: $40K, 1M, 10k, $1,200,000
  const currencyOrMag = /(?<!\w)\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[KMmk](?!\w)/g
  for (const m of text.matchAll(currencyOrMag)) out.add(m[0].trim())
  const dollarPlain = /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?(?!\w)/g
  for (const m of text.matchAll(dollarPlain)) out.add(m[0].trim())
  // Bare numbers >= 100
  const bigBare = /(?<!\w)\d{3,}(?:,\d{3})*(?:\.\d+)?(?!\w)/g
  for (const m of text.matchAll(bigBare)) out.add(m[0].trim())
  // Numbers (any size) followed by a social-proof noun within ~3 words
  // catches "12 leads", "5 clients", "3 sales" - small numbers that imply
  // social proof. The 3-word window absorbs "12 inbound leads",
  // "5 paying clients", etc.
  const proofPattern = new RegExp(
    `\\b(\\d+(?:,\\d{3})*(?:\\.\\d+)?[KMkm]?)\\s+(?:\\w+\\s+){0,3}(?:${SOCIAL_PROOF_NOUNS.join('|')})\\b`,
    'gi',
  )
  for (const m of text.matchAll(proofPattern)) out.add(m[1].trim())
  return [...out]
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s,]+/g, ' ')
    .trim()
}

/** Generate normalized variants of a number so "$40K" matches "$40,000",
 *  "100K" matches "100,000", etc. */
function numberVariants(claim: string): string[] {
  const lower = claim.toLowerCase()
  const variants = new Set<string>([lower])
  // Strip currency symbol for $-prefixed.
  if (lower.startsWith('$')) variants.add(lower.slice(1))
  // Expand K/M suffix to numeric.
  const km = lower.match(/^(\$)?(\d+(?:\.\d+)?)([km])$/i)
  if (km) {
    const sign = km[1] ?? ''
    const n = parseFloat(km[2])
    const mult = km[3].toLowerCase() === 'k' ? 1000 : 1_000_000
    const expanded = (n * mult).toString()
    variants.add(`${sign}${expanded}`)
    variants.add(expanded)
    // With comma separators
    variants.add(`${sign}${(n * mult).toLocaleString('en-US')}`.toLowerCase())
    variants.add((n * mult).toLocaleString('en-US').toLowerCase())
  }
  return [...variants]
}

// =============================================================================
// 2. PERSON CONSISTENCY
// =============================================================================

export interface PersonAnalysis {
  /** What person the script OPENS in. The first appearance of either
   *  pronoun set wins. Null when the script has no first-person reference. */
  opener: 'singular' | 'plural' | null
  /** Counts of each pronoun set across the whole script. */
  singularCount: number
  pluralCount: number
  /** True when both counts are > 0 and the script is mixing. */
  mixing: boolean
}

/** Detect first-person voice mixing. The script should pick "I" or "we"
 *  based on the opener and stay there. */
export function analyzePersonConsistency(script: string): PersonAnalysis {
  const lower = script.toLowerCase()
  // Whole-word matches only - "you" doesn't count, "i" without word-boundary
  // would match "is" / "in", so use \b.
  const singularRe = /\b(i|me|my|mine|i'm|i've|i'll|i'd)\b/g
  const pluralRe = /\b(we|us|our|ours|we're|we've|we'll|we'd)\b/g

  const singularMatches = [...lower.matchAll(singularRe)]
  const pluralMatches = [...lower.matchAll(pluralRe)]

  let opener: 'singular' | 'plural' | null = null
  if (singularMatches.length > 0 && pluralMatches.length > 0) {
    opener = singularMatches[0].index! < pluralMatches[0].index! ? 'singular' : 'plural'
  } else if (singularMatches.length > 0) {
    opener = 'singular'
  } else if (pluralMatches.length > 0) {
    opener = 'plural'
  }

  return {
    opener,
    singularCount: singularMatches.length,
    pluralCount: pluralMatches.length,
    mixing: singularMatches.length > 0 && pluralMatches.length > 0,
  }
}

/** Run a Pro rewrite to convert the script into a single first-person
 *  voice. Cheap because the input is small (1 short-form script) and the
 *  task is mechanical.
 *
 *  IMPORTANT - returns null when the rewrite truncates or returns
 *  meaningfully shorter than the original. The caller MUST treat null as
 *  "keep the original script" (we'd rather ship the original with
 *  inconsistent person than ship a truncated rewrite). Long-form scripts
 *  bit us specifically: a 3300-token script + 2000 maxTokens rewrite cap
 *  = the output gets chopped mid-script and we save the truncated version.
 *  Now we size the budget to the input AND verify length parity before
 *  accepting the rewrite.
 */
export async function rewriteForPersonConsistency(opts: {
  script: string
  target: 'singular' | 'plural'
  clientId?: string
}): Promise<string | null> {
  const { script, target, clientId } = opts
  const targetLabel = target === 'singular' ? 'first-person singular (I/me/my)' : 'first-person plural (we/us/our)'

  // Size the budget to the input. ~1.4 tokens per word + headroom for the
  // rewriter's thinking on Pro. Capped at 8000 (Gemini Pro's hard ceiling)
  // so we don't pass an invalid value.
  const wordCount = script.split(/\s+/).filter(Boolean).length
  const estimatedTokens = Math.ceil(wordCount * 1.4)
  const budget = Math.min(8000, Math.max(2000, estimatedTokens + 1500))

  const system = `You are a copy editor. The script you receive mixes first-person singular and plural pronouns. Rewrite it in CONSISTENT ${targetLabel}, preserving every other word, every fact, every example, every CTA, every line break.

Rules:
- Convert every opposing pronoun to ${targetLabel}. ("we" -> "I", "our framework" -> "my framework", or vice versa.)
- Do NOT change anything else. No new sentences, no rephrased lines, no removed beats.
- Preserve every bracket section label exactly. The script may use any of: [TITLE], [THUMBNAIL IDEA], [OUTLINE], [INTRO], [BODY], [OUTRO], [CTA], [DESCRIPTION], [HOOK], [REHOOK 1], [CTA], [REHOOK 2], [CLOSE], [RELOOP], [ANGLE], [PACING], [LENGTH], [SCENES], [CAPTION], [HASHTAGS], [SLIDES]. Do NOT add or remove any.
- The output MUST be at least as long as the input (we're swapping pronouns, not summarizing).
- Output the rewritten script as plain text. No JSON, no preamble.`

  const user = `SCRIPT TO REWRITE (${wordCount} words, preserve length):

${script}`

  try {
    const rewritten = await withContentRetry('script.person_polish', async () => {
      const result = await generateScript({
        system,
        user,
        temperature: 0.2,
        maxTokens: budget,
        quality: 'high',
        route: 'planner.script.person_polish',
        clientId,
        usageMeta: { target, input_words: wordCount, max_tokens: budget },
      })
      const cleaned = result.content.trim()
      if (!cleaned) throw new Error('Person rewrite returned empty')
      return cleaned
    })

    // Sanity check: a faithful pronoun rewrite preserves length within
    // ~10%. Anything significantly shorter means the rewrite truncated
    // (MAX_TOKENS) or summarized. Reject and keep the original.
    const originalLen = script.length
    const rewrittenLen = rewritten.length
    if (rewrittenLen < originalLen * 0.85) {
      console.warn(
        `[scriptValidation] person rewrite shorter than input (${rewrittenLen}/${originalLen} chars = ${Math.round(
          (rewrittenLen / originalLen) * 100,
        )}%). Likely truncated. Keeping original.`,
      )
      return null
    }
    return rewritten
  } catch (err) {
    console.warn('[scriptValidation] person rewrite failed, keeping original:', err)
    return null
  }
}

// =============================================================================
// 3. LONG-FORM POLISH (Pro pass for sentence-level cleanup)
// =============================================================================

/** Pull the contents of a single bracket-labeled section ([INTRO], [OUTRO],
 *  etc.) from a long-form script. Returns the body text between the label
 *  and the next bracket label, or null if the label is not found. Used by
 *  polishLongFormScript to compute the intro word count outside the model. */
function extractSection(script: string, label: string): string | null {
  const re = new RegExp(`\\[${label}\\]\\s*\\n?([\\s\\S]*?)(?=\\n\\[[A-Z]|$)`, 'i')
  const m = script.match(re)
  return m ? m[1].trim() : null
}

/** Targeted Pro polish for long-form scripts. Runs after the person-
 *  consistency rewrite and BEFORE auto-tighten / sanitize / save. Catches
 *  the residual class of failures the regex repairs in engine.ts can't
 *  reach reliably:
 *    - Broken sentences (missing auxiliary, dangling fragments).
 *    - Subtle meta-writing leaks ("here's where you can mention...").
 *    - INTRO running long (>220 words) - trim back to the cap without
 *      rewriting the whole intro.
 *
 *  Single Pro call. Conservative budget. Length sanity check rejects
 *  rewrites <85% of original (truncation guard, mirrors person-rewrite).
 *
 *  Returns null on failure / truncation - caller keeps the original. */
export async function polishLongFormScript(opts: {
  script: string
  clientId?: string
}): Promise<string | null> {
  const { script, clientId } = opts

  const wordCount = script.split(/\s+/).filter(Boolean).length
  const estimatedTokens = Math.ceil(wordCount * 1.4)
  const budget = Math.min(8000, Math.max(3000, estimatedTokens + 1500))

  // Compute the [INTRO] word count outside the model so the polish prompt
  // can state the exact number and the exact trim target. Pro is unreliable
  // at counting words against a budget when the count is implied; stating
  // it as a bare integer eliminates that failure mode.
  const introBlock = extractSection(script, 'INTRO')
  const introWords = introBlock
    ? introBlock.split(/\s+/).filter(Boolean).length
    : 0
  const introTrimNeeded = introWords > 220
  const introTrimAmount = introTrimNeeded ? introWords - 220 : 0

  const introInstruction = introTrimNeeded
    ? `3. The [INTRO] section is ${introWords} words. Cap is 220. Cut at least ${introTrimAmount} words from [INTRO] by removing the lowest-density sentence(s) - filler, generic empathy beats, or restated common-belief lines. The trim is REQUIRED, not optional. Do NOT touch any other section's word count.`
    : `3. The [INTRO] section is ${introWords} words and within budget. Do NOT touch its word count.`

  const system = `You are a copy editor for a long-form YouTube script. Your job is SURGICAL polish only - fix broken sentences and meta-writing leaks. Do not rewrite, do not restructure, do not summarize.

Your only allowed edits:
1. Fix broken sentences. Examples that MUST be fixed when you see them:
   - Missing auxiliary BE: "I just figuring this out" -> "I'm just figuring this out". "You documenting your reality" -> "You're documenting your reality".
   - Predicate-less noun phrase: "And your 'Scene' answer, where you described the setting and the feeling. That's a great Day-in-the-Life post." -> "And your 'Scene' answer, where you described the setting and the feeling, that's a great Day-in-the-Life post." (Apposition via comma; the first 'sentence' had no main verb.)
   - Conditional missing antecedent: "The secret sauce is: 'The viewer must feel the pain.' If they won't care about your solution." -> "The secret sauce is: 'The viewer must feel the pain.' If they don't, they won't care about your solution." (Restore the dropped IF-clause subject.)
   - Subject-less sentence-start: "Getting better at extracting the stories you're already living and using a system." -> "It's about getting better at extracting the stories you're already living and using a system." (Inject "It's about" when a gerund clause is used as a standalone sentence.)
   - Subject-verb disagreement, broken comma splices, obvious grammar bugs.
   Use the MINIMUM edit. Do not rewrite the surrounding sentence.
2. Strip meta-writing leaks. Phrases that address the writer/editor, not the viewer ("this is a great place to mention X", "remember to insert b-roll here", "[add product callout]"). Delete the leak; keep the surrounding sentences.
${introInstruction}

Hard rules:
- Preserve every bracket section label exactly. The script uses: [TITLE], [THUMBNAIL IDEA], [OUTLINE], [INTRO], [BODY], [OUTRO], [CTA], [DESCRIPTION], plus per-point labels POINT N, CONTEXT, APPLICATION, FRAMING, RE-HOOK. Do NOT add or remove any.
- Preserve all facts, numbers, names, examples, and CTAs. Polishing != fact-checking.
- Preserve voice. If the script is in first-person singular, keep it singular. If plural, keep it plural.
- Output the polished script as plain text. No JSON, no preamble.
- The output MUST be at least as long as the input minus any over-budget intro trim. Do not summarize.`

  const user = `SCRIPT TO POLISH (${wordCount} words total, [INTRO] is ${introWords} words):

${script}`

  try {
    const polished = await withContentRetry('script.longform_polish', async () => {
      const result = await generateScript({
        system,
        user,
        temperature: 0.2,
        maxTokens: budget,
        quality: 'high',
        route: 'planner.script.longform_polish',
        clientId,
        usageMeta: { input_words: wordCount, max_tokens: budget },
      })
      const cleaned = result.content.trim()
      if (!cleaned) throw new Error('Long-form polish returned empty')
      return cleaned
    })

    const originalLen = script.length
    const polishedLen = polished.length
    if (polishedLen < originalLen * 0.85) {
      console.warn(
        `[scriptValidation] long-form polish shorter than input (${polishedLen}/${originalLen} chars = ${Math.round(
          (polishedLen / originalLen) * 100,
        )}%). Likely truncated. Keeping original.`,
      )
      return null
    }
    return polished
  } catch (err) {
    console.warn('[scriptValidation] long-form polish failed, keeping original:', err)
    return null
  }
}

// =============================================================================
// 4. AUTO-TIGHTENER
// =============================================================================

/** Compress a script down to a target word count. Uses Flash (cheap) - the
 *  task is mechanical (cut filler, drop a body beat) and doesn't benefit
 *  from Pro. Returns null on failure so caller can keep the original. */
export async function autoTightenScript(opts: {
  script: string
  targetMaxWords: number
  clientId?: string
}): Promise<string | null> {
  const { script, targetMaxWords, clientId } = opts

  const system = `You are a copy editor. The script you receive is over its word budget. Compress it to AT MOST ${targetMaxWords} words by:
1. Cutting filler phrases ("genuinely", "actually", "totally", redundant adjectives).
2. Tightening sentences to their essential clause.
3. If still over budget, drop ONE body beat (the weakest mini-beat in [BODY]).
4. NEVER drop [TITLE], [HOOK], [REHOOK 1], [CTA], [REHOOK 2], [CLOSE], or [RELOOP] - those structural beats stay.
5. NEVER add new content. Only cut.
6. Preserve every bracket section label exactly.

Output the trimmed script as plain text. No JSON, no preamble.`

  const user = `SCRIPT TO COMPRESS (target: max ${targetMaxWords} words):

${script}`

  try {
    return await withContentRetry('script.auto_tighten', async () => {
      const result = await generateScript({
        system,
        user,
        temperature: 0.3,
        maxTokens: 2000,
        quality: 'standard',
        route: 'planner.script.auto_tighten',
        clientId,
        usageMeta: { target_max_words: targetMaxWords },
      })
      const cleaned = result.content.trim()
      if (!cleaned) throw new Error('Tighten returned empty')
      return cleaned
    })
  } catch (err) {
    console.warn('[scriptValidation] auto-tighten failed, keeping original:', err)
    return null
  }
}
