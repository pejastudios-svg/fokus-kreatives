// Static, format-specific human review guides shown alongside the AI
// checklist in the slot drawer. These are the rules / patterns staff
// scan for before approving a script.
//
// Distinct from the AI-graded checklist (which is per-script and lives
// in generation_meta.checklist). The review guides are STATIC text -
// same content for every script of that format - and serve as the
// "how to review this" instruction.
//
// Authored from the user's spec, adapted to use the section tags our
// framework actually emits, and extended with the quality rules from
// this round of work (mid-roll CTA tone, description rules, etc).

import type { SlotStream } from '@/lib/planner/types'

export interface GuideSection {
  title: string
  /** Plain-text intro paragraph, optional. Rendered above the items. */
  intro?: string
  /** Bullet items. Mix short rules with example fixes. */
  items: string[]
}

export interface ReviewGuide {
  /** Display title. e.g. "Long-form review guide". */
  title: string
  sections: GuideSection[]
}

// ---------------------------------------------------------------------------
// Universal sections - reused across every guide, duplicated here so each
// format's guide reads self-contained when surfaced in the drawer.
// ---------------------------------------------------------------------------

const AI_TELLS_SECTION: GuideSection = {
  title: 'Hunt the AI tells',
  intro:
    'These are the patterns that scream "AI wrote this". Skim every paragraph and rewrite each one as a direct, positive claim or delete it.',
  items: [
    '"isn\'t X, it\'s Y" / "you\'re not just X, you\'re Y" - the single biggest tell. Cut the negation, keep only the positive half. Example fix: "Your intro isn\'t a greeting, it\'s a 5-part sequence" → "Your intro is a 5-part sequence."',
    'Rhetorical fragment-questions used as transitions: "The result?", "The kicker?", "Honestly?", "Look,", "Here\'s the thing". Just say the next sentence - the transition is implied.',
    '"Here\'s the truth / secret / wild truth". Same family. Drop the preamble; keep the claim.',
    'Paired or tripled adjectives like "consistent, engaging content" or "clear, valuable, actionable". Pick the stronger one and cut the others.',
    'Em-dashes (the longer dash). Replace with commas, periods, or recast the sentence. Plain hyphens in compound modifiers (5-part, lead-generating) are fine and stay.',
    'AI cliché vocab: "game-changer", "leveraging", "captivated", "journey", "pulling back the curtain", "dive in", "unlock". Swap each for the plainest word the creator would say.',
    'Tag-question filler at the end of a sentence ("..., right?"). Convert to a period.',
    'Setup-payoff lines like "Here\'s why this matters:" or "The reason is simple:". Cut the setup, keep the actual sentence.',
    '"stuck on the first line" / "staring at a blank camera" used as a noun phrase. Banned outright - the AI must rephrase.',
  ],
}

const READ_ALOUD_SECTION: GuideSection = {
  title: 'Read it out loud (or in your head)',
  intro:
    'Does it sound like the creator talking, or like a polished blog post? If a sentence sounds like a LinkedIn comment, kill it.',
  items: [
    'Contractions everywhere (don\'t, won\'t, gonna, you\'re, I\'m). No "do not", "will not", "going to".',
    'Sentence length varies. Three sentences in a row at similar length is a tell. Mix a 3-word fragment with a 22-word run.',
    'No invented numbers, clients, dates, results, or social proof that weren\'t in the brief. If you didn\'t give the AI a stat, it shouldn\'t be using one.',
    'First-person stays consistent (I vs we). Switching mid-script reads as ghostwritten - flag any drift.',
  ],
}

// ---------------------------------------------------------------------------
// LONG-FORM
// ---------------------------------------------------------------------------

