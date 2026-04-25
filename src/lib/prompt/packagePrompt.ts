import type { BrandProfile } from '@/components/clients/brandProfile'
import {
  FRAMEWORK_CORE,
  PILLAR_FRAMEWORK,
  LONGFORM_FRAMEWORK,
  CAROUSEL_FROM_LONGFORM,
  REEL_FROM_LONGFORM,
  STORY_FROM_LONGFORM,
} from './framework'

export type PackagePillar = keyof typeof PILLAR_FRAMEWORK

function voiceLine(profile: BrandProfile | null): string {
  if (!profile) return 'VOICE: casual conversational, warm, no jargon.'
  const v = profile.voice
  const dial = (n: number) => (n <= 2 ? 'low' : n >= 4 ? 'high' : 'medium')
  const parts = [
    `addresses audience as "${v.address_audience_as || 'you'}"`,
    `casual=${dial(v.casualness)}`,
    `funny=${dial(v.funny)}`,
    `enthusiastic=${dial(v.enthusiastic)}`,
    `emotional=${dial(v.emotional)}`,
    `jargon=${v.uses_jargon}`,
  ]
  const traits = (v.traits || '').trim()
  if (traits) parts.push(`traits="${traits}"`)
  const sigs = (v.signature_phrases || []).map((s) => s.trim()).filter(Boolean)
  if (sigs.length) parts.push(`signature (use sparingly): ${sigs.map((s) => `"${s}"`).join(', ')}`)
  return `VOICE: ${parts.join(' | ')}`
}

function clientLine(profile: BrandProfile | null): string {
  if (!profile) return ''
  const b = profile.business
  const a = profile.audience
  const bits = [
    b.mission && `mission=${b.mission}`,
    b.problem_solved && `problem=${b.problem_solved}`,
    b.differentiation && `diff=${b.differentiation}`,
    b.signature_offer && `offer=${b.signature_offer}`,
    a.work_roles && `audience=${a.work_roles}`,
    a.desires && `desires=${a.desires}`,
  ].filter(Boolean)
  if (!bits.length) return ''
  return `CLIENT CONTEXT:\n- ${bits.join('\n- ')}`
}

