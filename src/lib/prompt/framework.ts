/**
 * Script-writing framework extracted from the reference transcript.
 *
 * The framework is split into three pieces:
 *   - FRAMEWORK_BASE        - universals applied to every script
 *                             (long, short, carousel, reel, story).
 *   - LONGFORM_BUILDOUT     - the 5-step writing process for ~10-15 min
 *                             video scripts. Includes the 2-1-3-4 body
 *                             method, fortune cookie outro, native CTA
 *                             embed, and mid-roll CTA placement.
 *   - SHORTFORM_BUILDOUT    - the 8-beat 30-60s short-form structure:
 *                             TITLE -> HOOK -> REHOOK 1 -> BODY -> CTA
 *                             -> REHOOK 2 -> CLOSE -> RELOOP. ONE mid-
 *                             script CTA, no end-CTA.
 *
 * `frameworkBlockForStream(stream)` selects the right combination based
 * on the slot's stream. `FRAMEWORK_CORE` is kept as a backward-compat
 * alias (= BASE + LONGFORM_BUILDOUT) so existing callers don't break;
 * new code should use the stream-aware selector instead.
 */

// =============================================================================
// FRAMEWORK_BASE - applies to every script, every format
// =============================================================================
export const FRAMEWORK_BASE = `FRAMEWORK - EXPECTATIONS vs REALITY (EVR):
Every viewer shows up with expectations set by the title/hook. Your job is to make the reality BEAT those expectations. If reality ≥ expectations, they stay. If reality < expectations, they bounce. Every sentence is a tiny EVR event.

ABSOLUTE SOURCE RULE (read this twice):
The CLIENT BRAINDUMP provided by the user is the SOURCE OF TRUTH. Every body point, every framework, every example, every claim in the script MUST come from the braindump (or from the supplied CLIENT CONTEXT block). You are expanding the braindump into a full script - you are NOT writing a fresh essay on the same topic. If the braindump names a specific framework, technique, order, or example, the script TEACHES that exact thing, with that exact vocabulary. Never replace the braindump's ideas with generic content-marketing advice. If the braindump is thin, keep the script shorter - do not fabricate filler points to hit a length.

VOCABULARY FIDELITY:
Any named framework, method, or step in the braindump (examples: "2-1-3-4 method", "value loop", "context / application / framing", "fortune cookie outro", "5-part intro", "re-hook", "native CTA", specific numbered sequences) MUST appear VERBATIM in the script where it's taught, and MUST be taught as its own mechanic, not merely namedropped. If the braindump explains WHY a mechanic works (e.g. "second-best first because it builds anticipation"), teach the WHY directly, not in paraphrase.

FRAMING FIDELITY:
If the SOURCE QUESTION primes a direction (e.g. "a month of content") but the braindump actually describes a DIFFERENT mechanic (e.g. a script-writing pattern), follow the BRAINDUMP, not the question. The question is context; the braindump is the spine. Do not blend the two into a vague hybrid - teach what's actually in the braindump and let the framing bend to fit it.

SCROLL-STOP PRINCIPLE:
Every hook and every re-hook must pass: (1) pattern interrupt in first 3 words, (2) a specific concrete detail (lifted from the braindump whenever possible), (3) creates tension the viewer must resolve.

PERSON CONSISTENCY (most-failed rule when the brand is an agency/team):
The script must stay in ONE grammatical person from open to close. Pick ONE based on the opening line and DO NOT switch:
- If the opening uses "I" / "me" / "my", the entire script stays in first-person singular. Frameworks named in raw material become "the framework I built" / "what I do is...", not "we call it..." / "we gather your ingredients".
- If the opening uses "we" / "us" / "our", the entire script stays in first-person plural. Personal anecdotes from raw material get reframed as "our founder noticed..." or pulled forward into "we".
- "You" addressing the audience is fine in either mode and does NOT count as a switch.
- Failure example: opening with "I just hit my limit trying to write content" then mid-script writing "We call it Real Stories → Right Recipe → Right Time. First, we gather your ingredients..." - the switch from "I" to "we" reads as a third party narrating someone else's framework. Always pick one and hold.

TEACHING CLARITY (universal - every script that teaches anything):
Every script that teaches a method, framework, or step MUST pass these tests:

1. CONCRETE OVER ABSTRACT. Replace abstract claims with specific actions.
   ✗ "Build a system to track your content"
   ✓ "Open a new sheet, label three columns: Topic, Hook, Format"
   ✗ "Make consistent, specific content"   (generic adjective stack)
   ✓ "Pick one story from your week and ask the 5 questions: Scene, Failed Attempt, Turning Point, Framework, Proof"

2. ACTIONABLE OVER INSPIRATIONAL. Every teaching beat ends with something the viewer can DO right now, not a feeling.
   ✗ "It's about turning your real experiences into content that connects"
   ✓ "Tonight, write down one thing that didn't go to plan this week. Tomorrow, that's your hook."

3. SHOW THE EXAMPLE - DON'T SUMMARIZE IT. If raw material gives a specific example, deliver it verbatim. Do NOT meta-describe it.
   ✗ "We ask 5 simple questions to extract your raw material"   (meta-summary)
   ✓ "We ask 5 questions: Where were you when this started? What did you try that didn't work? What changed your direction? What method finally worked? And what was the result?"   (the actual questions)

4. NAME THE THING. Frameworks, methods, numbers, sequences, and named tools from raw material appear VERBATIM. Don't paraphrase a named framework into a generic noun.
   ✗ "a system to plan content"
   ✓ "the Real Stories → Right Recipe → Right Time framework"

5. NO HOLLOW ANALOGIES. Analogies are only useful when followed by the concrete instruction the analogy implies. "It's like X" without the actionable follow-through is filler.
   ✗ "It's like planning a month of dinners, but for your content."   (analogy, no follow-through)
   ✓ "It's like a meal plan: pick one ingredient (the story), match it to a recipe (the format), repeat 8 times. That's a month of content."   (analogy + concrete steps)

6. NO CAPS-FOR-EMPHASIS. Words like YOU, NOT, THIS, REAL written in all caps mid-sentence are an AI tell. Italic or strong emphasis is fine; ALL CAPS for emphasis is not. Brand names (e.g. "FK", "YouTube") and proper acronyms keep their natural casing.

7. NO INVENTED EMPATHY BEATS. Generic empathy lines like "for anyone staring at a camera, totally lost", "if you've been there, you know", "you've felt it before" are filler unless the specific audience+pain is in raw material. If you can't anchor empathy to a specific moment from the braindump, cut the empathy beat - the value beat carries it.

8. NO CORPORATE-SPEAK FLUFF. "Each with its own secret sauce for success", "ensuring your content always sounds like YOU", "specific content that actually sounds like YOU not some generic AI" - these are stuffed-with-adjective marketing lines, not creator voice. State the value directly: "each format has one rule that makes it land. For Hero's Journey, it's the failed attempt - skip it and the story flops."

DO NOT:
- Invent frameworks, numbers, clients, examples, or quotes not in the braindump or CLIENT CONTEXT.
- Replace the braindump's specific ideas with generic content-marketing advice.
- Use em-dashes for the dramatic-reframe pattern ("X - Y" where Y restates X with punch, e.g. "this isn't a tactic - it's a way of life"). Em-dashes for natural pauses or parenthetical asides ARE fine; the ban is specifically the reframe pattern.
- Use the "this isn't X, it's Y" construction in any form ("this isn't just a X, it's a Y", "that's not just X, it's Y", "it's not X, it's Y", semicolon or period variants). Say the positive claim directly: "this is a Y", "Y is what matters". No negation-then-pivot framing anywhere.
- Use rhetorical question + fragment-answer ("That one story? It's 8 posts.", "The real difference? Not features.", "The fix? Real stories."). Rewrite as ONE statement.
- Use meta-writing vocabulary in the SPOKEN script - words like "click-confirm", "pattern interrupt", "hook stack", "scroll-stop", "curiosity loop", "re-hook" are behind-the-scenes instructions to the writer, not lines the audience should hear. Named creator-framework terms the braindump actually teaches (e.g. "2-1-3-4 method", "fortune cookie outro", "value loop") ARE allowed because they are the taught concepts.
- Use colon-led labels in spoken lines: "What I learned: ...", "What's actually happening: ...", "Here's why: ...", "The bigger lesson: ...", "The takeaway: ...". Just say the thing. State it directly, not as a label-then-payoff.
- Open with throat-clearing greetings ("Hey friend", "Hi friends", "Listen up", "Let me tell you", "Let me share"). Write like you're talking to a friend over coffee. Start mid-thought.
- Use AI-tell phrases: "game-changer", "level up", "unlock the secret", "the truth about", "this changes everything", "Now, X..." as a sentence opener.`

