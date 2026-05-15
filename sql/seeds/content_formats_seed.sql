-- =============================================================================
-- Format library seed.
--
-- Seeds public.content_formats with 35 rows: 19 short_form, 6 engagement_reel,
-- 5 carousel, 5 story. Idempotent via ON CONFLICT (slug) DO UPDATE so the seed
-- can be re-run after edits without losing references.
--
-- Source spec: docs/content_planner_buildout.md sections 9.1 and 13.
--
-- target_length_min / target_length_max units:
--   short_form, engagement_reel - seconds
--   carousel                    - slide count
--   story                       - frame count
--
-- Mad-libs are spoken-cadence references, NOT fill-in-the-blank templates.
-- promptBlock.ts tells the AI to match their rhythm, never copy them verbatim.
-- =============================================================================

INSERT INTO public.content_formats (
  slug, content_type, name, description, starting_point,
  strategy_beats, secret_sauce, mad_libs, gating_rule,
  pillar, bucket, target_length_min, target_length_max,
  cooldown_posts, sort_order
) VALUES

-- ---------------------------------------------------------------------------
-- SHORT-FORM (19)
-- ---------------------------------------------------------------------------

-- 1. Hero's Journey
(
  'short_form.heros_journey', 'short_form',
  $n$Hero's Journey$n$,
  $d$1st person POV transformation arc, problem to solution. The viewer emotionally relates to the pain so they stay for the solution.$d$,
  $sp$A core problem the creator faced + the solution that finally worked + the result that came from it.$sp$,
  $j$[
    {"label":"HOOK","description":"pattern interrupt establishing the problem"},
    {"label":"INTRO","description":"establish the hero (you) and the problem"},
    {"label":"INFLECTION","description":"pain points / lowest moment"},
    {"label":"RISING ACTION","description":"failed solutions you tried"},
    {"label":"CLIMAX","description":"the solution that finally worked"},
    {"label":"FALLING ACTION","description":"the result you saw"},
    {"label":"RESOLUTION","description":"optional CTA tying back to the offer"}
  ]$j$::jsonb,
  $ss$The viewer must FEEL the pain. If they don't relate to your before-state, they don't care about your solution. Specificity over polish.$ss$,
  $j$[
    {"beat":"HOOK","lines":["X years ago I [insert problem you were experiencing].","I was a [role] struggling with [problem], and I had no clue how to fix it."]},
    {"beat":"INFLECTION","lines":["It got so bad that I [lowest moment]."]},
    {"beat":"RISING ACTION","lines":["I tried [#1], [#2], and [#3]. Nothing worked."]},
    {"beat":"CLIMAX","lines":["Then I figured out the one thing that actually worked. [Solution]."]},
    {"beat":"FALLING ACTION","lines":["Within [timeframe] I went from [before] to [after]."]},
    {"beat":"RESOLUTION","lines":["Now I help [audience] do the same. [CTA]."]}
  ]$j$::jsonb,
  $g$Skip if the brand has no specific transformation arc with concrete before/after. A vague "I struggled, then I figured it out" without a named solution is too thin.$g$,
  'storytelling', 'storytelling', 45, 60, 10, 1
),

-- 2. Personal Learning / Epiphany
(
  'short_form.personal_learning', 'short_form',
  $n$Personal Learning / Epiphany$n$,
  $d$Lead with proof, then teach how the result was achieved. Reverse-engineer from the win.$d$,
  $sp$A specific result with visible proof (screenshot, number, outcome) + the non-obvious insight that produced it.$sp$,
  $j$[
    {"label":"HOOK","description":"lead with the result or proof"},
    {"label":"BACKSTORY","description":"brief context on where you were before"},
    {"label":"INSIGHT","description":"the realization that changed it"},
    {"label":"BREAKDOWN","description":"how you applied the insight (steps)"},
    {"label":"CTA","description":"bridge to action"}
  ]$j$::jsonb,
  $ss$Strong visible proof creates the curiosity hook ("how did they do that?"). The solution must be non-obvious - if it's "I worked harder," the proof loses its weight.$ss$,
  $j$[
    {"beat":"HOOK","lines":["I [impressive result] in [timeframe]. Here's exactly how.","[Screenshot]. Everyone keeps asking me how I did this."]},
    {"beat":"BACKSTORY","lines":["Before this, I was [previous state] and I thought [old belief]."]},
    {"beat":"INSIGHT","lines":["Then I realized [realization] and that changed everything.","The mistake I was making was [mistake]. The fix was [fix]."]},
    {"beat":"BREAKDOWN","lines":["Here's exactly what I did. First [step 1], then [step 2], finally [step 3]."]},
    {"beat":"CTA","lines":["Comment LEARN if you want the full breakdown."]}
  ]$j$::jsonb,
  $g$Skip if the result isn't quantifiable or specific. "Things are going great" doesn't work - needs a number, screenshot, or named outcome.$g$,
  'authority', 'educational', 30, 50, 5, 2
),

-- 3. About Me / Origin Story
(
  'short_form.about_me', 'short_form',
  $n$About Me / Origin Story$n$,
  $d$Personal backstory explaining the WHY behind the brand. Pinned-to-profile fodder. Builds personal trust, not professional expertise.$d$,
  $sp$Where you were before (normal life), what changed, the why driving the brand now.$sp$,
  $j$[
    {"label":"HOOK","description":"pull from hook bank"},
    {"label":"INTRO","description":"context on normal life"},
    {"label":"CONFLICT","description":"what set you on this path"},
    {"label":"EPIPHANY","description":"the realization"},
    {"label":"CHANGE","description":"the action you took"},
    {"label":"PURPOSE","description":"the deeper why"}
  ]$j$::jsonb,
  $ss$Don't sell. This is parasocial fuel - the audience comes away knowing who you are, not what you sell. The CTA is the brand existing, not a product.$ss$,
  $j$[
    {"beat":"HOOK","lines":["Hi I'm [name]. [X years] ago I was a normal [role] living a normal life."]},
    {"beat":"CONFLICT","lines":["Then [trigger event] happened, and I couldn't ignore it anymore."]},
    {"beat":"EPIPHANY","lines":["That moment made me understand [realization]."]},
    {"beat":"CHANGE","lines":["So I [bold action]. Fast forward to today and I've [current result]."]},
    {"beat":"PURPOSE","lines":["Now everything I do is about helping [who] achieve [what] without [common pain]."]}
  ]$j$::jsonb,
  $g$Skip if the brand has already published 2+ origin stories in the last 30 posts. This format saturates fast.$g$,
  'storytelling', 'storytelling', 45, 60, 14, 3
),

