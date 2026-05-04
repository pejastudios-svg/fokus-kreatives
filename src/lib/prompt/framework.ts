/**
 * Script-writing framework extracted from the reference transcript.
 * Applies to every piece of content (long, short, carousel, reel, story).
 */

export const FRAMEWORK_CORE = `FRAMEWORK - EXPECTATIONS vs REALITY (EVR):
Every viewer shows up with expectations set by the title/hook. Your job is to make the reality BEAT those expectations. If reality ≥ expectations, they stay. If reality < expectations, they bounce. Every sentence is a tiny EVR event.

ABSOLUTE SOURCE RULE (read this twice):
The CLIENT BRAINDUMP provided by the user is the SOURCE OF TRUTH. Every body point, every framework, every example, every claim in the script MUST come from the braindump (or from the supplied CLIENT CONTEXT block). You are expanding the braindump into a full script - you are NOT writing a fresh essay on the same topic. If the braindump names a specific framework, technique, order, or example, the script TEACHES that exact thing, with that exact vocabulary. Never replace the braindump's ideas with generic content-marketing advice. If the braindump is thin, keep the script shorter - do not fabricate filler points to hit a length.

VOCABULARY FIDELITY:
Any named framework, method, or step in the braindump (examples: "2-1-3-4 method", "value loop", "context / application / framing", "fortune cookie outro", "5-part intro", "re-hook", "native CTA", specific numbered sequences) MUST appear VERBATIM in the script where it's taught, and MUST be taught as its own mechanic, not merely namedropped. If the braindump explains WHY a mechanic works (e.g. "second-best first because it builds anticipation"), teach the WHY directly, not in paraphrase.

FRAMING FIDELITY:
If the SOURCE QUESTION primes a direction (e.g. "a month of content") but the braindump actually describes a DIFFERENT mechanic (e.g. a script-writing pattern), follow the BRAINDUMP, not the question. The question is context; the braindump is the spine. Do not blend the two into a vague hybrid - teach what's actually in the braindump and let the framing bend to fit it.

FIVE WRITING STEPS (in this order, always):
1) PACKAGING - idea (the pain point or rabbit-hole), title (curiosity loop), loose thumbnail concept. The first lines of the intro must CLICK-CONFIRM the title and ideally beat the expectation it sets.
2) OUTLINE - bulleted UNIQUE points only, all extracted from the braindump. For each point layer: WHAT it is, WHY it matters, HOW it fits the story. The OUTLINE point count MUST equal the BODY point count (if you want 4 body points, the outline has 4 points, and vice versa). If the braindump only supports 3 points, make the outline 3 - do not pad.
3) INTRO (5 parts, in this order, d and e interchangeable):
   a) IMMEDIATE CONTEXT - directly echo and confirm the title in the first 2–3 lines.
   b) COMMON BELIEF - state the conventional take on the topic (so they feel seen).
   c) CONTRARIAN TAKE - flip it. "But here's what actually works / the real answer."
   d) PROOF - one credibility beat that earns the next minute. PROOF MUST come from the braindump or CLIENT CONTEXT. If no real proof is supplied, OMIT the proof beat entirely rather than fabricate one. Never invent clients, results, numbers, case studies, or "I've worked with…" claims.
   e) PLAN - ordered list of what's coming (points/steps). Opens curiosity loops.
4) BODY - the 2-1-3-4 METHOD. Internally RANK your points by strength (#1 = strongest, #2 = second-strongest, #3 and #4 the rest). Then DELIVER them in this order: #2 → #1 → #3 → #4. But in the OUTPUT, relabel them sequentially as they appear: the first point delivered is called POINT 1, the second POINT 2, and so on. NEVER output "POINT 2" before "POINT 1" - the numbering is output order, not strength rank. The strength-reorder is internal choreography; the labels match reading order. Each point uses the VALUE LOOP:
   - CONTEXT (the what - one clear sentence)
   - APPLICATION (the how - concrete example the viewer can copy, drawn from the braindump)
   - FRAMING (the why - zoom out, connect to the bigger story)
   RE-HOOK between points: a 1-line tease that forces them into the next point. EVERY point except the last one has a re-hook. The final body point has NO re-hook; it flows straight into the outro.
5) OUTRO - FORTUNE COOKIE (mandatory schema):
   - Line 1: one-sentence high-note recap of the single biggest takeaway.
   - Line 2: one subtle tool / tip / freebie / resource the viewer can act on right now. This is the "fortune cookie" itself. If a CTA was supplied, this IS where you place it (softly). If no CTA was supplied, reference a lightweight tool or next-step the braindump implies - no hard sell.
   - Line 3: a closing line that reminds them reality beat expectations and invites a rewatch/share. Do NOT end with "let me know what you think" or any variant.

NATIVE CTA EMBED (when a CTA is required):
The CTA must be woven into the body point it naturally solves AS WELL AS reappearing in the fortune-cookie outro. Open with a pain point → offer the resource as the fix → move on. No "but first" pitches. No disruption. The viewer should barely notice it was a CTA.

SCROLL-STOP PRINCIPLE:
Every hook and every re-hook must pass: (1) pattern interrupt in first 3 words, (2) a specific concrete detail (lifted from the braindump whenever possible), (3) creates tension the viewer must resolve.

DO NOT:
- Invent frameworks, numbers, clients, examples, or quotes not in the braindump or CLIENT CONTEXT.
- Replace the braindump's specific ideas with generic content-marketing advice.
- Output body points whose labels contradict reading order (never "POINT 2" before "POINT 1").
- Let outline point count differ from body point count.
- Skip the fortune-cookie schema in the outro.
- Tack the CTA onto the end as a standalone line; it must live inside a body point AND the outro.
- Use em dashes anywhere. If you need a pause, use a comma or a period.
- Skip the common-belief beat; without it, the contrarian take has nothing to push against.
- Use the "this isn't X, it's Y" construction in any form ("this isn't just a X, it's a Y", "that's not just X, it's Y", "it's not X, it's Y", semicolon or period variants). Say the positive claim directly: "this is a Y", "Y is what matters". No negation-then-pivot framing anywhere.
- Use meta-writing vocabulary in the SPOKEN script - words like "click-confirm", "pattern interrupt", "hook stack", "scroll-stop", "curiosity loop", "re-hook" are behind-the-scenes instructions to the writer, not lines the audience should hear. Named creator-framework terms the braindump actually teaches (e.g. "2-1-3-4 method", "fortune cookie outro", "value loop") ARE allowed because they are the taught concepts.`