// =============================================================================
// LONGFORM_BUILDOUT - 5-step writing process for ~10-15 min videos
// =============================================================================
export const LONGFORM_BUILDOUT = `FIVE WRITING STEPS (long-form, in this order, always):
1) PACKAGING - idea (the pain point or rabbit-hole), title (curiosity loop), loose thumbnail concept. The first lines of the intro must CLICK-CONFIRM the title and ideally beat the expectation it sets.
2) OUTLINE - bulleted UNIQUE points only, all extracted from the braindump. For each point layer: WHAT it is, WHY it matters, HOW it fits the story. The OUTLINE point count MUST equal the BODY point count (if you want 4 body points, the outline has 4 points, and vice versa). If the braindump only supports 3 points, make the outline 3 - do not pad.
3) INTRO (5 parts, in this order, d and e interchangeable):
   a) IMMEDIATE CONTEXT - directly echo and confirm the title in the first 2-3 lines.
   b) COMMON BELIEF - state the conventional take on the topic (so they feel seen).
   c) CONTRARIAN TAKE - flip it. "But here's what actually works / the real answer."
   d) PROOF - one credibility beat that earns the next minute. PROOF MUST come from the braindump or CLIENT CONTEXT. If no real proof is supplied, OMIT the proof beat entirely rather than fabricate one. Never invent clients, results, numbers, case studies, or "I've worked with..." claims.
   e) PLAN - ordered list of what's coming (points/steps). Opens curiosity loops.
4) BODY - DELIVER POINTS IN OUTLINE ORDER. POINT 1 in BODY corresponds to POINT 1 in OUTLINE, POINT 2 to POINT 2, and so on. Same headlines, same sequence. We do NOT use the 2-1-3-4 strength-reorder method here - that's a viral-tips optimization that breaks pedagogy when you're teaching a system in sequence (intro before body, body before outro). Predictable order = staff can spot-check and viewers can follow the teaching arc.

   Each point uses the VALUE LOOP:
   - CONTEXT (the what - one clear sentence)
   - APPLICATION (the how - concrete example the viewer can copy, drawn from the braindump)
   - FRAMING (the why - zoom out, connect to the bigger story)
   RE-HOOK between points: a 1-line tease that forces them into the next point. EVERY point except the last one has a re-hook. The final body point has NO re-hook; it flows straight into the outro.

   MID-ROLL CTA PLACEMENT (only when a MID-ROLL CTA is supplied in the user prompt):
   The mid-roll CTA lands BETWEEN POINT 2 and POINT 3 in BODY. Frame it as a SOFT, CONVERSATIONAL aside that flows STRAIGHT into POINT 3 in the same breath. Format: "...quick aside - [CTA TEXT]. So now that we have that covered, [transition into POINT 3]..." or "...if you want this done for you, [CTA TEXT]. Okay, so let's keep going - [transition into POINT 3]..." NO paragraph break between the CTA and POINT 3. NO "back to the video". NO sign-off. The viewer should barely register that the aside happened - the script returns to teaching in the very next clause.
   THIS IS YOUTUBE LONG-FORM. The CTA is a website link-out (e.g. "click the link in the description"). NEVER write "Comment KEYWORD" or "DM me KEYWORD" inside a long-form script - those are feed-post conventions and they will be REJECTED. Use the supplied CTA TEXT verbatim for the link-out instruction.
   When NO mid-roll CTA is supplied, omit this beat entirely; do not fabricate one.
5) OUTRO - FORTUNE COOKIE (mandatory schema):
   - Line 1: one-sentence high-note recap of the single biggest takeaway.
   - Line 2: one subtle tool / tip / freebie / resource the viewer can act on right now. This is the "fortune cookie" itself. If a CTA was supplied, this IS where you place it (softly). If no CTA was supplied, reference a lightweight tool or next-step the braindump implies - no hard sell.
   - Line 3: a closing line that reminds them reality beat expectations and invites a rewatch/share. Do NOT end with "let me know what you think" or any variant.

NATIVE CTA EMBED (long-form, when a CTA is required):
The CTA must be woven into the body point it naturally solves AS WELL AS reappearing in the fortune-cookie outro. Open with a pain point → offer the resource as the fix → move on. No "but first" pitches. No disruption. The viewer should barely notice it was a CTA.

LONG-FORM DO NOT:
- Output body points whose labels contradict reading order (never "POINT 2" before "POINT 1").
- Let outline point count differ from body point count.
- Reorder body points relative to outline. POINT N in BODY must teach the same concept as POINT N in OUTLINE - the OUTLINE is the table of contents, the BODY is the chapters. Don't shuffle the chapters.
- Skip the fortune-cookie schema in the outro.
- Skip the common-belief beat; without it, the contrarian take has nothing to push against.
- Tack the CTA onto the end as a standalone line; it must live inside a body point AND the outro.
- Use the preamble "and the last one is the one most people miss" or "saving the best for last" before a final list item. State the final item directly.`

