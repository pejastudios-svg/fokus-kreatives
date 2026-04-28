/**
 * Client-safe external prompt assembler.
 *
 * Series and Double-Down pillars do NOT generate scripts in-app. Instead we
 * assemble a single, self-contained prompt the user can copy and paste into
 * an external AI (ChatGPT, Claude, Gemini, etc). All the framework, voice
 * rules, hard bans, and client context are baked into the prompt so the
 * external AI matches our internal output as closely as possible.
 *
 * No server imports here - this runs entirely in the browser.
 */

import {
  FRAMEWORK_CORE,
  LONGFORM_FRAMEWORK,
  PILLAR_FRAMEWORK,
} from './framework'
import type { BrandProfile } from '@/components/clients/brandProfile'

export type ExternalFormat = 'longform' | 'short' | 'carousel' | 'story' | 'engagement'
export type ExternalPillar = 'series' | 'doubledown'
export type SeriesLabel = 'Day' | 'Part' | 'Episode' | 'Chapter' | 'Lesson'

export interface SeriesAnswerForPrompt {
  entry_index: number
  question: string
  answer: string
  beat_type?: string
  anchor_field?: string
  anchor_value?: string
}

export interface BuildExternalPromptInput {
  clientProfile: BrandProfile
  clientName?: string
  businessName?: string
  industry?: string | null
  format: ExternalFormat
  pillar: ExternalPillar
  ctaText?: string | null
  ideaInput?: string | null
  // series-only
  seriesLabel?: SeriesLabel
  seriesLength?: number
  seriesTopics?: string[]
  /** When the operator has a submitted series form, pass the answers here.
   *  This switches the prompt into "from interview" mode - the AI builds each
   *  entry from the client's actual words instead of inferring from profile. */
  seriesAnswers?: SeriesAnswerForPrompt[]
  seriesTitle?: string | null
  brandLine?: string | null
  framing?: string | null
  // doubledown-only
  referenceScript?: string | null
}

const SHORT_FORMAT_STRUCTURE = `SHORT-FORM STRUCTURE (TikTok / Reels / Shorts, 45-60 seconds, ~120-180 words spoken).

OUTPUT SECTIONS in this exact order, using these exact bracket labels:

[TITLE]
One line. Curiosity loop pulled from the braindump.

[HOOK]
The first 3-5 seconds. 2-3 lines max. First 3 words must pattern-interrupt and click-confirm the title. Tension created MUST be resolved later in the script - never tease something the body doesn't pay off.

[BODY]
2-3 tight beats, written as flowing spoken prose. Each beat does what a long-form POINT does in compressed form: name the mechanic, give one concrete application from the braindump, point at why it matters. No labels inside the body, no CONTEXT/APPLICATION/FRAMING tags. Pure spoken script.

[CTA]
One line. If a CTA was supplied, echo it verbatim. Otherwise write: "(none - native close in body)"`

const CAROUSEL_FORMAT_STRUCTURE = `CAROUSEL STRUCTURE (Instagram / LinkedIn carousel, 10 slides).

HARD RULES:
- EXACTLY 10 slides. Not 6. Not 8. Ten.
- No slide over 18 words. Each slide advances the idea; no slide restates the previous one.
- The carousel teaches ONE specific beat as a standalone mini-lesson, not a trailer.

SLIDE ARC:
- Slide 1: Hook stating the problem or payoff of THIS specific beat.
- Slide 2: The common mistake or default approach.
- Slide 3: One-line reframe (the insight).
- Slides 4-8: Teaching body - one concept per slide, with concrete micro-applications.
- Slide 9: "Save this" summary line - the mechanic distilled to one screenshottable line.
- Slide 10: CTA slide (use supplied CTA verbatim if given; otherwise a soft directional line).

OUTPUT SECTIONS:
[TITLE]
[ANGLE]  - one line: the specific beat this carousel teaches
Slide 1: ...
Slide 2: ...
... (through Slide 10)
[CAPTION] - 90-160 words, 3 bullets, ends with a question. Caption TEACHES the takeaway, does not describe the carousel.
[HASHTAGS] - 12-18 unique tags`

