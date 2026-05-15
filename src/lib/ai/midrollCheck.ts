// Long-form mid-roll CTA presence check + targeted retry.
//
// Despite repeated prompt-engineering pressure, Pro occasionally still
// omits the mandatory mid-roll CTA between POINT 2 and POINT 3 of the
// BODY. When that happens we don't want to regenerate the whole script
// (expensive, and the rest of the script is usually fine) - we want a
// surgical insertion call that adds the CTA in the right place and
// returns the FULL script with everything else preserved.

import { generateScript } from './provider'
import { withContentRetry } from './contentRetry'

/**
 * Look at the [BODY] section of a long-form script and verify the mid-
 * roll CTA TEXT (or a close paraphrase) appears between POINT 2 and
 * POINT 3. Returns true when present, false otherwise. False is also
 * returned when the script is malformed (no [BODY], no POINT 2/3, points
 * out of order) - the retry call should rebuild whichever piece is missing.
 */
export function verifyMidrollCtaPresent(script: string, ctaText: string): boolean {
  const bodyMatch = script.match(/\[BODY\]([\s\S]*?)(?=\n\[OUTRO\]|\n\[CTA\]|\n\[DESCRIPTION\]|$)/i)
  if (!bodyMatch) return false
  const body = bodyMatch[1]

  const point2 = body.search(/\bPOINT\s*2\s*:/i)
  const point3 = body.search(/\bPOINT\s*3\s*:/i)
  if (point2 < 0 || point3 < 0 || point3 <= point2) return false

  const between = body.slice(point2, point3)

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const normBetween = normalize(between)
  const normCta = normalize(ctaText)

  if (normBetween.includes(normCta)) return true

  // Accept close paraphrase via key phrases. The hardcoded fallback CTA
  // and most brand defaults share these tokens.
  const keyPhrases = [
    'click the link in the description',
    'link in the description',
    'in the description below',
  ]
  for (const phrase of keyPhrases) {
    if (normBetween.includes(phrase)) return true
  }
  return false
}

/**
 * Surgical Pro call that inserts the mid-roll CTA between POINT 2 and
 * POINT 3 of an existing long-form script. Returns the full rewritten
 * script on success, or null on failure / truncation. Length-sanity-
 * checked: rejected if the rewrite is shorter than 90% of original
 * (truncation guard).
 */
export async function insertMidrollCta(opts: {
  script: string
  ctaText: string
  clientId?: string
}): Promise<string | null> {
  const { script, ctaText, clientId } = opts

  const wordCount = script.split(/\s+/).filter(Boolean).length
  const estimatedTokens = Math.ceil(wordCount * 1.4)
  const budget = Math.min(8000, Math.max(4000, estimatedTokens + 1500))

  const system = `You are an editor. The long-form script below is missing its mandatory mid-roll CTA between POINT 2 and POINT 3 in the [BODY] section. Your ONLY job is to insert the CTA in the right place and return the FULL script unchanged otherwise.

INSERTION RULE:
1. Find the RE-HOOK line at the end of POINT 2.
2. After that RE-HOOK line, in the SAME paragraph (no blank line, no new bracket label), append a conversational aside containing the supplied CTA TEXT verbatim, then transition straight into POINT 3.
3. Format the inserted aside like one of these patterns: "Quick aside - [CTA TEXT verbatim]. Anyway, [transition into POINT 3 topic]..." or "...if you want this done for you, [CTA TEXT verbatim]. So now that we have that covered, [transition]..." Pick whichever fits the script's existing tone.
4. The transition phrase MUST land naturally before the "POINT 3:" header so the script continues to flow.

HARD RULES:
- Do NOT modify any other section. [TITLE], [THUMBNAIL IDEA], [OUTLINE], [INTRO], POINT 1, POINT 2 main content, POINT 3 main content, POINT 4, [OUTRO], [CTA], [DESCRIPTION] all stay byte-for-byte the same except for the inserted aside at the end of POINT 2.
- Do NOT add a new bracket label. The aside is part of the existing POINT 2 RE-HOOK paragraph.
- Do NOT write "Comment KEYWORD" or "DM me KEYWORD" anywhere - long-form is website-link CTA only.
- Output the FULL script (every section, every word) as plain text. No JSON. No preamble.`

  const user = `MID-ROLL CTA TEXT TO INSERT: ${ctaText}

=====

FULL SCRIPT (insert the CTA aside at the end of POINT 2's RE-HOOK, then return the full script):

${script}`

  try {
    const fixed = await withContentRetry('script.midroll_insert', async () => {
      const result = await generateScript({
        system,
        user,
        temperature: 0.2,
        maxTokens: budget,
        quality: 'high',
        route: 'planner.script.midroll_insert',
        clientId,
        usageMeta: { input_words: wordCount, max_tokens: budget },
      })
      const cleaned = result.content.trim()
      if (!cleaned) throw new Error('Mid-roll insert returned empty')
      return cleaned
    })

    // Length sanity check - the insert should ADD content, never shrink it.
    if (fixed.length < script.length * 0.9) {
      console.warn(
        `[midrollCheck] insert returned shorter script (${fixed.length}/${script.length} chars). Likely truncated. Keeping original.`,
      )
      return null
    }

    // Verify the insert actually landed.
    if (!verifyMidrollCtaPresent(fixed, ctaText)) {
      console.warn('[midrollCheck] retry call did not place CTA between POINT 2 and POINT 3. Keeping original.')
      return null
    }

    return fixed
  } catch (err) {
    console.warn('[midrollCheck] insert failed:', err)
    return null
  }
}
