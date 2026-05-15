/**
 * Single-source-of-truth renderers for the brand profile inside prompts.
 *
 * Spec: docs/content_planner_buildout.md section 9.3.
 *
 * Before this module the same brand profile was rendered three different ways
 * across engine.ts (voiceFingerprint / voiceSamples / commonEnemyLine /
 * bansBlock / businessBlock / ammoBlock), packagePrompt.ts (voiceLine /
 * clientLine), and external.ts (brandProfileSummary). The renderers had
 * intentional but undocumented drift (different separators, different field
 * sets). Behavior is preserved exactly here so an existing snapshot can
 * confirm the consolidation does not change byte output.
 *
 * `voiceMode` and `clientMode` switch between the variants:
 *   - voiceMode 'full'    : engine.ts variant (irreverent + personal stories + profanity).
 *   - voiceMode 'light'   : packagePrompt.ts variant (no irreverent, no personal stories, no profanity).
 *   - clientMode 'extended': engine.ts businessBlock variant ('mission: X' separator, includes objections + tried_failed).
 *   - clientMode 'minimal' : packagePrompt.ts clientLine variant ('mission=X' separator, no objections / tried_failed).
 */

import type { BrandProfile } from '@/components/clients/brandProfile'

export type VoiceMode = 'light' | 'full'
export type ClientMode = 'minimal' | 'extended'
export type EnemyTier = 'beginner' | 'mid' | 'advanced'

const dial = (n: number) => (n <= 2 ? 'low' : n >= 4 ? 'high' : 'medium')

// -- voice ------------------------------------------------------------------

export function voiceFingerprintLine(profile: BrandProfile | null, mode: VoiceMode): string {
  if (!profile) return 'casual conversational, warm, no jargon.'
  const v = profile.voice

  const parts = [
    `addresses audience as "${v.address_audience_as || 'you'}"`,
    `casual=${dial(v.casualness)}`,
    `funny=${dial(v.funny)}`,
    `enthusiastic=${dial(v.enthusiastic)}`,
    `emotional=${dial(v.emotional)}`,
  ]

  if (mode === 'full') {
    parts.push(`irreverent=${dial(v.irreverent)}`)
  }
  parts.push(`jargon=${v.uses_jargon}`)
  if (mode === 'full') {
    parts.push(`personal stories=${v.shares_personal_stories}`)
    parts.push(`profanity=${v.profanity_level}`)
  }

  const traits = (v.traits || '').trim()
  if (traits) parts.push(`traits="${traits}"`)

  const sigs = (v.signature_phrases || []).map((s) => s.trim()).filter(Boolean)
  if (sigs.length) {
    // Drift preserved: 'full' says "signature phrases", 'light' says "signature".
    const label = mode === 'full' ? 'signature phrases (use sparingly)' : 'signature (use sparingly)'
    parts.push(`${label}: ${sigs.map((s) => `"${s}"`).join(', ')}`)
  }

  return parts.join(' | ')
}

export function voiceSamplesBlock(profile: BrandProfile | null): string {
  const samples = (profile?.voice.samples || []).map((s) => s.trim()).filter(Boolean).slice(0, 3)
  if (!samples.length) return ''
  return [
    'VOICE SAMPLES (mirror the rhythm, word choice, sentence length - do NOT quote):',
    ...samples.map((s, i) => `<sample ${i + 1}>\n${s}\n</sample>`),
  ].join('\n')
}

// -- client context ---------------------------------------------------------

export function clientContextBlock(profile: BrandProfile | null, mode: ClientMode): string {
  if (!profile) return ''
  const b = profile.business
  const a = profile.audience

  if (mode === 'minimal') {
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

  // extended
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

// -- ammo -------------------------------------------------------------------

export function ammoBlock(profile: BrandProfile | null): string {
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

// -- common enemy -----------------------------------------------------------

export function deriveCommonEnemy(profile: BrandProfile | null): string {
  const pains = (profile?.audience.pain_points || []).map((p) => p.trim()).filter(Boolean)
  const joined = pains.join(' | ').toLowerCase()
  if (/inconsist/.test(joined)) return 'the post-ghost-guilt loop'
  if (/overwhelm|confus/.test(joined)) return 'the overwhelm trap'
  if (/time|busy/.test(joined)) return 'the time tax'
  if (/view|reach|engage/.test(joined)) return 'the attention treadmill'
  if (/lead|sale|convert/.test(joined)) return "busy content that doesn't convert"
  return 'generic advice that keeps you stuck'
}

export function commonEnemyLine(profile: BrandProfile | null, tier: EnemyTier): string {
  const explicit = (profile?.voice.common_enemy || '').trim()
  const enemy = explicit || deriveCommonEnemy(profile)
  const stance =
    tier === 'beginner'
      ? `Frame as "me and you, figuring this out together" vs ${enemy}.`
      : tier === 'mid'
        ? `Frame as "me, a few steps ahead, pulling you past ${enemy}".`
        : `Frame as "I've seen what keeps people stuck in ${enemy} - here's the way through".`
  return `COMMON ENEMY: ${stance} Never say "the enemy is". Show the trap; don't label it.`
}

// -- bans -------------------------------------------------------------------

// `extraBans` is prepended to profile-defined custom bans. Engine.ts passes
// HARD_BANS via this slot; downstream callers can pass any baseline list.
export function bansBlock(profile: BrandProfile | null, extraBans: string[] = []): string {
  const custom = [
    ...(profile?.voice.banned_phrases || []),
    ...(profile?.voice.forbidden_words || []),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
  const all = [...extraBans, ...custom]
  return `BANNED (never use, no exceptions): ${all.map((s) => `"${s}"`).join(', ')}.`
}

// -- composer ---------------------------------------------------------------

export interface BrandContextOptions {
  /** 'light' = packagePrompt-style (no profanity, no personal stories, no irreverent). 'full' = engine.ts-style. */
  voiceMode?: VoiceMode
  /** 'minimal' = packagePrompt-style ('=' separator, fewer fields). 'extended' = engine.ts-style. */
  clientMode?: ClientMode
  includeVoiceSamples?: boolean
  includeAmmo?: boolean
  includeCommonEnemy?: boolean
  /** Required when includeCommonEnemy is true. */
  tierForEnemy?: EnemyTier
  includeBans?: boolean
  /** Baseline ban list (e.g. HARD_BANS from engine.ts). Used only when includeBans is true. */
  extraBans?: string[]
}

export function buildBrandContextBlock(
  profile: BrandProfile | null,
  opts: BrandContextOptions = {},
): string {
  const sections: string[] = []

  const voice = voiceFingerprintLine(profile, opts.voiceMode ?? 'full')
  if (voice) sections.push(`VOICE: ${voice}`)

  if (opts.includeVoiceSamples) {
    const samples = voiceSamplesBlock(profile)
    if (samples) sections.push(samples)
  }

  const client = clientContextBlock(profile, opts.clientMode ?? 'extended')
  if (client) sections.push(client)

  if (opts.includeAmmo) {
    const ammo = ammoBlock(profile)
    if (ammo) sections.push(ammo)
  }

  if (opts.includeCommonEnemy && opts.tierForEnemy) {
    sections.push(commonEnemyLine(profile, opts.tierForEnemy))
  }

  if (opts.includeBans !== false) {
    sections.push(bansBlock(profile, opts.extraBans ?? []))
  }

  return sections.join('\n\n')
}