// =============================================================================
// SHORTFORM_BUILDOUT - 30-60 second short-form structure
// =============================================================================
export const SHORTFORM_BUILDOUT = `SHORT-FORM STRUCTURE (30-60 seconds spoken, ~75-180 words total).

The script is built as 8 named beats in this exact order. Each beat has its
own bracket label. The CTA lands MID-SCRIPT (after BODY), NOT at the end -
viewers convert at peak engagement, not at the bounce point.

OUTPUT SECTIONS (in this exact order):

[TITLE]
4-8 words. Cold open / pattern interrupt. The single line that would survive as the video's first frame or thumbnail text. Specific, lifted from raw material whenever possible. No greetings, no "today I want to..." preambles.

[HOOK]
1 sentence. The specific moment from the braindump that triggers the rest. Anchored to a concrete scene, number, name, or claim - never generic. Quote or lightly rephrase the braindump's own words.

[REHOOK 1]
1 sentence. Either intensifies the HOOK or pivots to the audience ("You know that feeling when...", "And I bet you've felt it too"). Fragments OK. This is the line that decides whether they keep watching past the 5-second mark.

[BODY]
1-3 mini-beats from the FORMAT MODULE's strategy_beats, delivered in the format's natural order (no 2-1-3-4 reordering - short-form is too tight for internal ranking). 1-2 sentences per beat. Total BODY 50-100 words.
The body beats flow into each other naturally - DO NOT add micro-rehooks between body beats. The arc carries momentum. If you find yourself adding "And here's the thing..." between body beats, cut it.

EVERY BODY BEAT MUST CARRY (the teaching-clarity test - applies to all 19 short-form formats):
- WHAT (the named concept, lifted from raw material - "the 5 questions", "the 2-1-3-4 method", "the failed attempt beat", etc.)
- HOW (one specific, concrete action the viewer can replicate IMMEDIATELY after watching - a verb + a concrete object, not "build a system" but "open a doc and write 3 columns: A, B, C")
A body beat that names a concept without showing the action fails the teaching test - rewrite or cut it.

Examples of how BODY adapts per format type (note how each one names a thing AND shows the action):
- Hero's Journey: pain (specific scene from raw material) → failed attempt (what they tried) → turning point (the line / realization, quoted from raw material) → solution (the specific method, named)
- Listicle: 3 items - each item names ONE concept + a one-line action ("ingredient #1: the failed attempt - write down the most embarrassing thing you've tried this year")
- Hot Take: the take (one declarative sentence) + the evidence (one specific moment from raw material) + the dare (one sentence the disagreers will react to)
- Myth Bust: myth quoted in audience wording → one-line reason it's wrong → the action that replaces it ("instead of asking what to post, ask what happened this week")
- How-To: 2-3 numbered steps - each step is a verb + a concrete object (NOT "be consistent", but "tonight, write 5 lines about the worst week you had this quarter")
- Before & After: specific before scene (sensory detail) → specific after scene (sensory detail) → the ONE thing that changed (named, not vague)
- Q&A: real question quoted from a DM/comment + the direct answer + the sub-step the answer requires

[CTA]
1 sentence. The ONLY CTA - mid-script, after BODY delivers value. Drives ONE action: DM keyword, follow, or share. Use the supplied CTA verbatim if one is provided. NEVER add a second CTA at the end of the script. Short-form has a single CTA, full stop.

[REHOOK 2]
1 sentence. Pulls the viewer back into the script after the CTA, before the CLOSE. "But here's why this works..." or "And the kicker is..." or "What most people miss is..." This beat exists because viewers often scroll right after a CTA - REHOOK 2 catches that bounce.

[CLOSE]
1 sentence. The framing - why this all mattered, what it unlocks for the viewer. Re-anchors the value the CTA just sold. Tags into RELOOP without restating the HOOK.

[RELOOP]
Optional but high-leverage. 1 sentence. Echoes the TITLE or HOOK so the viewer who watches twice loops back into the same energy. Skip ONLY when the CLOSE already lands the loop naturally.

[CAPTION]
60-120 words. The post caption that goes BELOW the short-form video on Instagram / TikTok / Reels. The caption TEACHES the takeaway in writing - it does NOT describe the video ("this reel covers...") and it does NOT just repeat the script. Plain text, conversational, 2-3 short paragraphs separated by line breaks. Ends with a question that prompts comments OR a "comment KEYWORD" prompt when a brand DM keyword is locked. The caption should make sense to someone scrolling past who never watches the video.

[HASHTAGS]
8-14 unique hashtags, space-separated. Each starts with "#", alphanumeric + underscore only. Mix broad-niche tags with mid-specificity tags relevant to the script's specific topic. No hashtag stuffing - every tag should plausibly describe the video's content.

SHORT-FORM HARD RULES:
- Length cap: 75-180 words. Going over 180 means cutting a body beat.
- TITLE drops the viewer mid-thought. No "Hey friends", no "Today I want to talk about", no "Let me tell you about".
- REHOOK 1 is mandatory. A short-form without it loses ~30% of viewers at the 5-second mark.
- Single CTA only. Do NOT embed the CTA inside body and again at outro like long-form.
- No 2-1-3-4 method - short-form is too short for internal ranking. Body beats deliver in format's natural order.
- No fortune-cookie outro - replaced by CLOSE + RELOOP.
- Each beat 1-2 sentences MAX. If a beat needs 3 sentences, cut a beat.
- Sentences should sound spoken. Contractions, fragments, conversational rhythm. No textbook tone.

SHORT-FORM DO NOT:
- Use the long-form 5-step process (PACKAGING / OUTLINE / 5-part INTRO / 2-1-3-4 BODY / fortune cookie). It does not fit 30-60 seconds.
- Output a [DESCRIPTION] section (short-form has captions, not YouTube descriptions).
- Use POINT N labels (those are long-form output structure).
- Run THREE OR MORE sentences per beat - that's a length warning sign.
- Output ANY beat without its bracket label - all 8 beats labelled, in order.`

// =============================================================================
// ENGAGEMENT_REEL_BUILDOUT - silent text-on-screen reel (15-45s)
// =============================================================================
// Engagement reels are NOT spoken scripts. They are silent reels with
// background visuals (b-roll, brand graphics) and on-screen overlay text
// the viewer reads. The format's job is comment generation - the final
// scene drives a poll, opinion-split question, or "comment KEYWORD".
export const ENGAGEMENT_REEL_BUILDOUT = `ENGAGEMENT REEL STRUCTURE (silent, text-on-screen only, 15-45 seconds).

This is a SILENT REEL. The viewer sees background visuals (b-roll, brand graphics) while READING on-screen overlay text. There is NO voiceover, NO narration, NO spoken script. Every word in the output is overlay text the viewer reads.

The format's PURPOSE is comment generation. The final scene MUST drive a comment via opinion-splitting question, poll, or "comment KEYWORD" CTA.

OUTPUT SECTIONS (in this exact order, using these exact bracket labels):

[TITLE]
Internal title for the reel. Single line. Not shown to viewer.

[ANGLE]
One line naming which specific moment from raw material this reel anchors on. Internal note for the team.

[PACING]
One word: slow-build | fast-cut | reflective | punchy. Pick based on the emotional shape of the angle. Polls / debates use punchy. Hero's Journey Text uses reflective.

[LENGTH]
Approximate seconds (15-45s based on scene count).

[SCENES]
1-4 scenes. Each scene is on-screen overlay text only. NO voiceover, NO narration, NO "Say this:" annotation. Format each scene as:

  Scene N (X-Y sec): [overlay text]

5-14 words per overlay. No paragraphs. No voiceover-length sentences. Each scene moves the idea forward - no scene restates the previous.

Scene 1 (HOOK): The opening overlay that names the problem or payoff. Specific, anchored.
Scenes 2-3 (TEACH): The teaching core. ONE concept per scene. For polls / debates, the question/take + one piece of context.
Final scene (ENGAGEMENT DRIVER - MOST-FAILED RULE):
  This scene IS the format's purpose. It MUST be one of:
  - "Comment KEYWORD for [thing]" (when a brand DM keyword is locked) - the keyword goes in the OVERLAY, not just the caption
  - "A or B?" / "X or Y?" poll text
  - A short opinion-split question that splits the audience ("Is X overrated?", "Should creators do Y?")
  Do NOT use the final scene for a closing statement, summary line, or wrap-up like "So I built a system" or "Now I do X". Those are short-form CLOSE/RELOOP shapes - they don't drive comments. The caption holds the framing; the final scene drives the action.

  WRONG (closes the story instead of driving comments):
    "So I built a system to turn my real stories into a month of content."
  RIGHT (drives a comment):
    "Comment CONTENT for the framework."
    "Is AI scriptwriting the death of personal branding?"
    "Real stories or polished frameworks - which works for you?"

[CAPTION]
60-120 words. The caption TEACHES the takeaway, not "this reel covers...". Ends with a question that prompts comments. Plain text - no bullet points unless the format calls for them.

[HASHTAGS]
8-14 unique hashtags, space-separated.

ENGAGEMENT REEL HARD RULES:
- ZERO voiceover, ZERO spoken script, ZERO narration. Every word the viewer encounters is overlay text.
- NEVER include lines like "Voiceover:", "Narration:", "Say this:", or any (spoken) annotation.
- 5-14 words per overlay scene. Anything longer doesn't read in time.
- Final scene drives engagement. The format's purpose IS the comment count.
- 1-4 scenes total. Most engagement reels are 2-3 scenes.
- Pacing matches the emotional shape of the angle.

ENGAGEMENT REEL DO NOT:
- Output anything resembling a spoken short-form script (no [HOOK], [REHOOK 1], [BODY], [REHOOK 2], [CLOSE], [RELOOP] sections - those are short-form labels, not reel labels).
- Add a CTA mid-script the way short-form does. Engagement reels have ONE CTA at the end (the engagement driver).
- Write paragraphs. Every overlay is one short readable line.`

