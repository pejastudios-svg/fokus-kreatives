-- =============================================================================
-- Hook bank + reference scripts. Idempotent UPDATEs keyed by slug. Run after
-- the main content_formats_seed.sql.
--
-- Hook patterns: every short-form format gets 4-6 templates. The AI is
-- instructed in promptBlock.ts to PICK or ADAPT one of these for the opening
-- line, not to freelance.
--
-- Reference scripts: 4 of these come from a real reference set the user
-- pulled (a software engineer's day-in-the-life, a psychology how-to, a
-- listicle on dating dynamics, a million-follower personal learning).
-- More can be added per format over time via the same UPDATE pattern.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SHORT-FORM HOOKS (19 formats)
-- ---------------------------------------------------------------------------

-- Hero's Journey
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "[X years] ago I was [role] stuck in [problem].", "example": "Three years ago I was a junior dev stuck building features nobody used."},
  {"pattern": "I was a [role] who couldn't [thing they needed to do].", "example": "I was a freelancer who couldn't get a single client to reply to my proposals."},
  {"pattern": "[Specific lowest-moment scene].", "example": "I remember crying on the floor of my studio because I couldn't make rent that month."},
  {"pattern": "Everyone said [common belief]. I tried that for [timeframe] and almost [bad outcome].", "example": "Everyone said cold DMs work. I sent a thousand of them and almost gave up entirely."}
]$j$::jsonb WHERE slug = 'short_form.heros_journey';

-- Personal Learning / Epiphany
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "This is how I [achievement] in [timeframe]. The short answer is [X]. The long answer is all of these.", "example": "This is how I got a million followers in four months. The short answer is my 30 Lessons by 30 series. The long answer is all of these."},
  {"pattern": "I [impressive specific result] in [timeframe]. Here's exactly how.", "example": "I went from $0 to $10K MRR in 90 days. Here's exactly how."},
  {"pattern": "[Screenshot or visible proof]. Everyone keeps asking me how I did this.", "example": "[Screenshot of analytics]. Everyone keeps asking me how I did this."},
  {"pattern": "I just [accomplished thing] and the answer wasn't what I expected.", "example": "I just hit 100K subscribers and the answer wasn't more posting."}
]$j$::jsonb WHERE slug = 'short_form.personal_learning';

-- About Me / Origin Story
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "Hi I'm [name]. [X years] ago I was a normal [role] living a normal life.", "example": "Hi I'm Sarah. Three years ago I was a normal accountant living a normal life."},
  {"pattern": "I'm [name] and [bold mission claim].", "example": "I'm Mike and I'm trying to teach 1 million teenagers how to invest before they turn 25."},
  {"pattern": "Most people know me as [public face]. What they don't know is [hidden origin].", "example": "Most people know me as the productivity guy. What they don't know is I burned out three times before any of this worked."}
]$j$::jsonb WHERE slug = 'short_form.about_me';

-- Before & After
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "[X months] of [effort] in [X seconds].", "example": "Six months of training in fifteen seconds."},
  {"pattern": "Watch this transformation.", "example": "Watch this transformation."},
  {"pattern": "[Specific before-state]. [Specific after-state]. [Timeframe].", "example": "Couldn't do a single pull-up. Now I do twenty. Six months."}
]$j$::jsonb WHERE slug = 'short_form.before_after';

-- Goal / Dream Journey
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "For as long as I can remember I've wanted to [dream].", "example": "For as long as I can remember I've wanted to write a book that actually mattered."},
  {"pattern": "I'm trying to [ambitious goal] by [date]. Here's where I'm at.", "example": "I'm trying to launch a SaaS to $100K ARR by December. Here's where I'm at."},
  {"pattern": "I'm not there yet. But here's where I am.", "example": "I'm not at six figures yet. But here's where I am."}
]$j$::jsonb WHERE slug = 'short_form.goal_journey';

-- Challenge
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "I gave myself [X days] to [challenge]. No shortcuts.", "example": "I gave myself 30 days to write a viral post. No shortcuts."},
  {"pattern": "[X day] [challenge] starts now.", "example": "30 day cold shower challenge starts now."},
  {"pattern": "Day [X] of [challenge]. [Setback or progress].", "example": "Day 12 of writing every morning. I almost broke the streak yesterday."}
]$j$::jsonb WHERE slug = 'short_form.challenge';