const ENGAGEMENT_FORMAT_STRUCTURE = `ENGAGEMENT REEL STRUCTURE (silent, text-on-screen only).

THIS IS A SILENT, TEXT-ONLY FORMAT.
- NO voiceover. NO narration. NO spoken script.
- NEVER include "Voiceover:", "Narration:", "Say this:", or any (spoken) annotation.
- Every word in the output is on-screen overlay text the viewer reads while watching the visual.

HARD RULES:
- 1-4 scenes. Most reels are 2-3 scenes. Each scene moves the idea forward.
- Each on-screen overlay is screen-readable: 5-14 words per line. No paragraphs.
- Final scene closes a loop, poses a question, or leaves a one-line takeaway (use supplied CTA verbatim if given).

OUTPUT SECTIONS:
[TITLE]
[ANGLE]  - one line: the specific beat this reel teaches
[WHY THIS WORKS]  - 1-2 sentences on the psychology
[LENGTH]  - approx seconds
[PACING]  - slow-build | fast-cut | reflective | punchy
[SCENES]  - 1-4 scenes
  Scene 1 (0-X sec): On-screen text only. Overlay line(s).
  Scene 2 (X-Y sec): ...
[CAPTION] - 60-120 words, TEACHES the takeaway, ends with a question
[HASHTAGS] - 8-14 tags`

const STORY_FORMAT_STRUCTURE = `STORY STRUCTURE (Instagram Stories, 1-4 slides, overlay text only).

HARD RULES:
- 1-4 slides. Most stories are 2-3 slides.
- Short overlay text only, one idea per slide.
- Slide 1 = a sharp opener (a question, a sharp line, a curious framing).
- Middle slide(s) = the one takeaway in the creator's voice.
- Final slide = poll, question, or soft CTA (no hard sell).
- Stories don't have captions. Include sticker text if you use a poll/question.

OUTPUT SECTIONS:
[TITLE]
[ANGLE]  - one line: the specific moment this story repurposes
[SLIDES]  - 1-4 slides
  Slide 1 (HOOK): overlay text
  Slide 2 (VALUE): overlay text
  Slide 3 (CTA/POLL): overlay text  - (type: poll | question | swipe-up | DM keyword)
[OPTIONAL STICKER]  - poll options / question prompt, if any`

const FORMAT_STRUCTURE: Record<ExternalFormat, string> = {
  longform: LONGFORM_FRAMEWORK,
  short: SHORT_FORMAT_STRUCTURE,
  carousel: CAROUSEL_FORMAT_STRUCTURE,
  engagement: ENGAGEMENT_FORMAT_STRUCTURE,
  story: STORY_FORMAT_STRUCTURE,
}

const FORMAT_LABEL: Record<ExternalFormat, string> = {
  longform: 'Long-form Script (10-15 min YouTube)',
  short: 'Short-form Script (45-60 sec)',
  carousel: 'Carousel (10 slides)',
  engagement: 'Engagement Reel (silent, text-only)',
  story: 'Story Sequence (1-4 IG Stories)',
}

const CRITICAL_BANS_TOP = `CRITICAL HARD RULES - obey on EVERY line, EVERY entry, EVERY beat. These five are the most-violated rules. Do not violate them, even once.

1. NO em-dashes (—) or en-dashes (–). If you need a pause, use a comma or a period.

2. NO "it's not X, it's Y" / "this isn't X, it's Y" / "that's not X, it's Y" pivot in any form (semicolon variants and period variants too). State the positive claim directly. "X is Y." Not "It's not A, it's Y."

3. NO fabricated proof. NEVER write "I had a client who...", "I've watched business owners...", "we gave her...", invented stats, invented results, invented testimonials. If the CLIENT PROFILE below has no proof to cite, OMIT the proof beat. Shorter is fine. Empty is fine. Invented is not fine.

4. NO generic creator-coach advice. Every body line must anchor to a SPECIFIC item from the CLIENT PROFILE - a named pain point, a named fear, an evergreen topic, a hot take, the signature offer, the differentiation, the audience's exact role, the common enemy. If you cannot anchor a line to a profile item, CUT THE LINE. Do not pad. Do not write filler. Do not let the entry default to "plan your content / pick your buckets / write your hook" boilerplate that could appear on any random account.

5. NO forced metaphors that say nothing literal ("panic attack with a ring light", "the hook isn't the seasoning, it's the meal", "wing it kills your follower count"). State the literal observation in plain language.

If you find yourself unable to write an entry without violating one of these, write a SHORTER entry, or fewer entries, or stop and tell me the client profile does not support what was asked. Quality and specificity beat volume. Always.`

