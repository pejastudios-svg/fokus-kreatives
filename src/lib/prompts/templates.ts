// Paste-into-Claude prompt templates for the agency Prompts page. The page
// fills the {BRAND PROFILE} (and, for seed topics, {USED TOPICS}) from the
// selected client, then the agency copies the result into Claude.ai (web
// search on). Kept backtick-free in the bodies so they embed cleanly as TS
// strings; the code fence around the injected profile is added in build().

export type PromptType = 'seed-topics' | 'lead-magnet' | 'research'

export interface PromptCardMeta {
  type: PromptType
  title: string
  description: string
  /** lucide icon name, resolved on the page */
  icon: 'Lightbulb' | 'Magnet' | 'Telescope'
  webSearch: boolean
}

export const PROMPT_CARDS: PromptCardMeta[] = [
  {
    type: 'seed-topics',
    title: '100 Seed Topics',
    description:
      'A bank of owner-voice topic titles spread evenly across the 10 topic axes, deduped against past titles and documented stories. Paste them into the seed field; the form generator writes the 6 questions per topic.',
    icon: 'Lightbulb',
    webSearch: true,
  },
  {
    type: 'lead-magnet',
    title: 'Lead Magnet',
    description:
      "Hormozi-style: recommends one magnet (bridge, names, CTA), then on approval writes the full asset from the owner's question-form answers.",
    icon: 'Magnet',
    webSearch: true,
  },
  {
    type: 'research',
    title: 'Research Brief',
    description:
      'Live web research across three lenses: client deep-dive, competitor landscape, and market + audience language.',
    icon: 'Telescope',
    webSearch: true,
  },
]

const HOUSE_RULES = [
  'House rules (obey on every line):',
  '- No em-dashes or en-dashes. Use a comma or period.',
  "- No \"it's not X, it's Y\" / \"isn't X, it's Y\" pivots in any form.",
  '- No "here\'s the truth/thing", no rhetorical fragment-questions ("the result?", "the catch?"), no AI-tell phrases ("game changer", "let\'s dive in", "what if I told you", "delve", "robust", "seamless", "leverage", "resonate").',
  '- Never invent stats, quotes, clients, or results. Every claim traces to the brand profile or a cited source.',
  "- Use contractions, vary sentence length, plain language. Match the client's voice.traits and address the audience the way voice.address_audience_as says. Avoid any word in voice.forbidden_words.",
].join('\n')

// The 10 canonical topic axes, lifted verbatim from the in-app generator's
// AXIS_DESCRIPTION (src/app/api/question-form/generate/route.ts) so titles
// Claude produces take the exact same shapes the form generator expects.
const AXIS_BLOCK = `THE 10 TOPIC AXES (each title MUST take one of these shapes; spread the bank evenly across all 10):
- transformation: A before/after journey for the owner OR a specific client. Concrete starting state, concrete ending state, what bridged them.
- mistake: A specific thing the owner tried that flopped. Ground in a moment, a name, a number. The lesson is implied; the WAY THEY MISSED IT is the angle.
- industry_myth: A common belief in the niche the owner thinks is wrong. Quote the myth in the audience's exact wording. Surface what the truth actually is.
- hot_take: A contrarian opinion the owner holds and would defend in a debate. Sharp, no hedging. The take itself plus a real case where the mainstream view fails.
- origin: An early-days moment from the owner's path. Time-anchored (e.g., before they had clients, before they raised prices the first time). NOT a generic "how I got started".
- client_win: A specific result the owner produced for a named client (or a vivid description of the client). Numbers, screenshots, before/after, a single deliverable.
- framework_reveal: Surface ONE component of the owner's methodology. The angle is HOW that component works, why most people skip it, and what it looks like in practice.
- pivot: A strategic decision that changed direction. Old approach, what triggered the pivot, new approach, the outcome.
- mentor_lesson: A lesson learned from a specific person - mentor, peer, public figure. Name the person or describe them vividly. Quote or vivid moment required.
- industry_observation: A pattern the owner notices in the niche - across clients, competitors, market shifts. Not a personal story; a meta-observation grounded in their experience.`