const SHARED_GUARDRAILS = `GUARDRAILS:
- No em dashes (—) anywhere. Use commas or periods instead.
- ABSOLUTELY no "<subject> isn't X, it's Y" construction in any form. Applies to ANY subject, not just "this/that/it" — "your intro isn't just a greeting, it's a...", "the end isn't a goodbye, it's...", "this isn't just X, it's Y" are ALL banned. Any variant (comma, semicolon, period between the clauses; with or without "just", "simply", "merely"). State the positive claim directly. This is the single most common AI tell and is banned outright.
- No "here's the truth" / "here's the wild truth" / "here's the hard truth" / "here's the real truth" / "the wild truth" in any form. Just state the claim.
- No "and the best part", no "in this video", no "welcome back", no "let me know what you think", no "I'm excited to see", no "I'm sure you want to know", no "click the link in the description" outside of a single CTA placement.
- No meta-writing jargon inside the spoken script: never say "click-confirm", "directly echo and confirm", "pattern interrupt", "hook stack", "scroll-stop", "curiosity loop", "re-hook" as literal words in the script. These are behind-the-scenes instructions to the writer, not lines the audience should hear. Named creator-framework terms the braindump actually teaches (e.g. "2-1-3-4 method", "fortune cookie outro", "value loop", "5-part intro") ARE allowed because they are the taught concepts.
- BODY POINT COUNT: 3 or 4 points only. NEVER 5. The 2-1-3-4 method only works cleanly at 4. If the braindump has more than 4 steps, GROUP them so you end with 3 or 4 top-level points; walk through sub-steps inside APPLICATION.
- NO meta-outline points: never create a point titled "The Full Pattern", "The Complete System", "The Whole Roadmap", or any point that re-describes what the whole video is teaching. Every point must be a distinct teaching beat, not a summary of the video.
- FULL OUTPUT REQUIRED: the script MUST run all the way through [CTA] and [DESCRIPTION]. Do NOT stop at [OUTRO]. If you feel the word count running high, tighten body points, DO NOT drop the [DESCRIPTION] section.
- Never invent numbers, clients, dates, stories, case studies, results, or social proof that weren't supplied in the braindump or CLIENT CONTEXT.
- Name specific frameworks and steps by the vocabulary used in the braindump. No vague "system" or "something that works".
- Every hook and re-hook must pass: pattern interrupt in first 3 words + one concrete detail (from the braindump when possible) + tension to resolve.
- OUTLINE point count MUST equal BODY point count. No extra points appearing only in the body.
- BODY labels are sequential (POINT 1, POINT 2, POINT 3, POINT 4, …, POINT N) in reading order. The 2-1-3-4 rule reorders points by strength INTERNALLY; output numbering always goes 1, 2, 3, 4, … in reading order. Never output POINT 2 before POINT 1.
- Every body point MUST emit CONTEXT:, APPLICATION:, FRAMING: labels in that exact order, each on its own line. FRAMING is never skipped and never merged into APPLICATION. RE-HOOK: appears on every point except the final one.
- CTA appears a maximum of THREE times total across the entire script: once inside the relevant body point, once inside the outro fortune cookie, and once in the [CTA] section. Do not parrot it in multiple outro sentences.
- OUTRO must include the fortune-cookie tool/tip beat, not a vanilla recap. Outro is 3 beats maximum, no filler.
- LENGTH IS EARNED: target the per-section word counts by going DEEPER on braindump beats (more concrete examples, more specific language). Never pad by restating the same idea in different words.
- FORMATTING / SPACING: every bracket section sits on its own line with blank lines before and after. Every POINT N: header sits on its own line. Every CONTEXT:/APPLICATION:/FRAMING:/RE-HOOK: label sits on its own line with a blank line before it. Copy-paste of the output must read cleanly in a Google Doc with no manual reformatting.
- For long-form (YouTube), use [DESCRIPTION] not [CAPTION], and NO hashtags in the output.
- For carousel/reel/story (Instagram), keep [CAPTION] + [HASHTAGS].

GOOD vs BAD — concrete rewrites. Study these. Produce lines like RIGHT, NEVER like WRONG.

#1 AI tell — negation-then-pivot. Banned in every form: "isn't X, it's Y", "don't just X, you Y", "not about X, but Y", with any subject, any connector (comma, semicolon, period, "but"), with or without "just/simply/merely/only".
  WRONG: "Your intro isn't just a polite greeting, it's a five-part powerhouse."
  RIGHT: "Your intro is a five-part sequence that hooks the viewer in under ten seconds."
  WRONG: "You don't just share information; you craft an experience."
  RIGHT: "You craft an experience. Every sentence keeps them invested."
  WRONG: "It's not about working harder, but working smarter."
  RIGHT: "Work smarter. Let the pattern do the heavy lifting."
  WRONG: "Consistent content isn't about brute force; it's about a repeatable pattern."
  RIGHT: "Consistent content comes from a repeatable pattern, not brute force."

#2 AI tell — "here's the [adj] truth" family. Banned in every form (truth, wild truth, hard truth, real truth, ugly truth, honest truth, contrarian truth, simple truth, uncomfortable truth).
  WRONG: "Here's the contrarian truth: it doesn't have to be."
  RIGHT: "It doesn't have to be."
  WRONG: "Here's the wild truth about consistent content."
  RIGHT: "Consistent content is simpler than most people make it."

#3 AI tell — meta-writing jargon bleeding into spoken lines. These words are instructions to YOU, not words the audience should hear: "click-confirm", "echoes and confirms", "echoing what the video is about", "pattern interrupt", "hook stack", "scroll-stop", "curiosity loop", "re-hook" (the label is fine; the spoken word is not).
  WRONG: "First, you start with Context — immediately echoing what the video is about."
  RIGHT: "First, you start with Context: restate the promise of the title in your opening two lines, so the viewer knows they're in the right place."
  WRONG: "This directly echoes and confirms the video's topic."
  RIGHT: "This restates what the title promised."
  WRONG: "The hook stack opens curiosity loops that keep them watching."
  RIGHT: "The five-part intro opens questions the viewer wants answered."

STRUCTURAL MUSTS — non-negotiable. A missing label or skipped section is a failure, not a style choice.
- Every BODY point emits CONTEXT:, APPLICATION:, FRAMING: labels in that exact order, each on its own line, separated by blank lines. FRAMING is never skipped and never merged into APPLICATION — even a two-sentence FRAMING is required.
- RE-HOOK: appears on every body point except the final one.
- OUTLINE bullet count EQUALS BODY point count (3 or 4). Never 5+.
- BODY labels go 1, 2, 3, 4 in reading order. The 2-1-3-4 rule reorders points INTERNALLY; output numbering is always sequential.
- [DESCRIPTION] always present at the end (for long-form). Never stop at [OUTRO].`

export interface LongformPromptInput {
  profile: BrandProfile | null
  pillar: PackagePillar
  topicAnswer: string
  topicQuestion?: string | null
  ctaText?: string | null
  referenceScript?: string | null
  seriesDay?: number | null
}