const FAILURE_EXAMPLES = `FAILURE EXAMPLES - the model has produced these exact patterns before on this prompt. Do not repeat them.

✗ WRONG: "The hook isn't the seasoning. It's the meal."
WHY: Banned "X isn't Y, it's Z" pivot.
✓ RIGHT: "The hook is the meal."

✗ WRONG: "I had a client who was ready to quit posting. We gave her four buckets and she filmed thirty videos in two afternoons."
WHY: Fabricated client / testimonial. The CLIENT PROFILE contained no such case study.
✓ RIGHT: Cut the line entirely. If proof is needed, draw it ONLY from the CLIENT PROFILE. If the profile has none, skip the proof beat.

✗ WRONG: "Stop reinventing the wheel every Monday. Build the buckets once and let them feed you for a year."
WHY: Generic creator-coach advice. No anchor to this specific client.
✓ RIGHT: Anchor to a named profile item, e.g. reference the client's actual evergreen topics or signature offer by name. If no anchor, cut the line.

✗ WRONG: "That's not a strategy, that's a panic attack with a ring light."
WHY: Forced metaphor. Adds nothing literal. Reads as "AI being clever".
✓ RIGHT: State the literal point. "That's not a strategy. You're filming whatever you remember while the camera's on."

✗ WRONG: "Plan the month, then film the month."
WHY: Generic creator advice. Could close any random account's video.
✓ RIGHT: A close that names something specific to this client - their offer, their audience's exact pain point, their hot take.

✗ WRONG: "Wing it kills your follower count."
WHY: Cringe one-liner. Sounds like AI trying to sound punchy.
✓ RIGHT: Drop the punchline. State the consequence in plain language.`

const FINAL_CHECK = `FINAL CHECK BEFORE YOU WRITE EACH ENTRY (run this checklist mentally on every line):

□ Did I use an em-dash or en-dash anywhere? → replace with comma/period.
□ Did I use "it's not X, it's Y" / "this isn't X, it's Y" / period or semicolon variants? → rewrite as a positive claim.
□ Did I write any line that begins "I had a client", "I've watched", "we gave her", "she filmed thirty videos", or any variant naming a fabricated person/result? → cut the line. Proof is OPTIONAL.
□ Does every body line anchor to a SPECIFIC item from the CLIENT PROFILE (named pain point, fear, evergreen topic, hot take, signature offer, differentiation, audience role)? → cut every line that doesn't.
□ Is any sentence the kind of generic creator-coach advice ("plan the month", "build buckets", "stop reinventing the wheel", "the hook is everything") that could appear on any random account? → cut it.
□ Did I write a forced metaphor that doesn't literally describe anything? → drop the metaphor, state the literal observation.
□ Is the entry shorter as a result? → Good. Short and specific beats long and generic. Always.

Only after you have passed this checklist do you finalize the entry.`

const VOICE_RULES = `VOICE & HARD BANS (apply to every output, every time):

CONTRACTIONS: Always use contractions when speaking naturally would (it's, don't, that's, you're, we're, I'm, won't, can't, didn't, here's, there's, what's, that'll, you'll). Uncontracted forms read like a robot.

PUNCTUATION:
- NEVER use em-dashes (—) or en-dashes (–) anywhere. If you need a pause, use a comma or period.
- NEVER use the "this isn't X, it's Y" construction in any form ("this isn't just X, it's Y", "that's not X, it's Y", "it's not X, it's Y", semicolon or period variants). State the positive claim directly.
- NEVER stack two adjectives separated by a comma in praise/diagnosis ("consistent, engaging" → "consistent"). Pick one.

BANNED PHRASES (never appear, even as transitions):
"the result?", "the kicker?", "honestly?", "look,", "here's the thing", "plot twist?", "the truth is", "let me explain", "let that sink in", "here's the deal", "the reality is", "spoiler alert", "the fact is", "to be honest", "in essence", "ultimately", "fundamentally", "in conclusion", "moving forward", "at the end of the day", "needless to say", "so basically", "in other words"

BANNED CONSTRUCTIONS:
- Declarative statements with a question mark on the end ("Want more weird tricks." not "Want more weird tricks?" - unless it's an actual question to the viewer like "Ever felt that?").
- Empty quotes around emphasized phrases. If you mean it, just say it.
- "I'm excited to see", "I'm sure you want to know", "let me know what you think", or any feedback-bait closer.

VARY SENTENCE LENGTH:
Mix 4-word lines with 18-word lines. Boring rhythm = boring video. A staccato single-word line is fine. Two long sentences in a row is fine. Three long sentences in a row is robotic.

NO META-WRITING VOCABULARY in the spoken script:
"click-confirm", "pattern interrupt", "hook stack", "scroll-stop", "curiosity loop", "re-hook" are notes for the writer, not lines for the audience. Do not have the speaker say these words. Named creator-frameworks the braindump teaches (e.g. "2-1-3-4 method", "fortune cookie outro", "value loop") ARE allowed because they are the taught concepts.

TAG-AS-HEADER (non-negotiable):
Bracket tags ([TITLE], [INTRO], [BODY], [CTA], etc.) are headers, not punctuation. NEVER append a tag to the end of a paragraph (e.g. "...understood. [CTA]"). Each tag appears EXACTLY ONCE in the output. CONTEXT:, APPLICATION:, FRAMING:, RE-HOOK:, POINT N: each sit on their own line with a blank line before them.`

