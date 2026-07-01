import type { ContentFormat } from './types'
import { selectHookAngles, renderHookAngleBlock } from '@/lib/planner/hookBank'

// Renders a content_formats row as a system-prompt-ready text block.
// Spec: docs/content_planner_buildout.md section 9.2.
//
// CRITICAL: mad-libs are spoken-cadence references, not fill-in-the-blank
// templates. The block tells the AI to MATCH the rhythm, never to copy lines
// verbatim. See voice rules in section 6.
//
// hook_patterns + reference_scripts (added later) are the two layers that
// raise the script quality on Flash without paying Pro prices:
//   - hook_patterns: pre-defined opening templates the AI picks/adapts
//     instead of freelancing. Hook is the highest-failure-rate part of any
//     short-form, so locking it down is the highest-leverage move.
//   - reference_scripts: few-shot worked examples that anchor the AI to
//     "here's what 9/10 looks like for this format." Without these the AI
//     defaults to generic-sounding output even with good structure.
//
// STREAM-AWARENESS (added M4): the format library was authored assuming
// every format produces a spoken script. strategy_beats and mad_libs are
// shaped like "Hook -> Body -> Close" beats. That works for short-form +
// long-form, but when a format runs as an ENGAGEMENT REEL (silent text
// overlays) or CAROUSEL (10-slide deck), those beats CONFLICT with the
// framework's silent / static structure - the AI follows the format
// module's spoken-script shape and produces the wrong output.
//
// Fix: when the slot's stream is engagement_reel or carousel, drop
// strategy_beats and mad_libs from the format block. Keep name +
// description + starting_point + secret_sauce + hook_patterns +
// reference_scripts (those still help). The framework block then carries
// the structural shape unchallenged.
export type FormatPromptStream =
  | 'long_form'
  | 'short_form'
  | 'engagement_reel'
  | 'carousel'
  | 'story'

export function buildFormatPromptBlock(
  format: ContentFormat,
  stream: FormatPromptStream = 'short_form',
): string {
  // Streams whose format library beats are spoken-script shaped. For
  // these, we DROP strategy_beats and mad_libs to avoid conflicting with
  // the framework block's silent / static structure.
  //
  // EXCEPTION: caption-carry formats (List Bait) already have silent-shaped
  // beats (ON-SCREEN HOOK / DIRECTIVE + CAPTION OPEN / LIST / CLOSE) that
  // define the correct structure. Dropping them leaves only the generic
  // value-on-screen framework, which is exactly the bug - so keep them.
  const CAPTION_CARRY_SLUGS = new Set(['engagement_reel.caption_list'])
  const dropSpokenBeats =
    (stream === 'engagement_reel' || stream === 'carousel') &&
    !CAPTION_CARRY_SLUGS.has(format.slug)

  const beats = format.strategy_beats
    .map((b) => `- ${b.label} - ${b.description}`)
    .join('\n')

  const cadence = format.mad_libs
    .map((m) => {
      const lines = m.lines.map((l) => `- ${l}`).join('\n')
      return `For ${m.beat}:\n${lines}`
    })
    .join('\n\n')

  // Hook angle bank for every non-long-form asset. Seeded by format slug so
  // each format draws a consistent, bucket-appropriate angle subset; the
  // generator expands + grounds them (never verbatim). Long-form opens on its
  // own title/intro, so it's excluded.
  const angleBlock =
    stream === 'long_form'
      ? ''
      : renderHookAngleBlock(selectHookAngles({ bucket: format.bucket, seed: format.slug }))

  const hookBlock = format.hook_patterns.length
    ? [
        'HOOK PATTERNS (REQUIRED - pick or adapt one of these for the opening line. Do NOT freelance the hook. The hook is what decides whether anyone watches the rest):',
        '',
        format.hook_patterns
          .map(
            (h, i) =>
              `${i + 1}. PATTERN: ${h.pattern}\n   EXAMPLE: ${h.example}`,
          )
          .join('\n'),
        '',
      ].join('\n')
    : ''

  const refBlock = format.reference_scripts.length
    ? [
        'REFERENCE SCRIPTS (this is what 9/10 looks like for this format. Match THIS quality bar - voice, specificity, pacing, soft close. Do NOT copy lines verbatim, but absorb the cadence and the level of concrete detail):',
        '',
        format.reference_scripts
          .map(
            (r, i) =>
              `--- REFERENCE ${i + 1} (${r.label}) ---\n${r.script}\n--- END REFERENCE ${i + 1} ---`,
          )
          .join('\n\n'),
        '',
      ].join('\n')
    : ''

  const sections: string[] = [
    `FORMAT: ${format.name}`,
    `DESCRIPTION: ${format.description}`,
    '',
    `STARTING POINT (this format only works if the raw material has): ${format.starting_point}`,
    '',
  ]

  if (dropSpokenBeats) {
    sections.push(
      `NOTE FOR THIS STREAM (${stream}): The format library's strategy beats and cadence references are written for SPOKEN script formats (short-form / long-form). For ${stream}, ignore those - the framework block above defines the actual output structure (silent overlay scenes for engagement reels / 10-slide deck for carousels). Use the format's NAME, DESCRIPTION, SECRET SAUCE, and HOOK PATTERNS as creative context only.`,
      '',
    )
  } else {
    sections.push(
      'STRUCTURE (write the script in this order):',
      beats,
      '',
    )
  }

  sections.push(
    'SECRET SAUCE (the rule that makes this format land):',
    format.secret_sauce,
    '',
    hookBlock,
    angleBlock,
    refBlock,
  )

  if (!dropSpokenBeats) {
    sections.push(
      'CADENCE REFERENCES (these are RHYTHM hints, NEVER copy them verbatim. The AI tells you these patterns to MATCH, not to fill in like mad-libs):',
      '',
      cadence,
      '',
    )
  }

  sections.push(
    'GATING / SKIP CONDITION:',
    format.gating_rule,
  )

  return sections.filter((s) => s !== '').join('\n')
}