// Seed-topics prompt. Output is a TITLE BANK, not posts and not questions:
// each line is an owner-voice topic angle the in-app form generator later
// turns into a 6-question braindump arc. count varies (100 bank by default,
// or the package's monthly count).
function seedTopicsBody(count: number): string {
  const perAxis = Math.max(1, Math.round(count / 10))
  const spread =
    count >= 10
      ? `Spread the ${count} titles as evenly as possible across all 10 axes (about ${perAxis} per axis). Never let one axis dominate.`
      : `Use ${count} different axes, one title each, picking the ${count} that best fit this brand's material.`
  return `You are the lead content strategist at Fokus Kreativez, a content agency. Generate a bank of ${count} SEED TOPIC TITLES for one client. This is a title bank: each title is a short topic angle (4 to 10 words) that our form generator will later expand into a 6-question braindump for the owner to answer. You are NOT writing posts, hooks, captions, or questions here. Just the titles, each tagged with its axis and pillar. Work only from the brand profile below plus live web research. Never invent facts about the business.

WHO THE TITLES ARE ABOUT: the brand's OWNER / FOUNDER / OPERATOR, speaking from their own experience running the business or building their craft. They ARE the brand, never a customer of it. Address them in second person ("you" = the owner). Titles read like:
- "How you stopped chasing clients"
- "The first time you raised your prices"
- "Why your old offer wasn't converting"
- "The hire that nearly broke your agency"
Each title points at ONE specific story, lesson, or take the owner can speak to from real experience. Specific and concrete over clever or generic.

STEP 1 - Research (use web search, 5 to 8 searches): how the audience describes their pains and desires in their own words (forums, Reddit, reviews, comments) - borrow that exact phrasing; what the competitors keep covering (start from the COMPETITOR RESEARCH block below, then extend) - find the gaps; what's being discussed in the niche right now. Note 4 to 6 findings you'll actually use to sharpen the titles.

STEP 2 - Generate the titles by axis. ${spread}

${AXIS_BLOCK}

STEP 3 - Tag each title with a pillar_hint - the best-fit pillar for the topic as a whole. Allowed pillars: educational, storytelling, authority (only these three; do not use any others).

Each title must: take exactly one of the 10 axes above; be a real angle anchored to this owner's business, audience, or your research (never a generic platitude); be distinct from every other title AND from the ALREADY-COVERED TITLES and DOCUMENTED STORIES blocks below (do not repeat, paraphrase, or re-extract those - pick fresh ground); respect off_limits_topics and never_do in the profile.

STEP 4 - Output, ready to paste into the seed field. A numbered list. Put the title FIRST so it copies clean, then its tags in brackets, exactly like:
   1. How you stopped chasing clients  [axis: transformation | pillar: storytelling]
   2. The pricing model that quietly capped your income  [axis: mistake | pillar: educational]
Group nothing; just number 1 to ${count} in a single list, varying the axis as you go so no two neighbours share one. After the list, add a 3 to 4 line note on which profile elements and research findings drove the strongest angles. No preamble before the list.

House rules for the titles: no em-dashes or en-dashes; no "isn't X, it's Y" phrasing; no AI-tell wording ("game changer", "dive in", "the secret to", "unlock", "supercharge"); plain, specific language in the owner's world. Never fabricate a result, client, or number - if the profile doesn't support an angle, pick a different real one.`
}