// =============================================================================
// CAROUSEL_BUILDOUT - 10-slide teaching deck
// =============================================================================
// Carousels are NOT spoken scripts and NOT silent reels. They are 10-slide
// static decks the viewer swipes through. Each slide is read individually -
// the arc teaches one specific concept the viewer can act on by the time
// they finish swiping. The CTA is the comment-driven "save / comment X"
// pattern at slide 10.
export const CAROUSEL_BUILDOUT = `CAROUSEL STRUCTURE (10 slides + caption, no spoken narration).

The carousel teaches ONE specific concept the viewer can ACT ON. Slides build a teaching arc - the viewer swipes through and finishes able to apply the concept immediately. NOT a video. NOT a reel. NOT a transcribed long-form. A static-deck teaching unit.

OUTPUT SECTIONS (in this exact order, using these exact bracket labels):

[TITLE]
Internal title for the carousel. Single line. Not shown to viewer.

[ANGLE]
One line naming which specific concept from raw material this carousel teaches. Internal note for the team.

[CAPTION]
90-160 words. The caption TEACHES the takeaway, not "this carousel covers...". 3 short paragraphs separated by line breaks. Ends with a question OR a "comment KEYWORD" prompt that drives comments. The caption stands alone - someone who didn't swipe should still get value from it.

[SLIDES]
EXACTLY 10 slides. Format each slide as:

  Slide N: [slide text]

No slide over 18 words. No slide restates the previous one. Every slide moves the idea forward.

Slide 1 (HOOK): One sharp line stating the problem or payoff. Max 12 words. Pattern interrupt + specific detail drawn from raw material. Not the video's general topic - THIS specific concept.

Slide 2 (MISTAKE - MOST-FAILED): The SPECIFIC default mistake most people make, in their EXACT wording. Not a slogan, not a generic command. Max 14 words.
  WRONG (vague slogan):
    "Stop trying to invent ideas from nothing."
    "Don't overthink your content."
  RIGHT (specific, in audience wording):
    "Most creators start with 'what should I post?' and stare at a blank doc for an hour."
    "You ask AI for a script, hit record, and sound like a stranger reading it back."

Slide 3 (REFRAME - MOST-FAILED): The SPECIFIC one-line insight that names what to do instead. Not a command verb + abstract noun ("Start extracting real stories"). Max 14 words.
  WRONG (generic command):
    "Start extracting real stories from your life."
    "Use frameworks instead of guessing."
  RIGHT (concrete, names the lever):
    "Skip the topic hunt. Start with one moment from this week."
    "Five questions about one real thing beat any AI prompt."

Slides 4-8 (TEACHING BODY): EXACTLY five teaching slides. Each one teaches a distinct component. Max 18 words per slide.

Slide 4 is the FIRST teaching slide, NOT a meta intro / "Start by answering these 5 questions" bridge / "Here's how it works" preamble. That kind of meta slide wastes a slot and forces the remaining 4 to compress two components into one (this is a real failure mode - DO NOT do it).

For a 5-question / 5-step framework: slides 4-8 = one question or step per slide. Use the actual question or verb-led action verbatim from raw material. NEVER combine two questions into one slide ("4 & 5. Framework & Proof: ..." is broken - that's a slot allocation failure).

For a 3-part method: slides 4-6 = one part per slide + slides 7-8 show the parts working together with a specific example.

DO NOT write 5 generic teaching slides - each slide adds a distinct component.

Slide 9 (SUMMARY): The screenshot-worthy distillation. Max 14 words. This is the "save this" slide - it should fit on its own as a standalone share.

Slide 10 (CTA): The comment-driven CTA. Max 12 words. Use "Comment KEYWORD for [thing]" form when a brand DM keyword is locked. Otherwise drive a save / share / follow.

[HASHTAGS]
12-18 unique hashtags, space-separated.

CAROUSEL HARD RULES:
- 10 slides EXACTLY. Not 8. Not 12. Ten.
- No slide over 18 words. Each slide is a self-contained teaching beat.
- The caption TEACHES the takeaway. It doesn't describe the carousel.
- Every slide stands alone - no "and the next thing" / "as I mentioned" transitional crutches.
- Slides 4-8 each name ONE distinct component. Generic "consistency matters" / "be specific" slides fail the test.

CAROUSEL DO NOT:
- Output any spoken-script structure (no [HOOK], [REHOOK 1], [BODY], [REHOOK 2], [CLOSE], [RELOOP] sections - those are short-form labels).
- Output [SCENES] - that's reel structure.
- Lift sentences verbatim from raw material - reframe and tighten every line for slide format.
- Repeat content from slide to slide. Each slide is a unique beat.
- Use voiceover annotations - carousels are silent decks.`

// =============================================================================
// FRAMEWORK_CORE - backward-compat alias
// =============================================================================
// Keep existing callers working. New code should call
// frameworkBlockForStream(stream) instead.
export const FRAMEWORK_CORE = `${FRAMEWORK_BASE}

${LONGFORM_BUILDOUT}`

export const PILLAR_FRAMEWORK: Record<
  'educational' | 'storytelling' | 'authority' | 'series' | 'doubledown',
  string
> = {
  educational: `PILLAR VOICE - EDUCATIONAL: friendly coach / excited nerd sharing a discovery. Not a lecturer. Still runs the full 5-step framework.`,
  storytelling: `PILLAR VOICE - STORYTELLING: friend ranting about a specific moment. Scene → feeling → realization. The INTRO's "common belief → contrarian" becomes "what I thought → what actually happened". The BODY beats are story beats in OUTLINE order.`,
  authority: `PILLAR VOICE - AUTHORITY: coach with proof. Confident diagnosis. Proof beat in the intro is heavier. Body points are frameworks/case studies, delivered in OUTLINE order.`,
  series: `PILLAR VOICE - SERIES: this is part of an ongoing arc. Open with "Day N." - no "welcome back", no recap. Intro still runs directly echo and confirm → contrarian → plan, scoped to today's piece. Outro teases tomorrow's specific beat, not a vague "see you next time".`,
  doubledown: `PILLAR VOICE - DOUBLE DOWN: take the reference script's STRUCTURE and RHYTHM (sentence count, pause points, beat shapes) and swap the subject. Match the reference's body order; never copy wording.`,
}