-- 4. Before & After
(
  'short_form.before_after', 'short_form',
  $n$Before & After$n$,
  $d$Two contrasting states with a dramatic reveal. Format relies entirely on the gap.$d$,
  $sp$Two contrasting states with a measurable, visible gap between them.$sp$,
  $j$[
    {"label":"HOOK","description":"tease the transformation"},
    {"label":"BEFORE","description":"show the starting point"},
    {"label":"TRANSITION","description":"visual cut synced to audio"},
    {"label":"AFTER","description":"reveal the result"},
    {"label":"CONTEXT","description":"brief note on time/effort (optional)"},
    {"label":"CTA","description":"drive next action (optional)"}
  ]$j$::jsonb,
  $ss$Bigger gap = bigger watch time. The cut must be sharp and synced to audio. Best Before&Afters are 15-30s - explanation kills it.$ss$,
  $j$[
    {"beat":"HOOK","lines":["[X months] of [effort] in [X seconds].","Watch this transformation."]},
    {"beat":"BEFORE","lines":["This is where I started. [Before state].","[X years] ago, this was my reality."]},
    {"beat":"AFTER","lines":["And this is where I am now.","[X months] later."]},
    {"beat":"CONTEXT","lines":["[X months] of [effort]. Worth every second."]},
    {"beat":"CTA","lines":["Want to see how I did it? [CTA]."]}
  ]$j$::jsonb,
  $g$Skip if the gap isn't measurable or visible. A vague "things are better now" without a screenshot, number, or visual contrast doesn't land.$g$,
  'authority', 'proof_community', 15, 30, 7, 4
),

-- 5. Goal / Dream Journey
(
  'short_form.goal_journey', 'short_form',
  $n$Goal / Dream Journey$n$,
  $d$Long-held dream + where you are on the path. Open-ended, ongoing pursuit. Audience invited to follow along.$d$,
  $sp$A long-term goal that's genuinely unfinished, with vulnerable moments about whether you'll make it.$sp$,
  $j$[
    {"label":"HOOK","description":"pull from hook bank"},
    {"label":"INTRODUCE DREAM","description":"origin of the goal"},
    {"label":"PURSUIT","description":"when you started taking it seriously"},
    {"label":"PROGRESS","description":"where you are now"},
    {"label":"CTA","description":"invite participation"}
  ]$j$::jsonb,
  $ss$The goal must feel ambitious enough that the audience genuinely wonders if you'll achieve it. Vulnerable moments about doubt make this format land.$ss$,
  $j$[
    {"beat":"INTRODUCE DREAM","lines":["For as long as I can remember, I've wanted to [dream]."]},
    {"beat":"PURSUIT","lines":["Then [X weeks/months] ago, I finally stopped talking about it and [first action]."]},
    {"beat":"PROGRESS","lines":["Here's where I'm at. I've [progress]. Next I need to [next step]. Deadline is [date]."]},
    {"beat":"CTA","lines":["I'm going to document the whole thing. Follow along and hold me accountable."]}
  ]$j$::jsonb,
  $g$Skip if the goal is already achieved or fake-ambitious. The audience can smell a manufactured journey.$g$,
  'storytelling', 'storytelling', 45, 60, 14, 5
),

-- 6. Challenge
(
  'short_form.challenge', 'short_form',
  $n$Challenge$n$,
  $d$A bounded mission with rules and a deadline. Mission completed (or actively completing).$d$,
  $sp$A specific challenge with stated rules + obstacles + a clear outcome or cliffhanger.$sp$,
  $j$[
    {"label":"HOOK","description":"state the challenge and stakes"},
    {"label":"RULES","description":"the constraints"},
    {"label":"JOURNEY","description":"plot arc with obstacles"},
    {"label":"RESOLUTION","description":"outcome OR cliffhanger"}
  ]$j$::jsonb,
  $ss$The challenge must be ambitious + the obstacles must be specific. "I tried to write 30 posts in 30 days" isn't a challenge unless something almost made it fail.$ss$,
  $j$[
    {"beat":"HOOK","lines":["I gave myself [X days] to [challenge]. No shortcuts."]},
    {"beat":"RULES","lines":["Rules. [#1], [#2], [#3]."]},
    {"beat":"JOURNEY","lines":["Day [X]. [Setback or progress]. Things were [going well / falling apart] because [reason]."]},
    {"beat":"RESOLUTION","lines":["Final result. I went from [start] to [end] in [timeframe].","And with [X hours] left... [cliffhanger]. Follow for part 2."]}
  ]$j$::jsonb,
  $g$Skip if the challenge has no real obstacles. A challenge that went smoothly isn't a challenge.$g$,
  'storytelling', 'storytelling', 45, 60, 10, 6
),

-- 7. Win / Victory Announcement
(
  'short_form.win', 'short_form',
  $n$Win / Victory Announcement$n$,
  $d$A specific achievement, celebrated with proof. Distinct from Personal Learning (which teaches backward) - Wins celebrate forward.$d$,
  $sp$A specific, recent achievement with visible proof.$sp$,
  $j$[
    {"label":"HOOK","description":"state the win"},
    {"label":"PROOF","description":"show evidence"},
    {"label":"EMOTIONAL BEAT","description":"what it means"},
    {"label":"ACKNOWLEDGMENT","description":"brief journey nod (optional)"},
    {"label":"CTA","description":"channel the energy forward (optional)"}
  ]$j$::jsonb,
  $ss$Proof must be undeniable and visual - a screenshot, a notification, a physical result. Keep it short and raw, not produced.$ss$,
  $j$[
    {"beat":"HOOK","lines":["It finally happened. [Win].","We just [achievement] and I'm still in shock."]},
    {"beat":"PROOF","lines":["Look at this. [Show proof].","[X months/years] ago this number was [old number]."]},
    {"beat":"EMOTIONAL BEAT","lines":["You have no idea how long I've worked for this. [X months] of [effort]."]},
    {"beat":"ACKNOWLEDGMENT","lines":["From [before] to [after]. Wild."]},
    {"beat":"CTA","lines":["Next goal. [Next milestone]. Follow to watch."]}
  ]$j$::jsonb,
  $g$Skip if there's no visible proof. A Win without proof reads as a brag.$g$,
  'authority', 'proof_community', 15, 30, 7, 7
),