const HUMAN_VOICE_EXAMPLE = `HUMAN-VOICE EXAMPLE (read this once before writing - this is the tone target):

"Most people pick a topic, sit down, and try to write the whole script in one go. That's why their hooks are weak. Here's what changed it for me. I started writing the outline FIRST. Just bullet points. What I'm teaching, why it matters, how it lands. Then I wrote the intro. Then the body, in 2-1-3-4 order. Five minutes of outlining saved me an hour of rewrites. Try it on your next video and you'll feel the difference in the first 30 seconds."

Notice: contractions throughout. Short and long sentences mixed. Concrete instruction. No em-dashes. No "the result?". No "this isn't X, it's Y". No empty quotes. The framework name ("2-1-3-4") appears verbatim because it's the taught concept.`

function bp(label: string, value: unknown): string | null {
  const v = typeof value === 'string' ? value.trim() : value
  if (!v) return null
  if (Array.isArray(v) && v.every((x) => !x)) return null
  return `${label}: ${Array.isArray(v) ? v.filter(Boolean).join(' | ') : String(v)}`
}

function brandProfileSummary(
  p: BrandProfile,
  meta: { clientName?: string; businessName?: string; industry?: string | null },
): string {
  const lines: (string | null)[] = []

  if (meta.clientName || meta.businessName) {
    lines.push(`CLIENT: ${[meta.clientName, meta.businessName].filter(Boolean).join(' / ')}`)
  }
  if (meta.industry) lines.push(`INDUSTRY: ${meta.industry}`)

  lines.push('')
  lines.push('--- BUSINESS ---')
  lines.push(bp('Mission', p.business.mission))
  lines.push(bp('Vision', p.business.vision))
  lines.push(bp('Problem solved', p.business.problem_solved))
  lines.push(bp('Differentiation', p.business.differentiation))
  lines.push(bp('Signature offer', p.business.signature_offer))

  lines.push('')
  lines.push('--- AUDIENCE ---')
  lines.push(bp('Roles', p.audience.work_roles))
  lines.push(bp('Age range', p.audience.age_range))
  lines.push(bp('Location', p.audience.location))
  lines.push(bp('Family situation', p.audience.family_situation))
  lines.push(bp('Core values', p.audience.core_values))
  lines.push(bp('Fears', p.audience.fears))
  lines.push(bp('Desires', p.audience.desires))
  lines.push(bp('Hangouts', p.audience.hangouts))
  lines.push(bp('Pain points', p.audience.pain_points))
  lines.push(bp('What they tried and failed', p.audience.tried_failed))
  lines.push(bp('Objections', p.audience.objections))
  lines.push(bp('Yes triggers', p.audience.yes_triggers))

  lines.push('')
  lines.push('--- VOICE ---')
  lines.push(bp('Traits', p.voice.traits))
  lines.push(`Casualness: ${p.voice.casualness}/5  Funny: ${p.voice.funny}/5  Enthusiastic: ${p.voice.enthusiastic}/5  Emotional: ${p.voice.emotional}/5  Irreverent: ${p.voice.irreverent}/5`)
  lines.push(bp('Uses jargon', p.voice.uses_jargon))
  lines.push(bp('Shares personal stories', p.voice.shares_personal_stories))
  lines.push(bp('Profanity level', p.voice.profanity_level))
  lines.push(bp('Address audience as', p.voice.address_audience_as))
  lines.push(bp('Signature phrases', p.voice.signature_phrases))
  lines.push(bp('Forbidden words', p.voice.forbidden_words))
  lines.push(bp('Banned phrases (additional)', p.voice.banned_phrases))
  lines.push(bp('Common enemy', p.voice.common_enemy))

  lines.push('')
  lines.push('--- CONTENT STRATEGY ---')
  lines.push(bp('Primary content goal', p.content_strategy.primary_content_goal))
  lines.push(bp('Desired action', p.content_strategy.desired_action))
  lines.push(bp('Evergreen topics', p.content_strategy.evergreen_topics))
  lines.push(bp('Hot takes', p.content_strategy.hot_takes))
  const myths = p.content_strategy.myths
    .map((m) => (m.myth || m.truth) ? `  - Myth: ${m.myth} | Truth: ${m.truth}` : null)
    .filter(Boolean)
  if (myths.length) lines.push(`Myths to bust:\n${myths.join('\n')}`)
  const must = Object.entries(p.content_strategy.must_include)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ')
  if (must) lines.push(`Must include: ${must}`)
  const never = Object.entries(p.content_strategy.never_do)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ')
  if (never) lines.push(`Never do: ${never}`)
  lines.push(bp('Off-limits topics', p.content_strategy.off_limits_topics))

  if (p.legal.disclaimers || p.legal.compliance_requirements) {
    lines.push('')
    lines.push('--- LEGAL ---')
    lines.push(bp('Disclaimers', p.legal.disclaimers))
    lines.push(bp('Compliance', p.legal.compliance_requirements))
  }

  lines.push('')
  lines.push('--- POSITIONING ---')
  lines.push(`Market position: ${p.positioning.market_position} | Perception: ${p.positioning.perception}`)

  if (p.final.anything_else) {
    lines.push('')
    lines.push('--- FINAL NOTES ---')
    lines.push(p.final.anything_else)
  }

  return lines.filter((l) => l !== null && l !== '').length
    ? lines.filter((l) => l !== null).join('\n')
    : '(no client profile data supplied)'
}