/**
 * Long-form structure modeled on the reference transcript's 5-step process.
 * ~10-15 min, 1200-2000 words of actual script (not a full transcript).
 */
export const LONGFORM_FRAMEWORK = `LONG-FORM STRUCTURE (YouTube long-form, 10–15 minute video). Target 2400–3600 words of actual spoken script across INTRO + BODY + OUTRO. (Reference pace: established YouTube creators in this genre deliver ~4 words per second / ~240 words per minute, so 10 min ≈ 2400 words and 15 min ≈ 3600 words.) Do NOT pad - hit this range by going DEEPER on each braindump beat (more concrete examples, more specific language the creator actually used, more scenes). If you cannot hit the length from the braindump alone, zoom in on details from it; never invent.

OUTPUT SECTIONS (in this exact order, using these exact bracket labels):

[TITLE]
A single line. Curiosity loop. Pulled from the braindump's central idea. No colon-based clickbait.

[THUMBNAIL IDEA]
One line describing the visual concept. Match the title's curiosity.

[OUTLINE]
3 or 4 bullet points. HARD CAP: NEVER more than 4 points. OUTLINE POINT COUNT MUST EQUAL BODY POINT COUNT. Each bullet format:
  POINT: [headline from braindump] | what: [1 clause] | why: [1 clause] | how: [1 clause]

POINT COUNT HEURISTIC:
If the braindump describes a sequential method with more than 4 named steps, GROUP related steps together so you end with 3 or 4 top-level points, each of which may internally walk through its sub-steps in APPLICATION. Do NOT create 5+ points; the 2-1-3-4 method only works cleanly at 4. If the braindump is a single story or single insight, favour 3 points. Do NOT collapse a multi-step framework into one vague "blueprint" point; name and teach each grouping.

══════════════════════════════════════════════════════════════════
NO META-POINTS - THIS IS THE MOST COMMON FAILURE MODE. READ SLOWLY.
══════════════════════════════════════════════════════════════════
If the braindump has an UMBRELLA concept (e.g. "The Pattern", "The System", "The Framework", "The Method", "The Blueprint") plus a set of sub-mechanics underneath it (e.g. intro structure, body structure, outro structure), the umbrella IS NOT a POINT. The umbrella is what the VIDEO is about. The POINTS are its sub-mechanics.

NEVER make POINT 1 the umbrella. NEVER make POINT 1 walk through the other POINTS in miniature. If you would name POINT 1 "The [Umbrella Noun] Pattern/System/Framework/Method/Blueprint" and its APPLICATION would list the topics that POINTS 2/3/4 then teach individually, POINT 1 is a meta-summary and must be DELETED. Promote one of the sub-mechanics into POINT 1's slot instead.

TEST YOURSELF BEFORE WRITING: can POINT 1 be taught in isolation, without referencing the topics of POINTS 2/3/4? If no, it's a meta-point. Replace it.

  ✗ WRONG - POINT 1 is the umbrella
    POINT 1: The Content Creation Pattern - APPLICATION walks through Topic, Idea, Title, Thumbnail, Outline, Intro, Body, Outro, CTA
    POINT 2: The 5-Part Intro
    POINT 3: The 2-1-3-4 Body
    POINT 4: The Fortune Cookie Outro
    (POINT 1 is just a preview of 2/3/4 - delete it.)

  ✓ RIGHT - every POINT is a peer sub-mechanic
    POINT 1: The Outline Blueprint (What / Why / How)
    POINT 2: The 5-Part Intro
    POINT 3: The 2-1-3-4 Body
    POINT 4: The Fortune Cookie Outro
    (No umbrella at the POINT level - the video IS the umbrella, delivered through these four peer mechanics.)
══════════════════════════════════════════════════════════════════

[INTRO]
180-220 words MAXIMUM. Going over forces the rest of the script to truncate. Five beats in order (d and e interchangeable):
  a) IMMEDIATE CONTEXT - directly echo and confirm the title in the first 2-3 lines.
  b) COMMON BELIEF - the conventional take people hold on this topic.
  c) CONTRARIAN TAKE - flip it. "But here's what actually works."
  d) PROOF - one credibility beat. ONLY include if supplied by braindump/CLIENT CONTEXT. Otherwise skip entirely and glue c→e.
  e) PLAN - state the ordered points that are coming.
Write this as flowing spoken prose, not labeled beats. No bullet points inside [INTRO]. KEEP IT TIGHT - 180-220 words is the cap, not the target.

[BODY]
Same N points as the outline (N is 3 or 4; never more). DELIVER POINTS IN OUTLINE ORDER: POINT 1 in BODY teaches the same concept as POINT 1 in OUTLINE, POINT 2 to POINT 2, etc. Same headlines, same sequence. Do NOT shuffle the body order relative to the outline - it confuses pedagogical flow (you can't teach the body structure before the intro structure). Treat OUTLINE as the table of contents and BODY as the chapters.

Per-point format is mandatory - every point MUST emit all four labels in this exact order, each on its own line with a blank line before it. HARD CAP 500-620 words per point (over budget = truncated output, the AI's job is to hit value DENSITY not length):

  POINT N: [headline pulled from braindump, using the braindump's own vocabulary]

  CONTEXT: 2-3 sentences (50-90 words) naming what it is. Use the creator's exact words for any named framework or mechanic.

  APPLICATION: 6-9 sentences (240-380 words) walking through the concrete example from the braindump. If the braindump gives a specific sequence, steps, or example, TEACH it step by step in that exact order. Quote or lightly rephrase the braindump's own lines where they land.

  FRAMING: 2-3 sentences (60-110 words) zooming out to why this specific mechanic matters for the viewer's real problem. Never skip this label; never merge it into APPLICATION.

  RE-HOOK: 1 sentence (15-25 words) tease pulling into the next point. Omit the RE-HOOK label entirely on the FINAL point (the final point flows straight into the outro).

══════════════════════════════════════════════════════════════════
MID-ROLL CTA - MANDATORY WHEN MID-ROLL CTA TEXT IS SUPPLIED IN THE USER PROMPT.
══════════════════════════════════════════════════════════════════
If the user prompt supplies a "MID-ROLL CTA TEXT:" line, you MUST embed that CTA in the script at the END of POINT 2's RE-HOOK, as a conversational aside that flows STRAIGHT into POINT 3 in the same breath. This is NOT optional. A long-form draft that omits the mid-roll CTA when one was supplied will be REJECTED.

Format: end POINT 2's RE-HOOK normally, then in the same paragraph add: "Quick aside - [CTA TEXT verbatim]. Anyway, [transition into POINT 3]..." or "...if you want this done for you, [CTA TEXT verbatim]. So now that we have that covered, let's keep going..." NO new bracket label, NO paragraph break before POINT 3, NO sign-off.

CTA form: this is YOUTUBE LONG-FORM. The CTA is a website link-out (e.g. "click the link in the description"). NEVER write "Comment KEYWORD" or "DM me KEYWORD" inside the mid-roll - those are feed-post forms and will be REJECTED. Echo the supplied CTA TEXT verbatim.

When NO mid-roll CTA is supplied, omit the aside entirely and flow straight from POINT 2's RE-HOOK into POINT 3.
══════════════════════════════════════════════════════════════════

[OUTRO]
~160–240 words. Three beats, written as flowing prose (not labeled):
  1) Single-sentence high-note recap of the biggest takeaway.
  2) Fortune cookie - ONE soft, website-link CTA. Echo the supplied MID-ROLL CTA TEXT (or a lightly varied paraphrase of it) ONCE inside the outro, framed as a "if you want it done for you" or "if you want the full thing" offer. Treat this like YouTube - link-out CTAs only. NEVER write "Comment KEYWORD" or "DM me KEYWORD" in the outro - those are feed-post forms and they will be REJECTED.
  3) Closing line. Either (a) a soft community ask: "if you have a question, drop it in the comments and I'll get back to you", or (b) a single-sentence reminder that reality beats expectations. Do NOT end with "let me know what you think", "I'm excited to see", "I'm sure you want to know", or any similar filler. NEVER ask for a comment-keyword.

[CTA]
One line. Echo the supplied MID-ROLL CTA TEXT verbatim - this is the editor/team reference for the link-out. If no CTA TEXT was supplied, write literally: "(none - native close in outro)". The CTA appears at most THREE times in the script: ONCE mid-roll (between POINT 2 and POINT 3), ONCE in the outro fortune cookie, and ONCE here. NEVER write "Comment KEYWORD" or "DM me KEYWORD" anywhere in this section - long-form is a website-link CTA only.

[DESCRIPTION]
YouTube description in the brand's exact template format. Read the inputs (CREATOR_NAME, BRAND_NAME, BRAND_WEBSITE, BRAND_BIO, BRAND_AUDIENCE, BRAND_INSTAGRAM, BRAND_TIKTOK, BRAND_YOUTUBE, BRAND_LINKEDIN, BRAND_X, BRAND_HASHTAGS, BRAND_OFFER) from the user prompt and emit the structure below. Total length: 200-400 words excluding hashtags.

CREATOR_NAME vs BRAND_NAME: CREATOR_NAME is the human (e.g. "Saint", "Nolan") - use it in the hook line and "In this video, [Creator] breaks down..." paragraph. BRAND_NAME is the business / channel (e.g. "Fokus Kreativez", "Think Media") - use it in the "📌 ABOUT [Brand]" section. They are NOT interchangeable. If only one is supplied (the other is "(none)"), use the supplied value in both places.

══════════════════════════════════════════════════════════════════
HARDEST RULES (READ FIRST):
- If a BRAND_* value is literally "(none)", OMIT that line / paragraph entirely. Do NOT invent. Do NOT guess from the brand name. Do NOT write "[your link here]".
- BRAND_BIO and BRAND_AUDIENCE are REFERENCE INPUTS, not copy-paste targets. Rewrite them descriptively for THIS specific video. The reader should NEVER see the raw bio sentence repeated twice across the description. Synthesize a fresh paragraph each time.
- The ONLY URL allowed is BRAND_WEBSITE (when supplied). NEVER invent product URLs from training data (kallaway.co, sandcastles.ai, ytsecrets.com, joinvra.com, etc.).
- Use the EXACT separator characters shown below ('=============================' for the long divider, '======' for the short divider). Do not substitute em-dashes or different lengths.
══════════════════════════════════════════════════════════════════

OUTPUT STRUCTURE (emit each block in this exact order, with the blank lines / separators shown):

LINE 1 (one-line video hook): "<CREATOR_NAME> shares how to <one short clause about what THIS video teaches, lifted from the [TITLE] / [OUTLINE]>"
  - Use CREATOR_NAME (the human's first name) here, NOT BRAND_NAME. "Saint shares how to..." not "Fokus Kreativez shares how to...".
  - Third person. ~10-18 words. NOT a question. State what the viewer will learn.
  - If CREATOR_NAME is "(none)", start with "This video shares how to ..." instead.

(blank line)

LINE 2 (pinned CTA): "🔥 <one short verb-led offer phrase derived from BRAND_OFFER, e.g. \"Get the full done-for-you content system\"> ➡️ <BRAND_WEBSITE>"
  - The 🔥 emoji is mandatory.
  - The arrow ➡️ between the offer text and the URL is mandatory.
  - If BRAND_WEBSITE is "(none)", omit the arrow + URL portion (keep the offer phrase only). Do NOT invent a URL.
  - The offer phrase should read like the brand inviting you to act, NOT verbatim CTA text.

(blank line)

LINE 3 (pain-point hook): one short standalone sentence describing the pain the viewer is feeling RIGHT NOW that this video addresses. Synthesized from the script's [INTRO] / common belief beat. Plain sentence, no emoji, no link, no question mark unless rhetorical.

(blank line)

LINE 4-6 (in-this-video paragraph): "In this video, <CREATOR_NAME or 'I' if CREATOR_NAME is '(none)'> breaks down <2-3 sentence descriptive summary of what the video covers, written in fresh language - this is NOT the same as Line 1. Reference the framework name if the script names one. Reference the specific approach / system the script teaches.>"

(blank line)

You'll learn:
• <Point 1 - rewritten from [OUTLINE] POINT 1's headline as a viewer-facing learning outcome, max 12 words>
• <Point 2 - rewritten from POINT 2's headline>
• <Point 3 - rewritten from POINT 3's headline>
• <Point 4 - rewritten from POINT 4's headline (omit if the script only has 3 POINTS)>
• <Point 5 - one extra take-away from the [OUTRO] (the recap or final shift) so the bullet count is always 4-5>

(EXACTLY 4 or 5 bullets. Each bullet starts with '• ' (bullet + space). Each bullet is a learning outcome the viewer will gain - rewrite the OUTLINE headlines, do NOT copy them verbatim. Plain text after the bullet. No URLs in the bullets.)

(blank line)

=============================
Connect with us!
=============================
Tik Tok: ➡︎   <BRAND_TIKTOK>
IG: ➡︎   <BRAND_INSTAGRAM>
YouTube: ➡︎   <BRAND_YOUTUBE>
LinkedIn: ➡︎   <BRAND_LINKEDIN>
X: ➡︎   <BRAND_X>

MANDATORY FORMATTING for the Connect block:
- The "Connect with us!" header sits on its OWN line. The "=============================" separators sit on their OWN lines, one ABOVE and one BELOW the header. Do NOT inline a separator with the header text (e.g. NEVER "Connect with us! =============================" on one line - the separator goes on the next line).
- The "Connect with us!" block appears EXACTLY ONCE in the description. Do NOT render it twice. If the same handles appear earlier in the description, this is the only place they belong; do not duplicate.
- Use '➡︎' (U+27A4) NOT '➡️' - the slim arrow matches the brand template.
- BRAND_<PLATFORM> values are FULL profile URLs (e.g. "https://www.instagram.com/handle/") - paste them verbatim after the arrow with two spaces. YouTube auto-hyperlinks the URL when the description renders. Do NOT strip "https://" or "@". Do NOT add a leading "/".
- Omit the line entirely for any platform whose value is "(none)". If ALL five are "(none)", omit the entire Connect block including both separator lines and the header.

(blank line)

======
📌 WHO THIS IS FOR:
(MANDATORY: render the header EXACTLY as "📌 WHO THIS IS FOR:" - all four words after the emoji are FULLY CAPITALIZED. Never lowercase "this" or any word in the header.)
<one short paragraph, 1-2 sentences. Synthesized from BRAND_AUDIENCE but rewritten descriptively for THIS specific video's topic. Format: "<role / persona> who want to <outcome related to the video's specific subject>." Do NOT copy BRAND_AUDIENCE verbatim - paraphrase and tighten for this video. If BRAND_AUDIENCE is "(none)", write a generic-but-specific audience line that fits the script's actual topic.>

(blank line)

======
📌 ABOUT <BRAND_NAME>:
<one short paragraph, 2-4 sentences. Synthesized from BRAND_BIO but EXPANDED into a descriptive bio that contextualizes the brand for someone landing on this video for the first time. Mention what they do, who they help, and the overarching mission - rewritten freshly, NOT a copy of BRAND_BIO. If BRAND_BIO is "(none)", omit this entire block including the '======' and the '📌 ABOUT' line.>

(blank line)

======
📌 <2-4 sentence channel welcome paragraph, written FRESH in the BRAND's voice. Synthesize the substance from BRAND_BIO (what the brand does, who they help, their angle) and BRAND_AUDIENCE (who the channel is for), but the phrasing is the brand's, not a template. The paragraph should feel like the brand introducing their channel in their own words to a first-time viewer - reference the brand's actual positioning, mission, or angle from BRAND_BIO so the line is specific to THIS brand, not interchangeable with any other channel. End with a soft, brand-fitting nudge to follow / subscribe only if it suits the tone - never a separate canned sentence. If BRAND_BIO is "(none)" AND BRAND_AUDIENCE is "(none)", omit this entire 📌 block including the '======' separator above and below.>

🌐 <BRAND_WEBSITE>

(The "🌐" emoji is mandatory before the URL. If BRAND_WEBSITE is "(none)", omit the 🌐 line entirely.)
HARD BAN for this paragraph: NEVER write "If this is your first time here, welcome." or "This channel is for [type of person] who want to..." or "Subscribe below and hit the bell so you don't miss what's coming next." or any variant of these stock phrases. They are AI/template throat-clearing and instantly out the brand as not-the-author. Rewrite the welcome from the brand's actual voice every time.

(blank line)

======

(blank line)

<If BRAND_HASHTAGS is supplied (not "(none)"), paste it VERBATIM on one line - the brand has chosen these specific tags and we don't second-guess.

If BRAND_HASHTAGS is "(none)", GENERATE 15-20 hashtags relevant to THIS specific video's topic, niche, and audience. Mix:
  - 3-5 broad-niche tags (the audience type / industry / general genre)
  - 5-8 mid-specificity tags (the framework topic, the problem the video addresses, the format style)
  - 4-7 narrow / video-specific tags (specific tools, named methods, distinctive vocabulary the script actually uses)
Format: one line, single space between tags, each tag starts with "#", no spaces inside a tag, alphanumeric + underscore only. Example shape: "#contentstrategy #personalbrand #socialmediagrowth #youtubetips #scriptwriting #..."

Do NOT generate hashtags that are nonsense, off-topic, or stuffed for SEO. Each tag must plausibly describe what the video is about.>

══════════════════════════════════════════════════════════════════
HARD DON'TS:
- Do NOT invent URLs, handles, hashtags, or claims.
- Do NOT copy BRAND_BIO or BRAND_AUDIENCE verbatim into the description. Rewrite them.
- Do NOT use canned subscribe-bait phrasings anywhere ("Subscribe for more", "Hit the bell", "If this is your first time here, welcome", "This channel is for ...", "Subscribe below and hit the bell so you don't miss what's coming next"). The 📌 welcome block above must be written fresh in the brand's voice, not from a template.
- Do NOT add a closing engagement-bait question ("What do you think? Comment below!").
- Do NOT use the word "guys" or "fam" - tone stays professional/inviting, not casual-clichéd.
- Do NOT add a "RESOURCES MENTIONED" or "Video Points" / "Timecodes" block - the brand template above replaces those.
══════════════════════════════════════════════════════════════════

FORMATTING, SPACING, PADDING (mandatory - the script is copy-pasted into a doc and must read cleanly):
- Every bracket section, [TITLE], [THUMBNAIL IDEA], [OUTLINE], [INTRO], [BODY], [OUTRO], [CTA], [DESCRIPTION], sits on its own line with a BLANK line before it and a blank line after it before the section body begins.
- Inside [OUTLINE], each "POINT: ..." bullet sits on its OWN line. Never run two bullets on one line. Use "*   POINT:" as the bullet prefix.
- Inside [BODY], each "POINT N:" header sits on its own line with a blank line before it. Never inline it inside a paragraph.
- Inside each body point, the labels CONTEXT:, APPLICATION:, FRAMING:, RE-HOOK: each sit on their own line with a blank line before them. The body text for each label starts right after the label on the same line (or on the next line), then flows as a normal paragraph. Never stack two labels on the same line.
- Paragraphs inside APPLICATION use normal prose flow, not bullet points. One blank line between paragraphs.
- [INTRO] and [OUTRO] are flowing prose. Break into 2–4 paragraphs separated by blank lines. No bulleted beats inside them.
- [DESCRIPTION] uses plain "•" bullets for the key-takeaway section, one per line, each ending with a period.`