export const PILLAR_FRAMEWORK: Record<
  'educational' | 'storytelling' | 'authority' | 'series' | 'doubledown',
  string
> = {
  educational: `PILLAR VOICE - EDUCATIONAL: friendly coach / excited nerd sharing a discovery. Not a lecturer. Still runs the full 5-step framework.`,
  storytelling: `PILLAR VOICE - STORYTELLING: friend ranting about a specific moment. Scene → feeling → realization. The INTRO's "common belief → contrarian" becomes "what I thought → what actually happened". The BODY beats are story beats in 2-1-3-4 order.`,
  authority: `PILLAR VOICE - AUTHORITY: coach with proof. Confident diagnosis. Proof beat in the intro is heavier. Body points are frameworks/case studies, still 2-1-3-4 ordered.`,
  series: `PILLAR VOICE - SERIES: this is part of an ongoing arc. Open with "Day N." - no "welcome back", no recap. Intro still runs directly echo and confirm → contrarian → plan, scoped to today's piece. Outro teases tomorrow's specific beat, not a vague "see you next time".`,
  doubledown: `PILLAR VOICE - DOUBLE DOWN: take the reference script's STRUCTURE and RHYTHM (sentence count, pause points, beat shapes) and swap the subject. Keep the 2-1-3-4 order implicit in the reference. Never copy wording.`,
}

/**
 * Long-form structure modeled on the reference transcript's 5-step process.
 * ~10-15 min, 1200-2000 words of actual script (not a full transcript).
 */