function seriesBlock(
  label: SeriesLabel,
  length: number,
  topics: string[],
  format: ExternalFormat,
): string {
  const cleanTopics = topics.map((t) => t.trim()).filter(Boolean)
  const totalLabel = `${label} ${length}`
  const hasTopics = cleanTopics.length > 0

  const topicsBlock = hasTopics
    ? `TOPICS PER ENTRY (use these exact angles - do not invent new ones):
${cleanTopics
  .slice(0, length)
  .map((t, i) => `  ${label} ${i + 1}: ${t}`)
  .join('\n')}${cleanTopics.length < length ? `\n  ${label} ${cleanTopics.length + 1} - ${totalLabel}: pick fresh angles that build on the prior entries, anchored ONLY to the CLIENT PROFILE items (evergreen topics, hot takes, audience pain points, signature offer, differentiation).` : ''}

EVEN WITH PROVIDED TOPICS: each entry's body must anchor to a specific item from the CLIENT PROFILE (a named pain point, a hot take, the signature offer, the differentiation, etc). The topic is the angle, the profile is the substance. Do not pad with generic creator-coach advice.`
    : `TOPICS: not pre-specified - WING-IT MODE.

WING-IT MODE has a strict source rule: every topic must be drawn from the CLIENT PROFILE. The valid pools are:
  - audience.pain_points (5 entries)
  - content_strategy.evergreen_topics (5 entries)
  - content_strategy.hot_takes (3 entries)
  - content_strategy.myths (3 entries, each "myth + truth")
  - business.problem_solved
  - business.differentiation
  - business.signature_offer
  - voice.common_enemy
  - audience.fears, audience.desires, audience.objections, audience.yes_triggers, audience.tried_failed

You DO NOT invent fresh creator-coach topics ("how to plan content", "build content buckets", "the 4 hooks that work"). If you cannot map ${length} entries to distinct items from the pools above, write FEWER entries and tell me. A 5-entry series of profile-anchored content beats a 30-entry series of generic creator advice.`

  const planRequirement = hasTopics
    ? `STEP 1 - TOPIC PLAN (do this BEFORE writing any entry):
Before Batch 1, output a numbered TOPIC PLAN for all ${length} entries. For each line:
  ${label} N: <one-line topic restated from the supplied topic list> | Anchor: <which CLIENT PROFILE item this entry will pull its body content from - cite the field name and value, e.g. "audience.pain_points #2 'X'", "evergreen_topics 'Y'", "signature_offer 'Z'">

If a supplied topic has NO supporting profile item, write: "Anchor: NONE - entry will be shorter, no proof beat". Do not invent a fake anchor.`
    : `STEP 1 - TOPIC PLAN (do this BEFORE writing any entry):
Before Batch 1, output a numbered TOPIC PLAN for all ${length} entries. For each line:
  ${label} N: <topic in 5-12 words, drawn from the CLIENT PROFILE pools listed above> | Source: <exact profile field + value, e.g. "audience.pain_points #2 'X'">

Each entry must map to a DISTINCT profile item where possible. If the profile yields fewer than ${length} distinct anchors, output a shorter plan and tell me - do not pad.`

  return `SERIES SPEC:
- This is a ${length}-entry series, numbered "${label} 1" through "${totalLabel}".
- Every entry uses the same FORMAT: ${FORMAT_LABEL[format]}.
- Every entry opens with the literal label "${label} N." in its first line. No "welcome back", no recap.
- Every entry ends by teasing the SPECIFIC beat of the next entry, not a vague "see you tomorrow".
- Maintain a single throughline across the arc. Earlier entries set up later entries.

${topicsBlock}

${planRequirement}

After you output the TOPIC PLAN, STOP and wait for me to type "continue" or to revise the plan. Do not start Batch 1 until I confirm.

DELIVERY INSTRUCTIONS for the entries (after I confirm the plan):
Output entries in BATCHES OF 10. After each batch, STOP and wait for me to type "continue" before generating the next batch. This keeps each batch within your context window and lets me review before moving on.
- Batch 1: ${label} 1 through ${label} ${Math.min(10, length)}.${
    length > 10
      ? `
- Batch 2: ${label} 11 through ${label} ${Math.min(20, length)}.`
      : ''
  }${
    length > 20
      ? `
- Batch 3: ${label} 21 through ${label} ${Math.min(30, length)}.`
      : ''
  }${
    length > 30
      ? `
- Continue in batches of 10 until ${totalLabel} is delivered.`
      : ''
  }

After finishing each batch, end with: "BATCH COMPLETE. Reply 'continue' for the next batch." Do NOT generate the next batch until I say continue.

Each entry follows the FORMAT STRUCTURE in full. Within each entry, every body line must reference its profile anchor (named in the TOPIC PLAN). Separate entries with a horizontal rule line of equals signs (==========).`
}

