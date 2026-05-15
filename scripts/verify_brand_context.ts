/**
 * Byte-identical snapshot verifier for the brandContext consolidation
 * (docs/content_planner_buildout.md sections 9.3 + 9.8).
 *
 * Holds verbatim copies of the PRE-refactor render functions
 * (voiceFingerprint, voiceLine, voiceSamples, businessBlock, clientLine,
 * ammoBlock, commonEnemyLine, deriveEnemy, bansBlock) and runs them against
 * three brand-profile fixtures. Then runs the equivalent NEW exports from
 * src/lib/prompt/brandContext.ts on the same fixtures and asserts byte-for-byte
 * equality.
 *
 * Run with: npx tsx scripts/verify_brand_context.ts
 *
 * Exits 0 on PASS, 1 on FAIL.
 */

import {
  ammoBlock as newAmmoBlock,
  bansBlock as newBansBlock,
  clientContextBlock,
  commonEnemyLine as newCommonEnemyLine,
  deriveCommonEnemy,
  voiceFingerprintLine,
  voiceSamplesBlock,
} from '../src/lib/prompt/brandContext'
import {
  defaultBrandProfile,
  normalizeBrandProfile,
  type BrandProfile,
} from '../src/components/clients/brandProfile'
import { HARD_BANS } from '../src/lib/prompt/engine'

// ---------------------------------------------------------------------------
// Pre-refactor render functions (copied verbatim from engine.ts +
// packagePrompt.ts as of the start of session 2 / before brandContext.ts).
// ---------------------------------------------------------------------------

function oldVoiceFingerprint(profile: BrandProfile | null): string {
  if (!profile) return 'casual conversational, warm, no jargon.'
  const v = profile.voice
  const dial = (n: number) => (n <= 2 ? 'low' : n >= 4 ? 'high' : 'medium')
  const parts = [
    `addresses audience as "${v.address_audience_as || 'you'}"`,
    `casual=${dial(v.casualness)}`,
    `funny=${dial(v.funny)}`,
    `enthusiastic=${dial(v.enthusiastic)}`,
    `emotional=${dial(v.emotional)}`,
    `irreverent=${dial(v.irreverent)}`,
    `jargon=${v.uses_jargon}`,
    `personal stories=${v.shares_personal_stories}`,
    `profanity=${v.profanity_level}`,
  ]
  const traits = (v.traits || '').trim()
  if (traits) parts.push(`traits="${traits}"`)
  const sigs = (v.signature_phrases || []).map((s) => s.trim()).filter(Boolean)
  if (sigs.length) parts.push(`signature phrases (use sparingly): ${sigs.map((s) => `"${s}"`).join(', ')}`)
  return parts.join(' | ')
}