-- 8. Day In The Life
(
  'short_form.day_in_the_life', 'short_form',
  $n$Day In The Life$n$,
  $d$A day's events from 1st person POV. Personality + lifestyle aspiration.$d$,
  $sp$A real day with at least one unexpected/different beat that breaks the typical pattern.$sp$,
  $j$[
    {"label":"HOOK","description":"establish identity and context"},
    {"label":"MORNING","description":"set the tone"},
    {"label":"CORE WORK","description":"what you actually do + a complication"},
    {"label":"RESOLUTION","description":"close the day"}
  ]$j$::jsonb,
  $ss$The audience comes for the lifestyle. Show something unexpected - a different way of doing things, a quirk, a deliberate weird choice. Generic productivity content flops here.$ss$,
  $j$[
    {"beat":"HOOK","lines":["A day in the life of a [age] year old [role].","What a typical [weekday] looks like when you [lifestyle detail]."]},
    {"beat":"MORNING","lines":["I start every day with [routine] because [reason].","First thing. [Action]. Most people don't know I [unexpected detail]."]},
    {"beat":"CORE WORK","lines":["Today's biggest priority is [task]. The challenge is [complication]."]},
    {"beat":"RESOLUTION","lines":["End of day. Here's what I got done. [Summary]. Tomorrow I need to [next priority]."]}
  ]$j$::jsonb,
  $g$Skip if the day is genuinely uneventful. The audience won't watch a polished version of nothing happening.$g$,
  'storytelling', 'storytelling', 45, 60, 7, 8
),

-- 9. Personal Update
(
  'short_form.personal_update', 'short_form',
  $n$Personal Update$n$,
  $d$A personal update or change in life/mission, shared from 1st person. Community building, not authority.$d$,
  $sp$A real recent change/decision + the why behind it.$sp$,
  $j$[
    {"label":"HOOK","description":"tease the update"},
    {"label":"CONTEXT","description":"situation"},
    {"label":"UPDATE","description":"deliver the news"},
    {"label":"RATIONALE","description":"explain the why"},
    {"label":"CTA","description":"optional"}
  ]$j$::jsonb,
  $ss$Let people see behind the curtain. This is for community building. Vulnerability lands.$ss$,
  $j$[
    {"beat":"HOOK","lines":["I need to tell you something. [Teaser].","Something big just changed in my [life/business] and I want to explain why."]},
    {"beat":"CONTEXT","lines":["For the past [X months] I've been [previous state]."]},
    {"beat":"UPDATE","lines":["As of [date], I'm [the change]."]},
    {"beat":"RATIONALE","lines":["The reason is simple. [Core reason].","I realized that [insight], and once I saw it I couldn't un-see it."]}
  ]$j$::jsonb,
  $g$Skip if the update is fake-personal (e.g., a product launch dressed as a personal moment). Audience smells it.$g$,
  'storytelling', 'storytelling', 30, 45, 14, 9
),

-- 10. Lesson From Others / Mentor Story
(
  'short_form.lesson_from_others', 'short_form',
  $n$Lesson From Others / Mentor Story$n$,
  $d$Someone else's story - mentor, client, peer, public figure - taught you something. You're the narrator/student.$d$,
  $sp$A real, specific person + a specific situation/quote/moment + how you applied it.$sp$,
  $j$[
    {"label":"HOOK","description":"introduce the person and lesson"},
    {"label":"SITUATION","description":"describe their context"},
    {"label":"LESSON","description":"reveal the insight"},
    {"label":"APPLICATION","description":"how you applied it and what changed"},
    {"label":"CTA","description":"optional"}
  ]$j$::jsonb,
  $ss$The other person must feel real to the viewer - name them, describe the specific situation, deliver the lesson as a vivid quote or moment. Generic mentor stories ("a smart person once told me...") flop.$ss$,
  $j$[
    {"beat":"HOOK","lines":["I learned something powerful from [person/role].","Here's the best advice [figure] ever gave me."]},
    {"beat":"SITUATION","lines":["When I met them, they had just [event].","At the time, they were [situation]."]},
    {"beat":"LESSON","lines":["They told me, '[golden lesson/quote].'","Their advice was simple. [Lesson]."]},
    {"beat":"APPLICATION","lines":["I took that and [action]. Within [timeframe] I [outcome]."]},
    {"beat":"CTA","lines":["Save this. You'll need it on a hard day."]}
  ]$j$::jsonb,
  $g$Skip if the person can't be named (or at least specifically described) and there's no quoted/vivid moment.$g$,
  'authority', 'storytelling', 45, 60, 7, 10
),

-- 11. This vs That / Comparison Verdict
(
  'short_form.this_vs_that', 'short_form',
  $n$This vs That / Comparison Verdict$n$,
  $d$Direct head-to-head between two named options ending in a clear verdict.$d$,
  $sp$Two specific, comparable options the creator has first-hand experience with + a real opinion on which wins.$sp$,
  $j$[
    {"label":"HOOK","description":"frame the matchup"},
    {"label":"CRITERION","description":"what we're judging on"},
    {"label":"CASE A","description":"option A's case with evidence"},
    {"label":"CASE B","description":"option B's case with evidence"},
    {"label":"VERDICT","description":"winner + the deciding factor"},
    {"label":"CTA","description":"optional"}
  ]$j$::jsonb,
  $ss$The verdict must be earned. Hedging kills the format. Bonus points for picking the side the audience doesn't expect.$ss$,
  $j$[
    {"beat":"HOOK","lines":["[A] vs [B]. One of these [outcome]. The other doesn't."]},
    {"beat":"CRITERION","lines":["I'm judging this on [single criterion]. Nothing else matters."]},
    {"beat":"CASE A","lines":["[A] does [X] well. I tested it on [real thing], got [result]."]},
    {"beat":"CASE B","lines":["[B] does [Y] better. When I switched, [what changed]."]},
    {"beat":"VERDICT","lines":["Winner. [Option]. Not because [popular reason], but because [non-obvious reason]."]}
  ]$j$::jsonb,
  $g$Skip if the creator hasn't used both, or if the answer is "it depends."$g$,
  'authority', 'opinion', 30, 50, 5, 11
),

