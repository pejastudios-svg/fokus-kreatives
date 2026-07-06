// Final grammar / spelling polish pass. Runs as the LAST step in the
// generation pipeline (after sanitize, before save) for every stream.
//
// This is intentionally a SURGICAL pass on Flash-Lite (cheapest tier).
// Pro polish (long-form only) catches structural issues; this pass
// catches the residual class of small grammar / spelling bugs that
// regex repairs don't reach reliably:
//
//   - missed contractions ("I taking" -> "I'm taking" when not in our
//     narrow gerund whitelist)
//   - subject-verb disagreement ("These is rhythms")
//   - obvious typos / misspellings
//   - comma splices regex doesn't match
//   - dropped articles ("post will flop guaranteed" -> "post will flop,
//     guaranteed")
//
// HARDEST RULE: this pass MUST NOT rewrite, restructure, summarize, or
// shorten the script. It only fixes grammar / spelling errors. Length
// sanity check rejects any rewrite under 95% of the original length -
// at the grammar-fix level, the input and output should be near-
// identical character counts.

import { generateScript } from './provider'
import { withContentRetry } from './contentRetry'

export async function grammarPolishScript(opts: {
  script: string
  clientId?: string
  /** For ai_usage_log routing - distinguishes long-form vs short-form etc. */
  streamLabel: string
}): Promise<string | null> {
  const { script, clientId, streamLabel } = opts

  // Skip on tiny inputs - if the script is under 200 chars something
  // upstream broke; sending it through a polish pass risks the polish
  // becoming a rewrite. Caller keeps the original.
  if (script.trim().length < 200) return null

  const wordCount = script.split(/\s+/).filter(Boolean).length
  // Flash-Lite cheap, so we can size generously. 1.5 tokens per word + 500
  // headroom gives plenty of room without over-paying.
  const budget = Math.min(8000, Math.max(2500, Math.ceil(wordCount * 1.5) + 500))

  const system = `You are a copy editor running a final grammar / spelling pass on a script. Your ONLY job is to fix obvious grammar mistakes, spelling errors, and missing contractions. You DO NOT rewrite. You DO NOT restructure. You DO NOT summarize. You DO NOT shorten.

ALLOWED EDITS (use the minimum change):
- Missing auxiliary BE: "I taking" -> "I'm taking"; "You documenting" -> "You're documenting"; "We building" -> "We're building".
- Subject-verb disagreement: "These is rhythms" -> "These are rhythms"; "this rules helps" -> "these rules help".
- Obvious typos / misspellings: "recieve" -> "receive"; "definately" -> "definitely".
- Missing or wrong articles: "I built system" -> "I built a system"; "the result was a positive" -> "the result was positive".
- Comma splices that are clearly two independent clauses: "I tried Facebook ads, I spent $500" -> "I tried Facebook ads. I spent $500." (only when the second clause has its own subject + verb and would obviously be a separate sentence).
- Punctuation drops: "post will flop guaranteed" -> "post will flop, guaranteed".
- Label-colon fragments in prose: a short noun-phrase label + colon + payoff reads as an AI tell and must become a full sentence with the SAME words. "The real issue: your content has no anchor" -> "The real issue is that your content has no anchor". "The fix: Build a system" -> "The fix is to build a system". "My mistake: Using ChatGPT for scripts" -> "My mistake was using ChatGPT for scripts". ONLY rewrite the label into a verb phrase - do not touch the payoff wording. Do NOT apply this to: bracket section labels ([HOOK], [SCENES]...), "Scene N (X-Y sec):" / "Slide N:" prefixes, numbered list items, colons that introduce a list of items, or colons that introduce a quote.
- Capitalization within bracket section headers if the brand template requires all-caps (e.g. "WHO this IS FOR" -> "WHO THIS IS FOR" inside "📌 WHO THIS IS FOR:").

FORBIDDEN:
- Do NOT change word choice for stylistic reasons. "kind of" stays "kind of". "stuff" stays "stuff". "bullshit" stays "bullshit". The voice is the writer's, not yours.
- Do NOT cut sentences. Do NOT merge sentences. Do NOT add new sentences.
- Do NOT change meaning. If a sentence is grammatically fine but factually weird, leave it.
- Do NOT remove profanity, slang, or contractions that are already correct.
- Do NOT rewrite a sentence in clearer prose. Surgical edits only.
- Preserve every bracket section label exactly: [TITLE], [THUMBNAIL IDEA], [OUTLINE], [INTRO], [BODY], [OUTRO], [CTA], [DESCRIPTION], [HOOK], [REHOOK 1], [REHOOK 2], [CLOSE], [RELOOP], [CAPTION], [HASHTAGS], [ANGLE], [PACING], [LENGTH], [SCENES], [SLIDES], plus per-point labels POINT N, CONTEXT, APPLICATION, FRAMING, RE-HOOK.
- Preserve every emoji, every separator (===, ===========================), every URL exactly.

OUTPUT FORMAT:
- Plain text only. No JSON. No preamble. No "Here's the polished version:". The output is the full script with grammar fixes applied.
- The output MUST be approximately the same length as the input (within 5%). If you find yourself rewriting, stop and just return the input as-is.`

  const user = `SCRIPT TO POLISH (${wordCount} words, ${script.length} chars):

${script}`

  try {
    const polished = await withContentRetry('script.grammar_polish', async () => {
      const result = await generateScript({
        system,
        user,
        temperature: 0.1,
        maxTokens: budget,
        // Flash-Lite is cheapest and right for mechanical edits. Pro
        // would over-think and risk stylistic rewrites the user has
        // explicitly forbidden.
        quality: 'cheap',
        route: `planner.script.grammar_polish.${streamLabel}`,
        clientId,
        usageMeta: { stream: streamLabel, input_words: wordCount, max_tokens: budget },
      })
      const cleaned = result.content.trim()
      if (!cleaned) throw new Error('Grammar polish returned empty')
      return cleaned
    })

    // Length sanity check: at the grammar-fix level we expect <2% length
    // change. Reject if the output drifts more than 5% in EITHER
    // direction. <95% = likely truncated or summarized. >110% = the
    // model expanded / rewrote / inserted new content. Either case we
    // keep the original.
    const originalLen = script.length
    const polishedLen = polished.length
    const ratio = polishedLen / originalLen
    if (ratio < 0.95) {
      console.warn(
        `[grammarPolish] output shorter than input (${polishedLen}/${originalLen} chars = ${Math.round(
          ratio * 100,
        )}%). Likely truncated. Keeping original.`,
      )
      return null
    }
    if (ratio > 1.10) {
      console.warn(
        `[grammarPolish] output longer than input (${polishedLen}/${originalLen} chars = ${Math.round(
          ratio * 100,
        )}%). Model likely rewrote / expanded. Keeping original.`,
      )
      return null
    }

    return polished
  } catch (err) {
    console.warn('[grammarPolish] failed, keeping original:', err)
    return null
  }
}