export const LONGFORM_FRAMEWORK = `LONG-FORM STRUCTURE (YouTube long-form, 10–15 minute video). Target 1800–2800 words of actual spoken script across INTRO + BODY + OUTRO. Do NOT pad - hit this range by going DEEPER on each braindump beat (more concrete examples, more specific language the creator actually used, more scenes). If you cannot hit the length from the braindump alone, zoom in on details from it; never invent.

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
~180–260 words. Five beats in order (d and e interchangeable):
  a) IMMEDIATE CONTEXT - directly echo and confirm the title in the first 2–3 lines.
  b) COMMON BELIEF - the conventional take people hold on this topic.
  c) CONTRARIAN TAKE - flip it. "But here's what actually works."
  d) PROOF - one credibility beat. ONLY include if supplied by braindump/CLIENT CONTEXT. Otherwise skip entirely and glue c→e.
  e) PLAN - state the ordered points that are coming.
Write this as flowing spoken prose, not labeled beats. No bullet points inside [INTRO].

[BODY]
Same N points as the outline (N is 3 or 4; never more). 2-1-3-4 DELIVERY ORDER: internally rank the braindump points by strength (#1 = strongest, #2 = second-strongest, #3 and #4 the rest), then DELIVER in the order #2 → #1 → #3 → #4. For a 3-point script, deliver #2 → #1 → #3. HOWEVER, in the OUTPUT, RELABEL each point sequentially. The first point you deliver is POINT 1, the second is POINT 2, and so on. Never write "POINT 2" before "POINT 1". The strength-reorder is internal choreography; the label numbers match reading order.

WORKED EXAMPLE of the relabel discipline (4 points):
  If your strongest braindump beat is "Beat-B" and your second-strongest is "Beat-A", your output labels look like this:
  POINT 1, Beat-A headline    (internally your #2-strongest)
  POINT 2, Beat-B headline    (internally your #1-strongest)
  POINT 3, Beat-C headline
  POINT 4, Beat-D headline
  The labels go 1, 2, 3, 4. The STRENGTH is reordered, not the numbers.

Per-point format is mandatory - every point MUST emit all four labels in this exact order, each on its own line with a blank line before it. Target 400–650 words per point, deeper for the strongest one:

  POINT N: [headline pulled from braindump, using the braindump's own vocabulary]

  CONTEXT: 2–3 sentences naming what it is. Use the creator's exact words for any named framework or mechanic.

  APPLICATION: 6–10 sentences walking through the concrete example from the braindump. If the braindump gives a specific sequence, steps, or example, TEACH it step by step in that exact order. Quote or lightly rephrase the braindump's own lines where they land. If the braindump explains WHY a step works ("this ensures they stay to the end", "so they feel like if this advice is this good I wonder what the next one will be"), teach that WHY directly.

  FRAMING: 2–3 sentences zooming out to why this specific mechanic matters for the viewer's real problem. Never skip this label; never merge it into APPLICATION. It always appears, even if short.

  RE-HOOK: 1 sentence tease pulling into the next point. Omit the RE-HOOK label entirely on the FINAL point (the final point flows straight into the outro).

[OUTRO]
~120–180 words. Three beats, written as flowing prose (not labeled):
  1) Single-sentence high-note recap of the biggest takeaway.
  2) Fortune cookie - ONE soft offer: name a tool, tip, resource, template, or freebie the viewer can pick up. If a CTA was supplied, this IS where you embed it, naturally, ONCE. Do not repeat the CTA across multiple sentences.
  3) Closing line that reminds them reality beat expectations. Do NOT end with "let me know what you think", "I'm excited to see", "I'm sure you want to know", or any similar filler.

[CTA]
One line. If a CTA was supplied, echo the exact supplied text here - for the editor/team to see. If none was supplied, write literally: "(none - native close in outro)". The CTA must appear ONCE inside the relevant body point, ONCE inside the outro fortune cookie, and ONCE here - that's it. Three occurrences total, max.

[DESCRIPTION]
YouTube description. 180–320 words. This is NOT an Instagram caption. Structure:
  • Opening hook paragraph (2–4 sentences) - what the video is about and who it's for.
  • Key takeaways - 3–5 short bullet lines, each one a concrete beat from the script.
  • Resource / CTA line - single line linking to the supplied CTA resource (or "Resource in the comments." if no CTA).
  • Closing line - one sentence inviting a rewatch/share, not a question-bait prompt.
NO hashtags. YouTube long-form descriptions don't carry hashtags in the body.

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
 */
export function frameworkBlock(): string {
  return FRAMEWORK_CORE
}

export function pillarFrameworkBlock(
  pillar: 'educational' | 'storytelling' | 'authority' | 'series' | 'doubledown',
): string {
  return PILLAR_FRAMEWORK[pillar]
}