-- 12. Ranking / Tier List
(
  'short_form.ranking', 'short_form',
  $n$Ranking / Tier List$n$,
  $d$3-7 items ranked with a one-beat justification per item.$d$,
  $sp$A defined category and a real opinion on each item.$sp$,
  $j$[
    {"label":"HOOK","description":"category + criterion"},
    {"label":"SETUP","description":"quick rules"},
    {"label":"ITEMS","description":"walk the list, one sentence + reason each"},
    {"label":"SURPRISE BEAT","description":"defend the most-disagreed pick"},
    {"label":"CTA","description":"invite pushback"}
  ]$j$::jsonb,
  $ss$At least one item ranked far higher or far lower than expected, with a sharp reason. Obvious #1 picks are boring.$ss$,
  $j$[
    {"beat":"HOOK","lines":["Ranking [N items] worst to best. You're going to disagree with #[surprise position]."]},
    {"beat":"SETUP","lines":["Judging by [criterion]."]},
    {"beat":"ITEM","lines":["#[N]. [Item]. [One-line reason]."]},
    {"beat":"DEFENSE","lines":["Before you fight me on [item], [defense]."]},
    {"beat":"CTA","lines":["Tell me where I got it wrong."]}
  ]$j$::jsonb,
  $g$Skip if you can't articulate a sharp reason for each rank.$g$,
  'authority', 'opinion', 45, 60, 5, 12
),

-- 13. Hot Take / Contrarian
(
  'short_form.hot_take', 'short_form',
  $n$Hot Take / Contrarian$n$,
  $d$State an opinion the audience or industry rejects, defend it. Comments section becomes the show.$d$,
  $sp$A genuine contrarian view + at least one reason it's true that most people miss.$sp$,
  $j$[
    {"label":"HOOK","description":"state the take, no hedging"},
    {"label":"CONVENTIONAL","description":"acknowledge the mainstream view briefly"},
    {"label":"THE MISS","description":"what conventional view misses"},
    {"label":"EVIDENCE","description":"specific case"},
    {"label":"RESTATE + INVITE","description":"restate take, invite pushback"}
  ]$j$::jsonb,
  $ss$No softening in the first 3 seconds. "This might be controversial but..." kills it instantly. Punch first, justify after.$ss$,
  $j$[
    {"beat":"HOOK","lines":["[Contrarian take]. I know that's not what you want to hear."]},
    {"beat":"CONVENTIONAL","lines":["Most people will tell you [mainstream advice]. They're wrong."]},
    {"beat":"THE MISS","lines":["They forget [overlooked factor].","[Factor] is the part that breaks it."]},
    {"beat":"EVIDENCE","lines":["[Specific case]. That's what it actually looks like."]},
    {"beat":"RESTATE","lines":["[Take, restated]. Fight me in the comments."]}
  ]$j$::jsonb,
  $g$Skip if the take is actually mainstream, or if the creator can't name a specific case where the mainstream view fails.$g$,
  'authority', 'opinion', 30, 45, 5, 13
),