-- Win
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "It finally happened. [Win].", "example": "It finally happened. We hit $1M ARR."},
  {"pattern": "We just [achievement] and I'm still in shock.", "example": "We just closed a $400K contract and I'm still in shock."},
  {"pattern": "[Specific number / proof] just landed.", "example": "Ten thousand new followers in 24 hours just landed."}
]$j$::jsonb WHERE slug = 'short_form.win';

-- Day In The Life
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "Today I'm [doing specific thing] as a [role].", "example": "Today I'm going on a business trip as a software engineer in Big Tech."},
  {"pattern": "A day in the life of a [age] year old [role].", "example": "A day in the life of a 27 year old indie founder."},
  {"pattern": "What a typical [weekday] looks like when you [lifestyle detail].", "example": "What a typical Tuesday looks like when you work for yourself."}
]$j$::jsonb WHERE slug = 'short_form.day_in_the_life';

-- Personal Update
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "I need to tell you something. [Teaser].", "example": "I need to tell you something. I'm shutting the agency down."},
  {"pattern": "Something big just changed in my [life/business] and I want to explain why.", "example": "Something big just changed in my business and I want to explain why."},
  {"pattern": "I'm doing [unexpected thing] and here's why.", "example": "I'm moving to a new city next month and here's why."}
]$j$::jsonb WHERE slug = 'short_form.personal_update';

-- Lesson From Others
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "I learned something powerful from [person/role].", "example": "I learned something powerful from a 70-year-old plumber I sat next to on a flight."},
  {"pattern": "Here's the best advice [figure] ever gave me.", "example": "Here's the best advice my first boss ever gave me."},
  {"pattern": "[Person] told me something I think about every day.", "example": "My mentor told me something I think about every single day."}
]$j$::jsonb WHERE slug = 'short_form.lesson_from_others';

-- This vs That
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "[A] vs [B]. One of these [outcome]. The other doesn't.", "example": "Notion vs Obsidian. One of these will save you hours. The other won't."},
  {"pattern": "I tested [A] and [B]. Here's the winner.", "example": "I tested ChatGPT and Claude on the same task for a week. Here's the winner."},
  {"pattern": "Stop arguing about [A] vs [B]. The answer is [verdict].", "example": "Stop arguing about morning vs evening workouts. The answer is whichever one you'll actually do."}
]$j$::jsonb WHERE slug = 'short_form.this_vs_that';

-- Ranking / Tier List
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "Ranking [N items] worst to best. You're going to disagree with #[surprise position].", "example": "Ranking the seven biggest productivity apps worst to best. You're going to disagree with number 3."},
  {"pattern": "[N] [items] ranked. The bottom one is going to upset people.", "example": "Five marketing books ranked. The bottom one is going to upset people."},
  {"pattern": "The [N] [items], from useless to essential.", "example": "The five productivity habits, from useless to essential."}
]$j$::jsonb WHERE slug = 'short_form.ranking';

-- Hot Take
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "[Contrarian take]. I know that's not what you want to hear.", "example": "Productivity advice is keeping you broke. I know that's not what you want to hear."},
  {"pattern": "[Sharp 8-word take].", "example": "Side hustles are making your life worse."},
  {"pattern": "Hot take. [Take]. Fight me.", "example": "Hot take. The 4-hour work week is the worst book ever written. Fight me."}
]$j$::jsonb WHERE slug = 'short_form.hot_take';

-- Myth Bust
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "''[Myth in audience exact wording].'' This is wrong. Here's why.", "example": "''You need 10,000 hours to master something.'' This is wrong. Here's why."},
  {"pattern": "Stop telling people [common advice]. It's making them worse.", "example": "Stop telling people to follow their passion. It's making them worse."},
  {"pattern": "The myth that [belief] is destroying [audience]'s [outcome].", "example": "The myth that hard work alone gets you promoted is destroying junior engineers' careers."}
]$j$::jsonb WHERE slug = 'short_form.myth_bust';

-- Listicle
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "Top [N] things that'll [outcome].", "example": "Top five things that'll turn a woman off."},
  {"pattern": "[N] [things/mistakes/habits] [I learned / wish I knew].", "example": "Five things I wish I knew before quitting my job."},
  {"pattern": "[N] [items] you should [verb] before [deadline/condition].", "example": "Three books you should read before turning 30."}
]$j$::jsonb WHERE slug = 'short_form.listicle';

-- How-To
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "Here's how to [outcome] using [angle].", "example": "Here's how to make someone fall in love with you using psychology."},
  {"pattern": "How to [specific outcome] in [timeframe].", "example": "How to learn a new language in 90 days."},
  {"pattern": "[Tactic] is the fastest way to [outcome]. Here's how.", "example": "Cold emailing CEOs is the fastest way to land your first client. Here's how."}
]$j$::jsonb WHERE slug = 'short_form.how_to';

