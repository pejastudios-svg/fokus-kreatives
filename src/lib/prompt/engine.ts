import type { BrandProfile } from '@/components/clients/brandProfile'
import {
  ammoBlock as renderAmmoBlock,
  bansBlock as renderBansBlock,
  clientContextBlock,
  commonEnemyLine as renderCommonEnemyLine,
  voiceFingerprintLine,
  voiceSamplesBlock,
} from './brandContext'
import { frameworkBlock, pillarFrameworkBlock } from './framework'

export type Tier = 'beginner' | 'mid' | 'advanced'
export type Pillar = 'educational' | 'storytelling' | 'authority' | 'series' | 'doubledown'
export type ContentType = 'long' | 'short' | 'carousel' | 'story' | 'engagement' | 'text'

export interface BuildInput {
  profile: BrandProfile | null
  tier: Tier
  pillar: Pillar
  contentType: ContentType
  topic: string
  cta?: string
  referenceScript?: string
  seriesDay?: number
  competitorPatterns?: string[]
}

export interface BuiltPrompt {
  system: string
  user: string
  maxTokens: number
  temperature: number
}

export const HARD_BANS = [
  // Em-dash and en-dash - convert to commas via the repair regex; if any
  // survive the repair pass we want them surgically stripped. NOTE: this
  // entry MUST NOT be a plain hyphen ("-"), or surgicalBanRemoval will
  // delete every sentence that uses a compound modifier ("5-part intro",
  // "lead-generating machine", etc.) and findHardBanHit will flag every
  // hyphenated word. (That exact regression shipped once: the em dash
  // below was typo'd to a plain hyphen.)
  '—',
  '–',
  // Rhetorical-fragment-question transitions. These read as conversational
  // but every AI uses them now - they're the new "Here's the thing".
  'and the result?',
  'the result?',
  'the kicker?',
  'and the kicker?',
  'the catch?',
  'and the catch?',
  'the truth?',
  'the secret?',
  'the trick?',
  'plot twist?',
  'spoiler?',
  'and you know what?',
  'and the best part?',
  'but the best part?',
  'and here\'s the best part',
  "here's the best part",
  // Standalone "honestly?" / "honestly," as a vocal-tic transition (the word
  // inside a real sentence - "I was honestly surprised" - is fine).
  'honestly?',
  'honestly,',
  'and honestly,',
  'and honestly',
  'look,',
  // "What most people miss" - generic REHOOK 2 opener, AI tell.
  'what most people miss',
  "what most people don't",
  'most people miss this',
  'most people get wrong',
  // Declarative-variant rhetorical tells. We already ban "the kicker?"
  // (interrogative). The "and the kicker is," / "the kicker is," etc.
  // declarative form is the same tell, different punctuation.
  'and the kicker is',
  'the kicker is,',
  'and the catch is',
  'the catch is,',
  'and the trick is',
  'the trick is,',
  'and the secret is',
  'the secret is,',
  'the truth is,',
  'the real truth is',
  'the wild truth is',
  'and the result is',
  'the result is,',
  "what's wild is",
  "what's crazy is",
  // Generic empathy beats invented when not anchored to raw material.
  'if you\'ve been there',
  'if you\'ve felt this',
  'we\'ve all been there',
  // Common longer AI tells.
  'what if i told you',
  "here's what i've learned",
  "yeah, you read that right",
  'in this video',
  'in this post',
  'welcome back to',
  'buckle up',
  'listen up',
  'game changer',
  'game-changer',
  'game-changing',
  'game changing',
  "let's dive in",
  'secret sauce',
  'picture this,',
  'imagine this,',
  'staring at a blank',
  "hope you're doing well",
  "in today's digital landscape",
  'click-confirm',
  'click confirm',
  "here's the truth",
  'here is the truth',
  "here's the wild truth",
  'the wild truth',
  "here's the hard truth",
  "here's the real truth",
  "here's the ugly truth",
  "here's the plain truth",
  "here's the honest truth",
  "here's the real deal",
  'here is the real deal',
  "here's the real secret",
  "here's the secret",
  'here is the real secret',
  'here is the secret',
  "here's what actually works",
  'here is what actually works',
  "here's what really works",
  'here is what really works',
  // "Here's the thing" - the OG of this whole family.
  "here's the thing",
  'here is the thing',
  // "Here's what changed it for me" family - standalone transition sentences.
  // Any sentence-opening "here's" is a top AI tell; these are the most common
  // forms. The repair regex below strips sentence-initial "here's ..." openers;
  // these literals are a backstop for surgicalBanRemoval.
  "here's what changed it for me",
  'here is what changed it for me',
  "here's what changed everything",
  "here's what i learned",
  "here's what nobody tells you",
  "here's what i wish i knew",
  // Colon-led label patterns - state the thing instead. Section 9.7.
  "what's actually happening:",
  "what i learned:",
  "what they miss:",
  "the bigger lesson:",
  "the takeaway:",
  "the truth is:",
  "here's why:",
  "what they should have said:",
  // Preambles to the final list item - the cadence is the tell.
  "and the last one is the one most people miss",
  "saving the best for last",
  // Generic friendly openers - throat-clearing.
  "hey friend",
  "hi friends",
  "let me tell you",
  "let me share",
  // Noun-phrase versions of common tells. The AI uses these as standalone
  // nouns ("hours of stuck on the first line", "tired of stuck on the first
  // line") which is grammatically broken AND a recurring pattern. Banned
  // outright so the AI rewrites the sentence rather than dropping in this
  // specific phrasing.
  "stuck on the first line",
  "staring at a blank camera",
  "staring at the camera",
  "stuck staring at",
  // Canned YouTube description welcome lines. The brand-voice synthesis
  // in the [DESCRIPTION] 📌 welcome block must be written fresh - these
  // are the stock phrasings every AI defaults to. Surgical removal drops
  // the sentence, leaving the brand-voice paragraph around it intact.
  "if this is your first time here",
  "subscribe below and hit the bell",
  "hit the bell so you",
  "hit that bell",
  "so you don't miss what's coming",
]