const LONG_FORM_GUIDE: ReviewGuide = {
  title: 'Long-form review guide',
  sections: [
    {
      title: 'Check the structure first',
      intro:
        'Before reading the actual lines, scan that every section header is doing its job. The model sometimes glues a header to the end of the previous paragraph - move it to its own line with a blank line above and below.',
      items: [
        'Each [SECTION_TAG] sits on its own line with a blank line above and below.',
        'POINT N: and CONTEXT: / APPLICATION: / FRAMING: / RE-HOOK: are also internal labels. They sit on their own line.',
        'Each BRACKET section tag appears exactly once - e.g. only one literal "[CTA]" label in the whole script. If you see the [CTA] LABEL duplicated (one inline mid-paragraph and one at the bottom), delete the inline one. This rule is about the bracket label, NOT the mid-roll CTA prose - that prose IS supposed to live inside POINT 2 (see section 5).',
        'Required sections: [TITLE], [THUMBNAIL IDEA], [OUTLINE], [INTRO], [BODY], [OUTRO], [CTA], [DESCRIPTION].',
        '[OUTLINE] has 3 or 4 POINTs (never more). [BODY] has the same N POINTs in the same order as [OUTLINE].',
      ],
    },
    {
      title: 'Strip the analysis labels before client delivery',
      intro:
        'Inside [BODY] you\'ll see internal labels: POINT N, CONTEXT:, APPLICATION:, FRAMING:, RE-HOOK:. Those are for staff to confirm each beat does its job - they\'re NOT for the client. Remove every one of them before sending the script over.',
      items: [
        'Strip CONTEXT:, APPLICATION:, FRAMING:, RE-HOOK:, POINT N: labels from the [BODY].',
        'Strip [OUTLINE] entirely (analysis only - not part of the client deliverable).',
        'Keep [TITLE], [THUMBNAIL IDEA], [INTRO], [BODY], [OUTRO], [CTA], [DESCRIPTION] for the editor handoff.',
      ],
    },
    AI_TELLS_SECTION,
    READ_ALOUD_SECTION,
    {
      title: 'Long-form quality checks',
      intro: 'Long-form has structural and CTA rules that must pass.',
      items: [
        '[INTRO] runs 180-220 words MAX. Over budget and the script truncates downstream.',
        '[INTRO] hits these beats in order: immediate context (echoes the title), common belief, contrarian take, optional proof beat, and the plan (what the points will cover).',
        '[BODY] points teach in the same order as [OUTLINE]. POINT 1 in body = POINT 1 in outline.',
        'No "umbrella" meta-points. POINT 1 must be a peer sub-mechanic, never a summary of POINTs 2/3/4.',
        'Each POINT runs 500-620 words across CONTEXT + APPLICATION + FRAMING + RE-HOOK.',
        'Mid-roll CTA: lands at the END of POINT 2\'s RE-HOOK, flowing STRAIGHT into POINT 3 in the same paragraph. Never "back to the video" or paragraph break before POINT 3.',
        '[OUTRO]: ~160-240 words, three beats (recap, soft website-link offer, closing line). NEVER "Comment KEYWORD" or "DM me KEYWORD" - long-form uses website-link CTAs only.',
        '[CTA] block: one line, echoes the supplied MID-ROLL CTA TEXT verbatim, never a comment-keyword form.',
      ],
    },
    {
      title: '[DESCRIPTION] block specifically',
      intro:
        'YouTube description follows the brand\'s exact template. Audit it separately - the rules differ from the spoken script.',
      items: [
        'Line 1: "<CREATOR_NAME> shares how to <one short clause>". Uses the human\'s name (Jedidiah), NOT the business name (Fokus Kreativez).',
        '🔥 Pinned CTA: "<offer phrase> ➡️ <BRAND_WEBSITE>". Brand website URL appears verbatim - no fabricated URLs.',
        '"You\'ll learn:" block has 4-5 bullets with "• " prefix. Each bullet rewrites an OUTLINE POINT headline as a viewer-facing outcome.',
        '"Connect with us!" block: each social on its own line with the FULL profile URL (https://...). YouTube auto-hyperlinks the URL when the description renders. Lines with "(none)" inputs are omitted entirely.',
        '"📌 WHO THIS IS FOR:" header is fully UPPERCASE (not "WHO this IS FOR" or "Who This Is For").',
        '"📌 ABOUT <BRAND_NAME>:" - the ABOUT section uses the BUSINESS name. Bio is rewritten descriptively for this video, NOT pasted verbatim from BRAND_BIO.',
        '"📌" welcome paragraph (the one before the 🌐 line) MUST be written in the brand\'s voice - 2-4 sentences synthesized fresh from BRAND_BIO + BRAND_AUDIENCE. Banned canned phrasings: "If this is your first time here, welcome", "This channel is for [type of person] who want to...", "Subscribe below and hit the bell so you don\'t miss what\'s coming next". If you see any of those, reject and regenerate.',
        '🌐 footer line: full BRAND_WEBSITE URL, single line.',
        'Hashtags at the bottom: 15-20 tags, all relevant to the topic. No "#fokuskreativez" on every line if the brand doesn\'t use that.',
      ],
    },
    {
      title: 'Final pass',
      items: [
        'Mid-roll CTA appears exactly ONCE (between POINT 2 and POINT 3), the outro fortune-cookie repeats it ONCE softly, and the [CTA] block echoes it ONCE. Three total occurrences max.',
        'No "Comment CONTENT" / "DM me CONTENT" anywhere - those are feed-post conventions. Long-form is website-link only.',
        'Title and Connect block social URLs match the brand profile.',
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// CAROUSEL
// ---------------------------------------------------------------------------

const CAROUSEL_GUIDE: ReviewGuide = {
  title: 'Carousel review guide',
  sections: [
    {
      title: 'Check the structure first',
      items: [
        'Each [SECTION_TAG] sits on its own line.',
        'Required sections: [TITLE], [ANGLE], [CAPTION], [SLIDES], [HASHTAGS].',
        'Inside [SLIDES]: each "Slide N:" header on its own line, content on the line BELOW (never glued to the header).',
        'EXACTLY 10 slides. Not 6, not 8. Ten.',
        'Slide 1 is the hook. Slide 10 is the CTA. Slides 4-8 are the teaching body.',
      ],
    },
    AI_TELLS_SECTION,
    READ_ALOUD_SECTION,
    {
      title: 'Carousel-specific quality',
      items: [
        'No slide over 18 words.',
        'No slide restates the previous one - each slide advances the idea.',
        'Slide 4 is the FIRST teaching slide (not slides 1-3, which are hook + mistake + reframe).',
        'Slide 9 is the "save this" / screenshot-worthy distillation. Max 14 words.',
        'Slide 10 CTA: "Comment KEYWORD for [thing]" when a brand DM keyword is locked. Otherwise drives save/share/follow.',
        '[CAPTION]: 90-160 words, 3 short paragraphs separated by line breaks. TEACHES the takeaway - doesn\'t describe the carousel.',
        'Caption ends on a question OR a "comment KEYWORD" prompt.',
        '[HASHTAGS]: 12-18 unique tags, space-separated, all relevant.',
      ],
    },
    {
      title: 'Final pass',
      items: [
        'CTA keyword matches the brand profile (e.g. "CONTENT") - never invented (SYSTEM/FRAMEWORK/PLAN).',
        'Hashtags don\'t repeat. No glued tags like "#tipstips".',
        'No invented stats or testimonials.',
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// ENGAGEMENT REEL
// ---------------------------------------------------------------------------

const ENGAGEMENT_REEL_GUIDE: ReviewGuide = {
  title: 'Engagement reel review guide',
  sections: [
    {
      title: 'Check the structure first',
      items: [
        'Each [SECTION_TAG] sits on its own line.',
        'Required sections: [TITLE], [ANGLE], [PACING], [LENGTH], [SCENES], [CAPTION], [HASHTAGS].',
        'Inside [SCENES]: each "Scene N (X-Y sec):" header on its own line.',
        'This is a SILENT reel. Every word the viewer sees is overlay text, not spoken voice.',
      ],
    },
    AI_TELLS_SECTION,
    READ_ALOUD_SECTION,
    {
      title: 'Engagement-reel-specific quality',
      items: [
        '5-14 words per scene overlay. Anything longer doesn\'t read in time.',
        'NO voiceover, NO narration, NO spoken script. If you see anything formatted like spoken dialogue ("So I was thinking..."), reject it.',
        'Final scene drives engagement (poll, debate question, comment CTA). Never a wrap-up statement.',
        '[PACING] is one word: slow-build, fast-cut, reflective, or punchy.',
        '[LENGTH] is in seconds (15-45s for engagement reels).',
        '[CAPTION]: 60-120 words, TEACHES the takeaway, ends on a question that prompts comments.',
        'When a brand DM keyword is locked, the CTA uses "Comment KEYWORD for [thing]" form - the keyword goes in the OVERLAY, not just the caption.',
        '[HASHTAGS]: 8-14 unique tags.',
      ],
    },
    {
      title: 'Final pass',
      items: [
        'CTA keyword is the locked brand keyword - never invented.',
        'Hashtags don\'t repeat or glue.',
        'No invented stats.',
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// SHORT-FORM
// ---------------------------------------------------------------------------

const SHORT_FORM_GUIDE: ReviewGuide = {
  title: 'Short-form review guide',
  sections: [
    {
      title: 'Check the structure first',
      items: [
        'Each [SECTION_TAG] sits on its own line.',
        'Required sections in order: [TITLE], [HOOK], [REHOOK 1], [BODY], [CTA], [REHOOK 2], [CLOSE], [RELOOP], [CAPTION], [HASHTAGS].',
        '[RELOOP] is optional but high-leverage - skip only when [CLOSE] already lands the loop naturally.',
        'Single [CTA] only - mid-script, after [BODY]. Never a second CTA at the end.',
      ],
    },
    AI_TELLS_SECTION,
    READ_ALOUD_SECTION,
    {
      title: 'Short-form-specific quality',
      items: [
        'Total spoken script (TITLE through RELOOP, excluding caption/hashtags): 75-180 words. Over 180 = cut a body beat.',
        '[TITLE]: 4-8 words, pattern interrupt, no greetings or "today I want to..." preambles.',
        '[REHOOK 1] is MANDATORY. A short-form without it loses ~30% of viewers at the 5-second mark.',
        '[CTA] verb: "Comment KEYWORD" form when a DM keyword is locked. "DM me KEYWORD" is for stories, not feed posts.',
        'Each beat 1-2 sentences MAX. If a beat needs 3 sentences, cut a beat instead.',
        '[CAPTION]: 60-120 words, TEACHES the takeaway, doesn\'t describe the reel. Ends on a question or comment-KEYWORD prompt.',
        '[HASHTAGS]: 8-14 unique tags.',
      ],
    },
    {
      title: 'Final pass',
      items: [
        'CTA keyword matches the brand profile.',
        'Hashtags don\'t repeat or glue.',
        'No invented stats or testimonials.',
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const GUIDES: Partial<Record<SlotStream, ReviewGuide>> = {
  long_form: LONG_FORM_GUIDE,
  carousel: CAROUSEL_GUIDE,
  engagement_reel: ENGAGEMENT_REEL_GUIDE,
  short_form: SHORT_FORM_GUIDE,
  // Story stream skipped - stories are 4 short overlay frames + DM
  // keyword. There's no script-length review surface that warrants a
  // multi-section guide.
}

/** Look up the review guide for a stream. Returns null when no guide
 *  exists (currently only story falls through). */
export function getReviewGuide(stream: SlotStream): ReviewGuide | null {
  return GUIDES[stream] ?? null
}