function oldVoiceLine(profile: BrandProfile | null): string {
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

function oldVoiceSamples(profile: BrandProfile | null): string {
  const samples = (profile?.voice.samples || []).map((s) => s.trim()).filter(Boolean).slice(0, 3)
  if (!samples.length) return ''
  return [
    'VOICE SAMPLES (mirror the rhythm, word choice, sentence length - do NOT quote):',
    ...samples.map((s, i) => `<sample ${i + 1}>\n${s}\n</sample>`),
  ].join('\n')
}

function oldBusinessBlock(profile: BrandProfile | null): string {
  if (!profile) return ''
  const b = profile.business
  const a = profile.audience
  const lines = [
    b.mission && `mission: ${b.mission}`,
    b.problem_solved && `problem solved: ${b.problem_solved}`,
    b.differentiation && `differentiator: ${b.differentiation}`,
    b.signature_offer && `offer: ${b.signature_offer}`,
    a.work_roles && `audience: ${a.work_roles}`,
    a.desires && `desires: ${a.desires}`,
    a.objections && `objections: ${a.objections}`,
    a.tried_failed && `tried & failed: ${a.tried_failed}`,
  ].filter(Boolean)
  if (!lines.length) return ''
  return `CLIENT CONTEXT:\n- ${lines.join('\n- ')}`
}

function oldClientLine(profile: BrandProfile | null): string {
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

function oldAmmoBlock(profile: BrandProfile | null): string {
  if (!profile) return ''
  const pains = profile.audience.pain_points.filter(Boolean)
  const myths = profile.content_strategy.myths.filter((m) => m.myth && m.truth)
  const hot = profile.content_strategy.hot_takes.filter(Boolean)
  const ever = profile.content_strategy.evergreen_topics.filter(Boolean)
  const parts: string[] = []
  if (pains.length) parts.push(`pain points: ${pains.join(' | ')}`)
  if (myths.length) parts.push(`myths: ${myths.map((m) => `"${m.myth}" → "${m.truth}"`).join(' | ')}`)
  if (hot.length) parts.push(`hot takes: ${hot.join(' | ')}`)
  if (ever.length) parts.push(`evergreen topics: ${ever.join(' | ')}`)
  if (!parts.length) return ''
  return `AMMO (use when relevant):\n- ${parts.join('\n- ')}`
}

function oldDeriveEnemy(profile: BrandProfile | null): string {
  const pains = (profile?.audience.pain_points || []).map((p) => p.trim()).filter(Boolean)
  const joined = pains.join(' | ').toLowerCase()
  if (/inconsist/.test(joined)) return 'the post-ghost-guilt loop'
  if (/overwhelm|confus/.test(joined)) return 'the overwhelm trap'
  if (/time|busy/.test(joined)) return 'the time tax'
  if (/view|reach|engage/.test(joined)) return 'the attention treadmill'
  if (/lead|sale|convert/.test(joined)) return "busy content that doesn't convert"
  return 'generic advice that keeps you stuck'
}

function oldCommonEnemyLine(
  profile: BrandProfile | null,
  tier: 'beginner' | 'mid' | 'advanced',
): string {
  const explicit = (profile?.voice.common_enemy || '').trim()
  const enemy = explicit || oldDeriveEnemy(profile)
  const stance =
    tier === 'beginner'
      ? `Frame as "me and you, figuring this out together" vs ${enemy}.`
      : tier === 'mid'
        ? `Frame as "me, a few steps ahead, pulling you past ${enemy}".`
        : `Frame as "I've seen what keeps people stuck in ${enemy} - here's the way through".`
  return `COMMON ENEMY: ${stance} Never say "the enemy is". Show the trap; don't label it.`
}

function oldBansBlock(profile: BrandProfile | null): string {
  const custom = [
    ...(profile?.voice.banned_phrases || []),
    ...(profile?.voice.forbidden_words || []),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
  const all = [...HARD_BANS, ...custom]
  return `BANNED (never use, no exceptions): ${all.map((s) => `"${s}"`).join(', ')}.`
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fixtureMinimal(): BrandProfile {
  return defaultBrandProfile()
}

function fixtureFullFeatured(): BrandProfile {
  return normalizeBrandProfile({
    business: {
      mission: 'Help solo founders build content systems they will actually run.',
      vision: 'A creator economy that does not burn out its makers.',
      problem_solved: 'Inconsistent posting that never compounds into reach.',
      differentiation: 'Pulled from 200+ launches across SaaS and creator businesses.',
      signature_offer: 'The 30-day Posting Engine course.',
    },
    audience: {
      age_range: '28-42',
      gender: 'mixed',
      location: 'North America',
      work_roles: 'solo founders, creators, indie SaaS owners',
      family_situation: 'mixed',
      core_values: 'autonomy, craft, freedom of time',
      fears: 'spending months on content that goes nowhere',
      desires: 'predictable inbound from social',
      hangouts: 'X, IG, niche Discords',
      pain_points: [
        'inconsistent posting',
        'overwhelm picking topics',
        'time tax of doing it all alone',
        '',
        '',
      ],
      tried_failed: 'tried batching, tried Notion calendars, tried hiring a VA',
      objections: 'I don\'t have time, I\'m not a writer, my niche is too small',
      yes_triggers: 'a system that fits in 4 hours/week',
    },
    voice: {
      traits: 'wry, specific, blunt without being mean',
      casualness: 4,
      funny: 3,
      enthusiastic: 3,
      emotional: 2,
      irreverent: 4,
      uses_jargon: 'sometimes',
      shares_personal_stories: 'yes',
      profanity_level: 'light',
      signature_phrases: ['post the post', 'compound or quit', ''],
      forbidden_words: ['hustle', 'grindset', ''],
      address_audience_as: 'you',
      samples: [
        'You don\'t need another tool. You need a slot on the calendar and a topic.',
        'The first ten posts will be ugly. Post them anyway.',
      ],
      banned_phrases: ['rise and grind', 'work-life balance'],
      common_enemy: '',
    },
    content_strategy: {
      content_pillars: defaultBrandProfile().content_strategy.content_pillars,
      primary_content_goal: 'leads',
      desired_action: 'comment_keyword',
      evergreen_topics: [
        'why daily posting beats batching',
        'how to pick a niche',
        'the inverted pyramid hook',
        '',
        '',
      ],
      myths: [
        { myth: 'You need to post twice a day to grow.', truth: 'Once a day is enough if the post lands.' },
        { myth: 'Algorithms reward novelty.', truth: 'Algorithms reward retention.' },
        { myth: '', truth: '' },
      ],
      hot_takes: ['scheduled posts kill engagement', 'most viral hooks were not first drafts', ''],
      must_include: defaultBrandProfile().content_strategy.must_include,
      never_do: defaultBrandProfile().content_strategy.never_do,
      off_limits_topics: ['', '', ''],
    },
  })
}

function fixtureEdgeHeavy(): BrandProfile {
  // Empty everywhere except for a few spaces / partial fills, to flex the
  // filter-out-falsy paths and the "explicit common_enemy overrides derive"
  // path.
  return normalizeBrandProfile({
    business: {
      mission: '',
      vision: '',
      problem_solved: '',
      differentiation: '   ',
      signature_offer: '',
    },
    audience: {
      age_range: '',
      gender: 'unspecified',
      location: '',
      work_roles: '',
      family_situation: '',
      core_values: '',
      fears: '',
      desires: '',
      hangouts: '',
      pain_points: ['', '', '', '', ''],
      tried_failed: '',
      objections: '',
      yes_triggers: '',
    },
    voice: {
      traits: '   ',
      casualness: 1,
      funny: 5,
      enthusiastic: 5,
      emotional: 1,
      irreverent: 1,
      uses_jargon: 'no',
      shares_personal_stories: 'no',
      profanity_level: 'high',
      signature_phrases: ['', '   ', ''],
      forbidden_words: ['', '', ''],
      address_audience_as: '',
      samples: ['', '   '],
      banned_phrases: [],
      common_enemy: 'the curse of perfectionism',
    },
  })
}

// ---------------------------------------------------------------------------
// Comparison harness
// ---------------------------------------------------------------------------

interface Check {
  name: string
  expected: string
  actual: string
}

const failures: Array<{ fixture: string; check: Check }> = []

function check(fixture: string, name: string, expected: string, actual: string): void {
  if (expected !== actual) {
    failures.push({ fixture, check: { name, expected, actual } })
  }
}

function runFixture(name: string, profile: BrandProfile | null): void {
  // voice fingerprint
  check(name, 'voiceFingerprint (full)',
    oldVoiceFingerprint(profile),
    voiceFingerprintLine(profile, 'full'))

  // voiceLine = 'VOICE: ' + voiceFingerprintLine(profile, 'light')
  check(name, 'voiceLine (light)',
    oldVoiceLine(profile),
    `VOICE: ${voiceFingerprintLine(profile, 'light')}`)

  // voice samples
  check(name, 'voiceSamples',
    oldVoiceSamples(profile),
    voiceSamplesBlock(profile))

  // client context (extended)
  check(name, 'businessBlock (extended)',
    oldBusinessBlock(profile),
    clientContextBlock(profile, 'extended'))

  // client context (minimal)
  check(name, 'clientLine (minimal)',
    oldClientLine(profile),
    clientContextBlock(profile, 'minimal'))

  // ammo
  check(name, 'ammoBlock',
    oldAmmoBlock(profile),
    newAmmoBlock(profile))

  // common enemy across all 3 tiers
  for (const tier of ['beginner', 'mid', 'advanced'] as const) {
    check(name, `commonEnemyLine (${tier})`,
      oldCommonEnemyLine(profile, tier),
      newCommonEnemyLine(profile, tier))
  }

  // deriveEnemy / deriveCommonEnemy
  check(name, 'deriveEnemy',
    oldDeriveEnemy(profile),
    deriveCommonEnemy(profile))

  // bans
  check(name, 'bansBlock',
    oldBansBlock(profile),
    newBansBlock(profile, HARD_BANS))
}

runFixture('null-profile', null)
runFixture('minimal', fixtureMinimal())
runFixture('full-featured', fixtureFullFeatured())
runFixture('edge-heavy', fixtureEdgeHeavy())

if (failures.length === 0) {
   
  console.log('PASS - all brandContext renderers match pre-refactor output byte-for-byte.')
  process.exit(0)
} else {
   
  console.log(`FAIL - ${failures.length} mismatch(es):`)
  for (const f of failures) {
     
    console.log(`\n[${f.fixture}] ${f.check.name}`)
     
    console.log('--- EXPECTED ---')
     
    console.log(f.check.expected)
     
    console.log('--- ACTUAL -----')
     
    console.log(f.check.actual)
  }
  process.exit(1)
}