const LEAD_MAGNET_BODY = `You are a lead magnet strategist who thinks like Alex Hormozi ($100M Leads). You diagnose before you prescribe, back recommendations with logic tied to the client's actual business, and you are direct and specific. No generic "just make a PDF" advice.

The brand profile below already answers the diagnostic questions, so do NOT interrogate the client - read the profile and go to work. Only if a genuinely critical field is missing or contradictory, ask ONE targeted question, then proceed.

Map the profile to the diagnosis: what they sell -> business.signature_offer, problem_solved, differentiation, positioning.market_position (price tier); who they sell to -> audience.* (pain_points, fears, desires, work_roles, hangouts, objections, yes_triggers, tried_failed); goal/next action -> content_strategy.primary_content_goal and desired_action (your CTA must align to this); capacity/style -> final.collaboration_style (tells you if a high-touch services magnet is realistic or if it must be a build-once asset); guardrails -> content_strategy.never_do and legal (the magnet must not violate these).

USE THE OWNER'S REAL MATERIAL: below the profile you'll find a DOCUMENTED ANSWERS block - the owner's own answers from our question form (their scenes, failed attempts, turning points, frameworks, proofs, and opinions). This is their actual method and proof, in their own words, not guesses. It is the spine of the magnet. When you build the asset (Step 6), pull its real substance from here: their real framework steps, their real results and proof, their real stories and phrasing. The "framework" and "proof" answers are the richest source. Only invent structure where the answers don't cover it, and never contradict what they said. If the DOCUMENTED ANSWERS block is empty, build from the profile and research and say plainly that the magnet will be stronger once the question form is filled.

STEP 1 - Research (use web search, 4 to 6 searches): what lead magnets/freebies the competitors and wider niche already offer (start from the COMPETITOR RESEARCH block below, then extend - find what's saturated and what's missing); how the audience describes the specific problem the magnet will solve (their words). Use this so the magnet is differentiated, not a me-too freebie.

STEP 2 - Pick ONE type x ONE mechanism justified by THIS business.
The 3 types: Diagnose (buyer is unaware of the problem or it compounds - a quiz/audit/tool that gives personalized findings that reveal the next problem your offer solves); Trial (product delivers immediate tangible results and the buyer needs to feel the value - free days/session/implementation); One Step (offer is complex with sequential steps and one step is valuable alone - e.g. a strategy workshop that leaves them with clarity).
The 4 mechanisms (match to capacity/audience/price): Software (tool, calculator, quiz, audit - scales, build once); Information (guide, template, checklist - lowest lift, best for authority/solopreneurs); Services (your time - free call/audit/workshop - builds trust fast for high-ticket, does NOT scale); Physical (sample, printed report, workbook - for niches where tangibility sells).
Recommend exactly ONE combination. Do not list all 12. Explain WHY it fits THIS client in 2 to 4 bullets referencing their offer, audience, price tier, and capacity.

STEP 3 - Build the blueprint: the lead magnet (what it is, the narrow problem it completely solves, how it connects to signature_offer); the bridge (how solving this narrow problem surfaces the next problem, which is exactly what the paid offer fixes - if no clean bridge, reshape it); 2 to 3 names to test using the formula [Outcome/Benefit] + [Mechanism], specific over clever, plus a one-line A/B test plan; the CTA (exact next action aligned to desired_action, real urgency only if genuine); distribution (which of the client's actual channels/hangouts and how).

STEP 4 - Quality check, mark pass/fail for each: Complete but narrow (complete value on a narrow problem, not "3 tips", not "build a 7-figure business"); Bridge-break (solving it reveals the next problem -> the paid offer); Quality filter (attracts the right buyer and repels the wrong one; tastes like the paid offer's price and quality); Reputation bar (genuinely useful enough that someone would tell a friend; not bait-and-switch). Fix anything that fails before presenting.

STEP 5 - Present the BLUEPRINT for approval (this is the plan, not the asset yet) in this structure:
   Recommended type: [Type]
   Recommended mechanism: [Mechanism]
   The lead magnet: [clear description]
   Why this combination: [2 to 4 bullets tied to THEIR business]
   Naming options to test: A / B / C, plus how to test
   The bridge: [narrow problem solved -> next problem -> their paid offer]
   CTA: [exact action, aligned to desired_action]
   Distribution: [their channels, specific tactics]
   Quality check: each of the 4 tests with pass/fail and a note
Then ask exactly: "Approve this, or want me to adjust the type/mechanism, names, or bridge? Once you approve, I'll build the full magnet, ready to drop into a PDF or Canva."

STEP 6 - On approval, BUILD THE ACTUAL LEAD MAGNET - the finished asset the audience receives, fully written, no placeholders and no "you could add..." hand-waving. Pull the substance from the DOCUMENTED ANSWERS wherever it fits (the owner's real framework steps, real proof, real stories and phrasing), and only fill genuine gaps with your own expertise without contradicting them. Produce the real content for the chosen type x mechanism:
   - Information (guide/template/checklist): write every section in full, with worked examples and any fill-in templates completed once as a sample. If it's a framework, explain each part and show it applied to one real example.
   - Diagnose (quiz/audit/tool): write the actual questions, the answer options, the scoring logic, and the personalized result blurbs for each outcome.
   - Trial / Services (call/session/workshop): write the session outline, what they walk away with, the booking-page copy, and the exact steps you deliver.
   - Physical (sample/report/workbook): write the full text of the printed piece.
   Wrap it with a short title page (the chosen name + the one-line promise + who it's for) and a closing page (the CTA from the blueprint + a soft line bridging to the paid offer). Format it cleanly with headings so it pastes straight into a doc or Canva. Apply the house rules to every line.

STEP 7 - Save the finished magnet to a Google Doc titled "[Client business name] - [Chosen magnet name] - [Month Day, Year]". If no Google Docs/Drive connector, output the full magnet as clean copy-ready markdown and say the connector isn't available. It's a bridge, not the main event, so keep it tight and genuinely useful, don't pad it.

${HOUSE_RULES}`