function seriesFromAnswersBlock(
  label: SeriesLabel,
  length: number,
  format: ExternalFormat,
  answers: SeriesAnswerForPrompt[],
  title: string | null | undefined,
  brandLine: string | null | undefined,
  framing: string | null | undefined,
): string {
  const sorted = [...answers].sort((a, b) => a.entry_index - b.entry_index)
  const totalLabel = `${label} ${length}`

  const rawMaterialLines = sorted
    .map((a) => {
      const beat = a.beat_type ? ` | beat: ${a.beat_type}` : ''
      const anchor =
        a.anchor_field && a.anchor_value
          ? ` | anchor: ${a.anchor_field} = "${a.anchor_value}"`
          : a.anchor_field
            ? ` | anchor: ${a.anchor_field}`
            : ''
      return `[${label} ${a.entry_index}]${beat}${anchor}
QUESTION: ${a.question}
CLIENT ANSWER (verbatim): ${a.answer}`
    })
    .join('\n\n---\n\n')

  return `SERIES SPEC (FROM CLIENT INTERVIEW - the client filled out a per-entry questionnaire):

- Series title: "${title || 'Untitled series'}"
- ${length} entries, numbered "${label} 1" through "${totalLabel}"
- Format: ${FORMAT_LABEL[format]}${framing ? `\n- Framing: ${framing}` : ''}${
    brandLine
      ? `\n- Brand line (open EVERY entry with this exact phrase, then state the entry number): "${brandLine}"`
      : ''
  }

THIS IS THE MOST IMPORTANT PART OF THE WHOLE BRIEF. READ IT TWICE.

The client has provided RAW MATERIAL for each entry below - their own words, their own stories, their own language. Your job is to STRUCTURE these into the FORMAT, not to REPLACE them with your own ideas.

ABSOLUTE RULES FOR USING THE CLIENT'S MATERIAL:
1. Use the client's EXACT phrases wherever they're sharp. Their phrasing beats your phrasing every time. Their voice is what makes the series feel human.
2. Do NOT paraphrase a story into something more "polished" or "punchy". Polished sounds AI. Raw sounds human. The slightly awkward, specific, lived-in detail is what makes the audience trust them.
3. Do NOT add invented details, examples, numbers, results, clients, or proof. Use ONLY what the client wrote in the answer below. If the answer doesn't mention a result, the entry doesn't mention a result.
4. If the client's answer is short, the entry is short. Do not pad. A 30-second short pulled from one specific lived moment beats a 60-second short stuffed with filler.
5. Each entry's body must STAY ON the moment/lesson/story the client described. No drifting into adjacent generic content-creator advice.
6. If a slot below has no answer (client skipped it), write: "${label} N: [SKIPPED - no client material provided]" and move on. Do not invent.

OPEN AND CLOSE OF EACH ENTRY:
- Open: ${
    brandLine
      ? `the literal brand line "${brandLine}, ${label.toLowerCase()} N." (e.g. "${brandLine}, ${label.toLowerCase()} 1.")`
      : `the literal "${label} N." in the first 2 seconds`
  }. This repetition is non-negotiable - it's what makes the series brandable. (See the "30 lessons by 30, lesson 18" / "Day 37 of 75" pattern.)
- Close: a one-line tease pointing at the SPECIFIC topic of the next entry, drawn from the next entry's CLIENT ANSWER below. Not a vague "see you tomorrow." If you're writing ${label} 1, the tease must reference what ${label} 2's answer is actually about.

==================================================================
RAW MATERIAL (one block per entry - this is the source of truth):
==================================================================

${rawMaterialLines}

==================================================================
END RAW MATERIAL
==================================================================

DELIVERY INSTRUCTIONS:
Output entries in BATCHES OF 10. After each batch, STOP and wait for me to type "continue" before generating the next batch.
- Batch 1: ${label} 1 through ${label} ${Math.min(10, length)}.${
    length > 10 ? `\n- Batch 2: ${label} 11 through ${label} ${Math.min(20, length)}.` : ''
  }${
    length > 20 ? `\n- Batch 3: ${label} 21 through ${label} ${Math.min(30, length)}.` : ''
  }${length > 30 ? `\n- Continue in batches of 10 until ${totalLabel} is delivered.` : ''}

After finishing each batch, end with: "BATCH COMPLETE. Reply 'continue' for the next batch." Do NOT generate the next batch until I say continue.

Each entry follows the FORMAT STRUCTURE in full, but every body line must trace back to the CLIENT ANSWER for that entry. Separate entries with a horizontal rule line of equals signs (==========).`
}

