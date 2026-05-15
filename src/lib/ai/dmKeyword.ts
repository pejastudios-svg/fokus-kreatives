// Shared CTA-keyword enforcement (DM for stories, comment for feed posts).
//
// Different surfaces have different conversion mechanisms on Instagram:
//   - Stories → "DM me [keyword]" (DMs are how stories convert)
//   - Feed posts (scripts: short-form, reels, carousels, long-form) → "comment [keyword]"
//     (comments are how feed posts trigger the brand's auto-DM tools)
//
// The helpers below take a `platform: 'dm' | 'comment'` parameter so the
// prompt block + post-process regex match the right shape. Stories pass
// 'dm', scripts pass 'comment'. The brand's locked keyword (e.g. "CONTENT")
// is the same across both.
//
// The post-process is a safety net for when the AI ignores prompt rules
// (it does ~50% of the time on Flash).

export type CtaPlatform = 'dm' | 'comment'

// Patterns that match the "[verb] [me/us]? [keyword]" portion of a CTA.
// Group 1 = lead phrase incl. spacing; group 2 = optional quote; group 3 = keyword.
const PATTERN_DM = /\b((?:DM|Reply)(?:\s+(?:me|us|with))?\s+)(['"`]?)([A-Z][A-Z0-9_]{2,})\2/g
const PATTERN_COMMENT = /\b((?:Comment|Type|Drop|Reply\s+with)\s+(?:the\s+word\s+)?)(['"`]?)([A-Z][A-Z0-9_]{2,})\2/g

function patternFor(platform: CtaPlatform): RegExp {
  return platform === 'dm' ? PATTERN_DM : PATTERN_COMMENT
}

/**
 * Rewrites any CTA keyword in `text` to the brand's allowed keyword for the
 * given platform. Stories use 'dm', scripts use 'comment'. When `allowed`
 * has multiple entries, the FIRST is used as canonical replacement.
 */
export function enforceCtaKeyword(
  text: string,
  allowed: string[],
  platform: CtaPlatform,
): { text: string; rewrites: string[] } {
  if (!text || allowed.length === 0) return { text, rewrites: [] }
  const allowedSet = new Set(allowed.map((k) => k.toUpperCase()))
  const replacement = allowed[0].toUpperCase()
  const rewrites: string[] = []
  const next = text.replace(patternFor(platform), (match, lead: string, quote: string, kw: string) => {
    if (allowedSet.has(kw)) return match
    rewrites.push(`${kw} -> ${replacement}`)
    return `${lead}${quote}${replacement}${quote}`
  })
  return { text: next, rewrites }
}

/** Backward-compat alias - existing story code calls this name. Stories
 *  always use the 'dm' platform, so we hardcode it here. */
export function enforceDmKeywordInText(
  text: string,
  allowed: string[],
): { text: string; rewrites: string[] } {
  return enforceCtaKeyword(text, allowed, 'dm')
}

/** Build the CTA keyword rule block for injection into a generation prompt.
 *  Returns an empty string when no keyword is set (AI picks contextually). */
export function buildCtaKeywordPromptBlock(
  allowed: string[],
  platform: CtaPlatform,
): string {
  if (allowed.length === 0) return ''
  const verb = platform === 'dm' ? 'DM me' : 'comment'
  const example = platform === 'dm' ? `DM me ${allowed[0]}` : `comment ${allowed[0]}`
  if (allowed.length === 1) {
    const kw = allowed[0]
    return `CTA KEYWORD IS LOCKED. This is a ${platform === 'dm' ? 'STORY' : 'FEED POST'}, so the CTA uses "${verb} [keyword]" form. The ONLY valid keyword for this brand is "${kw}". Use it verbatim in uppercase: "${example} for [thing]". Do NOT substitute SYSTEM, FRAMEWORK, SCRIPT, PLAN, PLAYBOOK, or any other word. The post-processor WILL rewrite any other keyword to "${kw}", so just use it.`
  }
  const list = allowed.map((k) => `"${k}"`).join(' or ')
  return `CTA KEYWORD IS LOCKED to one of: ${list}. This is a ${platform === 'dm' ? 'STORY' : 'FEED POST'}, so use "${verb} [keyword]" form. Pick whichever keyword fits the CTA best, in uppercase. Do NOT invent or substitute any other keyword.`
}

/** Backward-compat alias for stories which always use 'dm' platform. */
export function buildDmKeywordPromptBlock(allowed: string[]): string {
  return buildCtaKeywordPromptBlock(allowed, 'dm')
}