-- Q&A / Mailbag
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "[Asker]. ''[Question verbatim].''", "example": "@john_doe asked: ''Should I delete old posts that don't fit my new niche?''"},
  {"pattern": "Got this DM yesterday. [Question]. Here's my honest answer.", "example": "Got this DM yesterday. ''How do I get clients without having a portfolio?'' Here's my honest answer."},
  {"pattern": "Someone asked me [question]. I've been thinking about it for a week.", "example": "Someone asked me if I'd quit my job again knowing what I know now. I've been thinking about it for a week."}
]$j$::jsonb WHERE slug = 'short_form.qa_mailbag';

-- Reaction / Reframe
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "Saw this take. ''[Claim].'' Let me reframe it.", "example": "Saw this take. ''Hustle culture is killing creators.'' Let me reframe it."},
  {"pattern": "[Public figure / source] said [claim]. They're not wrong, but they're missing [angle].", "example": "Naval said you should pick partners over employees. He's not wrong, but he's missing the early-stage version of this."},
  {"pattern": "[Common advice]. The level it's actually true at is [deeper layer].", "example": "''Build in public.'' The level it's actually true at is week 1, not week 100."}
]$j$::jsonb WHERE slug = 'short_form.reaction';

-- Behind the Scenes
UPDATE public.content_formats SET hook_patterns = $j$[
  {"pattern": "You saw [output]. You didn't see [hidden part].", "example": "You saw the launch. You didn't see the four months of dead-quiet posts before it."},
  {"pattern": "Behind the scenes of [output]. The truth is uglier than the post.", "example": "Behind the scenes of my viral post. The truth is uglier than the screenshot."},
  {"pattern": "Most people post the polished version. Here's the messy one.", "example": "Most people post the polished version. Here's the messy one of how this client deal actually went down."}
]$j$::jsonb WHERE slug = 'short_form.behind_the_scenes';


-- ---------------------------------------------------------------------------
-- REFERENCE SCRIPTS (4 user-provided + room to add more)
-- ---------------------------------------------------------------------------

-- 1. Day In The Life - business trip script
UPDATE public.content_formats SET reference_scripts = $j$[
  {
    "label": "Software engineer business trip - shows specificity, voice, soft close",
    "script": "Today I'm going on a business trip as a software engineer in Big Tech. A couple of co-workers and I are flying in from New York to Bay Area to attend a workshop. And yes, we have flights, meals, hotel, everything covered. But it's not as relaxing as you think. The whole time you're still working and have 5 hour long workshops. Okay, the airport lines were long, but I still got 2 hours to kill after. Because I planned like a father with 3 children. And opened my laptop thinking I'll just check a few things and suddenly I'm writing prod code next to a crying toddler. The flight itself was actually decent. No space issues, that toddler stopped crying. But the food was so forgettable I can't even complain properly. Here is a quick hotel room tour and my little organisation. I also have 2 TVs for no reason. Then I took a shower and ordered sushi and to whoever rolled that spicy tuna, I owe your entire bloodline a debt. And then at 2am, I wake up to the ceiling shaking. Actually shaking. Turns out it was an earthquake. Which is not exactly the kind of team bonding experience I signed up for. Aside from not dying, I'm grateful I get to do this. Day 1 at Google HQ tomorrow."
  }
]$j$::jsonb WHERE slug = 'short_form.day_in_the_life';

-- 2. How-To - psychology hooks script
UPDATE public.content_formats SET reference_scripts = $j$[
  {
    "label": "Psychology hooks - shows tactical specificity, named tools, meta-twist close",
    "script": "Here's how to make someone fall in love with you using psychology. Most people aren't attracted to you initially, they're attracted to how they feel about themselves around you. So if your content makes someone feel calmer, smarter, more capable, then they're much more likely to come back. Your brain hates unfinished business, and that's why you can't stop thinking about that person who never texts you back. So within the first 10 seconds of your video, open with a question, a list, or an unfinished idea, and your viewer physically cannot leave until it's resolved. Our brains feel threatened by what it doesn't recognise, but new creators get this wrong every time. They immediately try to stand out with custom fonts and unique colours, but viewers swipe away because it feels off. So stick to fonts like System on CapCut and Modern on Instagram edits. You never want to just teach your viewers, you want to live in their head. Say the thing that they're too scared to say aloud, the 2am thought that they can't admit to anyone, the car that they dream of having. Live in their world so precisely that their brain stops watching you and starts seeing itself. That's the difference between a viewer and a follower for life. You've completely missed the point. Go back and watch it knowing that every single one of these were being done to you the entire time. Let me know in the comments what you saw the second time."
  }
]$j$::jsonb WHERE slug = 'short_form.how_to';