function doubledownBlock(referenceScript: string, format: ExternalFormat): string {
  return `DOUBLE-DOWN SPEC:
Below is a REFERENCE SCRIPT that performed well for this client. Your job is to write a NEW piece of content in the same FORMAT (${FORMAT_LABEL[format]}) that copies the reference's STRUCTURE and RHYTHM (sentence count, pause points, beat shapes, hook style, transition cadence) but TEACHES A DIFFERENT ANGLE.

CRITICAL:
- Do NOT copy the reference's wording. Reframe every sentence.
- Do NOT teach the same topic. Pick a different angle that fits the same client and audience.
- DO match the reference's pacing, sentence-length distribution, hook structure, and outro shape.
- Use the client braindump (above) as the source of truth for the new angle's actual content.

REFERENCE SCRIPT (read it twice, internalize the shape, then write a new one):
=========================================================
${referenceScript.trim()}
=========================================================`
}

export function buildExternalPrompt(input: BuildExternalPromptInput): string {
  const {
    clientProfile,
    clientName,
    businessName,
    industry,
    format,
    pillar,
    ctaText,
    ideaInput,
    seriesLabel = 'Day',
    seriesLength = 10,
    seriesTopics = [],
    seriesAnswers,
    seriesTitle,
    brandLine,
    framing,
    referenceScript,
  } = input

  const hasSeriesAnswers = Array.isArray(seriesAnswers) && seriesAnswers.length > 0

  const sections: string[] = []

  sections.push(
    `# CONTENT BRIEF - PASTE THIS WHOLE PROMPT INTO YOUR EXTERNAL AI

You are writing content for a specific client. Read this entire brief once, then produce the requested output. Follow every rule. The client profile, format, voice rules, and ${pillar === 'series' ? 'series spec' : 'reference script'} below are non-negotiable.

PILLAR: ${pillar.toUpperCase()}
FORMAT: ${FORMAT_LABEL[format]}`,
  )

  // Sandwich top: loud version of the most-violated rules, before the model
  // even sees the client profile.
  sections.push('## CRITICAL HARD RULES (read these first, obey them last)\n')
  sections.push(CRITICAL_BANS_TOP)

  sections.push('## FAILURE EXAMPLES (do not produce these patterns)\n')
  sections.push(FAILURE_EXAMPLES)

  sections.push('## CLIENT PROFILE (the source of truth for everything you write)\n')
  sections.push(brandProfileSummary(clientProfile, { clientName, businessName, industry }))

  sections.push('## CORE FRAMEWORK\n')
  sections.push(FRAMEWORK_CORE)

  sections.push(`## PILLAR VOICE\n`)
  sections.push(PILLAR_FRAMEWORK[pillar])

  sections.push('## VOICE & HARD BANS (full)\n')
  sections.push(VOICE_RULES)

  sections.push('## TONE TARGET\n')
  sections.push(HUMAN_VOICE_EXAMPLE)

  sections.push('## FORMAT STRUCTURE\n')
  sections.push(FORMAT_STRUCTURE[format])

  if (pillar === 'series') {
    sections.push('## SERIES SPEC\n')
    if (hasSeriesAnswers) {
      sections.push(
        seriesFromAnswersBlock(
          seriesLabel,
          seriesLength,
          format,
          seriesAnswers!,
          seriesTitle ?? null,
          brandLine ?? null,
          framing ?? null,
        ),
      )
    } else {
      sections.push(seriesBlock(seriesLabel, seriesLength, seriesTopics, format))
    }
  } else if (pillar === 'doubledown') {
    sections.push('## DOUBLE-DOWN SPEC\n')
    sections.push(doubledownBlock(referenceScript || '', format))
  }

  if (ideaInput && ideaInput.trim()) {
    sections.push('## TOPIC / ANGLE NOTES (from the operator)\n')
    sections.push(ideaInput.trim())
  }

  if (ctaText && ctaText.trim()) {
    sections.push('## CTA (use this exact text where the format calls for a CTA)\n')
    sections.push(ctaText.trim())
  } else {
    sections.push('## CTA\n(none supplied - use a soft native close that fits the format)')
  }

  // Sandwich bottom: re-state the critical bans + final checklist immediately
  // before the "now produce" line so they're the last thing the model sees.
  sections.push('## CRITICAL HARD RULES (re-stated - the model has been observed violating these)\n')
  sections.push(CRITICAL_BANS_TOP)

  sections.push('## FINAL CHECK\n')
  sections.push(FINAL_CHECK)

  sections.push(`## NOW PRODUCE THE OUTPUT

${
  pillar === 'series'
    ? hasSeriesAnswers
      ? `The client has supplied raw material in the SERIES SPEC. Skip any topic-planning step - the entries are already defined by the client's answers.

Begin with Batch 1 (${seriesLabel} 1 through ${seriesLabel} ${Math.min(10, seriesLength)}). Each entry's body must trace directly to its CLIENT ANSWER block. Use the client's exact phrasing wherever it's sharp - their voice is the whole point. Separate entries with a line of equals signs (==========). End each batch with: "BATCH COMPLETE. Reply 'continue' for the next batch."

Before writing each entry, run the FINAL CHECK mentally. Cut any line that doesn't trace to the client's answer.`
      : `Step 1: Output the TOPIC PLAN as specified in the SERIES SPEC. Stop and wait for me to type "continue".

Step 2 (after I confirm): Begin with Batch 1 (${seriesLabel} 1 through ${seriesLabel} ${Math.min(10, seriesLength)}). Each entry follows the FORMAT STRUCTURE in full. Every body line must reference its profile anchor from the TOPIC PLAN. Separate entries with a line of equals signs (==========). End each batch with: "BATCH COMPLETE. Reply 'continue' for the next batch."

Before writing each entry, run the FINAL CHECK mentally. Cut any line that fails it.`
    : `Write ONE complete piece of content in the FORMAT STRUCTURE above, following every rule. Output the bracketed sections in the exact order specified.

Before finalizing, run the FINAL CHECK mentally. Cut any line that fails it. Shorter and specific beats longer and generic.`
}`)

  return sections.join('\n\n')
}
