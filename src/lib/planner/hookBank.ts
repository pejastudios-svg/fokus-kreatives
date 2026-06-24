// Shared hook-angle bank for every non-long-form asset (short-form, engagement
// reels, carousels, stories). These are ANGLES, not finished hooks: the format
// already carries tuned hook_patterns; this bank widens the angle pool so the
// brand doesn't open every post the same way.
//
// CRITICAL: these are used verbatim NOWHERE. The generator is told to pick an
// angle, fill it with the client's niche, then expand it into a brand-voice
// hook grounded in the specific raw-material answer. Used literally, these are
// the exact template tells we avoid. A rotating subset is surfaced per call
// (seeded) so the same angles don't repeat across a plan.

export type HookCategory =
  | 'curiosity'
  | 'listicle'
  | 'contrarian'
  | 'personal'
  | 'educational'
  | 'mistake'
  | 'proof'

export const HOOK_ANGLES: Record<HookCategory, string[]> = {
  curiosity: [
    'The one thing nobody tells you about [topic]',
    'What I wish I knew before [doing thing] in [niche]',
    'Nobody talks about this part of [niche]',
    "What I'd do differently if I started [thing] today",
    "The part of [niche] everyone gets wrong",
  ],
  listicle: [
    '[N] [things/signs/mistakes] in [niche]',
    '[N] rules of [outcome] in [niche]',
    '[N] facts people neglect about [topic]',
    '[N] things to stop doing in [niche]',
    '[N] tools/ways to [outcome] in [niche]',
  ],
  contrarian: [
    '[Common belief] in [niche] is wrong',
    'Stop doing [common practice] in [niche]',
    '[Popular thing] is overrated',
    'Why [common advice] actually hurts you in [niche]',
    "Working hard at [thing] is a mistake if [condition]",
  ],
  personal: [
    'How I [result] in [niche]',
    'The mistake that cost me [thing] in [niche]',
    'Why I started [thing]',
    'My worst [experience] in [niche] and what it taught me',
    "What [number] years in [niche] actually taught me",
  ],
  educational: [
    'How to [outcome] in [niche], step by step',
    'The fastest way to [outcome] in [niche]',
    '[Outcome] in [niche], explained simply',
    'Where to actually start with [thing] in [niche]',
    'The simplest way to [outcome] without [common cost]',
  ],
  mistake: [
    '[N] mistakes everyone makes when starting [niche]',
    'Avoid these mistakes in [niche]',
    'Stop [common mistake] before it costs you',
    'Read this before you [action] in [niche]',
    "The mistake keeping you stuck in [niche]",
  ],
  proof: [
    'Before and after [change] in [niche]',
    'How [result] actually happened',
    'What [result] in [niche] really took',
    'The one lever that changed [outcome] in [niche]',
  ],
}

// Which angle categories suit each coverage bucket. The first categories are
// weighted heavier (surfaced first).
const BUCKET_CATEGORIES: Record<string, HookCategory[]> = {
  storytelling: ['personal', 'curiosity', 'proof', 'mistake'],
  educational: ['educational', 'listicle', 'mistake', 'curiosity'],
  opinion: ['contrarian', 'curiosity', 'listicle'],
  proof_community: ['proof', 'personal', 'educational'],
}

// Small deterministic string hash so the same seed always surfaces the same
// rotation (no Math.random - keeps generations reproducible).
function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/**
 * Pick a rotating subset of hook angles for one slot. Weighted to the format's
 * bucket; the `seed` (e.g. the anchor answer / topic id) rotates which angles
 * surface so sibling pieces don't all draw the same one.
 */
export function selectHookAngles(opts: {
  bucket: string
  seed: string
  count?: number
}): string[] {
  const count = opts.count ?? 4
  const cats = BUCKET_CATEGORIES[opts.bucket] ?? BUCKET_CATEGORIES.educational
  const offset = hashSeed(opts.seed)
  const out: string[] = []
  // Round-robin across the bucket's categories, rotating the start index per
  // category by the seed so the pool shifts between slots.
  let i = 0
  while (out.length < count && i < count * cats.length) {
    const cat = cats[i % cats.length]
    const pool = HOOK_ANGLES[cat]
    const pick = pool[(offset + Math.floor(i / cats.length)) % pool.length]
    if (!out.includes(pick)) out.push(pick)
    i++
  }
  return out
}

/** Render the angle block injected into a hook prompt. Frames the angles as
 *  inspiration to expand + ground, never to copy. */
export function renderHookAngleBlock(angles: string[]): string {
  if (angles.length === 0) return ''
  return [
    'HOOK ANGLE BANK (inspiration only - pick at most one as a starting angle):',
    ...angles.map((a) => `- ${a}`),
    'RULES: never use these verbatim. Replace the brackets with this brand\'s niche, then EXPAND the angle into a full hook grounded in the specific raw-material answer below. If a tuned hook pattern fits better, use that instead. The angle is a direction, not the line.',
  ].join('\n')
}