-- 3. Listicle - dating turn-offs script
UPDATE public.content_formats SET reference_scripts = $j$[
  {
    "label": "Dating turn-offs - shows character voice, comedic illustration per item, vivid scenarios",
    "script": "Top five things that'll turn a woman off. First things first, you either want her or you don't. If you're inconsistent, she's gonna find someone who does. Long line outside her DMs. She already has enough on her plate. Reality TV to watch, good gossip to catch up on, and already can't decide for herself when it comes to what kind of food she wants to eat. Relax. The first thing that she wants and hopes for is for you to come around. The last thing that she wants is for you to come around and play ring around the Rosie. Next. I'm not gonna say all women, but most women, due to my experience, are attracted to leadership. Leaders, men who make their own decisions, and the last thing she wants to see is that you are a follower in your friend group. Listen, my good lad, we all have somebody that we look up to, so even if this is the case, that's alright. Just don't let her see it. If you follow your friends every move, God forbid, what you're gonna be like when you run into your favourite rapper. You're gonna be a holophane groupie. My good lad, you got to be confident in yourself, not for her sake, but for your sake, and let her know that you can make your own decisions. Don't go with the flow. Be it. Are you interested in dating her, or are you interested in dating yourself? If the night's supposed to be about her, if it's going that way, great. Keep it that way. You gotta be obsessed, brother. Not with yourself, with her. She doesn't want to hear your lifelong vent about how you almost made it to the league. Trust me, my brother, she's heard it before. I almost went, though. Oh, my good brother, didn't we all? Have her be the centre of all conversation, and not just a piece of it. When you ask her if there's something wrong, and she says there's nothing wrong, even though you know there's something wrong, then there's nothing wrong. But when you try to push that and fix what's wrong, now there's something wrong. What? Wait, hold up. My good brother, this isn't a big deal, but then again it is. This could be a humongous ick for her, or nothing at all, but when you call for that waiter, you got one shot. My good lad, there's nothing worse than the day going extremely great, you're in a nice restaurant, you try to get that waiter's attention, and you raise your finger and go, excuse me, and the waiter just passes you by. You get one chance, one shot. As soon as you raise that finger and say, excuse me, you get that waiter's attention. Do you hear me? My good lad, yes, I fully understand that it's important to know what she likes, but I think it's more important to know what she doesn't like. Know what she likes, know what she hates, and you're guaranteed to have a second date. Live well. And live long."
  }
]$j$::jsonb WHERE slug = 'short_form.listicle';

-- 4. Personal Learning - 1M followers script
UPDATE public.content_formats SET reference_scripts = $j$[
  {
    "label": "1M followers in 4 months - shows proof-led hook, two-tier answer, named tactics, soft cross-platform close",
    "script": "This is how I got a million followers in four months. The short answer is my 30 Lessons by 30 series. The long answer is all of these. It's no secret that everyone on the internet is doing series, but not everyone's series performs. I honestly did not understand why mine did, but after analysing my content, my comments, and a lot of input from my creator friends, I have found that there are six main attributes to why I think my series worked. First, repetition. Literally saying, this is 30 Lessons by 30 in every single video made it brandable and memorable and you understand what it is immediately. Second, the appointment effect. At the end of every video, I say the next lesson's tomorrow, so follow for more. I make a promise that there'll be more. I tell you when, and that gives you a reason to follow right now. Three, browsability. The thumbnails are clear, consistent, and very recognisable on my profile. Four, visual variety. I just filmed everywhere. Even I didn't know where I'd be filming next. And I think that became an interesting reason to keep watching. Five, distinct editing style. This is self-explanatory. It's easier said than done. I don't even know how to explain my own, but it kind of has to be something new. And finally, rooted and lived in experiences. Every script had to be concrete and specific because nothing irks me more than a video smelling like it was made from AI. I just posted a whole YouTube video breaking down my 1 million journey packed with lessons and insights. Hope this was helpful and let me know what else you'd like to know."
  }
]$j$::jsonb WHERE slug = 'short_form.personal_learning';

-- =============================================================================
-- Done.
-- =============================================================================