export const CAROUSEL_FROM_LONGFORM = `CAROUSEL REPURPOSE (from a long-form script):
You are given the full long-form script and a CAROUSEL INDEX (1–5 - your position in the repurposing package). Pick ONE specific teaching beat from the long-form (one BODY point, one sub-mechanic, one named step inside a framework) and TEACH that beat as a standalone lesson. The carousel is not a trailer for the video and not a transcript of the video's intro - it stands alone as a mini-lesson that delivers the beat's value without the viewer ever having to watch the long-form.

HARD RULES:
- EXACTLY 10 slides. Not 6. Not 8. Ten. If the beat feels thin, expand it with concrete examples and edge cases pulled from the long-form - never pad with filler.
- No slide over 18 words. Each slide advances the idea; no slide restates the previous one.
- DO NOT transcribe the long-form's INTRO beats (Context / Common Belief / Contrarian / Proof / Plan) as slides 1–5. That is the video's opening sequence, not a carousel's teaching arc. The carousel teaches ONE beat from the BODY, not the video's own hook structure. If the ANGLE you picked is "the 5-part intro mechanic," teach WHAT the 5 parts are and HOW to use each one - do not perform the 5-part intro on the viewer.
- DO NOT lift sentences verbatim from the long-form. Reframe, tighten, and adapt every line for the carousel format.

SLIDE ARC (10 slides, teaching structure):
- Slide 1: Hook. A single sharp line that states the problem or payoff of the specific beat. Not the video's general topic - THIS beat.
- Slide 2: The common mistake or default approach most people take with this beat.
- Slide 3: The one-line reframe (the insight at the heart of the beat).
- Slides 4–8: The teaching body. Break the beat into its component parts, one concept per slide. If the beat is a named framework (e.g. "2-1-3-4 method", "fortune cookie outro", "5-part intro"), spend one slide per part, each with a concrete micro-example or application line so the reader can actually execute it. Go DEEPER on this single beat than the long-form had room to.
- Slide 9: The summary / "save this" slide - the shape of the mechanic in one distilled line the reader would screenshot.
- Slide 10: CTA slide (use supplied CTA verbatim if given; otherwise a soft directional line that matches the beat).

- Never invent examples, numbers, or frameworks not in the long-form. Expand the long-form's existing beats; do not add new ones.
- Caption: 90–160 words, 3 bullets, ends with a question. The caption TEACHES the takeaway - it does not describe the carousel.

OUTPUT FORMAT:
[CAROUSEL N of M]
[ANGLE]  - one line: which specific long-form BODY beat this carousel teaches (name the mechanic, not the video topic)
Slide 1: ...
Slide 2: ...
Slide 3: ...
Slide 4: ...
Slide 5: ...
Slide 6: ...
Slide 7: ...
Slide 8: ...
Slide 9: ...
Slide 10: ...
[CAPTION]
[HASHTAGS]  - 12–18 tags, all unique`