export function buildLongformPackagePrompt(input: LongformPromptInput) {
  const { profile, pillar, topicAnswer, topicQuestion, ctaText, referenceScript, seriesDay } = input

  const systemParts = [
    `You are a ghostwriter. Real human voice. Short sentences. Specific words. No AI filler. You expand the client's braindump into a full script; you do not replace it with generic advice.`,
    voiceLine(profile),
    clientLine(profile),
    FRAMEWORK_CORE,
    PILLAR_FRAMEWORK[pillar],
    LONGFORM_FRAMEWORK,
    SHARED_GUARDRAILS,
    ctaText
      ? `CTA INSTRUCTIONS: The following CTA was supplied. You MUST (1) weave it verbatim into the single body point it most naturally solves, AND (2) reference it again softly in the fortune-cookie outro, AND (3) echo the exact text in the [CTA] section. Do not rewrite the CTA:\n${ctaText}`
      : `CTA: No CTA was supplied. Close softly via the fortune-cookie outro. In the [CTA] section, write "(none — native close in outro)".`,
    pillar === 'series' && seriesDay ? `SERIES DAY: ${seriesDay}` : '',
  ].filter(Boolean)

  const system = systemParts.join('\n\n')

  const userParts: string[] = []
  if (topicQuestion) userParts.push(`SOURCE QUESTION (the question the client was answering):\n${topicQuestion}`)
  userParts.push(
    `CLIENT BRAINDUMP — THIS IS THE SOURCE OF TRUTH.\n` +
      `Before you write a single line, extract the concrete beats from this braindump. Every OUTLINE point, every BODY example, every framework named, every step described in the script must come from here. Preserve the client's vocabulary, their specific sequence, their specific examples. If they named a framework (e.g. "2-1-3-4", "fortune cookie", a numbered order of steps), the script TEACHES that exact framework with that exact name. If the braindump is thin on a point, keep the script tighter rather than inventing filler.\n\n"""\n${topicAnswer}\n"""\n\n` +
      `Now build the script strictly around what's inside those triple-quotes.`,
  )
  if (pillar === 'doubledown' && referenceScript) {
    userParts.push(`REFERENCE SCRIPT (mirror STRUCTURE and RHYTHM only, swap the subject, never copy wording):\n"""\n${referenceScript}\n"""`)
  }
  if (pillar === 'series' && referenceScript) {
    userParts.push(`PREVIOUS SERIES DAY (continue the arc, do not recap):\n"""\n${referenceScript}\n"""`)
  }

  return {
    system,
    user: userParts.join('\n\n'),
    maxTokens: 8192,
    temperature: 0.6,
  }
}

export interface RepurposePromptInput {
  profile: BrandProfile | null
  pillar: PackagePillar
  longformScript: string
  index: number
  total: number
  previousAngles: string[]
  ctaText?: string | null
}

function repurposeBase(kind: 'carousel' | 'reel' | 'story', input: RepurposePromptInput) {
  const { profile, pillar, longformScript, index, total, previousAngles, ctaText } = input
  const formatSpec =
    kind === 'carousel' ? CAROUSEL_FROM_LONGFORM
    : kind === 'reel' ? REEL_FROM_LONGFORM
    : STORY_FROM_LONGFORM

  const systemParts = [
    `You are a ghostwriter repurposing a long-form script into ${kind} format. Every line you write must trace back to a specific beat in the long-form. You are slicing and reframing existing material, not generating new ideas.`,
    voiceLine(profile),
    clientLine(profile),
    FRAMEWORK_CORE,
    PILLAR_FRAMEWORK[pillar],
    formatSpec,
    SHARED_GUARDRAILS,
    kind !== 'story' && ctaText
      ? `CTA: If a CTA appears in this ${kind}, use this text verbatim: ${ctaText}`
      : '',
  ].filter(Boolean)

  const system = systemParts.join('\n\n')

  const avoid = previousAngles.length
    ? `ANGLES ALREADY USED (do NOT repeat — pick a different beat from the long-form):\n- ${previousAngles.join('\n- ')}`
    : ''

  const user = [
    `LONG-FORM SOURCE SCRIPT (this is your only source of truth — do not invent new points, examples, numbers, or claims):\n"""\n${longformScript}\n"""`,
    avoid,
    `INDEX: ${index} of ${total}. Pick ONE specific beat from the long-form that hasn't been used yet. Name it precisely in [ANGLE]. Return ONLY the formatted output for this single ${kind}.`,
  ].filter(Boolean).join('\n\n')

  return {
    system,
    user,
    maxTokens: kind === 'carousel' ? 1400 : kind === 'reel' ? 900 : 700,
    temperature: 0.6,
  }
}

export const buildCarouselPrompt = (i: RepurposePromptInput) => repurposeBase('carousel', i)
export const buildReelPrompt = (i: RepurposePromptInput) => repurposeBase('reel', i)
export const buildStoryPrompt = (i: RepurposePromptInput) => repurposeBase('story', i)