// Appended to the lead-magnet prompt when scoped to a SINGLE topic. Narrows the
// whole-business framing above into "build ONE magnet from this topic's method",
// with a qualification gate (skip topics that only describe an outcome/service)
// and a topical DM keyword so multiple magnets don't all share one keyword.
const LEAD_MAGNET_PER_TOPIC = `
## PER-TOPIC MODE (read this AFTER the steps above - it narrows them)
The DOCUMENTED ANSWERS below are ONE topic's braindump, not the whole business. Work from THIS topic only:
- The magnet's substance comes from THIS topic's [framework] and [proof] answers. Do NOT pull in other topics or invent a method the answers don't contain.
- QUALIFY FIRST. A magnet needs a complete-but-narrow, teachable method. If this topic's answers only give an outcome, a mindset, or a description of your service ("we do X for you", "30 days of content in a day") with no real step-by-step the audience could follow, do NOT force a magnet. Say plainly that this topic isn't magnet-ready, name the ONE missing piece (a concrete method/steps) that would make it one, and stop.
- If it qualifies, produce ONE magnet from this topic. Produce a SECOND only if the topic clearly splits into two genuinely distinct deliverables (different asset, different narrow problem) - otherwise one is correct.
- Still bridge to the client's signature offer: this magnet is top-of-funnel for the same paid offer.
- End with a suggested DM KEYWORD: one short, uppercase, on-topic word (e.g. BATCH, CAMERA, GEAR) the audience comments/DMs to get it - never a generic word like FRAMEWORK.`

const RESEARCH_BODY = `You are a research analyst at Fokus Kreativez, a content agency. Produce a research brief on one client so the team can position them sharply and generate content that wins. Do LIVE web research - real competitor content, real market signals, real audience language - not opinions. Every non-obvious claim cites a source (link or where you found it). Treat the brand profile below as the starting hypothesis, not gospel: confirm, sharpen, or challenge it with what you find online.

Run the research in three lenses.
LENS A - Client deep-dive (synthesis): the one-line positioning the client is actually best placed to own (from differentiation, signature_offer, positioning, and what the market leaves open); strengths to lean on and gaps/risks (where the profile is thin, vague, or contradicts market reality); the wedge - the specific, defensible angle competitors can't easily copy.
LENS B - Competitor research (web search): START from the COMPETITOR RESEARCH block below (our saved analyzer notes) and the profile's competitors[] - treat those as known, then verify and extend them with live search. Look up every named competitor and find 2 to 4 more real ones in the niche. For each, capture what they post about, their hooks/formats, their offers and lead magnets, what they do well, and where they're weak or repetitive. Output a short table: Competitor | What they own | Where they're weak | Gap the client can take. End with the 3 clearest openings nobody owns well.
LENS C - Market and audience research (web search): where the audience actually hangs out and what they're saying (forums, Reddit, YouTube comments, reviews, search-suggest) - pull direct quotes of how they describe pain_points, fears, desires, objections in their exact words; current demand signals and trends in the niche this month/year (what's rising, what's fatigued, recurring questions); any shifts (platform, regulation, seasonality) worth knowing.

STEP 1 - Search plan: run 10 to 16 targeted searches across the three lenses (substitute the niche, audience, and each competitor). Keep a running list of findings you'll actually use, each with its source.

STEP 2 - Write the brief for approval, in plain human language:
   1. Positioning in one line
   2. Client deep-dive - strengths, gaps, the wedge
   3. Competitor landscape - the table + the 3 clearest openings
   4. Audience in their own words - quoted pain/desire/objection language (with sources)
   5. Market signals - what's rising / fatigued / shifting (with sources)
   6. So what - the 5 sharpest content angles this research unlocks, and the 1 lead-magnet idea it points to (these feed the seed-topic and lead-magnet prompts)
   7. Sources - every link used
Then ask: "Want me to dig deeper on any competitor, lens, or angle before I save this to a Google Doc?"

STEP 3 - On approval, save to Google Doc titled "[Client business name] - Research Brief - [Month Day, Year]" with the final brief (all 7 sections, sources included). If no Google Docs/Drive connector, output clean copy-ready markdown and say so. If you can't verify something, say so rather than asserting it.

${HOUSE_RULES}`