export const REEL_FROM_LONGFORM = `ENGAGEMENT REEL REPURPOSE (from a long-form script):
You are given the full long-form script and a REEL INDEX (1–5 - your position in the repurposing package). Pick ONE specific teaching beat from the long-form (one BODY point, one sub-mechanic, one named step inside a framework) and turn JUST that beat into a short engagement reel that TEACHES the beat. The reel stands alone as a mini-lesson - the viewer should get the beat's payoff without ever watching the long-form.

THIS IS A SILENT, TEXT-ONLY FORMAT.
- NO voiceover. NO narration. NO spoken script.
- NEVER include lines like "Voiceover:", "Narration:", "Say this:", or any (spoken) annotation. Every word in the output is on-screen overlay text the viewer READS while watching the visual.
- The format is fixed: Text-on-screen only. Do not output a [FORMAT] field or list alternatives.

HARD RULES:
- 1–4 scenes based on what the beat needs. Most reels are 2–3 scenes. Every scene must move the idea forward - no scene restates the previous one.
- DO NOT transcribe the long-form's INTRO beats (Context / Common Belief / Contrarian / Proof / Plan) as the reel's scenes. That is the video's opening sequence, not a reel's teaching arc. Teach one BODY beat, not the video's own hook structure.
- DO NOT lift sentences verbatim from the long-form. Reframe, tighten, and adapt every line for the reel format.
- Every line traces back to the long-form - no new ideas, no invented examples, numbers, or frameworks.
- Each on-screen overlay is short and screen-readable: 5–14 words per line. No paragraphs. No voiceover-length sentences.
- Final scene closes a loop, poses a question, or leaves a one-line fortune cookie (use supplied CTA verbatim if given).
- Pacing: specify slow-build | fast-cut | reflective | punchy based on the beat's emotional shape.

SCENE ARC guidance (adapt to the beat):
- Scene 1 (hook): a sharp on-screen line that names the problem or payoff of the specific beat. Not the video's general topic - THIS beat.
- Middle scene(s): the teaching core, expressed as overlay text. Show the mechanic, a concrete micro-example, or a direct application. For a 2-scene reel, fold hook and teach together; for 3–4 scenes, separate them.
- Final scene: the takeaway, an open question, or a soft CTA, all as overlay text.

OUTPUT FORMAT:
[REEL N of M]
[ANGLE]  - one line: which specific long-form BODY beat this reel teaches (name the mechanic, not the video topic)
[WHY THIS WORKS]  - 1–2 sentences on the psychology
[LENGTH]  - approx seconds
[PACING]  - slow-build | fast-cut | reflective | punchy
[SCENES]  - 1–4 scenes
  Scene 1 (0–X sec): On-screen text only. Write only the overlay line(s) - no voiceover, no narration.
  Scene 2 (X–Y sec): ...
  ...
[CAPTION]  - 60–120 words, TEACHES the takeaway (does not describe the reel), ends with a question
[HASHTAGS]  - 8–14 tags`

