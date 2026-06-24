-- =============================================================================
-- New formats: caption-carry engagement reel + two story value formats.
--
--  1. engagement_reel.caption_list - on-screen is a curiosity hook (broad
--     statement, or "N ways to X in [niche]") + "check the caption"; the value
--     lives in a long, structured caption. Framework-driven, NOT opinion - so
--     it adds engagement-reel volume even when a topic's opinion answer is thin.
--  2. story.value_teaser - teaches a real lesson, then a DM CTA for a resource.
--  3. story.value_drop  - pure value, no CTA (3 frames). Builds trust.
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE, mirroring content_formats_seed.sql.
-- Also mirrored into the seed files so a fresh re-seed includes them.
-- =============================================================================

INSERT INTO public.content_formats (
  slug, content_type, name, description, starting_point,
  strategy_beats, secret_sauce, mad_libs, gating_rule,
  pillar, bucket, target_length_min, target_length_max,
  cooldown_posts, sort_order
) VALUES

-- Caption-carry engagement reel (framework-driven)
(
  'engagement_reel.caption_list', 'engagement_reel',
  $n$List Bait (Caption)$n$,
  $d$Silent text-on-screen reel. On-screen is a curiosity hook only - a broad statement, or "N things/ways/mistakes in [niche]" - plus a nudge to read the caption. The full value lives in a long, structured caption that carries the entire idea.$d$,
  $sp$A set of distinct, concrete points about the niche (problems + fixes, ways, mistakes, or signs). Needs a framework / list answer that breaks cleanly into 4+ items.$sp$,
  $j$[
    {"label":"ON-SCREEN HOOK","description":"a broad statement OR 'N [things/ways/mistakes/signs] in [niche]' - pure curiosity, no value yet"},
    {"label":"ON-SCREEN DIRECTIVE","description":"a short nudge to read the caption (e.g. 'Read the caption')"},
    {"label":"CAPTION OPEN","description":"1-2 lines that raise the stakes and promise the list"},
    {"label":"CAPTION LIST","description":"N numbered points; each is a sharp claim then a one-line explanation or fix"},
    {"label":"CAPTION CLOSE","description":"the takeaway plus a soft CTA (save, follow, or comment a word)"}
  ]$j$::jsonb,
  $ss$The on-screen text only sells the click. The CAPTION carries 100% of the value as a skimmable numbered list. Every item stands on its own and earns its place - no filler between items, no restating the hook.$ss$,
  $j$[
    {"beat":"ON-SCREEN HOOK","lines":["7 things in your [niche] quietly telling people it's fake.","5 ways to [outcome] in [niche]. Most skip #3."]},
    {"beat":"CAPTION LIST","lines":["1. [Sharp claim]: [one line on why it matters]. Fix: [one line].","2. [Sharp claim]: [one line on why]. Fix: [one line]."]}
  ]$j$::jsonb,
  $g$Skip if there is no list-style material - you need at least 4-5 distinct points. Do not pad a 2-idea topic into 7.$g$,
  'educational', 'educational', 8, 25, 4, 41
),

-- Story: value teaser with DM CTA
(
  'story.value_teaser', 'story',
  $n$Value Teaser$n$,
  $d$Multi-frame story that teaches a real lesson, builds interest, then ends on a DM CTA to get a resource (a free training, guide, or breakdown).$d$,
  $sp$A teachable lesson or framework worth a DM, plus something real to send.$sp$,
  $j$[
    {"label":"HOOK","description":"the promise - what they will get"},
    {"label":"VALUE","description":"the lesson teased - enough to prove it is worth it"},
    {"label":"REHOOK","description":"raise the stakes - why it matters now"},
    {"label":"CTA","description":"reply with [keyword] to get [resource]"}
  ]$j$::jsonb,
  $ss$Give a real, usable piece of the value up front so the DM ask feels earned, not baited. The keyword matches the value, never a generic word.$ss$,
  $j$[
    {"beat":"HOOK","lines":["It took me [time] to learn [number] lessons that changed everything."]},
    {"beat":"CTA","lines":["Reply [KEYWORD] and I'll send you the [resource]."]}
  ]$j$::jsonb,
  $g$Skip if there is nothing real to send. An empty 'DM me' with no resource reads as a scam.$g$,
  'educational', 'educational', 4, 4, 3, 36
),

-- Story: value drop (no CTA)
(
  'story.value_drop', 'story',
  $n$Value Drop$n$,
  $d$Multi-frame story that teaches one useful thing straight up and ends on the payoff. No CTA, no DM ask - pure value to build trust.$d$,
  $sp$One genuinely useful insight, tip, or lesson from the raw material.$sp$,
  $j$[
    {"label":"HOOK","description":"the promise of the insight"},
    {"label":"VALUE","description":"the actual useful thing - specific and usable"},
    {"label":"REHOOK","description":"the payoff / takeaway that lands it - NO ask"}
  ]$j$::jsonb,
  $ss$No CTA at all. The value IS the point. End on the takeaway, never a 'follow for more'.$ss$,
  $j$[
    {"beat":"HOOK","lines":["The one thing nobody told me about [niche]."]},
    {"beat":"REHOOK","lines":["[The takeaway, stated plainly - no ask]."]}
  ]$j$::jsonb,
  $g$Skip if the insight is not genuinely useful on its own.$g$,
  'educational', 'educational', 3, 3, 3, 37
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

-- Hook angles for the caption-carry reel (on-screen hook only).
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern":"[N] [things/signs/mistakes] quietly telling people [bad outcome] in [niche].","example":"7 things quietly telling people your brand is fake. Most are in your office right now."},
  {"pattern":"[N] ways to [desired outcome] in [niche]. Check the caption.","example":"5 ways to book more calls from one reel. Check the caption."},
  {"pattern":"[Broad provocative statement about niche]. Here is the breakdown.","example":"People decide if your brand is real in seconds. Here is what is doing it."}
]$j$::jsonb
WHERE slug = 'engagement_reel.caption_list';

-- =============================================================================
-- Done.
-- =============================================================================