type RepairReplacer = string | ((substring: string, ...args: string[]) => string)
const REPAIR_REGEX: Array<{ re: RegExp; replace: RepairReplacer }> = [
  // Em-dash dramatic-reframe pattern only. Targets "X — that's/it's/this is Y"
  // and similar restate-with-punch patterns. Em-dashes for natural pauses
  // are preserved.
  // The previous blanket regex `[-–]` was a bug - it included plain hyphens
  // (U+002D) in addition to en-dashes, corrupting every compound modifier
  // ("Behind-the-Scenes" → "Behind, the, Scenes", "5-part" → "5, part",
  // "lead-generating" → "lead, generating"). Plain hyphens are NEVER touched
  // by sanitize anymore.
  { re: /\s+—\s+(?=(?:that['’]s|it['’]s|this\s+is|those\s+are|they['’]re)\s+)/g, replace: ', ' },
  // General em-dash fallback: any remaining em-dash (parenthetical asides like
  // "your content—scripting and recording—stays consistent") becomes a comma.
  // Targets ONLY the em-dash char (U+2014), never the hyphen-minus, so
  // compound modifiers ("5-part intro", "lead-generating") are untouched.
  { re: /\s*—\s*/g, replace: ', ' },
  // "X is not Y. It's Z." / "X isn't Y. It's Z." → drop the negation clause, keep the positive claim
  { re: /\b(\w[\w\s]{0,30})\s+is\s+not\s+[^.?!]{1,80}[.?!]\s*[Ii]t['’]s\s+/gi, replace: '$1 is ' },
  { re: /\b(\w[\w\s]{0,30})\s+isn['’]t\s+[^.?!]{1,80}[.?!]\s*[Ii]t['’]s\s+/gi, replace: '$1 is ' },
  // Generic subject: "<subject> isn't [just] X; it's Y" / comma / period variants → "<subject> is Y"
  // Matches up to 4-word subjects like "your intro", "The end of your content", "This 5-part intro".
  // Subject words allow hyphens (e.g. "5-part") and bold markdown wrappers (**Intro**) via \*{0,2}[\w-]+\*{0,2}.
  { re: /\b((?:this|that|it|these|those|my|your|our|their|his|her|the|a|an)(?:\s+\*{0,2}[\w-]+\*{0,2}){0,4})\s+(?:\*{0,2})?(?:is\s+not|isn['’]t|are\s+not|aren['’]t)(?:\*{0,2})?(?:\s+(?:just|simply|merely|only))?\s+[^.,;!?]{1,80}[,;.]\s*(?:\*{0,2})?(?:it['’]s|that['’]s|they['’]re|this\s+is|these\s+are)(?:\*{0,2})?\s+/gi, replace: '$1 is ' },
  // Non-negation cousin: "<subject> is (about) more than just X; it's Y" → "<subject> is Y"
  { re: /\b((?:this|that|it|these|those|my|your|our|their|his|her|the|a|an)(?:\s+\*{0,2}[\w-]+\*{0,2}){0,4})\s+(?:is|are)(?:\s+about)?\s+more\s+than\s+(?:just\s+)?[^.,;!?]{1,80}[,;.]\s*(?:it['’]s|that['’]s|they['’]re|this\s+is|these\s+are)\s+/gi, replace: '$1 is ' },
  // Subject-agnostic "X isn't (just) about Y; it's (just) about Z" - catches cases where the subject
  // has no determiner (e.g. "consistent, engaging content isn't about endless effort; it's about ...").
  // The "about" keyword on both sides makes this idiom distinctive enough to rewrite without a determiner anchor.
  // Also handles contracted forms "it's not" / "they're not" via ['’]s\s+not and ['’]re\s+not.
  { re: /\b([A-Za-z][\w,\s-]{1,60}?)\s+(?:['’]s\s+not|['’]re\s+not|is\s+not|isn['’]t|are\s+not|aren['’]t)(?:\s+(?:just|simply|merely|only))?\s+about\s+[^.,;!?]{1,80}[,;.]\s*(?:it['’]s|that['’]s|they['’]re|this\s+is|these\s+are)(?:\s+(?:just|simply|merely|only))?\s+about\s+/gi, replace: '$1 is about ' },
  // Same construction but connector is "but" instead of "it's": "X isn't about Y, but Y'" → "X is about Y'".
  { re: /\b([A-Za-z][\w,\s-]{1,60}?)\s+(?:['’]s\s+not|['’]re\s+not|is\s+not|isn['’]t|are\s+not|aren['’]t)(?:\s+(?:just|simply|merely|only))?\s+about\s+[^.,;!?]{1,80}[,;]\s*but\s+(?:rather\s+|instead\s+)?(?:just\s+|simply\s+|merely\s+|only\s+)?(?:about\s+)?/gi, replace: '$1 is about ' },
  // "<determiner subject> isn't/aren't (just) X, but Y" → "<subject> is/are Y" (general, not "about"-gated).
  // Catches the AI tell "the problem wasn't just *what* to say, but *how* to say it" → "the problem was *how* to say it".
  { re: /\b((?:this|that|it|these|those|my|your|our|their|his|her|the|a|an)(?:\s+\*{0,2}[\w-]+\*{0,2}){0,4})\s+(?:isn['’]t|aren['’]t|is\s+not|are\s+not)(?:\s+(?:just|simply|merely|only))?\s+[^.,;!?]{1,60}[,;]\s+but\s+(?:rather\s+|instead\s+)?(?:just\s+|simply\s+|merely\s+|only\s+)?/gi, replace: '$1 is ' },
  // Past-tense version: "<determiner subject> wasn't/weren't (just) X, but Y" → "<subject> was/were Y".
  { re: /\b((?:this|that|it|these|those|my|your|our|their|his|her|the|a|an)(?:\s+\*{0,2}[\w-]+\*{0,2}){0,4})\s+(?:wasn['’]t|weren['’]t|was\s+not|were\s+not)(?:\s+(?:just|simply|merely|only))?\s+[^.,;!?]{1,60}[,;]\s+but\s+(?:rather\s+|instead\s+)?(?:just\s+|simply\s+|merely\s+|only\s+)?/gi, replace: '$1 was ' },
  // Auxiliary-verb negation: "<pronoun> don't/doesn't (just) X; <pronoun> Y" → "<pronoun> Y".
  // Drops the negation clause and the repeated subject, keeping only the positive Y clause.
  // The just/simply/merely qualifier is REQUIRED. Without it this rule ate
  // plain negation + new sentence ("it doesn't go in. This approach...")
  // and left mangled prose in live captions. The AI-tell reframe always
  // carries the qualifier ("doesn't just X; it Y") - match only that.
  { re: /\b(I|we|you|they|he|she|it)\s+(?:do\s+not|don['’]t|does\s+not|doesn['’]t|didn['’]t)\s+(?:just|simply|merely|only)\s+[^.,;!?]{1,80}[,;.]\s*(?:I|we|you|they|he|she|it)\s+/gi, replace: '$1 ' },
  // Noun-subject auxiliary-verb negation: "<determiner + noun> doesn't (just) X; it Y" → "<subj> Y".
  // Catches "This intro doesn't just tell them what's coming; it makes them feel understood."
  // Pivot clause accepts bare pronoun + verb (not only "it's" / "that's").
  // Qualifier required here too - same false-positive class as above.
  { re: /\b((?:this|that|it|these|those|my|your|our|their|his|her|the|a|an)(?:\s+\*{0,2}[\w-]+\*{0,2}){0,4})\s+(?:do\s+not|don['’]t|does\s+not|doesn['’]t|didn['’]t)\s+(?:just|simply|merely|only)\s+[^.,;!?]{1,80}[,;.]\s*(?:it|that|they|this|these|those)\s+/gi, replace: '$1 ' },
  // Broadest subject-agnostic pivot: "<anything> isn't (just) Y; it's Z" - catches adjective-led
  // subjects like "consistent, engaging content isn't magic; it's a pattern" that slip past the
  // determiner-anchored rule. Runs AFTER the specific rules so those take priority.
  // Only triggers on comma/semicolon pivots (NOT period), to avoid eating legitimate cross-sentence
  // statements like "The team isn't here. It's her birthday."
  { re: /\b([A-Za-z][\w,\s-]{1,60}?)\s+(?:['’]s\s+not|['’]re\s+not|is\s+not|isn['’]t|are\s+not|aren['’]t)(?:\s+(?:just|simply|merely|only))?\s+[^.,;!?]{1,60}[,;]\s*(?:it['’]s|that['’]s|they['’]re|this\s+is|these\s+are)(?:\s+(?:just|simply|merely|only))?\s+/gi, replace: '$1 is ' },
  // "It's not X, it's Y" / "That's not X, that's Y" → drop the negation, keep Y
  { re: /\bit['’]s\s+not(?:\s+(?:just|simply|merely|only))?\s+[^.,;!?]{1,60}[,;.]?\s*it['’]s\s+/gi, replace: "it's " },
  { re: /\bthat['’]s\s+not(?:\s+(?:just|simply|merely|only))?\s+[^.,;!?]{1,60}[,;.]?\s*that['’]s\s+/gi, replace: "it's " },
  { re: /\bthis isn['’]t (?:a|an) [^.,;]{1,60}[,;.]?\s*it['’]s (a|an)\s+/gi, replace: "it's $1 " },
  // "Here's the [wild|hard|real|ugly|plain|honest|contrarian|simple|uncomfortable] truth" → strip entirely
  { re: /\bhere['’]s\s+(?:the\s+(?:wild\s+|ugly\s+|hard\s+|real\s+|plain\s+|honest\s+|contrarian\s+|simple\s+|uncomfortable\s+)?truth)\s*[:,.]?\s*/gi, replace: '' },
  { re: /\bhere is\s+(?:the\s+(?:wild\s+|ugly\s+|hard\s+|real\s+|plain\s+|honest\s+|contrarian\s+|simple\s+|uncomfortable\s+)?truth)\s*[:,.]?\s*/gi, replace: '' },
  // "Here's the [real|hidden|simple|contrarian] secret" family - same AI-transition tell as "truth"
  { re: /\bhere['’]s\s+(?:the\s+(?:real\s+|hidden\s+|simple\s+|contrarian\s+|wild\s+)?secret)\s*[:,.]?\s*/gi, replace: '' },
  { re: /\bhere is\s+(?:the\s+(?:real\s+|hidden\s+|simple\s+|contrarian\s+|wild\s+)?secret)\s*[:,.]?\s*/gi, replace: '' },
  // "Here's the real deal" variants
  { re: /\bhere['’]s\s+the\s+real\s+deal\s*[:,.]?\s*/gi, replace: '' },
  { re: /\bhere is\s+the\s+real\s+deal\s*[:,.]?\s*/gi, replace: '' },
  // "Here's what actually works" / "Here's what really works" - same transition-tell family
  { re: /\b(?:but\s+)?here['’]s\s+what\s+(?:actually|really)\s+works\s*[:,.]?\s*/gi, replace: '' },
  { re: /\b(?:but\s+)?here is\s+what\s+(?:actually|really)\s+works\s*[:,.]?\s*/gi, replace: '' },
  // "Here's what changed it for me" family - strip the whole opener even at end of text.
  { re: /\bhere(?:['’]s| is)\s+what\s+(?:changed|fixed)\s+(?:it|everything)\s+for\s+me\s*[:,.]?\s*/gi, replace: '' },
  // General sentence-initial "Here's <short clause>." transition. Only fires when
  // the opener is a SHORT standalone sentence (no colon, <=45 chars) followed by
  // another sentence, so we strip the runway without eating content sentences or
  // colon-led "here's why:" patterns (handled above). Capitalization of the next
  // sentence is restored by the post-repair capitalization pass below.
  { re: /(^|[.!?]['’"”)\]]*\s+|\n\s*)here(?:['’]s| is)\s+[^.!?:\n]{0,45}[.!?]\s+/gi, replace: '$1' },
  // Meta-writing jargon leaking into the script voice (soft-rewrite, keeps sentence flow)
  { re: /\bclick[-\s]?confirm(?:ing|ed|s)?\s+the\s+(title|video|topic)\b/gi, replace: 'confirm what the $1 promises' },
  { re: /\bclick[-\s]?confirm(?:ing|ed|s)?\b/gi, replace: 'confirm' },
  { re: /\b(?:directly\s+)?echoes?\s+and\s+confirms?\s+the\s+(title|video|topic)\b/gi, replace: 'confirms what the $1 promises' },
  // Broader "echoes and confirms whatever/your promise/hook/claim..." variant
  { re: /\b(?:directly\s+)?echoes?\s+and\s+confirms?\s+(?:whatever|the|your|that)\s+(?:promise|claim|point|hook|title|video|topic|headline|post)[^.,;!?]{0,60}/gi, replace: 'confirms what the title promises' },
  { re: /\b(?:directly\s+|immediately\s+)?echoing\s+and\s+confirming\s+(?:whatever|the|your|that)\s+(?:promise|claim|point|hook|title|video|topic|headline|post)[^.,;!?]{0,60}/gi, replace: 'confirming what the title promises' },
  // Gerund form: "echoing the title and confirming what the video is about"
  { re: /\b(?:immediately\s+|directly\s+)?echoing\s+(?:the|your)\s+(title|video|topic|post|headline)\s+and\s+confirming\s+(?:what|that)\s+(?:the|your)\s+(?:video|title|topic|post)\s+is\s+about\b/gi, replace: 'confirming what the $1 promises' },
  // Paraphrased variants that also leak meta-writing voice
  { re: /\bdirectly\s+echo(?:es|ing|ed)?\s+(?:what|the)\s+(?:your|the)\s+(?:video|title|topic|post)\s+is\s+about\b/gi, replace: 'confirm what the video promises' },
  { re: /\bdirectly\s+echo(?:es|ing|ed)?\s+(?:the|your)\s+(title|video|topic|post|headline)\b/gi, replace: 'confirm the $1' },
  { re: /\bechoes?\s+(?:the|your)\s+(title|headline|topic)\b/gi, replace: 'confirms the $1' },
  // Meta-jargon swaps with article rewrite so "a curiosity loop" doesn't become "a open question".
  { re: /\ba\s+hook\s+stack\b/gi, replace: 'a five-part intro' },
  { re: /\ban\s+hook\s+stack\b/gi, replace: 'a five-part intro' },
  { re: /\bhook\s+stack\b/gi, replace: 'five-part intro' },
  { re: /\ba\s+scroll[-\s]?stopper\b/gi, replace: 'an attention-grabber' },
  { re: /\ban\s+scroll[-\s]?stopper\b/gi, replace: 'an attention-grabber' },
  { re: /\bscroll[-\s]?stopper\b/gi, replace: 'attention-grabber' },
  { re: /\bscroll[-\s]?stop(?:ping)?\b/gi, replace: 'attention-grabbing' },
  { re: /\ba\s+pattern\s+interrupt\b/gi, replace: 'an unexpected opener' },
  { re: /\ban\s+pattern\s+interrupt\b/gi, replace: 'an unexpected opener' },
  { re: /\bpattern\s+interrupt\b/gi, replace: 'unexpected opener' },
  { re: /\ba\s+curiosity\s+loop\b/gi, replace: 'an open question' },
  { re: /\ban\s+curiosity\s+loop\b/gi, replace: 'an open question' },
  { re: /\bcuriosity\s+loop\b/gi, replace: 'open question' },
  // Filler starters - strip, keep rest of sentence. Every phrase needs a
  // trailing \b before the optional "?" or it matches INSIDE longer words:
  // "and the result" without \b ate the front of "and the resulting
  // burnout", leaving "here's what happened.ing burnout" in a live script.
  //
  // "and the result" additionally REQUIRES the "?" - the target is only the
  // dramatic-question tic ("...and the result?"). Without that anchor it
  // matched the ordinary continuation "and the result was better retention"
  // and produced "here's what happened. was better retention".
  { re: /\band the result\?/gi, replace: "here's what happened." },
  { re: /^\s*the result\??$/gim, replace: "here's what happened." },
  { re: /\band you know what\b\??\s*/gi, replace: '' },
  { re: /\b(?:and|but)\s+(?:here['’]s\s+)?the best part\b\??\s*/gi, replace: '' },
  { re: /\bhere['’]s the best part\b\??\s*/gi, replace: '' },
  { re: /\bwhat if i told you\b[,.]?\s*/gi, replace: '' },
  { re: /\bhere['’]s what i['’]ve learned\b[,.]?\s*/gi, replace: "what I figured out was" },
  { re: /\byeah,?\s*you read that right\b[,.]?\s*/gi, replace: '' },
  { re: /\bhere['’]s the thing\b[,.]?\s*/gi, replace: '' },
  { re: /\blet me (show|explain)(?:\s+you)?\b[,.]?\s*/gi, replace: '' },
  { re: /\bin this (video|post)\b[:,]?\s*/gi, replace: '' },
  { re: /\b(stare|staring)\s+at\s+(a\s+)?blank\s+(page|screen)\b/gi, replace: 'stuck on the first line' },
  { re: /\b(blank)\s+(page|screen)\b/gi, replace: 'empty draft' },

  // "you're not (just) X; you're Y" / "I'm not X, I'm Y" - contracted-be
  // negation pivot. Not covered by the do/does/don't catcher above.
  { re: /\b(I|we|you|they|he|she|it)['’]?(?:m|re|s)?\s+not(?:\s+(?:just|simply|merely|only))?\s+[^.,;!?]{1,80}[,;.]\s*(?:I|we|you|they|he|she|it)['’]?(?:m|re|s)?\s+/gi, replace: '$1 ' },

  // Empty quoted phrase left behind when the sanitizer strips a banned word
  // from inside quotes ("This is your "" moment" → "This is your moment").
  { re: /\s*[""]\s*[""]\s*/g, replace: ' ' },
  { re: /\s*"\s*"\s*/g, replace: ' ' },

  // Declarative sentence accidentally ending with a question mark - model
  // tic where it ends statements like "...without the burnout?" or
  // "...cuts through the noise?". The allowlist below covers anything that
  // could legitimately start a question, including imperative-style verbs
  // ("want", "need", "got", "ready", "tell", "let", "try", "think", "ever",
  // "feel"). If the sentence opens with one of those, leave the '?' alone.
  {
    re: /(^|[.!?]\s+)(?!(?:how|what|why|when|where|who|which|can|could|do|does|did|is|are|am|was|were|will|would|should|may|might|must|have|has|had|so|want|need|got|ready|tell|let|try|think|ever|feel|been|fancy|wanna|gonna|sure|guess|wonder|see|know|remember|notice|imagine)\b)([A-Z][^?.!]{8,200}?)\?/gi,
    // Function replacer: a sentence can open with a statement-y word and
    // still be a real question via a mid-sentence pivot ("Value or Volume,
    // which side are you on?"). If a question indicator appears after a
    // comma inside the span, keep the '?'.
    replace: ((m: string, pre: string, body: string) =>
      /,\s*(?:which|what|why|how|who|where|when|are|is|am|do|does|did|can|could|will|would|should|or)\b/i.test(body)
        ? m
        : `${pre}${body}.`) as (substring: string, ...args: string[]) => string,
  },

  // Common paired-adjective AI stacks - strip the redundant adjective.
  // Conservative: only the highest-frequency offenders so we don't eat
  // legitimate phrasing.
  { re: /\bconsistent,\s+engaging\b/gi, replace: 'consistent' },
  { re: /\bclear,\s+valuable,?\s+and\s+actionable\b/gi, replace: 'actionable' },
  { re: /\bclear,\s+concise\b/gi, replace: 'clear' },
  { re: /\bsimple,\s+repeatable\b/gi, replace: 'repeatable' },
  { re: /\bspecific,\s+actionable\b/gi, replace: 'actionable' },
  { re: /\bcompelling,\s+engaging\b/gi, replace: 'engaging' },

  // AI clichés that survived earlier passes.
  { re: /\bgot\s+the\s+receipts?\b/gi, replace: 'have proof' },
  { re: /\breinvent(?:ing)?\s+the\s+wheel\b/gi, replace: 'starting from scratch' },
  { re: /\bmagic\s+well\s+of\s+(?:endless\s+)?ideas?\b/gi, replace: 'an endless supply of ideas' },
  { re: /\bevery\s+single\s+(day|week|time|month)\b/gi, replace: 'every $1' },
  { re: /\byou\s+just\s+watched\s+how\s+to\s+/gi, replace: 'use this to ' },

  // Tag-question filler at end of sentence: "...impossible task, right?"
  { re: /,\s*right\?/g, replace: '.' },
  // Standalone "You know?" / "You know." filler sentence. The ?-stripper
  // turns the tic "You know?" into the even worse fragment "You know." -
  // either way the sentence carries nothing. Drop it entirely.
  { re: /(^|[.!?]\s+)you know[.?!]\s*/gi, replace: '$1' },
  // Question openers the model writes with a period: "Want my content
  // system. Comment FRAMEWORK below." The opener is a question - restore
  // the "?" when it's immediately followed by an imperative CTA verb.
  { re: /\b(want|need)(\s+(?:my|your|the|this|our|a|an)\s+[^.!?\n]{1,60})\.(\s+(?:comment|dm|save|follow|drop|reply))/gi, replace: '$1$2?$3' },

  // ", and honestly," / "and honestly," softener mid-sentence transition.
  { re: /,?\s+and honestly,?\s+/gi, replace: ', ' },
  // "What most people miss is..." / "What most people don't realize is..." - REHOOK 2 AI tell.
  { re: /\bwhat most people miss is(?:\s+that)?\s+/gi, replace: '' },
  { re: /\bwhat most people don['’]t (?:realize|see|get) is(?:\s+that)?\s+/gi, replace: '' },
  { re: /\bmost people (?:miss|don['’]t see) this[.,]?\s+/gi, replace: '' },
  // Generic empathy beats - drop entirely when they appear as standalone clauses.
  { re: /\b(?:if\s+you['’]ve\s+been\s+there|if\s+you['’]ve\s+felt\s+this|we['’]ve\s+all\s+been\s+there)[,.]?\s+/gi, replace: '' },
  // a/an article repair for common offenders. The AI occasionally writes
  // "a empty draft" / "a AI script" / "a important takeaway" - vowel-led
  // words that need "an". Curated list rather than universal vowel-check
  // because exceptions exist ("a unique", "a one-time" - consonant sound
  // despite vowel start; "an hour", "an honest" - vowel sound despite
  // consonant start).
  { re: /\ba\s+(?=(?:empty|AI|important|awesome|amazing|easy|easier|effective|even|ever|honest|hour|hours|impossible|incredible|insane|interesting|obvious|open|opening|empty|outrageous|absolute|absolute|enormous|odd|adamant|early|easy|elegant|enthusiastic|excellent|exhausted|engineered)\b)/g, replace: 'an ' },
  // Broken multi-word hashtag with embedded space. Catches "#fokus
  // kreativez" (brand-name with space) and joins to "#fokuskreativez".
  // Constrained to hashtag-list context by requiring the match be
  // followed by another hashtag, end of line, or end of string - so
  // prose like "from #framework approach" is left alone.
  { re: /(#\w+)\s+(\w+)(?=\s+#|\s*\n|\s*$)/g, replace: '$1$2' },
  // Caps-for-emphasis on common pronouns + adjectives mid-sentence. Matches
  // when surrounded by whitespace/punctuation so proper nouns and acronyms
  // are preserved. Only trips when the word is fully capped AND it's a
  // known emphasis target (these specific words signal "I'm trying to
  // emphasize this" rather than "this is a brand name").
  { re: /(\s)YOU(\s|[.,!?;:'])/g, replace: '$1you$2' },
  { re: /(\s)YOUR(\s|[.,!?;:'])/g, replace: '$1your$2' },
  { re: /(\s)YOURS(\s|[.,!?;:'])/g, replace: '$1yours$2' },
  { re: /(\s)NOT(\s|[.,!?;:'])/g, replace: '$1not$2' },
  { re: /(\s)REAL(\s|[.,!?;:'])/g, replace: '$1real$2' },
  { re: /(\s)THIS(\s|[.,!?;:'])/g, replace: '$1this$2' },
  { re: /(\s)THAT(\s|[.,!?;:'])/g, replace: '$1that$2' },
  { re: /(\s)ME(\s|[.,!?;:'])/g, replace: '$1me$2' },
  { re: /(\s)MINE(\s|[.,!?;:'])/g, replace: '$1mine$2' },
  // Additional caps-for-emphasis offenders that slip through. Same word-
  // boundary logic - only trips when the word is fully capped AND surrounded
  // by whitespace/punctuation. Acronyms ("EVERY framework's KPI is X") are
  // not affected; only the standalone caps form is rewritten.
  { re: /(\s)ONE(\s|[.,!?;:'])/g, replace: '$1one$2' },
  { re: /(\s)ANY(\s|[.,!?;:'])/g, replace: '$1any$2' },
  { re: /(\s)EVERY(\s|[.,!?;:'])/g, replace: '$1every$2' },
  { re: /(\s)NEVER(\s|[.,!?;:'])/g, replace: '$1never$2' },
  { re: /(\s)FEEL(\s|[.,!?;:'])/g, replace: '$1feel$2' },
  { re: /(\s)MUST(\s|[.,!?;:'])/g, replace: '$1must$2' },
  { re: /(\s)ALWAYS(\s|[.,!?;:'])/g, replace: '$1always$2' },
  // Progressive-aspect contraction repair. Common AI tell: "I just learning
  // this" / "You just starting out" - drops the auxiliary BE. The fix is
  // mechanical: inject "'m" / "'re" before "just <verb-ing>". Targets only
  // -ing verbs to avoid corrupting the legitimate "I just learned" simple
  // past form. Restricted to mid-sentence (preceded by whitespace) to skip
  // sentence-initial cases that may be deliberate stylistic fragments.
  { re: /(\s)I\s+just\s+(\w+ing)\b/g, replace: "$1I'm just $2" },
  { re: /(\s)You\s+just\s+(\w+ing)\b/g, replace: "$1You're just $2" },
  { re: /(\s)you\s+just\s+(\w+ing)\b/g, replace: "$1you're just $2" },
  { re: /(\s)We\s+just\s+(\w+ing)\b/g, replace: "$1We're just $2" },
  { re: /(\s)we\s+just\s+(\w+ing)\b/g, replace: "$1we're just $2" },
  // Bare pronoun + gerund without an aux verb. Common AI tell: "I taking
  // their ingredients", "You documenting your reality", "We building a
  // system". Restricted to a narrow gerund whitelist of high-frequency
  // offenders that almost never appear as parenthetical insertions in
  // legitimate prose ("I, running late, missed the bus" type cases would
  // need their own grammatical structure - which we don't catch here).
  // Only fires when the pronoun is the FIRST token of the clause (after
  // sentence-ending punctuation or start-of-line), so noun-clause uses
  // ("the report I writing showed...") are not affected.
  { re: /(^|[.!?]\s+)I\s+(taking|making|doing|writing|building|trying|working|creating|teaching|sharing|talking|using|running|showing|telling|asking|giving|finding|getting|calling|seeing|reading|adding|playing|sending|reading|reviewing)\b/g, replace: "$1I'm $2" },
  { re: /(^|[.!?]\s+)You\s+(taking|making|doing|writing|building|trying|working|creating|teaching|sharing|talking|using|running|showing|telling|asking|giving|finding|getting|calling|seeing|reading|adding|playing|sending|reviewing)\b/g, replace: "$1You're $2" },
  { re: /(^|[.!?]\s+)We\s+(taking|making|doing|writing|building|trying|working|creating|teaching|sharing|talking|using|running|showing|telling|asking|giving|finding|getting|calling|seeing|reading|adding|playing|sending|reviewing)\b/g, replace: "$1We're $2" },
  // Comma splice repair: ", I/he/she/we/they <verb>" where the comma should
  // be a period. Narrow trigger to specific past-tense / simple-present
  // verbs that signal an independent-clause continuation rather than a
  // legitimate appositive ("I, frustrated, walked away" - won't match
  // because "frustrated" isn't in the verb list).
  { re: /,\s+(I|he|she|we|they|you)\s+(spent|tried|did|said|went|made|wrote|built|saw|told|gave|bought|paid|got|had)\b/g, replace: ". $1 $2" },
  // Meta-writing leaks - phrases that address the writer/team, not the
  // viewer. These are scaffolding the AI accidentally bleeds into the
  // spoken script. Strip the lead-in entirely (the actual content beat
  // following it usually stands on its own).
  { re: /\bthis\s+is\s+(?:a\s+great|the\s+perfect|a\s+good)\s+place\s+to\s+(?:mention|insert|add|drop|plug|cite|note)\b[^.,;!?]{0,80}[.,;]?\s*/gi, replace: '' },
  { re: /\b(?:remember|note|also)\s+to\s+(?:mention|insert|include|add|cite)\b[^.,;!?]{0,80}[.,;]?\s*/gi, replace: '' },
  { re: /\b\(?\s*(?:insert|add|mention)\s+(?:a\s+)?(?:b-?roll|graphic|callout|card|cta|link|product|tool)[^)]{0,80}\)?\s*/gi, replace: '' },
  // Reverse direction - declarative ending in `?`. The AI sometimes
  // closes a long declarative clause with a question mark when the clause
  // FEELS rhetorical to it ("which is why most people freeze and give up?",
  // "which are things like polls or contrarian one-liners?"). The `which
  // is/are/was/were` relative clause cannot grammatically form a question
  // - the antecedent is the question target, not the relative clause - so
  // any `?` ending a `which is/are` clause is wrong. Convert to `.`.
  // Narrow trigger words (which is/are/was/were) keeps this safe; we don't
  // touch true questions like "Which is faster?" because those don't
  // have a preceding clause + comma to anchor the relative reading.
  { re: /(,\s+which\s+(?:is|are|was|were)\s+[^.?!]{1,120})\?/gi, replace: '$1.' },
  // Run-on join repair. Scripts occasionally produce "...steps in order. That's
  // the framework." or "...beats together. That's how it works." where the
  // demonstrative "That's" awkwardly references the prior sentence. Convert to
  // a comma continuation so the second clause flows naturally. Restricted to
  // these specific connector phrases to avoid touching legitimate "That's"
  // sentence starts.
  { re: /\b(in\s+order|together|in\s+sequence|step\s+by\s+step)\.\s+That['’]s\s+/g, replace: '$1, which is ' },
  // Capitalized continuation after "etc.)": "...(Scene, Proof, etc.) To a specific X."
  // The model treats "etc." as a sentence terminator and capitalizes the next
  // word, but the sentence continues. Lowercase it. Narrow trigger: only fires
  // for prepositions / common continuation words that would never legitimately
  // start a new sentence right after a parenthetical "etc.)".
  { re: /(\betc\.\)\s+)(To|At|On|In|By|For|With|From|Of|As|Into|Onto)\b/g, replace: (_m: string, p1: string, p2: string) => p1 + p2.toLowerCase() },
  // Predicate-less subject repair: "<and> your 'X' answer, where you Y. That's Z"
  // → "<and> your 'X' answer, where you Y, that's Z." The first "sentence" has
  // no main predicate ("your X answer, where you Y" is a noun + relative clause
  // only); the period before "That's" is the bug. Apposition via comma fixes
  // the fragment. Narrow lead-in (`your <quoted-noun> answer, where`) so we
  // don't touch real prose ending in a `where`-clause.
  { re: /\b((?:and\s+)?your\s+['"‘’“”][^'"‘’“”]+['"‘’“”]\s+answer,?\s+where\s+(?:you|I|we|they)\s+\w+(?:\s+[^.?!]{0,80})?)\.\s+That['’]s\s+/gi, replace: '$1, that\'s ' },
  // Conditional missing antecedent: "...secret sauce is 'X.' If they won't Y."
  // The conditional has no IF-clause - the AI dropped the antecedent. Fix by
  // injecting "If they don't, " (the implied antecedent for the most common
  // failure shape we see). The lead-in allows an optional closing quote
  // (straight or curly) so the pattern fires when the prior sentence ended
  // inside a quote: ".'  If they..." or ".'  If you..."
  { re: /([.!?][\*'’"`“”]?)\s+If\s+(they|you)\s+won['’]t\s+([a-z]\w+(?:\s+[^.?!,]{0,60})?)\.(['’"`“”]?)(?=\s|$)/g, replace: "$1 If $2 don't, $2 won't $3.$4" },
  // Same conditional-without-antecedent pattern, uncontracted form: "...feel
  // the pain. If they will not care about your solution." Mirror the same
  // restoration: insert "don't, " as the implicit antecedent.
  { re: /([.!?][\*'’"`“”]?)\s+If\s+(they|you)\s+will\s+not\s+([a-z]\w+(?:\s+[^.?!,]{0,60})?)\.(['’"`“”]?)(?=\s|$)/g, replace: "$1 If $2 don't, $2 will not $3.$4" },
  // Conditional-without-antecedent, "can't" form: "...needs a real contrarian
  // opinion plus a specific case study. If you can't use the recipe." The
  // "If you can't" clause is dangling - no condition was stated. Inject
  // "If you don't have one, " as the implicit antecedent for the most common
  // failure shape. Tightened to no comma in body so grammatical "If you
  // can't X, Y" continuations are not touched.
  { re: /([.!?][\*'’"`“”]?)\s+If\s+(they|you)\s+can['’]t\s+([a-z]\w+(?:\s+[^.?!,]{0,60})?)\.(['’"`“”]?)(?=\s|$)/g, replace: "$1 If $2 don't have one, $2 can't $3.$4" },
  // Missing gerund after "stop": "you can stop stuck on..." -> "you can stop
  // being stuck on...". Narrow trigger: "stop" + adjective participle. The
  // adjective list is intentionally short (just the failure shapes we've
  // observed) to avoid false positives on legitimate "stop angry shouting"
  // / "stop slow loading" type prose.
  { re: /\bstop\s+(stuck|frozen|paralyzed|confused)\b/g, replace: 'stop being $1' },
  // Period before a closing quote when the quoted text starts with a
  // question word - common AI tell in fragments like "Instead of asking
  // 'what should we post.'" - convert the period to a question mark.
  // Targets only quoted fragments to avoid over-matching declaratives that
  // happen to start with "what" / "how" / etc. Catches both straight
  // ASCII quotes ("'`) AND curly/smart quotes (" " ' ' ` `).
  //
  // The body of the question allows apostrophes (straight + curly) so
  // contractions inside the question (didn't / don't / won't / it's)
  // don't break the match. We still exclude OPENING-quote characters
  // ("/'/`/'/`/curly-doubles) to keep the match anchored to a single
  // quoted fragment. Closing quote can be any of those quote characters
  // OR a sentence-final apostrophe (some scripts use bare-apostrophe
  // close after a period: "what's the catch.'").
  { re: /((?:what|how|why|when|where|who|which)[^.?!"`“”]{1,60})\.(["`'‘’“”])/gi, replace: '$1?$2' },
  // Unquoted question fragment ending in a period. Catches "Where were
  // you." / "And what was the proof." that appear inside a list of
  // questions ("5 questions: Where were you. What did you try?...") or
  // mid-sentence after a comma ("If you've felt that, what was the
  // worst line it ever gave you."). The leading delimiter list now
  // includes comma so post-clause questions get caught. Constrained to
  // question-word + auxiliary-verb to avoid over-matching noun clauses
  // like "What I learned was helpful." Case-insensitive so lowercase
  // "what was" / "where did" caught too (real failure: "...actually
  // worked? And what was the result." stayed unfixed because of casing).
  { re: /([:,.!?]\s+)((?:And\s+|Or\s+|But\s+|So\s+)?(?:What|How|Why|When|Where|Who|Which)\s+(?:was|were|is|are|did|do|does|will|would|can|could|should|has|have|had|am)\b[^.?!]{1,80})\.(?=\s|$)/gi, replace: '$1$2?' },
  // Contraction-led question: "What's your fix for X.", "How's your week.",
  // "Where's the catch." - common AI tell where a captioned question ends
  // in a period instead of a question mark. The contraction "'s" already
  // implies the auxiliary verb, so we don't need a separate aux check;
  // we DO require something after the contraction (otherwise "What's." is
  // not a real question). Case-insensitive for the same reason as above.
  { re: /([:.!?]\s+|^)((?:And\s+|Or\s+|But\s+|So\s+)?(?:What|How|Why|When|Where|Who)['’]s\s+\w+[^.?!]{1,80})\.(?=\s|$)/gmi, replace: '$1$2?' },
  // Label-prefixed question without auxiliary verb. Catches:
  //   "TURNING POINT: What changed your direction." -> "?"
  //   "FRAMEWORK: What method finally worked." -> "?"
  //   "FAILED ATTEMPT: How did this even start." (already covered by aux
  //    pattern but harmless to double-match).
  // The aux-verb pattern above (`What did | What was | ...`) misses bare-
  // verb questions ("What changed", "What worked", "What method..."). The
  // all-caps label prefix is what makes this safe to widen - prose rarely
  // has the form "<ALL CAPS LABEL>: <wh-word> <bare verb>." outside of
  // structured Q&A blocks. The negative lookahead blocks pronoun-led noun
  // clauses ("What I learned.", "What you did.") which DO appear in normal
  // prose and are not questions.
  { re: /((?:^|[\s,(])[A-Z][A-Z\s]{1,30}:\s+)((?:What|How|Why|When|Where|Who|Which)\s+(?!(?:I|we|you|they|he|she|it|that|this|these|those)\b)[a-z]\w*(?:\s+[^.?!]{0,60})?)\.(?=\s|$)/g, replace: '$1$2?' },
  // Inline separator after "Connect with X!" header repair. The brand
  // template requires the "===========================" separator to live
  // on its OWN line above and below the header. The AI occasionally
  // collapses the second separator onto the same line as the header
  // ("Connect with me! =============================="). Push it onto
  // the next line.
  { re: /(Connect\s+with\s+(?:us|me)!)\s+(={20,})/g, replace: '$1\n$2' },
  // Duplicate "Connect with us/me!" block collapser. The AI sometimes
  // renders the entire Connect block twice - once with handles, once
  // empty. Detect a SECOND occurrence of the header-with-separators that
  // has no body lines (no handle bullets) before the next blank line and
  // strip it. Restricted to the empty-second-block case so we don't
  // delete a legitimately-handle-bearing duplicate (which would itself
  // be a separate bug, but we leave that to manual review).
  { re: /\n\s*={20,}\s*\n\s*Connect\s+with\s+(?:us|me)!\s*\n?\s*={20,}\s*\n(?=\s*\n|\s*={3,}|\s*📌)/g, replace: '\n' },
  // Long-form description section header all-caps repair. Catches:
  //   "📌 WHO this IS FOR:" -> "📌 WHO THIS IS FOR:"
  //   "📌 Who This is For:" -> "📌 WHO THIS IS FOR:"
  // The `📌 WHO THIS IS FOR:` header MUST be fully uppercase per the brand
  // template. The AI occasionally lowercases an interior word; this regex
  // repairs the whole header in one shot.
  { re: /(📌\s*)who\s+this\s+is\s+for(\s*:)/gi, replace: '$1WHO THIS IS FOR$2' },
  // Same for "ABOUT" header - the emoji + "ABOUT" should always be
  // uppercase. The lookahead allows whitespace OR direct colon
  // ("📌 about Fokus:" and "📌 ABOUT:" both repaired) without consuming
  // the trailing char so callers can append the original brand name
  // / colon as-is.
  { re: /(📌\s*)about(?=[\s:])/gi, replace: (_m: string, p1: string) => `${p1}ABOUT` },
  // Question fragment inside a slide-list bullet. Catches:
  //   "Slide 7: 4. Framework: What steps finally worked."
  //   "Slide 4: Q1: SCENE - Where were you when this started."
  //   "Slide 6: Q3: TURNING POINT - What changed your direction."
  // The prefix between "Slide N:" and the question word can be many
  // shapes (numbered, lettered, dashed, colon-led, including a period
  // after a list number like "4. Framework"). We allow up to 40 chars
  // of anything except `?`/`!`/newline (period IS allowed - "4." is a
  // common list separator inside the prefix).
  { re: /(\bSlide\s+\d+:\s+[^?!\n]{0,40}?)\b((?:What|How|Why|When|Where|Who|Which)\s+\w+[^.?!]{1,60})\.(?=\s|$)/gi, replace: '$1$2?' },
  // Strip meta format-type words from the [TITLE] section, anywhere
  // they appear within the title line. The title is an internal label;
  // having "Carousel" / "Reel" / "Engagement Reel" / "Hero's Journey" /
  // "Short-form" / "Long-form" appear in the title text is a label leak.
  // The format word can be at the start ("Carousel: One Story..."), end
  // ("One Story... Carousel"), or middle.
  // CRITICAL: "Story" is NOT in this list. It's a common English word
  // that legitimately appears in titles like "One Story to a Month of
  // Content" - stripping it produced "Oneto a Month of Content" (real
  // bug we hit in production). "Reel" stays since it's uncommon outside
  // the format context. Longest alternatives first so "Engagement Reel"
  // matches before bare "Reel".
  {
    re: /(\[TITLE\]\s*\n?)([^\n\[]*?)\s*[-:–—]*\s*\b(?:Engagement\s+Reel|Hero['’]s\s+Journey(?:\s+\(Text-Only\))?|Short-form|Long-form|Carousel|Reel)\b\s*[-:–—]*\s*([^\n\[]*)(?=\n|\[|$)/gi,
    replace: '$1$2$3',
  },
  // Cleanup pass: collapse double spaces inside the title that the strip
  // above might have left behind when the format word was mid-title.
  {
    re: /(\[TITLE\]\s*\n?[^\n\[]*?)\s{2,}([^\n\[]*?)(?=\n|\[|$)/g,
    replace: '$1 $2',
  },
  // Clean up any leading separator left in the title after the strip
  // (edge case where the format word was at the start with no prior text).
  {
    re: /(\[TITLE\]\s*\n?)\s*[-:–—]\s*/g,
    replace: '$1',
  },
  // Declarative rhetorical tells: "and the kicker is, X" / "the catch is, X"
  // / "the secret is, X" / "the truth is, X". Strip the lead-in clause and
  // keep the payload. The repair lower-cases the first word of the payload
  // since it was originally mid-sentence; the surgicalBanRemoval pass picks
  // up any leftover capitalization issues.
  { re: /([.!?]\s+)(?:And\s+)?[Tt]he\s+(?:kicker|catch|trick|secret|result)\s+is\s*,?\s+/g, replace: '$1' },
  { re: /\s+(?:and\s+)?the\s+(?:kicker|catch|trick|secret|result)\s+is\s*,?\s+/gi, replace: ' ' },
  { re: /\s+the\s+(?:real|wild)\s+truth\s+is\s*,?\s+/gi, replace: ' ' },
  { re: /\s+what['’]s\s+(?:wild|crazy)\s+is\s*,?\s+/gi, replace: ' ' },
  // Section 9.7 - colon-led label patterns. Strip the label so the AI states
  // the thing directly. Even when the exact phrase isn't in the bans list, the
  // model uses these as cadence; surgical removal keeps the sentence flow.
  { re: /\bwhat['’]?s actually happening\s*[:,]?\s*/gi, replace: "what's happening is " },
  { re: /\bwhat i learned\s*[:,]?\s*/gi, replace: '' },
  { re: /\bthe bigger lesson\s*[:,]?\s*/gi, replace: 'the bigger lesson is ' },
  { re: /\bthe takeaway\s*[:,]?\s*/gi, replace: 'the takeaway is ' },
  { re: /\bwhat they miss\s*[:,]?\s*/gi, replace: 'they forget ' },
  { re: /\bwhat they should have said\s*[:,]?\s*/gi, replace: 'what they should have said is ' },
  { re: /\bhere['’]s why\s*[:,]?\s*/gi, replace: '' },
  // "And the last one..." preambles
  { re: /\band the last one is the one most people miss\s*[:,]?\s*/gi, replace: '' },
  { re: /\bsaving the best for last\s*[:,]?\s*/gi, replace: '' },
  // Generic friendly openers
  { re: /\b(hey|hi)\s+friends?\s*[,.]?\s*/gi, replace: '' },
  { re: /\blet me (tell|share)(\s+you)?\s*[,.]?\s*/gi, replace: '' },
  { re: /\blisten up\s*[,.]?\s*/gi, replace: '' },

  // LAST: orphaned-conjunction cleanup. Earlier phrase strips can eat the
  // rest of a line and leave a bare "But" / "And" as an entire section
  // (a live REHOOK 2 shipped as just "But"). A line that is only a
  // conjunction plus punctuation carries no content - drop it.
  { re: /^\s*(?:but|and|so|yet|because)[\s.,!]*$/gim, replace: '' },
]

const PREAMBLE_STRIPPERS: RegExp[] = [
  /^\s*here['’]s an improved version[^:]*:?\s*/i,
  /^\s*here is an improved version[^:]*:?\s*/i,
  /^\s*here['’]s (?:the|your) (?:improved|revised|rewritten|updated) [^:]*:?\s*/i,
  /^\s*i['’]?ve (?:rewritten|improved|updated)[^:]*:?\s*/i,
  /^\s*sure[,!]?\s+here['’]s[^:]*:?\s*/i,
]

/**
 * Story-frame-only repairs. These target AI tells that show up in short IG
 * story overlays (rhetorical-question openers, "you're not X; you're Y"
 * pivots, "not what you think") and are NOT worth adding to the long-form
 * REPAIR_REGEX. Applied by sanitizeStoryText(), which also runs the shared
 * REPAIR_REGEX (em-dash, "isn't X, it's Y" pivots, caps-for-emphasis).
 */
const STORY_REPAIRS: Array<{ re: RegExp; replace: RepairReplacer }> = [
  // "It's not what you think" / "Not what you think" - a pure tell with no
  // content of its own. Strip it wherever it appears.
  { re: /\b(?:it['’]s\s+)?not what you think[.,!?]*\s*/gi, replace: '' },
  // Rhetorical-question opener + fragment answer. Drop the question, keep the
  // answer: "The real shift? Stopping the habit..." -> "Stopping the habit...";
  // "What changed? I decided to..." -> "I decided to...". Only fires at the
  // start of a block, only for a known rhetorical lead-in, and only when a
  // real answer follows the "?" - so genuine standalone questions (sticker
  // polls) are never touched.
  {
    re: /^\s*(?:the\s+real\s+[\w-]+(?:\s+[\w-]+){0,4}|the\s+(?:catch|kicker|secret|trick|truth|fix|difference|problem|point|reason(?:\s+[\w-]+){0,4})|what\s+(?:changed|really\s+matters|most\s+people\s+miss|nobody\s+tells\s+you|happened(?:\s+next)?))\s*\?\s+(?=[A-Za-z0-9])/gi,
    replace: '',
  },
  // "You're/We're/They're not X; you're/we're/they're Y" -> keep the positive
  // clause. Complements the REPAIR_REGEX pivots (which cover "it's/that's not").
  {
    re: /\b(you|we|they)(['’]re)\s+not(?:\s+(?:just|simply|merely|only))?\s+[^.,;!?]{1,50}[,;.]\s*\1\2\s+/gi,
    replace: "$1$2 ",
  },
]

export function allowedPillarsForTier(tier: Tier): Pillar[] {
  if (tier === 'beginner') return ['educational', 'storytelling', 'series']
  if (tier === 'mid') return ['educational', 'storytelling', 'series', 'doubledown']
  return ['educational', 'storytelling', 'authority', 'series', 'doubledown']
}

export function isPillarAllowed(tier: Tier, pillar: Pillar): boolean {
  return allowedPillarsForTier(tier).includes(pillar)
}

function normalizeTier(t?: string): Tier {
  const x = (t || '').toLowerCase()
  if (x.startsWith('adv')) return 'advanced'
  if (x.startsWith('mid')) return 'mid'
  return 'beginner'
}

function normalizePillar(p?: string): Pillar {
  const x = (p || '').toLowerCase().replace(/\s|-/g, '')
  if (x.includes('story')) return 'storytelling'
  if (x.includes('author')) return 'authority'
  if (x.includes('series')) return 'series'
  if (x.includes('double')) return 'doubledown'
  return 'educational'
}

function normalizeContentType(c?: string): ContentType {
  const x = (c || '').toLowerCase()
  if (x.includes('long')) return 'long'
  if (x.includes('carousel')) return 'carousel'
  if (x.includes('story')) return 'story'
  if (x.includes('engage')) return 'engagement'
  if (x.includes('text') || x.includes('tweet') || x.includes('post')) return 'text'
  return 'short'
}

export function coerceInput(raw: {
  profile?: BrandProfile | null
  tier?: string
  pillar?: string
  contentType?: string
  topic?: string
  cta?: string
  referenceScript?: string
  seriesDay?: number
}): BuildInput {
  const tier = normalizeTier(raw.tier)
  let pillar = normalizePillar(raw.pillar)
  if (!isPillarAllowed(tier, pillar)) pillar = 'educational'
  return {
    profile: raw.profile ?? null,
    tier,
    pillar,
    contentType: normalizeContentType(raw.contentType),
    topic: (raw.topic || '').trim(),
    cta: (raw.cta || '').trim() || undefined,
    referenceScript: (raw.referenceScript || '').trim() || undefined,
    seriesDay: raw.seriesDay,
  }
}

function tierVoiceBlock(tier: Tier): string {
  if (tier === 'beginner') {
    return `TIER: BEGINNER (guide who's been there, not an expert on a pedestal).
- You're learning alongside the viewer. Share YOUR journey, YOUR mistakes, YOUR discoveries.
- Encouraged openings: "I used to…", "When I discovered…", "Here's what changed for me…", "If I were starting today, I'd…", "I made this mistake so you can avoid it…", "Here's how I do X now…"
- Forbidden: "You're doing X wrong", "Your content is failing because…", any direct diagnosis of THEIR life, any social proof not supplied.`
  }
  if (tier === 'mid') {
    return `TIER: MID (peer who's a few steps ahead).
- You can use "you" more confidently. Frame common errors as "a common mistake I see" - not "your mistake".
- Mix "I learned…" with "here's what works…". Client examples allowed only if supplied in context.`
  }
  return `TIER: ADVANCED (coach with proof).
- Direct diagnosis allowed: "3 signs your content isn't converting", "stop doing X, start Y".
- Strong social proof allowed only if it appears in the client context or topic. Never fabricate.`
}

function pillarBlock(pillar: Pillar, tier: Tier, seriesDay?: number): string {
  switch (pillar) {
    case 'educational':
      if (tier === 'beginner') {
        return `PILLAR: EDUCATIONAL (beginner variant - teach through your own learning).
- Frame every teaching beat as "what I figured out" not "what you should do".
- One clear idea. Mistake I made → cost → what I changed → one concrete example.
- Lots of "you" is fine - but "you" is a friend, not a student being lectured.`
      }
      return `PILLAR: EDUCATIONAL.
- Friendly advice, peer-to-peer. Lots of "you". Never condescending.
- Teach ONE specific concept. Name the actual framework/technique - no vague "system" or "something".
- Show the mistake, the cost, the fix, and one concrete example line the viewer can copy.`
    case 'storytelling':
      return `PILLAR: STORYTELLING (cozy-friend-vlog voice).
- Like venting to a friend over coffee. Specific scenes, specific feelings.
- Only use personal stories the user supplied in the topic. Never invent dates, numbers, names, or outcomes.
- If the topic is thin, tell a situational story (a moment, not a timeline).`
    case 'authority':
      return `PILLAR: AUTHORITY (advanced tier only - coach tone).
- You've walked the path. Pull the viewer forward. Confident, not arrogant.
- "If I were running your X…" / "Here's the move I'd make…" is the register.
- Never invent metrics, clients, or outcomes. Use only what's in the client context.`
    case 'series': {
      const dayLabel = seriesDay ? `Day ${seriesDay}` : 'Day N'
      return `PILLAR: SERIES (${dayLabel} continuation).
- Hook MUST start with "${dayLabel}." - no recap, no "welcome back", no "as we discussed".
- Pattern: current status → today's struggle → the small win → what I'm trying tomorrow.`
    }
    case 'doubledown':
      return `PILLAR: DOUBLE DOWN.
- Study the reference script's rhythm, pacing, pause points, and transition shapes.
- Keep the STRUCTURE. Swap the topic and the specific words. Never copy wording verbatim.
- Match sentence length and beat count as closely as possible.`
  }
  const _exhaustive: never = pillar
  return _exhaustive
}

function patternBlock(type: ContentType): string {
  switch (type) {
    case 'long':
      return `LONG-FORM YOUTUBE (10–15 min, 1600–2400 words):

HOOK STACK (first 30 seconds is everything):
- 0–3s MAIN HOOK: pattern interrupt, specific, emotionally charged. No "in this video".
- 3–8s VALUE HOOK: promise a specific transformation with a timeframe.
- 8–15s PREVIEW: tease 3 points and open 2–3 loops you will close later.
- 15–30s PROOF: quick credibility + one concrete detail from the client context (if available).

BODY - pick ONE structure:
A) Transformation framework (current state → bridge method → steps → signs it's working)
B) Myth-busting (3 myths with truth + proof for each → your real method)
C) Story-teaching hybrid (story beats every ~2 min, each delivering one lesson)
D) Case study breakdown (who/what/when → problem → process → specifics → replication guide)

RETENTION MOVES (apply throughout):
- Open 2–3 loops in the first 3 minutes. Close them at 3, 5, 7 minute marks.
- Mini re-hook every ~250 words ("the part that actually changes retention is coming next").
- Pacing: fast intro → slower teaching → fast recap. Vary sentence length.
- Every teaching beat includes ONE concrete example line the viewer can imitate.
- Save the best tip for the final ~20%.

SOFT LEAD CAPTURE (natural, not pitchy):
- Around the 2-minute mark and again near the end, mention a free resource only if desired_action supports it.
- 90% teaching, 10% offer connection. Never make the script about the offer.`
    case 'short':
      return `SHORT-FORM (30–45s, 120–170 words):
Beat order - HOOK → REHOOK → CONNECT → COMMON ENEMY (shown, not labeled) → REHOOK → RELATE → CLOSE → CTA → RELOOP.
- HOOK: pattern interrupt in ≤8 words. Specific.
- REHOOK: a promise or tease that justifies staying.
- CONNECT: one line that makes the viewer say "that's me".
- ENEMY: show the trap/system. Never say "the enemy is".
- RELATE + CLOSE: land the idea with ONE concrete example or micro-framework.
- RELOOP: last line sends them back to the hook or prompts immediate action.
- No "Step 1/2/3". Use "first… then… last" inline.`
    case 'engagement':
      return `ENGAGEMENT REEL (15–25s total runtime, 30–70 words across all frames):
This is a SILENT video format. NO voiceover, NO narration, NO spoken script. Every line you write is overlay text the viewer READS on the screen. The visual is the creator on camera (or B-roll) with text overlays appearing/disappearing in sync with their movement.
- Every beat is a TEXT OVERLAY, not a spoken line. Write punchy, screen-readable lines, not sentences a creator would speak aloud. Think Instagram caption length, not voiceover script.
- No "voiceover:" labels, no "(narration)" notes, no "say this:" prefixes. The output IS the text overlays, period.
Beat order - TRIGGER → CONTEXT (1 short overlay) → BAIT (yes/no, A/B, or ranked opinion) → ON-SCREEN TEXT (the answer/teaser they'll see if they engage) → CTA.
- TRIGGER: 5–10 words, pattern interrupt that makes them stop scrolling.
- CONTEXT: 1 short overlay, 8–14 words. Sets up the bait.
- BAIT: a question answerable in the comments in under 5 words. Take a clear, slightly polarizing stance grounded in the client context.
- ON-SCREEN TEXT: the framework name, payoff line, or hidden answer that ties it all together. 3–8 words.
- CTA: the comment-bait or follow line. 4–10 words.
- COHERENCE RULE: TRIGGER, CONTEXT, and BAIT must all be about the SAME specific thing. The trigger introduces the angle, the context narrows it, and the bait asks a question that resolves the same tension. Never pivot from one topic in TRIGGER to a different question in BAIT - readers feel the disconnect immediately.
- Bad: TRIGGER = "I used to make content the dumbest way" → BAIT = "Do you give your best tip first or second?" The trigger is about content failure, the bait is about tip ordering. Disconnected.
- Good: TRIGGER = "Best tip first kills your retention" → CONTEXT = "Order matters more than the tips themselves" → BAIT = "Best tip first or second?" Same thread the whole way through.`
    case 'carousel':
      return `CAROUSEL (6–10 slides, ~15 words/slide):
Slide 1 = hook (5–10 words). Slide 2 = promise/rehook. Slides 3 to N-2 = one specific idea per slide with a concrete micro-example.
Second-to-last = framework summary ("screenshot this"). Last = CTA slide.
- No paragraphs. No slide over 18 words. Each slide must stand alone.`
    case 'story':
      return `IG STORIES (3–5 frames, overlay text only, no caption, no hashtags):
Frame 1 HOOK → Frame 2 VALUE (the ONE insight) → Frame 3 MINI-TEACH (one thing they can try) → Frame 4 CTA → optional Frame 5 POLL/QUESTION.
- Short overlay text only. Leads the viewer to another video or a question, never a hard sell.`
    case 'text':
      return `TEXT POST (tweet-style, single thought, 1–3 lines, <280 chars ideal):
- One idea. Concrete, specific, slightly contrarian. Ends on a line that makes the reader pause.
- No thread format. No hashtags unless asked.`
  }
  const _exhaustive: never = type
  return _exhaustive
}

function outputFormat(type: ContentType): string {
  switch (type) {
    case 'long':
      return `OUTPUT FORMAT (aim 1200–1600 words total - depth over length, no filler):
[TITLE]  (1 punchy headline)
[HOOK]  (60–120 words)
[SETUP]  (100–150 words - stakes + preview; open 2 loops)
[ANTICIPATION]  (80–120 words - tease the best tip; one proof point)
[TEACH]  (600–800 words - 3 teaching beats. Each beat = NAME the specific framework/technique, 1 concrete example line, 1 practical action. Close both loops in order. Do NOT repeat ideas. Do NOT invent client stories.)
[REHOOK]  (60–100 words - the best tip of the whole script)
[PAYOFF]  (80–120 words - the "if you only take one thing" moment)
[CTA]  (20–50 words)
[PUBLISHING PACK]
HEADER: (6–14 words)
CAPTION: (120–180 words, 3 bullet points, ends with a question)
HASHTAGS: (exactly 12–15 tags, each used once, no repeats, no "tipstips" gibberish)

Put each [SECTION TAG] on its OWN LINE with a blank line before and after.
If you have nothing specific left to teach, END the section. Do NOT pad with repetition.`
    case 'short':
      return `OUTPUT FORMAT:
[TITLE]
[HOOK]
[REHOOK]
[CONNECT]
[ENEMY]
[REHOOK 2]
[RELATE]
[CLOSE]
[CTA]
[RELOOP]
[PUBLISHING PACK]
HEADER:
CAPTION: (90–160 words, 3 bullets, ends with a question)
HASHTAGS: (12–18 tags)`
    case 'engagement':
      return `OUTPUT FORMAT:
[TITLE]
[TRIGGER]
[CONTEXT]
[BAIT]
[ON-SCREEN TEXT]
[CTA]
[PUBLISHING PACK]
HEADER:
CAPTION: (60–120 words, ends with a question)
HASHTAGS: (8–14 tags)`
    case 'carousel':
      return `OUTPUT FORMAT:
[TITLE]
Slide 1:
Slide 2:
Slide 3:
Slide 4:
Slide 5:
Slide 6:
(optional) Slide 7:
(optional) Slide 8:
(optional) Slide 9:
(optional) Slide 10:
[CTA]
[PUBLISHING PACK]
HEADER:
CAPTION: (90–160 words, 3 bullets, ends with a question)
HASHTAGS: (12–18 tags)`
    case 'story':
      return `OUTPUT FORMAT:
[TITLE]
Frame 1 (Hook):
Frame 2 (Value):
Frame 3 (Rehook):
Frame 4 (CTA):
Frame 5 (Poll/Question):`
    case 'text':
      return `OUTPUT FORMAT:
[TITLE]
[POST]`
  }
  const _exhaustive: never = type
  return _exhaustive
}

function ctaBlock(cta?: string, profile?: BrandProfile | null): string {
  if (cta) {
    return `CTA: In the [CTA] section output this EXACTLY, verbatim, no edits:\n${cta}`
  }
  const desired = profile?.content_strategy.desired_action || 'comment_keyword'
  const soft = profile?.content_strategy.never_do.aggressive_sales ?? true
  return `CTA: No CTA was provided. Keep it ${soft ? 'soft' : 'direct'}. Default intent: ${desired}.`
}

export function buildPrompt(input: BuildInput): BuiltPrompt {
  const { profile, tier, pillar, contentType, topic, cta, referenceScript, seriesDay, competitorPatterns } = input

  const voiceLine = voiceFingerprintLine(profile, 'full')

  const blocks = [
    `You are a ghostwriter. You write like a real human creator. Short sentences. Specific words. No AI filler. You can write from multiple angles - "I used to…", "Here's how I do X now…", "When I first tried X…", "If I were starting today…" - not just "you're a ___ who…".`,
    voiceLine && `VOICE: ${voiceLine}`,
    voiceSamplesBlock(profile),
    tierVoiceBlock(tier),
    clientContextBlock(profile, 'extended'),
    renderAmmoBlock(profile),
    competitorPatterns?.length
      ? `COMPETITOR PATTERNS (structure only, never name them):\n- ${competitorPatterns.join('\n- ')}`
      : '',
    renderCommonEnemyLine(profile, tier),
    frameworkBlock(),
    pillarFrameworkBlock(pillar),
    pillarBlock(pillar, tier, seriesDay),
    patternBlock(contentType),
    renderBansBlock(profile, HARD_BANS),
    `FABRICATION PREVENTION:
- Never invent social proof: "you keep asking", "my most requested", "everyone's been DMing me". Only claims from the client context or the topic are allowed.
- Never invent numbers, percentages, dollars, follower counts, timeframes, or outcomes.
- Never invent a client story ("I was working with a client who…", "one of my clients…") unless a real client example is in the inputs. If you need an example, use a hypothetical framed as "imagine a [role] who…" - don't pretend it happened.
- Never re-use the user's own story as a client's story. Your "I" and a client's "they" are different people.
- Never name specific competitors. Describe patterns instead.`,
    `TEACHING DEPTH:
- If the content teaches something, NAME the specific framework, technique, or move. No vague "system", "something", "a method".
- Every teaching beat includes ONE concrete example line the viewer can copy.
- 70%+ of the body is teaching. At most 10% connects to the offer, and only near the end.`,
    `SCROLL-STOP TEST (every hook must pass):
1) Pattern interrupt in the first 3 words.
2) One concrete detail from the inputs.
3) Creates tension the viewer needs to resolve.
4) Flows in one breath when read aloud.
5) Sounds like a real person - not a brand voice.`,
    `SECTION TAGS:
- Every [SECTION_TAG] starts on its own line with a blank line before and after.
- NEVER place a [SECTION_TAG] inline at the end of a paragraph (e.g. "...understood. [CTA]"). Tags are headers, not punctuation.
- Each tag appears EXACTLY ONCE per script. Do not write [CTA] inside [PAYOFF] and again at the bottom.`,
    `VOICE RULES (non-negotiable):
- No em-dashes (-) or en-dashes (–). Plain hyphens in compound modifiers (5-part, lead-generating, not-so-simple) ARE allowed.
- ABSOLUTELY no "<subject> isn't X, it's Y" / "you're not just X, you're Y" / "it's not about X, but Y" pivots. State the positive claim directly. Single biggest AI tell.
- No rhetorical fragment-questions used as transitions: "The result?", "The kicker?", "The catch?", "The truth?", "Plot twist?", "Spoiler:", "Here's the thing,", "Honestly?", "Look,". Just say the next sentence.
- NO sentence may begin with "Here's" or "Here is" in any form ("here's the truth", "here's what changed it for me", "here's the thing", "here's why", "here's how", "here's what I learned", "here's the secret", "here's what actually works"). It's a top AI tell. Delete the opener and state the point directly.
- No "and the result?", "and the best part?", "what if I told you", "you read that right", "in this video".
- Speak like a real person talking out loud, not a writer trying to sound smart. School-voice is banned. If a sentence sounds like a LinkedIn post, kill it.
- Use contractions always. Sentence fragments are encouraged. Start sentences with And / But / So / Because.
- Vary length violently - a 3-word sentence next to a 22-word one. Never write three sentences in a row of the same length.
- No paired or tripled adjectives. "consistent, engaging content" → "consistent content". Pick ONE.
- Don't justify every claim. Make the point and move on; don't add "and that's why this matters".
- Don't bridge paragraphs with "Now," / "So," / "Moving on," / "Let's break it down,". Just start the next idea.
- No choppy fragment stacking ("Hours back. Energy saved. Freedom unlocked."). One fragment is fine; three in a row reads as AI.
- Don't reuse the same transitional phrase twice in one script.`,
    `HUMAN-VOICE EXAMPLE - match this rhythm. Never the polished-blog tone of typical AI output:

"""
Most people overthink this. They sit down, stare at the doc, and try to sound smart. That's the trap. Smart sounds like school. School doesn't sell.

Just talk. Say what you'd say to a friend who asked you the question. If you wouldn't use the word out loud, cut it. If a sentence sounds like a LinkedIn post, kill it.

The pattern I use is three things. Topic. Idea. Outline. That's it. I don't sit there 'getting in the right headspace'. I open a doc and I write what I'd say.

And yeah, the first draft is rough. Doesn't matter. You can fix rough. You can't fix a blank page.
"""

Notice: contractions everywhere, sentence fragments ("That's the trap.", "Three things."), short next to longer, no paired adjectives, no rhetorical fragment-questions. Match THAT rhythm.`,
    ctaBlock(cta, profile),
    outputFormat(contentType),
  ].filter(Boolean)

  const system = blocks.join('\n\n')

  const userParts: string[] = []
  if (pillar === 'doubledown' && referenceScript) {
    userParts.push(`REFERENCE SCRIPT (mirror structure/pacing, not words):\n"""\n${referenceScript}\n"""`)
  }
  if (pillar === 'series' && referenceScript) {
    userParts.push(`PREVIOUS DAY'S SCRIPT (continue from the next step, do not recap):\n"""\n${referenceScript}\n"""`)
  }
  if (seriesDay) userParts.push(`SERIES DAY: ${seriesDay}`)
  if (topic) {
    if (topic.length > 180) {
      userParts.push(
        `USER DRAFT / BRAIN DUMP (preserve the voice, keep the comedic beats, the slang, the rhythm; clean up filler but do NOT neutralize the personality; profanity level = ${profile?.voice.profanity_level || 'none'}):
"""
${topic}
"""`,
      )
    } else {
      // Short topic = topic-expansion mode. Without this explicit framing,
      // the model sometimes treats the topic as a prompt to clarify ("tell
      // me more about X") instead of expanding it into a full script.
      userParts.push(
        `TOPIC: ${topic}

TOPIC EXPANSION MODE: The topic above is the seed for the entire script. Treat it as the angle, not as a question to answer. Build the full piece around it: hook into the audience's pain (from CLIENT CONTEXT and AMMO), teach using the framework and pillar above, weave in concrete examples, land on the CTA. Don't ask for more input. Don't pad. Generate the full output exactly per OUTPUT FORMAT below.`,
      )
    }
  } else {
    userParts.push(
      'NO TOPIC GIVEN. Pick a strong one from the evergreen topics or myths in the client context, then expand it into the full output. Do not ask the user to pick one.',
    )
  }

  const user = userParts.join('\n\n')

  const temperature = contentType === 'text' ? 0.7 : 0.55
  // Headroom over the actual content size so the script can finish even when
  // Pro's thinking config consumes ~1024 tokens of budget. Earlier values
  // (1600 for everything except long) were getting truncated mid-script.
  const maxTokens =
    contentType === 'long'
      ? 8000
      : contentType === 'carousel'
        ? 4000
        : contentType === 'short'
          ? 4000
          : contentType === 'engagement'
            ? 2500
            : contentType === 'story'
              ? 2500
              : contentType === 'text'
                ? 800
                : 4000

  return { system, user, maxTokens, temperature }
}

export function sanitize(text: string): string {
  let t = text || ''

  // Strip model preambles like "Here's an improved version of the draft:"
  for (const re of PREAMBLE_STRIPPERS) t = t.replace(re, '')

  for (const { re, replace } of REPAIR_REGEX) {
    t = typeof replace === 'string' ? t.replace(re, replace) : t.replace(re, replace)
  }

  // Repairs above can land a lowercase "it's"/"that's" at a sentence boundary.
  // Restore capitalization after `.`, `:`, or at start of string / line.
  // `!` and `?` are excluded because quoted interjections like "Click me!" And "aha!" Moment
  // are mid-sentence - treating them as terminators wrongly capitalizes the next word.
  // Also handle closing quote/paren between terminator and space: `.' it's` / `.) it's`.
  // Lookbehinds exempt mid-sentence abbreviations (vs. / e.g. / i.e. / etc.)
  // - without them "quality vs. quantity" became "quality vs. Quantity".
  t = t.replace(/(^|(?<!\bvs)(?<!\be\.g)(?<!\bi\.e)(?<!\betc)[.:]['"’”)\]]*\s+|\n\s*)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase())

  // Post-strip artifact: stripping phrases like "here's the real deal: " leaves the
  // following word mid-sentence but still capitalized. Lowercase a capitalized pronoun
  // that follows a sentence-internal connector (But/And/So/Yet/Or).
  t = t.replace(/\b(But|And|So|Yet|Or)\s+(It|That|They|This|These|Those|He|She|We|You|I)\b/g, (_m, conj: string, pronoun: string) => `${conj} ${pronoun === 'I' ? 'I' : pronoun.toLowerCase()}`)

  // Normalize section headings to bracketed tags
  t = t.replace(/^\s*\*{0,2}\s*(#+\s*)?title\s*:?\s*\*{0,2}\s*$/gim, '[TITLE]')
  t = t.replace(/^\s*\*{0,2}\s*(#+\s*)?publishing pack\s*:?\s*\*{0,2}\s*$/gim, '[PUBLISHING PACK]')
  t = t.replace(/^\s*\*{0,2}\s*caption\s*:?\s*\*{0,2}/gim, 'CAPTION:')
  t = t.replace(/^\s*\*{0,2}\s*hashtags\s*:?\s*\*{0,2}/gim, 'HASHTAGS:')
  t = t.replace(/^\s*\*{0,2}\s*header\s*:?\s*\*{0,2}/gim, 'HEADER:')
  t = t.replace(/^\s*\*{0,2}\s*\[?CTA\]?\s*:?\s*\*{0,2}\s*$/gim, '[CTA]')

  // Force every [SECTION TAG] onto its own line. Models smoosh them inline.
  t = t.replace(/\s*(\[[A-Z][A-Z +]*\])\s*/g, '\n\n$1\n')
  // And keep labeled fields (HEADER:, CAPTION:, HASHTAGS:) on their own line.
  t = t.replace(/\s*(HEADER:|CAPTION:|HASHTAGS:)\s*/g, '\n\n$1 ')
  // "POINT N:" / "POINT N -" body headers onto their own line with breathing room
  t = t.replace(/\s*(POINT\s+\d+\s*[:.\-–])\s*/g, '\n\n$1 ')
  // Inner value-loop labels onto their own line inside each body point
  t = t.replace(/\s*(CONTEXT:|APPLICATION:|FRAMING:|RE[-\s]?HOOK:)\s*/g, '\n\n$1 ')
  // Outline bullets on their own line (models run them together on one line)
  t = t.replace(/\s*[*•\-]\s+POINT:\s*/g, '\n*   POINT: ')

  // Dedupe multiple [PUBLISHING PACK] sections (keep the last - usually most complete)
  t = dedupeSection(t, '[PUBLISHING PACK]')

  // Hashtag hard cap (fixes runaway loops like "#tipstipstips…")
  t = capHashtags(t, 18)

  // Kill adjacent duplicate sentences (loops produce the same line twice)
  t = dedupeAdjacentSentences(t)

  // Collapse 3+ newlines into 2
  t = t.replace(/\n{3,}/g, '\n\n')

  return t.trim()
}

/**
 * Lean sanitizer for a SHORT story overlay line. Applies the mechanical
 * AI-tell repairs (em-dash reframes, "isn't X, it's Y" pivots,
 * caps-for-emphasis, rhetorical-question fragments) WITHOUT the long-form
 * section/hashtag/publishing-pack normalization in sanitize() - that logic
 * would mangle a 12-word frame. Caller runs this per text_block.
 */
export function sanitizeStoryText(text: string): string {
  let t = (text || '').trim()
  if (!t) return t

  // Shared mechanical repairs (em-dash, negation pivots, caps, question marks).
  for (const { re, replace } of REPAIR_REGEX) {
    t = typeof replace === 'string' ? t.replace(re, replace) : t.replace(re, replace)
  }
  // Story-only tells (rhetorical-question openers, you're-not-X pivots, etc.).
  for (const { re, replace } of STORY_REPAIRS) {
    t = typeof replace === 'string' ? t.replace(re, replace) : t.replace(re, replace)
  }

  // Repairs can lowercase a word at a sentence boundary - restore it.
  // Lookbehinds exempt mid-sentence abbreviations (vs. / e.g. / i.e. / etc.)
  // - without them "quality vs. quantity" became "quality vs. Quantity".
  t = t.replace(/(^|(?<!\bvs)(?<!\be\.g)(?<!\bi\.e)(?<!\betc)[.:]['"’”)\]]*\s+|\n\s*)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
  // Lowercase a capitalized pronoun left mid-sentence after a connector.
  t = t.replace(
    /\b(But|And|So|Yet|Or)\s+(It|That|They|This|These|Those|He|She|We|You|I)\b/g,
    (_m, conj: string, pronoun: string) => `${conj} ${pronoun === 'I' ? 'I' : pronoun.toLowerCase()}`,
  )

  // Collapse any double spaces the strips left behind.
  return t.replace(/\s{2,}/g, ' ').trim()
}

function capHashtags(text: string, max: number): string {
  return text.replace(/HASHTAGS:\s*([^\n]*)/i, (_m, body: string) => {
    const tags = (body.match(/#[A-Za-z0-9_]+/g) || [])
      .map((t) => t.toLowerCase())
      .filter((t, i, arr) => arr.indexOf(t) === i) // unique
      .slice(0, max)
    return `HASHTAGS: ${tags.join(' ')}`
  })
}

function dedupeAdjacentSentences(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const out: string[] = []
  let last = ''
  for (const s of sentences) {
    const norm = s.trim().toLowerCase()
    if (norm && norm === last) continue
    out.push(s)
    last = norm
  }
  return out.join(' ')
}

function dedupeSection(text: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^\\s*${escaped}\\s*$`, 'gim')
  const matches = Array.from(text.matchAll(re))
  if (matches.length < 2) return text
  // keep the last occurrence; delete from the first occurrence up to (but not including) the last
  const firstIdx = matches[0].index ?? 0
  const lastIdx = matches[matches.length - 1].index ?? 0
  return text.slice(0, firstIdx) + text.slice(lastIdx)
}

export function wordCount(text: string): number {
  return (text || '').trim().split(/\s+/).filter(Boolean).length
}

export function deriveTitle(topic: string, fallback = 'untitled'): string {
  if (!topic) return fallback
  const firstSentence = topic.split(/[.!?\n]/).map((s) => s.trim()).find(Boolean) || topic
  const words = firstSentence.split(/\s+/).filter(Boolean)
  if (words.length <= 10) return firstSentence
  return words.slice(0, 10).join(' ')
}

export function findHardBanHit(text: string): string | null {
  const t = (text || '').toLowerCase()
  for (const phrase of HARD_BANS) {
    if (!phrase) continue
    if (t.includes(phrase.toLowerCase())) return phrase
  }
  return null
}

/**
 * Cheap surgical repair: find the sentence containing the banned phrase
 * and just remove that sentence rather than the whole script.
 * Returns the repaired text. No LLM call.
 */
export function surgicalBanRemoval(text: string, phrase: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const phraseLower = phrase.toLowerCase()
  const filtered = sentences.filter((s) => !s.toLowerCase().includes(phraseLower))
  return filtered.join(' ').trim()
}

export function targetLongformWords(): { min: number; target: number } {
  return { min: 1200, target: 1500 }
}

export function ensureTitle(output: string, fallback = 'untitled'): string {
  if (/\[title\]/i.test(output)) return output
  return `[TITLE]\n${fallback}\n\n${output}`.trim()
}

export function ensureCtaVerbatim(output: string, cta?: string): string {
  if (!cta || !cta.trim()) return output
  const c = cta.trim()
  let result = output
  if (!result.includes(c)) {
    const lines = result.split('\n')
    const idx = lines.findIndex((l) => /^\s*\[CTA\]\s*$/i.test(l))
    if (idx >= 0) {
      let end = lines.length
      for (let i = idx + 1; i < lines.length; i++) {
        if (/^\s*\[[A-Z][A-Z +]*\]\s*$/.test(lines[i])) { end = i; break }
      }
      const before = lines.slice(0, idx + 1)
      const after = lines.slice(end)
      result = [...before, '', c, '', ...after].join('\n')
    } else {
      const packRe = /\n\s*\[PUBLISHING PACK\]/i
      if (packRe.test(result)) {
        result = result.replace(packRe, `\n\n[CTA]\n${c}\n\n[PUBLISHING PACK]`)
      } else {
        result = `${result.trim()}\n\n[CTA]\n${c}\n`
      }
    }
  }
  return dedupeCtaSection(result)
}

/**
 * Collapse repeated `[CTA]\n<text>\n` blocks down to a single occurrence.
 * Pro sometimes writes the [CTA] section twice - once inline at the end of
 * the body and once as a standalone label - and we don't want both in the
 * final output.
 */
function dedupeCtaSection(text: string): string {
  const re = /(\[CTA\]\s*\n[\s\S]*?)(?=\n\s*\[[A-Z][A-Z +]*\]|\n*$)/gi
  const seen = new Set<string>()
  return text.replace(re, (match) => {
    const normalized = match.trim().toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(normalized)) return ''
    seen.add(normalized)
    return match
  })
}