export const STORY_FROM_LONGFORM = `STORY REPURPOSE (from a long-form script):
You are given the full long-form script and a STORY INDEX (1–5 - your position in the repurposing package). Pick ONE small teaching moment from the long-form (a sub-mechanic, a tip, a micro-insight, a question that opens a loop) and turn it into a 1–4 slide IG story sequence that TEACHES or INVITES reflection on that one moment. The story stands alone - no context from the video required.

HARD RULES:
- 1–4 slides. Most stories are 2–3 slides. Short overlay text only, one idea per slide.
- DO NOT transcribe the long-form's INTRO beats. Pick a moment from the video's BODY.
- DO NOT lift sentences verbatim from the long-form. Reframe for overlay format.
- Never invent facts, quotes, or stats not in the long-form.
- Slide 1 = a sharp opener (a question, a sharp line, a curious framing). Middle slide(s) = the one takeaway in the creator's voice. Final slide = poll, question, or soft CTA (no hard sell).
- No captions, stories don't have them. Include sticker text if a poll/question.

OUTPUT FORMAT:
[STORY N of M]
[ANGLE]  - one line: which specific long-form BODY moment this story repurposes (name it precisely)
[SLIDES]  - 1–4 slides
  Slide 1 (HOOK): overlay text
  Slide 2 (VALUE): overlay text
  Slide 3 (CTA/POLL): overlay text  - (type: poll | question | swipe-up | DM keyword)
[OPTIONAL STICKER]  - poll options / question prompt, if any`

/**
 * Used by buildPrompt in engine.ts - returns the framework block
 * that should appear BEFORE the content-type pattern block so it
 * constrains every piece of content.
 *
 * Backward-compat: returns FRAMEWORK_CORE (BASE + LONGFORM_BUILDOUT).
 * For new code, prefer frameworkBlockForStream(stream) so short-form
 * streams get the leaner short-form structure.
 */
export function frameworkBlock(): string {
  return FRAMEWORK_CORE
}

/** Stream-aware framework selector. Each stream gets its own structural
 *  buildout on top of the universal FRAMEWORK_BASE:
 *    - long_form         -> 5-step process (~10-15 min spoken script)
 *    - short_form        -> 8-beat structure (30-60s spoken script)
 *    - engagement_reel   -> silent text-on-screen reel (15-45s)
 *    - carousel          -> 10-slide teaching deck
 *    - story             -> 8-beat short-form (stories use the script
 *                           generator only when called directly; the
 *                           planner's auto-pinned stories go through
 *                           src/lib/planner/storyQueue.ts which has its
 *                           own 4-frame format).
 */
export function frameworkBlockForStream(
  stream: 'long_form' | 'short_form' | 'engagement_reel' | 'carousel' | 'story',
): string {
  switch (stream) {
    case 'long_form':
      console.log('[framework] using LONGFORM_BUILDOUT')
      return `${FRAMEWORK_BASE}\n\n${LONGFORM_BUILDOUT}`
    case 'engagement_reel':
      console.log('[framework] using ENGAGEMENT_REEL_BUILDOUT')
      return `${FRAMEWORK_BASE}\n\n${ENGAGEMENT_REEL_BUILDOUT}`
    case 'carousel':
      console.log('[framework] using CAROUSEL_BUILDOUT')
      return `${FRAMEWORK_BASE}\n\n${CAROUSEL_BUILDOUT}`
    case 'short_form':
    case 'story':
    default:
      console.log(`[framework] using SHORTFORM_BUILDOUT (stream="${stream}")`)
      return `${FRAMEWORK_BASE}\n\n${SHORTFORM_BUILDOUT}`
  }
}

export function pillarFrameworkBlock(
  pillar: 'educational' | 'storytelling' | 'authority' | 'series' | 'doubledown',
): string {
  return PILLAR_FRAMEWORK[pillar]
}