-- 14. Myth Bust
(
  'short_form.myth_bust', 'short_form',
  $n$Myth Bust$n$,
  $d$Take a specific common belief, dismantle it, replace with the real mechanism.$d$,
  $sp$A specific belief (quotable in audience's exact wording) + the real mechanism that contradicts it.$sp$,
  $j$[
    {"label":"HOOK","description":"quote the myth"},
    {"label":"WHY BELIEVED","description":"gives permission to have been wrong"},
    {"label":"THE TRUTH","description":"real mechanism"},
    {"label":"PROOF","description":"concrete example"},
    {"label":"CORRECTED RULE","description":"one-line replacement"}
  ]$j$::jsonb,
  $ss$Quote the myth in the audience's exact wording. "Everyone says you need to post twice a day to grow" lands; "people think X is bad" doesn't.$ss$,
  $j$[
    {"beat":"HOOK","lines":["'[Myth in quotes].' This is wrong. Here's why."]},
    {"beat":"WHY BELIEVED","lines":["It sounds right because [surface logic]."]},
    {"beat":"THE TRUTH","lines":["What's happening is [real mechanism]."]},
    {"beat":"PROOF","lines":["[Example] proves it."]},
    {"beat":"CORRECTED RULE","lines":["The actual rule. [One-line replacement]."]}
  ]$j$::jsonb,
  $g$Skip if nobody actually believes the myth.$g$,
  'educational', 'educational', 30, 50, 5, 14
),

-- 15. Listicle
(
  'short_form.listicle', 'short_form',
  $n$Listicle$n$,
  $d$Numbered list (3-5 items) of mistakes / lessons / habits / frameworks.$d$,
  $sp$N items the creator has earned the right to list.$sp$,
  $j$[
    {"label":"HOOK","description":"stake the list"},
    {"label":"ITEMS","description":"one-line setup + payoff per item"},
    {"label":"CLOSER","description":"strongest item last"},
    {"label":"CTA","description":"call to save / act"}
  ]$j$::jsonb,
  $ss$Every item carries a one-line punch. If you need 3 sentences to explain it, the item is too soft. 3 sharp items beats 5 mid ones.$ss$,
  $j$[
    {"beat":"HOOK","lines":["[N] [things/mistakes/habits] [I learned / wish I knew]."]},
    {"beat":"ITEM","lines":["[N]. [Item]. [One-line punch]."]},
    {"beat":"CLOSER","lines":["Number [N], most people skip this. [Item]."]},
    {"beat":"CTA","lines":["Save this. Go do #[N]."]}
  ]$j$::jsonb,
  $g$Skip if items can't each carry a one-line punch.$g$,
  'educational', 'educational', 45, 60, 4, 15
),

-- 16. How-To (Compressed)
(
  'short_form.how_to', 'short_form',
  $n$How-To (Compressed)$n$,
  $d$One specific skill taught in 45-60s. Three steps max. Pure utility.$d$,
  $sp$A bounded teachable skill + 3 concrete steps.$sp$,
  $j$[
    {"label":"HOOK","description":"state the outcome"},
    {"label":"STEP 1","description":"first action"},
    {"label":"STEP 2","description":"second action"},
    {"label":"STEP 3","description":"third action"},
    {"label":"PITFALL","description":"common mistake to avoid"},
    {"label":"CTA","description":"optional"}
  ]$j$::jsonb,
  $ss$Specificity over completeness. "Research your audience" is dead. "Open your top 3 competitors' comments and screenshot every question" is alive.$ss$,
  $j$[
    {"beat":"HOOK","lines":["How to [specific outcome] in [timeframe]."]},
    {"beat":"STEP 1","lines":["First, [action]. Use [specific tool]."]},
    {"beat":"STEP 2","lines":["Then, [action]. The trick is [non-obvious detail]."]},
    {"beat":"STEP 3","lines":["Finally, [action]. Make sure [what to check]."]},
    {"beat":"PITFALL","lines":["Everyone messes this up by [mistake]. Don't."]}
  ]$j$::jsonb,
  $g$Skip if the skill genuinely takes more than 3 steps.$g$,
  'educational', 'educational', 45, 60, 4, 16
),

-- 17. Q&A / Mailbag
(
  'short_form.qa_mailbag', 'short_form',
  $n$Q&A / Mailbag$n$,
  $d$A real audience question becomes the script.$d$,
  $sp$A real, specific question someone actually asked.$sp$,
  $j$[
    {"label":"HOOK","description":"show or voice the question"},
    {"label":"CONTEXT","description":"why it's common"},
    {"label":"ANSWER","description":"direct"},
    {"label":"PROOF","description":"specific example"},
    {"label":"BROADER","description":"reframe to a bigger lesson (optional)"},
    {"label":"CTA","description":"invite next question"}
  ]$j$::jsonb,
  $ss$Specific questions get specific answers. "How do I grow on Instagram?" is dead - "Should I delete old posts that don't fit my new niche?" is alive.$ss$,
  $j$[
    {"beat":"HOOK","lines":["[Asker]. '[Question verbatim].'"]},
    {"beat":"CONTEXT","lines":["Great question because [why it's common]."]},
    {"beat":"ANSWER","lines":["Short answer. [Direct take]."]},
    {"beat":"PROOF","lines":["Because [reason / example]."]},
    {"beat":"BROADER","lines":["The bigger lesson is [insight]."]},
    {"beat":"CTA","lines":["Got a question? DM it. I'll answer the next one on camera."]}
  ]$j$::jsonb,
  $g$Skip if there's no real question. Fabricated mailbags are obvious.$g$,
  'authority', 'proof_community', 30, 45, 5, 17
),

-- 18. Reaction / Reframe
(
  'short_form.reaction', 'short_form',
  $n$Reaction / Reframe$n$,
  $d$Surface a piece of conventional advice or external take, reframe with a sharper version.$d$,
  $sp$A specific external claim + a sharper reframe.$sp$,
  $j$[
    {"label":"HOOK","description":"show the claim"},
    {"label":"ACKNOWLEDGE","description":"why it resonates"},
    {"label":"REFRAME","description":"where the original is partial"},
    {"label":"SHARPER VERSION","description":"the version that actually works"},
    {"label":"CTA","description":"call to save"}
  ]$j$::jsonb,
  $ss$Don't rage-react. Calm and specific reframes are stronger. "They're not wrong, they're thinking about it at the wrong level."$ss$,
  $j$[
    {"beat":"HOOK","lines":["Saw this take. '[Claim].' Let me reframe it."]},
    {"beat":"ACKNOWLEDGE","lines":["It sounds right because [reason]."]},
    {"beat":"REFRAME","lines":["The level it's actually true at is [deeper layer]."]},
    {"beat":"SHARPER VERSION","lines":["What they should have said is [version]."]},
    {"beat":"CTA","lines":["Save this for the next time you hear that one."]}
  ]$j$::jsonb,
  $g$Skip if the reframe is just "I disagree" with no sharper version.$g$,
  'authority', 'opinion', 30, 45, 5, 18
),

-- 19. Behind the Scenes
(
  'short_form.behind_the_scenes', 'short_form',
  $n$Behind the Scenes$n$,
  $d$Show the actual process behind a known output. Process-focused (vs Day In The Life which is personality-focused).$d$,
  $sp$A specific output + the unglamorous process behind it.$sp$,
  $j$[
    {"label":"HOOK","description":"the output they've seen"},
    {"label":"CURTAIN","description":"pull back"},
    {"label":"MIDDLE","description":"messy middle (friction, rework, pivot)"},
    {"label":"LESSON","description":"one specific takeaway"},
    {"label":"CTA","description":"invite the audience in"}
  ]$j$::jsonb,
  $ss$Don't sanitize. Show friction, rework, the version that flopped. Polished BTS is just ad copy.$ss$,
  $j$[
    {"beat":"HOOK","lines":["You saw [output]. You didn't see [hidden part]."]},
    {"beat":"CURTAIN","lines":["Here's what actually went into it."]},
    {"beat":"MIDDLE","lines":["[Specific friction beat. 'We shot v4 before we got the take', 'I redid the deck three times', 'The first launch flopped']."]},
    {"beat":"LESSON","lines":["[Takeaway]. That's what stuck with me."]},
    {"beat":"CTA","lines":["Most polished content hides this. I want you to see it."]}
  ]$j$::jsonb,
  $g$Skip if the process is genuinely uneventful or the creator won't show the unflattering part.$g$,
  'authority', 'educational', 45, 60, 7, 19
),

-- ---------------------------------------------------------------------------
-- ENGAGEMENT REELS (6) - text-on-screen only, no voiceover
-- ---------------------------------------------------------------------------

-- 20. Poll Reel
(
  'engagement_reel.poll_reel', 'engagement_reel',
  $n$Poll Reel$n$,
  $d$Visual two-option poll, asks viewer to pick in comments. Text-on-screen only, no voiceover, no narration.$d$,
  $sp$A binary choice the audience genuinely splits on, plus a brief reason each side might pick.$sp$,
  $j$[
    {"label":"TRIGGER","description":"pattern interrupt question (overlay)"},
    {"label":"CONTEXT","description":"narrows the topic (overlay)"},
    {"label":"BAIT","description":"the binary choice (overlay)"},
    {"label":"ON-SCREEN","description":"your stance hinted"},
    {"label":"CTA","description":"comment your pick (overlay)"}
  ]$j$::jsonb,
  $ss$The two options must be near-equal in plausibility. Lopsided polls flop because there's no debate.$ss$,
  $j$[
    {"beat":"TRIGGER","lines":["5-10 words. Pattern interrupt."]},
    {"beat":"CONTEXT","lines":["Sets up the bait. 8-14 words."]},
    {"beat":"BAIT","lines":["[Option A] or [Option B]?"]},
    {"beat":"ON-SCREEN","lines":["I'd pick [option]. You?"]},
    {"beat":"CTA","lines":["Comment A or B."]}
  ]$j$::jsonb,
  $g$Skip if one option is obviously correct. Polls flop without real disagreement.$g$,
  NULL, 'opinion', 15, 20, 4, 20
),

-- 21. Debate Starter
(
  'engagement_reel.debate_starter', 'engagement_reel',
  $n$Debate Starter$n$,
  $d$Present a tension between two takes, ask audience which side. Text-on-screen only, no voiceover.$d$,
  $sp$Two opposing takes that both have legitimate defenders + a brief reason for each.$sp$,
  $j$[
    {"label":"TRIGGER","description":"name the tension"},
    {"label":"CONTEXT","description":"both takes briefly"},
    {"label":"BAIT","description":"which side"},
    {"label":"ON-SCREEN","description":"your hint"},
    {"label":"CTA","description":"debate me"}
  ]$j$::jsonb,
  $ss$Both takes must have actual defenders. If one side is obviously right, the format flops.$ss$,
  $j$[
    {"beat":"TRIGGER","lines":["There's a fight in [niche] right now."]},
    {"beat":"CONTEXT","lines":["Side A says [take]. Side B says [opposite]."]},
    {"beat":"BAIT","lines":["Which side are you on?"]},
    {"beat":"ON-SCREEN","lines":["I'm on side [X]."]},
    {"beat":"CTA","lines":["Defend yours in the comments."]}
  ]$j$::jsonb,
  $g$Skip if one side has no real defenders.$g$,
  'authority', 'opinion', 15, 25, 4, 21
),

-- 22. Spicy Question
(
  'engagement_reel.spicy_question', 'engagement_reel',
  $n$Spicy Question$n$,
  $d$One provocative question that splits the audience. Text-on-screen only, no voiceover.$d$,
  $sp$A genuinely provocative question - one that triggers a strong opinion either way.$sp$,
  $j$[
    {"label":"TRIGGER","description":"the spicy question"},
    {"label":"CONTEXT","description":"set the stakes"},
    {"label":"BAIT","description":"your hint of an answer"},
    {"label":"CTA","description":"comment your take"}
  ]$j$::jsonb,
  $ss$The question must trigger a feeling, not a calculation. "Should creators reveal income?" splits. "What's the best time to post?" doesn't.$ss$,
  $j$[
    {"beat":"TRIGGER","lines":["[Spicy question]?"]},
    {"beat":"CONTEXT","lines":["I have a feeling about this."]},
    {"beat":"BAIT","lines":["Most people will say [common answer]. They're wrong."]},
    {"beat":"CTA","lines":["What's your take?"]}
  ]$j$::jsonb,
  $g$Skip if the question is calculative, not emotional.$g$,
  NULL, 'opinion', 15, 20, 4, 22
),

-- 23. Tier-List Bait
(
  'engagement_reel.tier_list_bait', 'engagement_reel',
  $n$Tier-List Bait$n$,
  $d$Half-finished ranking that begs viewers to argue. Text-on-screen only, no voiceover.$d$,
  $sp$N items where you've ranked some controversially + leave gaps for the audience.$sp$,
  $j$[
    {"label":"TRIGGER","description":"the partial ranking"},
    {"label":"CONTEXT","description":"your top pick + reason"},
    {"label":"BAIT","description":"your worst pick + provocation"},
    {"label":"ON-SCREEN","description":"open slots"},
    {"label":"CTA","description":"fill in the rest"}
  ]$j$::jsonb,
  $ss$Leave the most-debatable ranks empty. Audience fills them in for engagement.$ss$,
  $j$[
    {"beat":"TRIGGER","lines":["Ranking [items]. The top is [item]. The bottom is [controversial item]."]},
    {"beat":"BAIT","lines":["[Bottom item] doesn't deserve [perceived value]."]},
    {"beat":"CTA","lines":["Where would you rank [missing item]?"]}
  ]$j$::jsonb,
  $g$Skip if your ranking has no controversy.$g$,
  NULL, 'opinion', 15, 25, 4, 23
),

-- 24. Defend This Take
(
  'engagement_reel.defend_this_take', 'engagement_reel',
  $n$Defend This Take$n$,
  $d$Drop a contrarian one-liner with no explanation. Force comment debate. Text-on-screen only, no voiceover.$d$,
  $sp$A sharp, defendable contrarian one-liner.$sp$,
  $j$[
    {"label":"TRIGGER","description":"the take"},
    {"label":"ON-SCREEN","description":"defend or disagree"},
    {"label":"CTA","description":"comments"}
  ]$j$::jsonb,
  $ss$The take must be SHORT (8 words max) and provocative. No explanation.$ss$,
  $j$[
    {"beat":"TRIGGER","lines":["[Sharp 8-word take]."]},
    {"beat":"ON-SCREEN","lines":["Defend or disagree."]},
    {"beat":"CTA","lines":["I'm reading every comment."]}
  ]$j$::jsonb,
  $g$Skip if the take requires explanation to land.$g$,
  'authority', 'opinion', 10, 15, 4, 24
),

-- 25. Hero's Journey (Text-Only)
(
  'engagement_reel.heros_journey_text', 'engagement_reel',
  $n$Hero's Journey (Text-Only)$n$,
  $d$Hero's Journey arc told via text overlays + B-roll, no voiceover.$d$,
  $sp$Same as Hero's Journey - problem + solution + result, but compressed for visual storytelling.$sp$,
  $j$[
    {"label":"TRIGGER","description":"the before-state pain (overlay)"},
    {"label":"STRUGGLE","description":"failed attempts (overlay)"},
    {"label":"TURN","description":"what changed (overlay)"},
    {"label":"RESULT","description":"the after (overlay)"},
    {"label":"CTA","description":"follow for the playbook (overlay)"}
  ]$j$::jsonb,
  $ss$Each overlay 5-10 words max. The visual carries the emotion; text just narrates beats.$ss$,
  $j$[
    {"beat":"TRIGGER","lines":["[X] years ago. Stuck in [problem]."]},
    {"beat":"STRUGGLE","lines":["Tried [thing 1]. [Thing 2]. Nothing worked."]},
    {"beat":"TURN","lines":["Then I figured out [solution]."]},
    {"beat":"RESULT","lines":["Now. [Specific result]."]},
    {"beat":"CTA","lines":["Follow for the playbook."]}
  ]$j$::jsonb,
  $g$Skip if the brand has no clear visual b-roll for the transformation.$g$,
  'storytelling', 'storytelling', 20, 25, 7, 25
),

-- ---------------------------------------------------------------------------
-- CAROUSELS (5) - 5-8 slides, each slide max 18 words
-- ---------------------------------------------------------------------------

-- 26. Framework Carousel
(
  'carousel.framework', 'carousel',
  $n$Framework Carousel$n$,
  $d$Teaches one framework from the long-form, slide by slide.$d$,
  $sp$A named framework with 3-5 components that can be diagrammed or explained one slide at a time.$sp$,
  $j$[
    {"label":"HOOK SLIDE","description":"the framework name + promise"},
    {"label":"CONTEXT SLIDE","description":"why most people get this wrong"},
    {"label":"COMPONENT 1","description":"first component"},
    {"label":"COMPONENT 2","description":"second component"},
    {"label":"COMPONENT 3","description":"third component (and optional 4, 5)"},
    {"label":"SUMMARY SLIDE","description":"save this"},
    {"label":"CTA SLIDE","description":"call to action"}
  ]$j$::jsonb,
  $ss$The framework must be NAMED. Vague "5 things to do" carousels flop. "The 2-1-3-4 method" works.$ss$,
  $j$[
    {"beat":"HOOK","lines":["The [framework name] that [outcome]."]},
    {"beat":"CONTEXT","lines":["Most people [common mistake]."]},
    {"beat":"COMPONENT","lines":["[Component name]. [What it does in 12 words]."]},
    {"beat":"SUMMARY","lines":["Save this. Use it next time you [situation]."]}
  ]$j$::jsonb,
  $g$Skip if the framework isn't named.$g$,
  'educational', 'educational', 7, 8, 4, 26
),

-- 27. List Carousel
(
  'carousel.list', 'carousel',
  $n$List Carousel$n$,
  $d$3-5 items with intro + outro slides.$d$,
  $sp$N items the creator has earned the right to list.$sp$,
  $j$[
    {"label":"HOOK SLIDE","description":"stake the list"},
    {"label":"ITEM SLIDES","description":"3-5 items, one per slide"},
    {"label":"CTA SLIDE","description":"save / react"}
  ]$j$::jsonb,
  $ss$One item per slide. Each item readable in 2 seconds.$ss$,
  $j$[
    {"beat":"HOOK","lines":["[N] [items] [I wish I knew / nobody talks about]."]},
    {"beat":"ITEM","lines":["[N]. [Item]. [One-line punch]."]},
    {"beat":"CTA","lines":["Save this. Tell me which one hit."]}
  ]$j$::jsonb,
  $g$Skip if items can't each fit one slide cleanly.$g$,
  'educational', 'educational', 5, 7, 4, 27
),

-- 28. Story Carousel
(
  'carousel.story', 'carousel',
  $n$Story Carousel$n$,
  $d$Narrative arc pulled from a long-form story beat.$d$,
  $sp$A single story moment from the long-form or from a topic answer.$sp$,
  $j$[
    {"label":"HOOK","description":"the moment"},
    {"label":"SCENE","description":"sensory detail"},
    {"label":"CONFLICT","description":"what was at stake"},
    {"label":"TURN","description":"what shifted"},
    {"label":"RESOLUTION","description":"what changed"},
    {"label":"LESSON","description":"what stuck"},
    {"label":"CTA","description":"your turn"}
  ]$j$::jsonb,
  $ss$Specificity. Generic "I had a hard day" stories flop; "I was at the airport at 6am when my flight cancelled" lands.$ss$,
  $j$[
    {"beat":"HOOK","lines":["I was [specific scene] when [event]."]},
    {"beat":"SCENE","lines":["[One sensory detail per line]."]},
    {"beat":"CONFLICT","lines":["I had to [decision] in [timeframe]."]},
    {"beat":"TURN","lines":["Then [shift]."]},
    {"beat":"RESOLUTION","lines":["Now [outcome]."]},
    {"beat":"LESSON","lines":["[Takeaway]."]}
  ]$j$::jsonb,
  $g$Skip if the story has no specific details.$g$,
  'storytelling', 'storytelling', 6, 8, 7, 28
),

-- 29. Hero's Journey Carousel
(
  'carousel.heros_journey', 'carousel',
  $n$Hero's Journey Carousel$n$,
  $d$Full Hero's Journey arc compressed to a swipeable.$d$,
  $sp$Same as Hero's Journey short-form - problem + failed attempts + turn + solution + result.$sp$,
  $j$[
    {"label":"HOOK SLIDE","description":"X years ago"},
    {"label":"PROBLEM SLIDE","description":"establish the problem"},
    {"label":"FAILED ATTEMPTS SLIDE","description":"things you tried that didn't work"},
    {"label":"TURN SLIDE","description":"the moment it changed"},
    {"label":"SOLUTION SLIDE","description":"what finally worked"},
    {"label":"RESULT SLIDE","description":"the after"},
    {"label":"LESSON SLIDE","description":"what to take away"},
    {"label":"CTA SLIDE","description":"follow / save"}
  ]$j$::jsonb,
  $ss$Same as the short-form - viewer must FEEL the pain. Compressing for swipe doesn't change the rule.$ss$,
  $j$[
    {"beat":"HOOK","lines":["[X] years ago I was [role] stuck in [problem]."]},
    {"beat":"PROBLEM","lines":["Every day looked like [specific pain]."]},
    {"beat":"FAILED ATTEMPTS","lines":["I tried [#1], [#2], and [#3]. Nothing worked."]},
    {"beat":"TURN","lines":["Then I figured out [non-obvious insight]."]},
    {"beat":"SOLUTION","lines":["The thing that worked. [Solution in 12-18 words]."]},
    {"beat":"RESULT","lines":["[X timeframe] later. [Specific result]."]},
    {"beat":"LESSON","lines":["[Takeaway]. That's what stuck with me."]},
    {"beat":"CTA","lines":["Save this. Follow for the rest of the playbook."]}
  ]$j$::jsonb,
  $g$Same as short-form. Skip if no specific transformation arc with concrete before/after.$g$,
  'storytelling', 'storytelling', 7, 8, 10, 29
),

-- 30. Personal Learning Carousel
(
  'carousel.personal_learning', 'carousel',
  $n$Personal Learning Carousel$n$,
  $d$Lead with proof, then teach how it was achieved.$d$,
  $sp$Same as Personal Learning short-form - result with visible proof + non-obvious insight.$sp$,
  $j$[
    {"label":"PROOF SLIDE","description":"lead with the result"},
    {"label":"BACKSTORY SLIDE","description":"where you were before"},
    {"label":"INSIGHT SLIDE","description":"the realization"},
    {"label":"STEP 1","description":"first step you took"},
    {"label":"STEP 2","description":"second step"},
    {"label":"STEP 3","description":"third step (optional)"},
    {"label":"CTA","description":"save / DM"}
  ]$j$::jsonb,
  $ss$Same as short-form. Proof first, insight non-obvious.$ss$,
  $j$[
    {"beat":"PROOF","lines":["[Result] in [timeframe]. Here's how."]},
    {"beat":"BACKSTORY","lines":["Before this I was [previous state] thinking [old belief]."]},
    {"beat":"INSIGHT","lines":["The fix was [non-obvious insight]."]},
    {"beat":"STEP","lines":["[Step number]. [Action]. [Specific detail]."]},
    {"beat":"CTA","lines":["Save this. DM me LEARN for the full breakdown."]}
  ]$j$::jsonb,
  $g$Same as short-form. Skip if no quantifiable proof.$g$,
  'authority', 'educational', 5, 7, 5, 30
),

-- ---------------------------------------------------------------------------
-- STORIES (5) - Instagram/Facebook stories, 1-4 frames
-- ---------------------------------------------------------------------------

-- 31. Proof Drop
(
  'story.proof_drop', 'story',
  $n$Proof Drop$n$,
  $d$Screenshot/result + one-line caption.$d$,
  $sp$A specific recent result with visible proof (screenshot, notification, photo).$sp$,
  $j$[
    {"label":"FRAME 1","description":"proof + 1 line"}
  ]$j$::jsonb,
  $ss$Single frame. No setup. Just the proof.$ss$,
  $j$[
    {"beat":"FRAME 1","lines":["[Screenshot]. [One-line context like 'A year ago this said zero.']"]}
  ]$j$::jsonb,
  $g$Skip if there's no visible proof.$g$,
  'authority', 'proof_community', 1, 1, 3, 31
),

-- 32. Day Moment
(
  'story.day_moment', 'story',
  $n$Day Moment$n$,
  $d$Single moment from the day with personality.$d$,
  $sp$Something genuinely happening today worth sharing.$sp$,
  $j$[
    {"label":"FRAME 1","description":"moment captured"},
    {"label":"FRAME 2","description":"quick reaction or detail (optional)"}
  ]$j$::jsonb,
  $ss$Reactive, not produced. Polish kills it.$ss$,
  $j$[
    {"beat":"FRAME 1","lines":["[Photo/video of moment]. [Honest one-liner]."]}
  ]$j$::jsonb,
  $g$Skip if the moment is fabricated or fake-spontaneous.$g$,
  'storytelling', 'storytelling', 1, 2, 3, 32
),

-- 33. Behind the Curtain
(
  'story.behind_the_curtain', 'story',
  $n$Behind the Curtain$n$,
  $d$Process snippet from current work.$d$,
  $sp$A specific in-progress moment from work - not a polished output.$sp$,
  $j$[
    {"label":"FRAME 1","description":"what you're working on"},
    {"label":"FRAME 2","description":"the messy detail most people don't see"},
    {"label":"FRAME 3","description":"the takeaway (optional)"}
  ]$j$::jsonb,
  $ss$Show the unglamorous beat. Sanitized BTS is dead.$ss$,
  $j$[
    {"beat":"FRAME 1","lines":["Working on [thing]."]},
    {"beat":"FRAME 2","lines":["Most people don't realize [hidden detail]."]}
  ]$j$::jsonb,
  $g$Skip if the work is genuinely uneventful or won't show the unflattering part.$g$,
  'authority', 'educational', 1, 3, 4, 33
),

-- 34. Question for Audience
(
  'story.question_for_audience', 'story',
  $n$Question for Audience$n$,
  $d$Direct question with reply box.$d$,
  $sp$A specific question the audience has a real opinion on.$sp$,
  $j$[
    {"label":"FRAME 1","description":"question + reply sticker"}
  ]$j$::jsonb,
  $ss$Specific, not generic. "What's your favorite color?" flops. "Should I keep posting daily or drop to 3x/week?" lands.$ss$,
  $j$[
    {"beat":"FRAME 1","lines":["[Specific question]. (with question/reply sticker)"]}
  ]$j$::jsonb,
  $g$Skip if the question is generic.$g$,
  NULL, 'proof_community', 1, 1, 3, 34
),

-- 35. Vulnerable Share
(
  'story.vulnerable_share', 'story',
  $n$Vulnerable Share$n$,
  $d$Honest moment, low-polish, parasocial fuel.$d$,
  $sp$A real, recent moment of doubt / struggle / honesty the brand is willing to share.$sp$,
  $j$[
    {"label":"FRAME 1","description":"the honest moment"},
    {"label":"FRAME 2","description":"what you're choosing to do (optional)"}
  ]$j$::jsonb,
  $ss$Real, not performative. If it sounds like a "vulnerability flex," cut it.$ss$,
  $j$[
    {"beat":"FRAME 1","lines":["[Honest line about a real feeling/moment]."]},
    {"beat":"FRAME 2","lines":["[What you're doing about it]."]}
  ]$j$::jsonb,
  $g$Skip if the brand isn't willing to actually be vulnerable.$g$,
  'storytelling', 'storytelling', 1, 2, 7, 35
)

ON CONFLICT (slug) DO UPDATE SET
  content_type      = EXCLUDED.content_type,
  name              = EXCLUDED.name,
  description       = EXCLUDED.description,
  starting_point    = EXCLUDED.starting_point,
  strategy_beats    = EXCLUDED.strategy_beats,
  secret_sauce      = EXCLUDED.secret_sauce,
  mad_libs          = EXCLUDED.mad_libs,
  gating_rule       = EXCLUDED.gating_rule,
  pillar            = EXCLUDED.pillar,
  bucket            = EXCLUDED.bucket,
  target_length_min = EXCLUDED.target_length_min,
  target_length_max = EXCLUDED.target_length_max,
  cooldown_posts    = EXCLUDED.cooldown_posts,
  sort_order        = EXCLUDED.sort_order;

-- =============================================================================
-- Sanity check (run manually after seed):
--   SELECT content_type, COUNT(*) FROM public.content_formats
--   WHERE is_active GROUP BY content_type ORDER BY content_type;
--   -- expect: carousel=5, engagement_reel=6, short_form=19, story=5
-- =============================================================================