// The two static prompts. seed-topics is built per-call via seedTopicsBody()
// since its body depends on the requested count.
const STATIC_BODIES: Record<'lead-magnet' | 'research', string> = {
  'lead-magnet': LEAD_MAGNET_BODY,
  research: RESEARCH_BODY,
}

const FENCE = '```'

export const DEFAULT_SEED_COUNT = 100

interface BuildInput {
  type: PromptType
  /** The client's brand_profile as pretty JSON (or a written summary). */
  brandProfileText: string
  /** seed-topics: how many titles to generate (bank of 100, or monthly count). */
  count?: number
  /** seed-topics dedup: titles the brand has already had in past batches. */
  existingTitles?: string[]
  /** seed-topics dedup: short excerpts of stories the owner already documented. */
  existingAnswers?: string[]
  /** lead-magnet: the owner's real answers from the question form (typed),
   *  used as the asset's source material. */
  formAnswers?: FormAnswer[]
  /** lead-magnet scope. 'topic' narrows the prompt to build ONE magnet from a
   *  single topic's braindump (qualify-first, suggest a keyword); 'form'/'all'
   *  keep the whole-business framing. Default 'all'. */
  leadMagnetScope?: 'topic' | 'form' | 'all'
  /** Saved competitor analyzer notes (clients.competitor_insights). Injected
   *  into all three prompts so Claude builds on real research, not a blank. */
  competitorInsights?: string
}

export interface FormAnswer {
  input_type?: string
  question?: string
  answer: string
}

function block(label: string, lines: string[], emptyNote: string): string {
  const body = lines.length ? lines.map((l) => `- ${l}`).join('\n') : emptyNote
  return `\n## ${label}\n${FENCE}\n${body}\n${FENCE}\n`
}

function competitorBlock(insights?: string): string {
  const text = insights?.trim()
  if (!text) return ''
  // Cap so a long-accumulating insights blob can't blow up the prompt.
  const capped = text.length > 8000 ? `${text.slice(0, 8000)}\n...(truncated)` : text
  return `\n## COMPETITOR RESEARCH (saved notes from our competitor analyzer - real research, use it; verify and extend it, don't ignore it)\n${FENCE}\n${capped}\n${FENCE}\n`
}

function formAnswersBlock(answers: FormAnswer[]): string {
  if (!answers.length) {
    return `\n## DOCUMENTED ANSWERS (from the question form)\n${FENCE}\nNone on file yet. Build from the profile and research, and note that the magnet will be sharper once the owner has filled out the question form.\n${FENCE}\n`
  }
  const lines = answers.map((a) => {
    const tag = a.input_type ? `[${a.input_type}] ` : ''
    const q = a.question ? `${a.question.trim()} -> ` : ''
    return `- ${tag}${q}${a.answer.trim()}`
  })
  return `\n## DOCUMENTED ANSWERS (the owner's real material from our question form - their actual stories, frameworks, and proof; this is the spine of the magnet)\n${FENCE}\n${lines.join('\n')}\n${FENCE}\n`
}

export function buildPrompt({
  type,
  brandProfileText,
  count = DEFAULT_SEED_COUNT,
  existingTitles = [],
  existingAnswers = [],
  formAnswers = [],
  competitorInsights = '',
  leadMagnetScope = 'all',
}: BuildInput): string {
  if (type === 'seed-topics') {
    let out = seedTopicsBody(count)
    out += `\n\n## BRAND PROFILE\n${FENCE}json\n${brandProfileText.trim()}\n${FENCE}\n`
    out += competitorBlock(competitorInsights)
    out += block(
      'ALREADY-COVERED TITLES (do NOT repeat or paraphrase any of these - pick fresh angles)',
      existingTitles,
      'none yet',
    )
    out += block(
      "DOCUMENTED STORIES (the owner has already answered these - do NOT design titles that re-extract any of them, even reworded)",
      existingAnswers,
      'none yet',
    )
    return out
  }

  let out = STATIC_BODIES[type]
  out += `\n\n## BRAND PROFILE\n${FENCE}json\n${brandProfileText.trim()}\n${FENCE}\n`
  out += competitorBlock(competitorInsights)
  if (type === 'lead-magnet') {
    out += formAnswersBlock(formAnswers)
    if (leadMagnetScope === 'topic') out += LEAD_MAGNET_PER_TOPIC
  }
  return out
}
