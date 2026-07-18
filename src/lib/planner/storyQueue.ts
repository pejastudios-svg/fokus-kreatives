// Story queue generation - unified frame model.
//
// Stories are TEXT-FIRST 4-frame sequences. Each story has 4 beats:
//   HOOK -> VALUE -> REHOOK -> CTA
// Each frame is read silently by the viewer (~5-7s per frame, 4 frames =
// ~20-28s total). No voiceover - the on_screen_text IS the message.
// `capture` is a one-phrase visual hint ("talking head" / "text card" /
// "b-roll" / "screen recording") - not a production paragraph.
//
// Word budgets per beat (enforced in prompt + post-processed):
//   HOOK   <= 10 words
//   VALUE  <= 15 words
//   REHOOK <= 12 words
//   CTA    <= 10 words
//
// Sticker stays separate - it's a single-frame format with a sticker
// (poll / question / slider) that IS the call to action.
//
// At the DB level we reuse carrier='video' for the unified frame model
// (no enum migration). Sticker stays carrier='sticker'.
//
// CTA RULES (story-specific):
//   - Stories CANNOT be saved on Instagram, so "Save this" is invalid.
//   - All story CTAs must be DM-driven, share, or follow:
//     "DM me [keyword]", "Send this to someone who...", "Follow for more"
//
// Plan-time tightening rules (applied in generateStoriesForPlan):
//   1. Per-group cap (STORIES_PER_GROUP_CAP) - one topic group can back
//      at most N stories so material gets distributed.
//   2. Round-robin group assignment - each slot pre-bound to a topic group.
//   3. Per-slot format-fit filter - only formats with material_fit >=
//      threshold survive against the assigned group.
//   4. Capture rotation - rolling AVOID list of recent visuals.
//   5. Brand DM keywords - dm_keywords from brand_content_settings get
//      injected into the CTA section.

import { generateScript } from '@/lib/ai/provider'
import { sanitizeStoryText, findHardBanHit } from '@/lib/prompt/engine'
import { evaluateStoryChecklist } from '@/lib/checklist/storyChecklist'
import type { ChecklistItem } from '@/lib/checklist/items'
import { listFormats } from '@/lib/contentFormats'
import type { ContentFormat } from '@/lib/contentFormats/types'
import type {
  AssetSlot,
  FrameRole,
  FrameSticker,
  StickerKind,
  StoryCampaign,
  StoryFrameV2,
  StoryIntent,
  StoryMechanic,
  TextBlock,
  TextEmphasis,
} from '@/components/planner/types'

import { plannerAdmin } from './db'
import { loadAvailableTopicGroups } from './material'
import { pickBestMaterial } from './scoring'
import { selectHookAngles, renderHookAngleBlock } from './hookBank'
import type { RawTopicAnswer, TopicGroup } from './types'

const STORIES_PER_GROUP_CAP = 5
const MATERIAL_FIT_THRESHOLD = 5
const CAPTURE_ROTATION_WINDOW = 8

// Per-frame word budget (combined across stacked text_blocks) used by the
// post-processor. The prompt asks the AI to respect these; the post-processor
// truncates only when WAY over (>1.5x), preserving sentence boundaries -
// hard-cutting at exactly the budget produces broken sentences like "Got this
// DM: How do I get clients without a." (a real failure case from production).
const ROLE_WORD_BUDGETS: Record<FrameRole, number> = {
  HOOK: 12,
  CONTEXT: 14,
  VALUE: 15,
  STEP: 16,
  PROOF: 14,
  ESCALATE: 26,
  REHOOK: 12,
  CTA: 14,
}
// Per stacked overlay line. ESCALATE stacks several short lines; this caps any
// single one so the frame stays readable.
const MAX_BLOCK_WORDS = 12

// Per-bucket narrative arc for the teach/prove intents. The frames must form
// ONE story, not disconnected lines. The cta strings are mechanic-NEUTRAL (the
// actual "Reply '{KW}'..." vs "DM..." shape comes from the CTA RULES block +
// the per-role CTA guidance) so flipping the default mechanic touches one place.
type FormatBucket = 'storytelling' | 'educational' | 'opinion' | 'proof_community'

const NARRATIVE_ARCS: Record<FormatBucket, { hook: string; value: string; rehook: string; cta: string }> = {
  storytelling: {
    hook: 'the painful BEFORE - ONE specific moment/scene from the raw material. State what was happening and what it felt like.',
    value: 'the turning point - the realization or shift that changed things. Anchor to a specific cause.',
    rehook: 'the AFTER - show how things look now in concrete terms that contrast the BEFORE. Same protagonist, same situation, new state.',
    cta: 'invite the viewer to apply the realization themselves.',
  },
  educational: {
    hook: 'the problem framed as a real situation the viewer recognizes - not abstract.',
    value: 'ONE punchy piece of the framework - the single most useful idea, complete on its own. Not a list of three.',
    rehook: 'the angle most people miss - reframe what the value beat just said with a sharper take.',
    cta: 'invite the viewer to ask for the full framework.',
  },
  opinion: {
    hook: 'the spicy take - one sentence that splits the room. Pick a side.',
    value: 'ONE piece of evidence or reasoning that defends the take. Specific, not generic.',
    rehook: 'frame the opposite side as wrong (or shaky) and dare the viewer to disagree.',
    cta: 'invite the viewer to reply, share, or follow to continue the debate.',
  },
  proof_community: {
    hook: 'the win/result - a specific outcome from the raw material. Quote it verbatim if a number exists; do NOT invent numbers.',
    value: 'the ONE lever that produced the result - the specific thing that mattered.',
    rehook: 'what this means for the viewer (the implication, not a generic platitude).',
    cta: 'invite the viewer to ask for the breakdown.',
  },
}

// ---------------------------------------------------------------------------
// INTENT ROUTER
//
// A story is a Story Set: an `intent` selects a variable-length sequence of
// frames (RoleSpec[]). Each RoleSpec carries per-role guidance (parameterized
// by bucket/campaign), a word budget, and a max stacked-text-block count.
// `engage` routes to the sticker generator; the other four flow through
// generateOneStoryBrief's prompt builder.
// ---------------------------------------------------------------------------

/**
 * CTA shape for a story. We rotate this across a story set so a month of
 * stories doesn't collapse into "Reply KEYWORD" on every card:
 *   - keyword:    the lead-capture ask ("Reply 'FRAMEWORK' for X") - keyword-locked
 *   - engagement: a genuine reply, no keyword ("Reply with your take")
 *   - share:      "Send this to someone who..."
 *   - follow:     "Follow for [specific next thing]"
 * launch/bts use their own CTA specs and ignore this.
 */
type CtaShape = 'keyword' | 'engagement' | 'share' | 'follow'
const CTA_SHAPES: CtaShape[] = ['keyword', 'engagement', 'share', 'follow']

/** Rotate CTA shape for teach stories; prove always asks for the breakdown. */
function pickCtaShape(intent: StoryIntent, rotation: number): CtaShape {
  if (intent !== 'teach') return 'keyword'
  return CTA_SHAPES[Math.abs(rotation) % CTA_SHAPES.length]
}

/** Small stable string hash (djb2) - deterministic CTA rotation for one-offs. */
function stableHash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return h >>> 0
}

interface ArcCtx {
  bucket: FormatBucket
  arc: { hook: string; value: string; rehook: string; cta: string }
  KW: string
  mechanic: StoryMechanic
  campaign: StoryCampaign | null
  /** Which CTA shape this story uses (keyword/engagement/share/follow). */
  ctaShape: CtaShape
}

interface RoleSpec {
  role: FrameRole
  guidance: (ctx: ArcCtx) => string
  /** Combined word budget across this frame's text_blocks. */
  wordBudget: number
  /** Max stacked overlays. 1 for most; up to 4 for ESCALATE. */
  maxBlocks: number
  /** When set, this frame is an asset-slot frame (PROOF). */
  assetSlot?: AssetSlot
}

const replyOrDm = (c: ArcCtx) =>
  c.mechanic === 'dm' ? `DM '${c.KW}'` : `Reply '${c.KW}' to this story`

const HOOK_SPEC: RoleSpec = { role: 'HOOK', wordBudget: 12, maxBlocks: 1, guidance: (c) => c.arc.hook }
const VALUE_SPEC: RoleSpec = { role: 'VALUE', wordBudget: 15, maxBlocks: 1, guidance: (c) => c.arc.value }
const REHOOK_SPEC: RoleSpec = { role: 'REHOOK', wordBudget: 12, maxBlocks: 1, guidance: (c) => c.arc.rehook }
const CTA_SPEC: RoleSpec = {
  role: 'CTA',
  wordBudget: 14,
  maxBlocks: 1,
  guidance: (c) => {
    switch (c.ctaShape) {
      case 'engagement':
        return `an ENGAGEMENT reply CTA - NO keyword. Invite a genuine reply tied to this story's value beat. Shape: "Reply to this story with [your take / your answer]." Do NOT use a keyword word. Do NOT say "Save this".`
      case 'share':
        return `a SHARE CTA - NO keyword. Shape: "Send this to someone who [specific person this story is for]." Make the "someone who" specific to the value beat, not generic.`
      case 'follow':
        return `a FOLLOW CTA - NO keyword. Shape: "Follow for [the specific next thing this account delivers]." Tie it to the value beat, never generic "more content".`
      case 'keyword':
      default:
        return `${c.arc.cta} Phrase as the ${c.mechanic === 'dm' ? 'DM' : 'reply-to-story'} CTA: "${replyOrDm(c)} for [the thing]."`
    }
  },
}

const PROOF_SPEC: RoleSpec = {
  role: 'PROOF',
  wordBudget: 14,
  maxBlocks: 2,
  guidance: () =>
    `built around a REAL asset the staff will paste in. Set "visual" to EXACTLY one of: "screenshot-proof", "dm-testimonial", or "result-graphic" (whichever fits the proof). The text_blocks are 1-2 short caption lines AROUND that asset, drawn ONLY from raw material. Do NOT invent the number/quote shown in the asset; if raw material has no specific number, keep the caption qualitative ("the result", "what they said").`,
}

const HOOK_PSA_SPEC: RoleSpec = {
  role: 'HOOK',
  wordBudget: 14,
  maxBlocks: 2,
  guidance: (c) =>
    `an announcement / heads-up opener (a "PSA"-style line), NOT a story scene. Name what's happening${c.campaign?.event_date ? ` and when (${c.campaign.event_date})` : ''}. Punchy. You may stack a short second line.`,
}
const ESCALATE_SPEC: RoleSpec = {
  role: 'ESCALATE',
  wordBudget: 26,
  maxBlocks: 4,
  guidance: () =>
    `2-4 SHORT stacked text_blocks that build momentum in this order of feeling: announce -> why it matters to the viewer -> ONE proof point (only if a real number/result is in raw material) -> urgency. Each block is one short line (<= 12 words). Do NOT use a "good news / better news / best news" or numbered-tier template - that reads as a formula. Vary the phrasing. Mark the announce and urgency blocks with "emphasis":"big" or "highlight".`,
}
const CTA_LAUNCH_SPEC: RoleSpec = {
  role: 'CTA',
  wordBudget: 16,
  maxBlocks: 1,
  guidance: (c) => {
    const offer = c.campaign?.offer ? ` to get ${c.campaign.offer}` : ' for the details'
    const when = c.campaign?.event_date ? ` Reference the date (${c.campaign.event_date}) for urgency.` : ''
    return `the ask: "${replyOrDm(c)}${offer}."${when}`
  },
}

const CONTEXT_SPEC: RoleSpec = {
  role: 'CONTEXT',
  wordBudget: 14,
  maxBlocks: 1,
  guidance: () =>
    `a casual REAL behind-the-scenes moment from raw material - what's happening right now, low-key and human. No selling yet.`,
}
const BTW_PIVOT_SPEC: RoleSpec = {
  role: 'STEP',
  wordBudget: 16,
  maxBlocks: 2,
  guidance: (c) =>
    `a soft pivot that opens like an afterthought ("btw", "quick thing", "almost forgot") into the offer${c.campaign?.offer ? ` (${c.campaign.offer})` : ''}. Low pressure, friendly.`,
}
const CTA_SOFT_SPEC: RoleSpec = {
  role: 'CTA',
  wordBudget: 14,
  maxBlocks: 1,
  guidance: (c) => `a SOFT invite, never a hard sell: "${replyOrDm(c)} if you want in." Keep it casual.`,
}

const INTENT_ROLES: Record<StoryIntent, RoleSpec[]> = {
  teach: [HOOK_SPEC, VALUE_SPEC, REHOOK_SPEC, CTA_SPEC],
  prove: [HOOK_SPEC, PROOF_SPEC, REHOOK_SPEC, CTA_SPEC],
  launch: [HOOK_PSA_SPEC, ESCALATE_SPEC, PROOF_SPEC, CTA_LAUNCH_SPEC],
  engage: [HOOK_SPEC], // routed to generateStickerBrief; sequence is informational
  bts_invite: [CONTEXT_SPEC, BTW_PIVOT_SPEC, CTA_SOFT_SPEC],
}

function roleOrder(specs: RoleSpec[], role: FrameRole): number {
  const i = specs.findIndex((s) => s.role === role)
  return i < 0 ? 99 : i
}

/** The JSON `frames` schema shown to the model, derived from the role specs. */
function buildFramesSchema(specs: RoleSpec[]): string {
  return specs
    .map((s) => {
      const blocks =
        s.maxBlocks > 1
          ? `[{ "text": "...", "emphasis": "normal|highlight|big" }, ... up to ${s.maxBlocks}]`
          : `[{ "text": "...", "emphasis": "normal" }]`
      const visual =
        s.role === 'PROOF'
          ? `"screenshot-proof|dm-testimonial|result-graphic"`
          : `"talking head|text card|b-roll|screen recording"`
      return `    { "role": "${s.role}", "text_blocks": ${blocks}, "visual": ${visual} }`
    })
    .join(',\n')
}

/** The per-role guidance block (replaces the old fixed NARRATIVE ARC). */
function buildRoleGuidance(specs: RoleSpec[], ctx: ArcCtx): string {
  const order = specs.map((s) => s.role).join(' -> ')
  const lines = specs.map((s) => {
    const blocksNote = s.maxBlocks > 1 ? `, up to ${s.maxBlocks} stacked text_blocks` : ''
    return `- ${s.role} (~${s.wordBudget} words${blocksNote}) = ${s.guidance(ctx)}`
  })
  return `FRAME SEQUENCE (exactly ${specs.length} frame${specs.length === 1 ? '' : 's'}, in order ${order}):\n${lines.join('\n')}`
}

/** Intent-aware coherence rule. Narrative intents anchor to ONE moment; launch
 *  anchors to ONE offer. */
function buildCoherenceRule(intent: StoryIntent): string {
  if (intent === 'launch') {
    return `ONE-OFFER RULE (read twice):
- Every frame serves ONE offer. Do NOT drift to other topics. The announce, the escalation, the proof, and the CTA all point at the SAME single offer.
- The proof frame must support THIS offer, not a tangent.`
  }
  return `ONE-SITUATION RULE (most-violated rule - read twice):
- All frames describe ONE specific situation, ONE protagonist, ONE scene. Do NOT pivot topics between frames.
- If the opener is about "creator's block on Tuesday morning", the rest must stay anchored to THAT moment - not jump to "first time filming" or some other angle.
- Pick the single moment from raw material that best supports the sequence above. Build every frame from THAT moment. Stories that pivot read as disconnected slogans.`
}

export interface RefillResult {
  created: number
  skipped: string[]
}

async function loadDmKeywords(clientId: string): Promise<string[]> {
  const supabase = plannerAdmin()
  const { data, error } = await supabase
    .from('brand_content_settings')
    .select('dm_keywords')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) {
    console.error('[story_brief] loadDmKeywords error:', error.message)
    return []
  }
  const raw = (data?.dm_keywords as string[] | null) ?? []
  const out = raw.map((k) => (typeof k === 'string' ? k.trim() : '')).filter(Boolean)
  console.log(`[story_brief] loadDmKeywords client=${clientId} ->`, JSON.stringify(out))
  return out
}

/** The brand's active launch campaign, or null. Returns null when unset,
 *  toggled off, or the event_date has passed - so auto-launch only fires for a
 *  real, current offer (never an invented one). */
async function loadActiveCampaign(clientId: string): Promise<StoryCampaign | null> {
  const supabase = plannerAdmin()
  const { data, error } = await supabase
    .from('brand_content_settings')
    .select('story_campaign')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) {
    console.error('[story_brief] loadActiveCampaign error:', error.message)
    return null
  }
  const raw = data?.story_campaign as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') return null
  if (raw.active === false) return null
  const offer = typeof raw.offer === 'string' ? raw.offer.trim() : ''
  if (!offer) return null
  const eventDate =
    typeof raw.event_date === 'string' && raw.event_date.trim() ? raw.event_date.trim() : null
  if (eventDate && eventDate < new Date().toISOString().slice(0, 10)) return null // expired
  const keyword = typeof raw.keyword === 'string' && raw.keyword.trim() ? raw.keyword.trim() : null
  const mechanic: StoryMechanic = raw.mechanic === 'dm' ? 'dm' : 'reply'
  return { offer, event_date: eventDate, keyword, mechanic }
}

/** Auto-mix the story archetype for plan-time / refill generation.
 *  - launch only when the brand has an active campaign (else it would invent an offer)
 *  - prove only for proof_community formats (where real proof material exists)
 *  - engage (sticker) and bts_invite sprinkled on a rotation; teach is the default */
function pickAutoIntent(
  format: ContentFormat,
  rotation: number,
  hasActiveCampaign: boolean,
): StoryIntent {
  if (hasActiveCampaign && rotation % 6 === 3) return 'launch'
  if (rotation % 5 === 4) return 'engage'
  if (rotation % 7 === 6) return 'bts_invite'
  if (format.bucket === 'proof_community') return 'prove'
  return 'teach'
}

export async function refillStoryQueue(
  clientId: string,
  targetCount?: number,
): Promise<RefillResult> {
  const supabase = plannerAdmin()
  const target = targetCount ?? 5
  const skipped: string[] = []

  const { count } = await supabase
    .from('story_queue_items')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .is('consumed_at', null)

  const have = count ?? 0
  const needed = Math.max(0, target - have)
  if (needed <= 0) return { created: 0, skipped: [] }

  const { data: clientRow } = await supabase
    .from('clients')
    .select('id, name, business_name')
    .eq('id', clientId)
    .maybeSingle()

  const pools = await loadCarrierPools()
  if (pools.story.length === 0) {
    return { created: 0, skipped: ['no source formats available for stories'] }
  }

  let topicGroups = await loadAvailableTopicGroups(supabase, clientId)
  if (topicGroups.length === 0) {
    return { created: 0, skipped: ['no available topic answers'] }
  }

  const dmKeywords = await loadDmKeywords(clientId)
  const campaign = await loadActiveCampaign(clientId)
  const hasActiveCampaign = !!campaign
  const brandName = clientRow?.business_name ?? clientRow?.name ?? null
  let created = 0
  const recentCaptures: string[] = []
  const recentHooks: string[] = []
  const sortedFormats = [...pools.story].sort((a, b) => a.cooldown_posts - b.cooldown_posts)

  for (let i = 0; i < needed; i++) {
    const format = sortedFormats[i % sortedFormats.length]
    const intent = pickAutoIntent(format, i, hasActiveCampaign)
    const generated =
      intent === 'engage'
        ? await generateStickerBrief({ clientId, brandName, format, topicGroups, dmKeywords })
        : await generateOneStoryBrief({
            clientId,
            brandName,
            format,
            topicGroups,
            dmKeywords,
            recentCaptures: [...recentCaptures],
            recentHooks: [...recentHooks],
            intent,
            campaign: intent === 'launch' ? campaign : null,
          })
    if (!generated) {
      skipped.push(`${format.slug}: generation failed`)
      continue
    }

    const { error } = await supabase.from('story_queue_items').insert({
      client_id: clientId,
      format_id: format.id,
      source_format_id: format.id,
      carrier: generated.intent === 'engage' ? 'sticker' : 'video',
      intent: generated.intent,
      campaign: generated.campaign,
      mechanic: generated.mechanic,
      prompt_text: generated.prompt_text,
      visual_direction: generated.visual_direction,
      frames: generated.frames,
      raw_material_refs: generated.refs,
      checklist: generated.checklist,
    })
    if (error) {
      skipped.push(`${format.slug}: ${error.message}`)
      continue
    }
    created += 1

    for (const f of generated.frames) {
      if (f.visual && !ASSET_SLOT_SET.has(f.visual as AssetSlot)) recentCaptures.push(f.visual)
      if ((f.role === 'HOOK' || f.role === 'CONTEXT') && f.text_blocks[0]?.text) {
        recentHooks.push(f.text_blocks[0].text)
      }
    }
    while (recentCaptures.length > CAPTURE_ROTATION_WINDOW) recentCaptures.shift()
    while (recentHooks.length > CAPTURE_ROTATION_WINDOW) recentHooks.shift()

    if (generated.topic_group_id && topicGroups.length > 1) {
      topicGroups = topicGroups.filter((g) => g.topic_group_id !== generated.topic_group_id)
    }
  }

  return { created, skipped }
}

export interface GenerateStoryPromptInput {
  clientId: string
  seedText?: string | null
  /** Optional: override the format pick. */
  formatId?: string | null
  /** Optional: the archetype to generate. Defaults to 'teach'. */
  intent?: StoryIntent
}

export async function generateStoryPrompt(input: GenerateStoryPromptInput): Promise<{ promptId: string }> {
  const supabase = plannerAdmin()

  const { data: clientRow } = await supabase
    .from('clients')
    .select('id, name, business_name')
    .eq('id', input.clientId)
    .maybeSingle()

  const pools = await loadCarrierPools()
  if (pools.story.length === 0) throw new Error('No source formats configured for stories')

  let format: ContentFormat | null = null
  if (input.formatId) {
    format = pools.story.find((f) => f.id === input.formatId) ?? null
  }
  if (!format) {
    format = [...pools.story].sort((a, b) => a.cooldown_posts - b.cooldown_posts)[0]
  }

  const topicGroups = await loadAvailableTopicGroups(supabase, input.clientId)
  if (topicGroups.length === 0) throw new Error('No available topic answers')

  const dmKeywords = await loadDmKeywords(input.clientId)
  const brandName = clientRow?.business_name ?? clientRow?.name ?? null
  const intent: StoryIntent = input.intent ?? 'teach'
  const campaign = intent === 'launch' ? await loadActiveCampaign(input.clientId) : null
  const generated =
    intent === 'engage'
      ? await generateStickerBrief({ clientId: input.clientId, brandName, format, topicGroups, dmKeywords })
      : await generateOneStoryBrief({
          clientId: input.clientId,
          brandName,
          format,
          topicGroups,
          seedText: input.seedText ?? null,
          dmKeywords,
          recentCaptures: [],
          recentHooks: [],
          intent,
          campaign,
        })

  if (!generated) throw new Error('Story prompt generation failed')

  const { data: inserted, error } = await supabase
    .from('story_queue_items')
    .insert({
      client_id: input.clientId,
      format_id: format.id,
      source_format_id: format.id,
      carrier: generated.intent === 'engage' ? 'sticker' : 'video',
      intent: generated.intent,
      campaign: generated.campaign,
      mechanic: generated.mechanic,
      prompt_text: generated.prompt_text,
      visual_direction: generated.visual_direction,
      frames: generated.frames,
      raw_material_refs: generated.refs,
      seed_text: input.seedText ?? null,
      checklist: generated.checklist,
    })
    .select('id')
    .single()

  if (error || !inserted) throw new Error(error?.message ?? 'Insert failed')
  return { promptId: inserted.id as string }
}

/**
 * Plan-time bulk story generation. Walks Mon-Fri dates in [start, end), pins
 * one story per weekday up to the tier's monthly story quota, capped by
 * available material.
 *
 * Two carriers: most stories are 4-frame text-first sequences (carrier
 * 'video' in the DB), with one or two sticker stories sprinkled in for
 * engagement. Slots are pre-bound to topic groups round-robin (capped at
 * STORIES_PER_GROUP_CAP per group). Each slot then filters its format pool
 * by per-group material_fit and rejects formats that can't produce a
 * passable beat from the assigned group.
 *
 * Idempotent: dates that already have a pinned story are skipped so re-runs
 * don't double up.
 */
export async function generateStoriesForPlan(input: {
  clientId: string
  start: string
  end: string
  /** How many stories to generate per campaign topic. Caller computes
   *  this from `tierCfg.perCampaign.stories * monthsAhead`. */
  storiesPerCampaign: number
  /** The same campaign topics the planner used for content slots. Each
   *  topic produces `storiesPerCampaign` stories, anchored to its
   *  answers in slot order (slot N -> answers[N]). */
  topicGroups: TopicGroup[]
}): Promise<{ created: number; skipped: string[] }> {
  const skipped: string[] = []
  if (input.storiesPerCampaign <= 0 || input.topicGroups.length === 0) {
    return { created: 0, skipped: [] }
  }

  const supabase = plannerAdmin()

  const { data: clientRow } = await supabase
    .from('clients')
    .select('id, name, business_name')
    .eq('id', input.clientId)
    .maybeSingle()

  const pools = await loadCarrierPools()
  if (pools.story.length === 0) {
    return { created: 0, skipped: ['no source formats available for stories'] }
  }

  const dmKeywords = await loadDmKeywords(input.clientId)
  console.log(`[story_brief] generateStoriesForPlan: loaded ${dmKeywords.length} dm_keywords:`, JSON.stringify(dmKeywords))
  const campaign = await loadActiveCampaign(input.clientId)
  const hasActiveCampaign = !!campaign
  console.log(`[story_brief] generateStoriesForPlan: active campaign =`, campaign ? campaign.offer : 'none')

  // Build Mon-Fri dates in the horizon.
  const dates: string[] = []
  let cursor = input.start
  while (cursor < input.end) {
    const d = new Date(`${cursor}T00:00:00Z`)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) dates.push(cursor)
    d.setUTCDate(d.getUTCDate() + 1)
    cursor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  // Wipe un-consumed stories so re-generate replaces them. Consumed
  // (marked-as-used) stories are preserved.
  const { error: wipeErr, count: wipedCount } = await supabase
    .from('story_queue_items')
    .delete({ count: 'exact' })
    .eq('client_id', input.clientId)
    .gte('pinned_to_date', input.start)
    .lt('pinned_to_date', input.end)
    .is('consumed_at', null)
  if (wipeErr) {
    console.error('[story_brief] failed to wipe stale stories:', wipeErr.message)
  } else if ((wipedCount ?? 0) > 0) {
    console.log(`[story_brief] wiped ${wipedCount} stale un-consumed stories in range before regen`)
  }

  const { data: existingPinned } = await supabase
    .from('story_queue_items')
    .select('pinned_to_date')
    .eq('client_id', input.clientId)
    .gte('pinned_to_date', input.start)
    .lt('pinned_to_date', input.end)
  const pinnedDates = new Set(
    (existingPinned ?? []).map((r) => r.pinned_to_date as string).filter(Boolean),
  )
  const availableDates = dates.filter((d) => !pinnedDates.has(d))
  if (availableDates.length === 0) return { created: 0, skipped }

  // Slice dates per campaign so a topic's stories cluster on the calendar
  // (week 1 = topic 1 etc).
  const datesPerCampaign: string[][] = []
  for (let i = 0; i < input.topicGroups.length; i++) {
    const start = Math.floor((i * availableDates.length) / input.topicGroups.length)
    const end = Math.floor(((i + 1) * availableDates.length) / input.topicGroups.length)
    datesPerCampaign.push(availableDates.slice(start, end))
  }

  const brandName = clientRow?.business_name ?? clientRow?.name ?? null
  const sortedFormats = [...pools.story].sort((a, b) => a.cooldown_posts - b.cooldown_posts)

  interface PendingInsert {
    date: string
    sourceFormatId: string
    promptText: string
    visualDirection: string | null
    frames: StoryFrameV2[]
    refs: string[]
    intent: StoryIntent
    campaign: StoryCampaign | null
    mechanic: StoryMechanic
    checklist: ChecklistItem[]
  }
  const inserts: PendingInsert[] = []
  const BATCH = 6

  // Build the queue: for each campaign, walk slot indices 0..storiesPerCampaign-1.
  // Each slot anchors to topic.answers[slotIndex % answers.length], with
  // recycled=true when slotIndex >= answers.length.
  interface StoryUnit {
    date: string
    topic: TopicGroup
    anchor: RawTopicAnswer
    recycled: boolean
    formatRotation: number
  }
  const queue: StoryUnit[] = []
  for (let campaignIdx = 0; campaignIdx < input.topicGroups.length; campaignIdx++) {
    const topic = input.topicGroups[campaignIdx]
    const campaignDates = datesPerCampaign[campaignIdx]
    if (campaignDates.length === 0 || topic.answers.length === 0) continue

    const stepCount = Math.min(input.storiesPerCampaign, campaignDates.length)
    for (let slotIdx = 0; slotIdx < input.storiesPerCampaign; slotIdx++) {
      const answerIdx = slotIdx % topic.answers.length
      const anchor = topic.answers[answerIdx]
      const recycled = slotIdx >= topic.answers.length
      const dateIdx = Math.min(
        campaignDates.length - 1,
        Math.floor((slotIdx * campaignDates.length) / Math.max(1, stepCount)),
      )
      queue.push({
        date: campaignDates[dateIdx],
        topic,
        anchor,
        recycled,
        formatRotation: slotIdx,
      })
    }
  }

  if (queue.length === 0) return { created: 0, skipped }

  // Sort by date so polish + capture rotation advance in calendar order.
  queue.sort((a, b) => a.date.localeCompare(b.date))

  for (let i = 0; i < queue.length; i += BATCH) {
    const batchSlice = queue.slice(i, i + BATCH)
    const batchResults = await Promise.all(
      batchSlice.map(async (unit, sliceIdx) => {
        // Calendar position across the whole (date-sorted) queue - drives the
        // CTA-shape rotation so consecutive stories don't repeat a CTA type.
        const calendarIdx = i + sliceIdx
        // Pick the best format for this anchor in the story pool. We
        // prefer formats whose required input_types include the anchor's
        // input_type, falling back to whatever scores highest. Cooldown
        // is approximated by rotating through the pool by formatRotation.
        const fittingFormats = sortedFormats.filter(
          (f) => pickBestMaterial(f, [unit.topic]).fit >= MATERIAL_FIT_THRESHOLD,
        )
        const pool = fittingFormats.length > 0 ? fittingFormats : sortedFormats
        const format = pool[unit.formatRotation % pool.length]

        const intent = pickAutoIntent(format, unit.formatRotation, hasActiveCampaign)
        const generated =
          intent === 'engage'
            ? await generateStickerBrief({
                clientId: input.clientId,
                brandName,
                format,
                topicGroups: [unit.topic],
                dmKeywords,
              })
            : await generateOneStoryBrief({
                clientId: input.clientId,
                brandName,
                format,
                topicGroups: [unit.topic],
                dmKeywords,
                anchorAnswer: unit.anchor,
                recycled: unit.recycled,
                recentCaptures: [],
                recentHooks: [],
                intent,
                campaign: intent === 'launch' ? campaign : null,
                ctaRotation: calendarIdx,
              })
        if (!generated) return null
        return {
          date: unit.date,
          sourceFormatId: format.id,
          promptText: generated.prompt_text,
          visualDirection: generated.visual_direction,
          frames: generated.frames,
          refs: generated.refs,
          intent: generated.intent,
          campaign: generated.campaign,
          mechanic: generated.mechanic,
          checklist: generated.checklist,
        }
      }),
    )
    for (const r of batchResults) if (r) inserts.push(r)
  }

  if (inserts.length === 0) {
    return { created: 0, skipped: [...skipped, 'all generation calls returned empty'] }
  }

  const { error: insertErr, count } = await supabase
    .from('story_queue_items')
    .insert(
      inserts.map((r) => ({
        client_id: input.clientId,
        format_id: r.sourceFormatId,
        source_format_id: r.sourceFormatId,
        carrier: r.intent === 'engage' ? 'sticker' : 'video',
        intent: r.intent,
        campaign: r.campaign,
        mechanic: r.mechanic,
        prompt_text: r.promptText,
        visual_direction: r.visualDirection,
        frames: r.frames,
        raw_material_refs: r.refs,
        pinned_to_date: r.date,
        checklist: r.checklist,
      })),
      { count: 'exact' },
    )
  if (insertErr) return { created: 0, skipped: [...skipped, insertErr.message] }
  return { created: count ?? inserts.length, skipped }
}

/**
 * Regenerate a single story prompt in place, preserving its carrier and
 * source format. The id and pinned_to_date stay so calendar position is
 * unchanged.
 */
export async function regenerateStoryPrompt(itemId: string): Promise<{ id: string } | null> {
  const supabase = plannerAdmin()
  const { data: row } = await supabase
    .from('story_queue_items')
    .select('id, client_id, format_id, source_format_id, carrier, intent, campaign, seed_text')
    .eq('id', itemId)
    .maybeSingle()
  if (!row) return null

  const carrierRaw = row.carrier as string | null
  // Preserve the archetype on redo. Legacy rows (no intent) infer from carrier.
  const storedIntent = (row.intent as StoryIntent | null) ?? null
  const intent: StoryIntent = storedIntent ?? (carrierRaw === 'sticker' ? 'engage' : 'teach')
  const isSticker = intent === 'engage'
  const sourceFormatId = (row.source_format_id as string | null) ?? (row.format_id as string | null)

  const pools = await loadCarrierPools()
  let format: ContentFormat | null = null
  if (isSticker) {
    format = pools.sticker
  } else if (sourceFormatId) {
    format = pools.story.find((f) => f.id === sourceFormatId) ?? null
  }
  if (!format) {
    if (isSticker && pools.sticker) format = pools.sticker
    else if (pools.story.length > 0) format = pools.story[0]
    else return null
  }

  const topicGroups = await loadAvailableTopicGroups(supabase, row.client_id as string)
  if (topicGroups.length === 0) return null

  const { data: clientRow } = await supabase
    .from('clients')
    .select('name, business_name')
    .eq('id', row.client_id as string)
    .maybeSingle()
  const brandName = clientRow?.business_name ?? clientRow?.name ?? null
  const dmKeywords = await loadDmKeywords(row.client_id as string)

  // Launch redo reuses the row's stored campaign snapshot, falling back to the
  // brand's current active campaign.
  const campaign =
    intent === 'launch'
      ? ((row.campaign as StoryCampaign | null) ?? (await loadActiveCampaign(row.client_id as string)))
      : null

  const generated = isSticker
    ? await generateStickerBrief({
        clientId: row.client_id as string,
        brandName,
        format,
        topicGroups,
        dmKeywords,
      })
    : await generateOneStoryBrief({
        clientId: row.client_id as string,
        brandName,
        format,
        topicGroups,
        seedText: row.seed_text as string | null,
        dmKeywords,
        recentCaptures: [],
        recentHooks: [],
        intent,
        campaign,
      })
  if (!generated) return null

  const { error } = await supabase
    .from('story_queue_items')
    .update({
      prompt_text: generated.prompt_text,
      visual_direction: generated.visual_direction,
      frames: generated.frames,
      raw_material_refs: generated.refs,
      source_format_id: format.id,
      carrier: generated.intent === 'engage' ? 'sticker' : 'video',
      intent: generated.intent,
      campaign: generated.campaign,
      mechanic: generated.mechanic,
      checklist: generated.checklist,
    })
    .eq('id', itemId)
  if (error) return null
  return { id: itemId }
}

// ---------------------------------------------------------------------------
// INTERNAL HELPERS
// ---------------------------------------------------------------------------

interface CarrierPools {
  /** All formats usable as story source material: short_form +
   *  engagement_reel + carousel. */
  story: ContentFormat[]
  /** Story-native sticker format (story.question_for_audience). */
  sticker: ContentFormat | null
}

async function loadCarrierPools(): Promise<CarrierPools> {
  const allActive = await listFormats({ is_active: true })
  return {
    story: allActive.filter(
      (f) =>
        f.content_type === 'short_form' ||
        f.content_type === 'engagement_reel' ||
        f.content_type === 'carousel',
    ),
    sticker: allActive.find((f) => f.slug === 'story.question_for_audience') ?? null,
  }
}

interface GeneratedBrief {
  prompt_text: string
  visual_direction: string | null
  frames: StoryFrameV2[]
  refs: string[]
  topic_group_id: string | null
  intent: StoryIntent
  campaign: StoryCampaign | null
  mechanic: StoryMechanic
  /** Per-story QA checklist (AI tells / fabrication / CTA). Read-only in UI. */
  checklist: ChecklistItem[]
}

const ASSET_SLOT_SET = new Set<AssetSlot>(['screenshot-proof', 'dm-testimonial', 'result-graphic'])

function firstText(frame: StoryFrameV2 | undefined): string {
  return (frame?.text_blocks?.[0]?.text ?? '').trim()
}

function deriveBriefSummary(frames: StoryFrameV2[]): string {
  const lead = frames.find((f) => f.role === 'HOOK' || f.role === 'CONTEXT') ?? frames[0]
  if (!lead) return ''
  return (firstText(lead) || lead.visual || '').trim()
}

function deriveBriefVisual(frames: StoryFrameV2[]): string | null {
  const visuals = frames
    .map((f) => (ASSET_SLOT_SET.has(f.visual as AssetSlot) ? 'proof asset' : f.visual?.trim()))
    .filter((c): c is string => !!c)
  if (visuals.length === 0) return null
  return visuals.join(' / ')
}

interface DmKeywordRule {
  placeholder: string
  hardRule: string
}

function buildDmKeywordRules(dmKeywords: string[], lockedKeyword?: string | null): DmKeywordRule {
  // A launch campaign keyword (if set) takes priority over the brand's
  // standing dm_keywords for THIS story.
  if (lockedKeyword && lockedKeyword.trim()) {
    const kw = lockedKeyword.trim().toUpperCase()
    return {
      placeholder: kw,
      hardRule: `- KEYWORD IS LOCKED to "${kw}" (this campaign's keyword). Use it verbatim in uppercase. Do NOT substitute any other word.`,
    }
  }
  if (dmKeywords.length === 0) {
    return {
      placeholder: '[KEYWORD]',
      hardRule: `- The keyword is a short uppercase word the brand picks (e.g. "PLAYBOOK", "FRAMEWORK"). Pick something topical to THIS story's value beat, not a generic word.`,
    }
  }
  if (dmKeywords.length === 1) {
    const kw = dmKeywords[0]
    return {
      placeholder: kw,
      hardRule: `- KEYWORD IS LOCKED. The ONLY valid keyword for this brand is "${kw}". Use it verbatim in uppercase. Do NOT substitute SYSTEM, FRAMEWORK, SCRIPT, SKELETON, FORMULA, PLAN, STRATEGY, VOICE, VALUE, or any other word - even if the format's hook patterns or secret sauce reference them.`,
    }
  }
  const list = dmKeywords.map((k) => `"${k}"`).join(' or ')
  return {
    placeholder: dmKeywords[0],
    hardRule: `- KEYWORD IS LOCKED to one of: ${list}. Pick whichever fits this story's value beat. Do NOT invent or substitute any other keyword.`,
  }
}

function buildCaptureAvoidBlock(recentCaptures: string[]): string {
  if (recentCaptures.length === 0) return ''
  const trimmed = recentCaptures.slice(-CAPTURE_ROTATION_WINDOW).map((c) => `- ${c}`)
  return `\nRECENT VISUAL HINTS TO AVOID (the last ${trimmed.length} stories already used these - pick a different visual for at least 2 of your frames):\n${trimmed.join('\n')}\n`
}

function buildHookAvoidBlock(recentHooks: string[]): string {
  if (recentHooks.length === 0) return ''
  const trimmed = recentHooks.slice(-CAPTURE_ROTATION_WINDOW).map((h) => `- "${h}"`)
  return `\nRECENT HOOKS TO AVOID (already used in this batch - your HOOK must anchor on a DIFFERENT moment from raw material):\n${trimmed.join('\n')}\n`
}

function normalizeEmphasis(v: unknown): TextEmphasis {
  return v === 'big' || v === 'highlight' ? v : 'normal'
}

const VALID_STICKER_KINDS: StickerKind[] = ['poll', 'question', 'slider', 'quiz', 'countdown', 'link']

function parseStickerOut(v: unknown): FrameSticker | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as Record<string, unknown>
  const type =
    typeof r.type === 'string' && (VALID_STICKER_KINDS as string[]).includes(r.type)
      ? (r.type as StickerKind)
      : null
  if (!type) return undefined
  const out: FrameSticker = { type }
  if (typeof r.label === 'string' && r.label.trim()) out.label = r.label.trim()
  if (Array.isArray(r.options)) {
    const opts = r.options
      .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
      .map((o) => o.trim())
    if (opts.length) out.options = opts
  }
  return out
}

/** Per-block cap, then per-frame cap (single-block frames only). */
function applyFrameBudgets(frames: StoryFrameV2[]): void {
  for (const frame of frames) {
    const budget = ROLE_WORD_BUDGETS[frame.role] ?? 15
    frame.text_blocks = frame.text_blocks.map((b) => ({
      ...b,
      text: truncateToWordBudget(b.text, MAX_BLOCK_WORDS),
    }))
    if (frame.text_blocks.length === 1 && frame.text_blocks[0]) {
      frame.text_blocks[0] = {
        ...frame.text_blocks[0],
        text: truncateToWordBudget(frame.text_blocks[0].text, budget),
      }
    }
  }
}

/**
 * Generate one text-first Story Set. `intent` selects the role sequence (3-8
 * frames); each frame stacks 1-4 text overlays, carries a visual hint OR an
 * asset-slot, and may hold a sticker. No voiceover. `engage` is NOT generated
 * here (it routes to generateStickerBrief).
 *
 * STORY CTA RULES:
 *   - "Save this" is INVALID (Instagram stories cannot be saved)
 *   - The default CTA mechanic is REPLY-TO-STORY ("Reply 'KEYWORD'...")
 *   - A launch campaign supplies the offer / event date / keyword
 */
async function generateOneStoryBrief(opts: {
  clientId: string
  brandName: string | null
  format: ContentFormat
  topicGroups: TopicGroup[]
  seedText?: string | null
  dmKeywords: string[]
  recentCaptures: string[]
  recentHooks: string[]
  anchorAnswer?: RawTopicAnswer | null
  recycled?: boolean
  /** The archetype. Defaults to 'teach' (the legacy 4-beat shape). */
  intent?: StoryIntent
  /** Launch campaign (offer / event / keyword). Only meaningful for launch. */
  campaign?: StoryCampaign | null
  /** Calendar position in the story set - rotates the CTA shape so a set
   *  varies. Falls back to a stable hash of the anchor when omitted. */
  ctaRotation?: number
}): Promise<GeneratedBrief | null> {
  const intent: StoryIntent = opts.intent ?? 'teach'
  const roleSpecs = INTENT_ROLES[intent] ?? INTENT_ROLES.teach
  const campaign = opts.campaign ?? null
  const mechanic: StoryMechanic = campaign?.mechanic ?? 'reply'

  const material = pickBestMaterial(opts.format, opts.topicGroups)
  if (material.refs.length === 0) {
    const fallback = opts.topicGroups[0]?.answers[0]
    if (!fallback) return null
    material.refs.push(fallback.id)
    material.topic_group_id = opts.topicGroups[0].topic_group_id
  }

  // Resolve anchor: caller-supplied wins, otherwise pick by material fit.
  const fallbackAnchor =
    opts.topicGroups
      .find((g) => g.topic_group_id === material.topic_group_id)
      ?.answers.find((a) => material.refs.includes(a.id)) ?? null
  const anchor = opts.anchorAnswer ?? fallbackAnchor
  const groupAnswers = opts.topicGroups
    .find((g) => g.topic_group_id === material.topic_group_id)
    ?.answers ?? []
  const answers: typeof groupAnswers =
    anchor != null
      ? [anchor, ...groupAnswers.filter((a) => a.id !== anchor.id)]
      : groupAnswers.slice()

  // Override raw_material_refs so the saved row leads with the anchor.
  if (anchor != null) {
    const otherRefs = material.refs.filter((r) => r !== anchor.id)
    material.refs = [anchor.id, ...otherRefs]
  }

  // The launch campaign keyword (if set) locks the CTA keyword; otherwise the
  // brand's standing dm_keywords apply.
  const dmRule = buildDmKeywordRules(opts.dmKeywords, campaign?.keyword)
  const captureAvoidBlock = buildCaptureAvoidBlock(opts.recentCaptures)
  const hookAvoidBlock = buildHookAvoidBlock(opts.recentHooks)
  const KW = dmRule.placeholder
  const recycledBlock = opts.recycled
    ? `\nANCHOR IS RECYCLED. This topic doesn't have enough fresh answers to fill the campaign quota, so this anchor moment is being used a SECOND time across the brand's content. Your frames MUST take a totally different angle than any prior piece using this same anchor: different opener, different value, different CTA wording. Treat this as a separate post about the same situation, not a paraphrase.\n`
    : ''

  // Rotate the CTA shape. In a batch the caller passes the calendar index;
  // for a one-off (Redo / preview) fall back to a stable hash of the anchor
  // so the same story deterministically gets the same shape.
  const ctaRotation =
    opts.ctaRotation ?? stableHash(anchor?.id ?? material.topic_group_id ?? opts.format.slug)
  const ctaShape = pickCtaShape(intent, ctaRotation)

  const arcCtx: ArcCtx = {
    bucket: (opts.format.bucket as FormatBucket) ?? 'storytelling',
    arc: NARRATIVE_ARCS[opts.format.bucket as FormatBucket] ?? NARRATIVE_ARCS.storytelling,
    KW,
    mechanic,
    campaign,
    ctaShape,
  }

  const frameCount = roleSpecs.length
  const roleList = roleSpecs.map((s) => s.role).join(', ')
  const replyShape = mechanic === 'dm' ? `DM me '${KW}'` : `Reply '${KW}' to this story`
  const dmAltLine =
    mechanic === 'dm'
      ? `(This brand prefers DM, so DM is fine here.)`
      : `(DM is allowed only if a brand explicitly prefers it; default to REPLY.)`

  const system = `You write Instagram story production briefs. The output is a ${frameCount}-frame TEXT-FIRST story sequence. The viewer READS each frame silently for 5-7 seconds. There is NO voiceover. The text_blocks are the message.

Output STRICT JSON:
{
  "frames": [
${buildFramesSchema(roleSpecs)}
  ]
}

EXACTLY ${frameCount} frames, in order: ${roleList}. No voiceover field. No prose paragraphs.

${buildRoleGuidance(roleSpecs, arcCtx)}

STACKED TEXT (text_blocks):
- Each frame's "text_blocks" is an ordered list of short overlay lines the viewer reads top to bottom. Most frames have ONE block.
- A frame marked "up to N stacked text_blocks" may use 2-N short lines that build on each other.
- "emphasis":"big" or "highlight" makes a line stand out - use sparingly, for the single punchiest line. Default "normal".
- Each block is <= 12 words.

${buildCoherenceRule(intent)}

ANTI-INVENTION RULE (zero tolerance):
- Every name, brand, tool, product, number, date, and quote MUST appear in the raw material below.
- If raw material doesn't contain a specific anchor, stay generic. Do NOT make one up.
- BANNED examples (these specific failures have happened in production):
    * "I made $40K in 30 days" - banned unless the dollar figure is verbatim in raw material
    * "12 inbound leads in a week" - banned unless that exact count is in raw material
    * "Notion vs Obsidian", "Slack vs Discord", "ChatGPT vs Claude" - banned unless those exact products are in raw material
    * "the 2-1-3-4 method", "the 5-step framework" - banned unless that exact name is in raw material
- When you need a comparison and raw material doesn't supply one, ask the question generically ("the right tool", "the framework you'll actually use") instead of inventing brand names.

CONTINUOUS-MONOLOGUE RULE:
- The frames are ONE voice in sequence, not independent slogans. Read them in order - they should sound like one person finishing one thought, then the next.
- Each frame after the opener should LINK to the previous one with a connective: "but", "so", "then", "that's when", "instead", "here's what", "what changed:", "so I tried", "the result:".
- WRONG (disconnected): "Creator's block hit hard." / "A/B testing this content format proved it works." / "That's how I knew to trust it."
- RIGHT (linked): "Creator's block hit hard." / "So I started A/B testing the format." / "That's when I knew it actually worked."
- The opener does not need a connective. Every later frame should.

BANNED LANGUAGE PATTERNS (these are AI tells - do NOT use them. An automated scrubber runs after you and will mangle these, so write clean the first time):
- Rhetorical question + fragment answer. THIS IS THE #1 STORY TELL. Banned openers include "The real shift? ...", "The real problem? ...", "The real reason ...? ...", "What changed? ...", "What really matters? ...", "The catch? ...", "The kicker? ...", "It's not what you think." Write the answer as ONE plain statement instead. WRONG: "The real shift? Stopping the habit." RIGHT: "The shift was giving up the habit."
- Negation pivot: "X isn't Y, it's Z" / "you're not X, you're Y" / "it's not about A, it's about B". This is the single biggest AI tell. State the positive claim directly. WRONG: "The real problem isn't burnout, it's creator chaos." RIGHT: "The real problem is creator chaos."
- Sentence opening with "Now, ..." or "And here's the thing,". Just say the thing.
- Em-dash for dramatic reframe ("--it's the one that fits YOUR brain").
- Caps-for-emphasis on a whole word ("your camera is NOT the reason"). Use normal case; use the "emphasis" field for stress, not capitals.
- Formulaic three-item lists with Oxford "and": "We analyze, craft, and handle." Drop the formula or pick ONE specific verb.
- "good news / better news / best news" or numbered-tier escalation - that reads as a template.
- "Game-changer", "level up", "unlock the secret", "the truth about", "this changes everything".
- Generic "system" / "framework" / "playbook" without specifics. The CTA should hint at WHAT it actually delivers (drawn from raw material).

WORD BUDGETS: each frame lists its target above. Count words before output - over-budget output gets truncated mid-sentence.

VISUAL FIELD (one short phrase per frame):
- For a normal frame pick ONE: "talking head", "talking head, b-roll", "text card", "screen recording", "b-roll".
- For a PROOF frame, set "visual" to EXACTLY one asset-slot keyword: "screenshot-proof", "dm-testimonial", or "result-graphic" - the staff paste the REAL asset there.
- DO NOT write paragraph-length production directions. DO NOT describe choreography. DO NOT mix multiple options on one frame.

WRITING STYLE:
- Conversational, contractions, fragments OK. ${opts.brandName ? `Brand: ${opts.brandName}.` : ''}
- No throat-clearing ("Hey friends", "So today...", "Welcome").
- No AI tells, no colon-led labels, no greetings.
- PROOFREAD before output. NO typos. NO missing characters. NO fragmented words ("Soli reliance"). If unsure of spelling, pick a different word.

SOURCE FORMAT (the angle - shapes WHICH moment from raw material to anchor on):
Name: ${opts.format.name}
Description: ${opts.format.description}
Secret sauce: ${opts.format.secret_sauce}
${opts.format.hook_patterns.length ? `Hook patterns (use one for the opener - keep its grammatical shape, fill specifics from raw material):\n${opts.format.hook_patterns.map((h) => `- ${h.pattern} (e.g. ${h.example})`).join('\n')}` : ''}

${renderHookAngleBlock(selectHookAngles({ bucket: opts.format.bucket, seed: anchor?.id ?? material.topic_group_id ?? opts.format.slug }))}

CTA RULES (this is the most-failed rule - read carefully):
${dmRule.hardRule}
- The CTA frame MUST be one of these shapes (REPLY-TO-STORY is the default for stories):
    1. REPLY-DRIVEN (default): "${replyShape} for [thing].", "${replyShape} to [verb]."
    2. SHARE: "Send this to someone who [needs it]."
    3. FOLLOW: "Follow for [specific next thing]."
    ${dmAltLine}
- BANNED: "Save this", "Save it for later", "Bookmark this".
- BANNED trail-off endings: "You're not alone", "Felt like time was running out". Rewrite as one of the valid CTAs above.
${captureAvoidBlock}${hookAvoidBlock}${recycledBlock}`

  const taskLine = `TASK: Generate the structured JSON brief now. Exactly ${frameCount} frames (${roleList}). Strict JSON. No voiceover field. Respect word budgets. Proofread before output.`

  const user = anchor
    ? `ANCHOR MOMENT (your frames MUST be built around THIS one specific moment - this is THE moment the story is about; do not pivot to other moments):
- (${anchor.input_type}) ${anchor.answer}

${answers.length > 1 ? `SUPPORTING CONTEXT (use ONLY for body context if absolutely needed - your opener and CTA do NOT reference these):\n${answers.slice(1).map((a) => `- (${a.input_type}) ${a.answer}`).join('\n')}\n` : ''}${campaign?.offer ? `CAMPAIGN OFFER (what the CTA drives to): ${campaign.offer}${campaign.event_date ? ` (event: ${campaign.event_date})` : ''}\n` : ''}${opts.seedText ? `SEED IDEA from the team: ${opts.seedText}\n` : ''}${taskLine}`
    : `RAW MATERIAL (anchor every specific to this; don't invent details not present here):
${answers.map((a) => `- (${a.input_type}) ${a.answer}`).join('\n')}

${campaign?.offer ? `CAMPAIGN OFFER (what the CTA drives to): ${campaign.offer}${campaign.event_date ? ` (event: ${campaign.event_date})` : ''}\n` : ''}${opts.seedText ? `SEED IDEA from the team: ${opts.seedText}\n` : ''}${taskLine}`

  try {
    const { content } = await generateScript({
      system,
      user,
      temperature: 0.6,
      // Pro reserves ~1k tokens for internal reasoning out of maxOutputTokens,
      // so give the JSON payload real headroom on top of the ~600-token frames.
      maxTokens: 3000,
      jsonObject: true,
      quality: 'high', // Pro - stories draft here now follow the ban/tell rules far better than Flash-Lite
      route: 'planner.story_brief',
      clientId: opts.clientId,
      usageMeta: { format_slug: opts.format.slug, has_seed: !!opts.seedText, intent },
    })
    const parsed = safeParseJson(content)
    if (!parsed) return null

    const expectedRoles = new Set<FrameRole>(roleSpecs.map((s) => s.role))
    const rawFrames = Array.isArray(parsed.frames)
      ? parsed.frames
      : Array.isArray(parsed.beats)
        ? parsed.beats
        : []
    const frames: StoryFrameV2[] = []
    for (const f of rawFrames) {
      if (!f || typeof f !== 'object') continue
      const raw = f as Record<string, unknown>
      const roleStr =
        typeof raw.role === 'string'
          ? raw.role.toUpperCase()
          : typeof raw.label === 'string'
            ? raw.label.toUpperCase()
            : ''
      const role = roleStr as FrameRole
      if (!expectedRoles.has(role)) continue

      let blocks: TextBlock[] = []
      if (Array.isArray(raw.text_blocks)) {
        blocks = raw.text_blocks
          .map((b) => (b && typeof b === 'object' ? (b as Record<string, unknown>) : null))
          .filter((b): b is Record<string, unknown> => !!b && typeof b.text === 'string' && (b.text as string).trim().length > 0)
          .map((b) => ({ text: (b.text as string).trim(), emphasis: normalizeEmphasis(b.emphasis) }))
      } else if (typeof raw.on_screen_text === 'string' && raw.on_screen_text.trim()) {
        // Resilience: model fell back to the old single-string shape.
        blocks = [{ text: raw.on_screen_text.trim(), emphasis: 'normal' }]
      }

      const visual =
        typeof raw.visual === 'string'
          ? raw.visual.trim()
          : typeof raw.capture === 'string'
            ? raw.capture.trim()
            : ''
      const sticker = parseStickerOut(raw.sticker)
      if (blocks.length === 0 && !visual) continue
      frames.push({ role, text_blocks: blocks, visual, ...(sticker ? { sticker } : {}) })
    }

    if (frames.length === 0) return null
    frames.sort((a, b) => roleOrder(roleSpecs, a.role) - roleOrder(roleSpecs, b.role))

    // Pro polish for narrative coherence (teach/prove only - it's built around
    // the HOOK/VALUE/REHOOK/CTA arc). launch/bts degrade gracefully (skipped).
    await polishStoryCoherence({
      frames,
      intent,
      format: opts.format,
      bucket: opts.format.bucket,
      brandName: opts.brandName,
      clientId: opts.clientId,
    })

    // Deterministic AI-tell scrub on every overlay line. Stories never ran
    // through the sanitizer before, so em-dashes, "isn't X, it's Y" pivots,
    // caps-for-emphasis, and rhetorical-question openers all slipped through.
    for (const frame of frames) {
      const cleaned = frame.text_blocks
        .map((b) => ({ ...b, text: sanitizeStoryText(b.text) }))
        .filter((b) => b.text.length > 0)
      // Keep the scrubbed blocks unless the scrub emptied the whole frame.
      if (cleaned.length > 0) frame.text_blocks = cleaned
      for (const b of frame.text_blocks) {
        const ban = findHardBanHit(b.text)
        if (ban) {
          console.warn(
            `[story_brief] hard-ban survived sanitize (${opts.format.slug} ${frame.role}): "${ban}" in "${b.text}"`,
          )
        }
      }
    }

    // Apply word budgets AFTER polish + sanitize (either can change length).
    applyFrameBudgets(frames)

    // Lock the CTA keyword ONLY when this story actually uses a keyword CTA.
    // Engagement/share/follow CTAs (rotated in for teach stories) have no
    // keyword to lock, so enforcing here would wrongly inject one.
    if (ctaShape === 'keyword' && (opts.dmKeywords.length > 0 || campaign?.keyword)) {
      const allowed = campaign?.keyword ? [campaign.keyword] : opts.dmKeywords
      enforceDmKeyword(frames, allowed)
    }

    // QA checklist (Pro grade + deterministic hard-ban override). Never throws.
    const checklist = await evaluateStoryChecklist({
      frames,
      rawMaterial: answers.map((a) => `- (${a.input_type}) ${a.answer}`).join('\n'),
      campaignContext: campaign?.offer
        ? `${campaign.offer}${campaign.event_date ? ` (event: ${campaign.event_date})` : ''}`
        : undefined,
      clientId: opts.clientId,
      formatSlug: opts.format.slug,
    })

    return {
      prompt_text: deriveBriefSummary(frames),
      visual_direction: deriveBriefVisual(frames),
      frames,
      refs: material.refs,
      topic_group_id: material.topic_group_id,
      intent,
      campaign,
      mechanic,
      checklist,
    }
  } catch (err) {
    console.error('story brief generation failed:', err)
    return null
  }
}

function truncateToWordBudget(text: string, budget: number): string {
  if (!text) return ''
  const words = text.split(/\s+/).filter(Boolean)
  // Allow up to 1.5x the budget if the text reads naturally. Stories are
  // read silently - 12 vs 10 words is invisible to the user, but a
  // mid-sentence cut is jarring.
  const hardCap = Math.ceil(budget * 1.5)
  if (words.length <= hardCap) return text
  // Way over - find the latest sentence boundary within hard cap.
  const cut = words.slice(0, hardCap).join(' ')
  const sentenceEnd = cut.match(/^.*[.!?](?=\s|$)/)
  if (sentenceEnd) return sentenceEnd[0].trim()
  // Last resort: hard-cut at hard cap with a period.
  return `${words.slice(0, hardCap).join(' ').replace(/[.,;:!?]+$/, '')}.`
}

/**
 * Pro-tier coherence polish. Reads all 4 frames of a Flash-drafted story
 * + the format + narrative arc, then rewrites HOOK and/or REHOOK in place
 * if they don't make the 4 frames feel like ONE story. VALUE and CTA are
 * NEVER rewritten:
 *   - VALUE is the meat (Flash + narrative arc shape it well)
 *   - CTA is keyword-locked (we own it via enforceDmKeyword)
 *
 * Mutates beats in place. Failures are non-fatal - logged and skipped so
 * a slow Pro response can't kill story generation.
 */
async function polishStoryCoherence(opts: {
  frames: StoryFrameV2[]
  intent: StoryIntent
  format: ContentFormat
  bucket: string
  brandName: string | null
  clientId?: string
}): Promise<void> {
  // Polish targets the HOOK/VALUE/REHOOK/CTA arc; only teach/prove have it.
  // launch/bts degrade gracefully (skipped) so their multi-block frames aren't
  // flattened by the Pro pass.
  if (opts.intent !== 'teach' && opts.intent !== 'prove') return
  const hook = opts.frames.find((f) => f.role === 'HOOK')
  const value = opts.frames.find((f) => f.role === 'VALUE' || f.role === 'PROOF')
  const rehook = opts.frames.find((f) => f.role === 'REHOOK')
  const cta = opts.frames.find((f) => f.role === 'CTA')
  if (!hook || !value || !rehook || !cta) return

  const hookText = firstText(hook)
  const valueText = firstText(value)
  const rehookText = firstText(rehook)
  const ctaText = firstText(cta)
  if (!hookText || !rehookText) return

  const arc = NARRATIVE_ARCS[opts.bucket as FormatBucket] ?? NARRATIVE_ARCS.storytelling

  const system = `You polish Instagram story drafts for narrative coherence. The draft has 4 frames: HOOK -> VALUE -> REHOOK -> CTA. The viewer reads each frame silently for 5-7 seconds.

Your job: rewrite HOOK and REHOOK so the 4 frames read as ONE story about ONE specific situation. Default behavior is REWRITE BOTH. Only mark "not rewritten" when the existing frame is genuinely 9/10 - which is rare for Flash drafts.

DO NOT touch VALUE. DO NOT touch CTA.

NARRATIVE ARC for this story type:
- HOOK   = ${arc.hook}
- VALUE  = ${arc.value}
- REHOOK = ${arc.rehook}
- CTA    = ${arc.cta}

WHAT YOU ARE LOOKING FOR (these are the failure modes you MUST fix):
1. HOOK and VALUE are about different topics. Example failure: HOOK says "creator's block" and VALUE says "first time filming". Same protagonist, but two different situations - those must be ONE situation. Rewrite HOOK so it sets up the EXACT moment VALUE elaborates.
2. REHOOK introduces a new claim that doesn't appear in HOOK or VALUE. Rewrite REHOOK so it reframes what VALUE just said with a sharper angle, or teases what the CTA delivers - in the SAME scene.
3. HOOK is abstract or generic ("Your content IS your salesperson", "Every script has a skeleton", "Stop guessing"). Rewrite to drop the viewer into a SPECIFIC moment - a number, a quote, a scene drawn from VALUE.
4. HOOK reads like a slogan/headline, not a story opener. "Top 3 mistakes" is a list intro. "I lost 3 clients in a week because of mistake #1" is a story opener. Rewrite slogans into openers when the format is storytelling/proof_community.
5. REHOOK is a slogan ("Stop guessing", "It's simpler than you think") instead of a re-engagement beat. Rewrite to actually reframe the value or tease the payoff.
6. AI TELLS in the existing draft. Rewrite to remove them:
   - Rhetorical question + fragment ("That one story? It's 8 posts.", "The real difference? Not features.") - convert to one statement.
   - "Now, X..." opener - drop the "Now,".
   - Em-dash for dramatic reframe.
   - "Game-changer", "level up", "unlock", "the truth about".
7. DISCONNECTED FRAMES. Frames 2-4 should LINK to the previous frame with a connective ("but", "so", "then", "that's when", "instead", "here's what"). If REHOOK doesn't link to VALUE, rewrite it to start with a connective and continue the same voice.

ANTI-INVENTION (zero tolerance, applies to your rewrites too):
- Do NOT introduce names, brands, tools, products, numbers, or quotes that don't appear in the existing VALUE/CTA frames or the brand context.
- Banned examples: "Notion vs Obsidian", "$40K in 30 days", "12 inbound leads", "the 2-1-3-4 method".
- If you need a specific anchor and don't have one, write generically ("the right tool", "the system") rather than inventing.

EVALUATION BAR:
- HOOK: specific moment + names the same situation VALUE elaborates. ~10 words. No throat-clearing.
- REHOOK: stays in HOOK+VALUE's scene, reframes or teases. ~12 words. No new claims.
- The 4 frames in sequence read as ONE narrative the viewer wants to keep reading.

Default to REWRITING. Returning "not rewritten" requires a specific reason the existing frame already meets the bar above. When in doubt, rewrite.

Output STRICT JSON:
{
  "hook_rewritten": true | false,
  "new_hook": "(the rewritten hook - ALWAYS provide this when hook_rewritten is true)",
  "rehook_rewritten": true | false,
  "new_rehook": "(the rewritten rehook - ALWAYS provide this when rehook_rewritten is true)"
}

${opts.brandName ? `BRAND: ${opts.brandName}` : ''}
FORMAT: ${opts.format.name} - ${opts.format.secret_sauce}`

  const user = `DRAFT FRAMES:

HOOK   (current, candidate for rewrite): ${hookText}
VALUE  (DO NOT TOUCH, but use to anchor HOOK rewrite): ${valueText}
REHOOK (current, candidate for rewrite): ${rehookText}
CTA    (DO NOT TOUCH, but use to anchor REHOOK rewrite): ${ctaText}

TASK: Read all 4 frames. Identify the ONE specific situation VALUE describes. Rewrite HOOK so it drops the viewer into that exact situation. Rewrite REHOOK so it bridges VALUE to CTA in the same scene. Default to rewriting both. Strict JSON only.`

  console.log(`[story_brief] polish entering for format=${opts.format.slug}`)
  try {
    const { content } = await generateScript({
      system,
      user,
      temperature: 0.5,
      // Pro reserves up to 1024 tokens for thinking INSIDE maxOutputTokens.
      // At 500 the thinking consumed the whole budget and the response text
      // came back EMPTY (finish=MAX_TOKENS, text_len=0) - every polish call
      // silently no-oped. Budget = thinking cap + room for the small JSON.
      maxTokens: 2000,
      jsonObject: true,
      quality: 'high', // Pro - the whole point is narrative craft
      route: 'planner.story_polish',
      clientId: opts.clientId,
      usageMeta: { format_slug: opts.format.slug },
    })
    const parsed = safeParseJson(content)
    if (!parsed) {
      console.error(`[story_brief] polish JSON parse failed. Raw content:`, content.slice(0, 500))
      return
    }
    console.log(`[story_brief] polish Pro returned:`, JSON.stringify(parsed))

    const newHook = typeof parsed.new_hook === 'string' ? parsed.new_hook.trim() : ''
    const newRehook = typeof parsed.new_rehook === 'string' ? parsed.new_rehook.trim() : ''
    const hookRewritten = !!parsed.hook_rewritten && !!newHook
    const rehookRewritten = !!parsed.rehook_rewritten && !!newRehook

    if (hookRewritten) {
      console.log(`[story_brief] polish rewrote HOOK: "${hookText}" -> "${newHook}"`)
      hook.text_blocks[0] = { ...hook.text_blocks[0], text: newHook }
    }
    if (rehookRewritten) {
      console.log(`[story_brief] polish rewrote REHOOK: "${rehookText}" -> "${newRehook}"`)
      rehook.text_blocks[0] = { ...rehook.text_blocks[0], text: newRehook }
    }
    if (!hookRewritten && !rehookRewritten) {
      console.log(`[story_brief] polish kept frames unchanged for ${opts.format.slug}`)
    }
  } catch (err) {
    console.error('[story_brief] polish failed - leaving Flash draft as-is:', err)
  }
}

const DM_PATTERN = /\b((?:DM|Reply)(?:\s+(?:me|us|with))?\s+)(['"`]?)([A-Z][A-Z0-9_]{2,})\2/g

function enforceDmKeyword(frames: StoryFrameV2[], allowed: string[]): void {
  if (allowed.length === 0) return
  const allowedSet = new Set(allowed.map((k) => k.toUpperCase()))
  const replacement = allowed[0].toUpperCase()
  const rewrites: string[] = []
  const rewrite = (text: string): string =>
    text.replace(DM_PATTERN, (match, lead: string, quote: string, kw: string) => {
      if (allowedSet.has(kw)) return match
      rewrites.push(`${kw} -> ${replacement}`)
      return `${lead}${quote}${replacement}${quote}`
    })
  for (const frame of frames) {
    if (frame.role !== 'CTA') continue
    frame.text_blocks = frame.text_blocks.map((b) => ({ ...b, text: rewrite(b.text) }))
  }
  if (rewrites.length > 0) {
    console.log(`[story_brief] enforceDmKeyword rewrote ${rewrites.length} CTA block(s):`, rewrites.join(', '))
  }
}

/**
 * Single sticker story (story.question_for_audience). The sticker IS the
 * CTA. Two beats: HOOK (the question) + CTA (sticker tap prompt).
 */
async function generateStickerBrief(opts: {
  clientId: string
  brandName: string | null
  format: ContentFormat
  topicGroups: TopicGroup[]
  dmKeywords: string[]
}): Promise<GeneratedBrief | null> {
  const material = pickBestMaterial(opts.format, opts.topicGroups)
  if (material.refs.length === 0) {
    const fallback = opts.topicGroups[0]?.answers[0]
    if (!fallback) return null
    material.refs.push(fallback.id)
    material.topic_group_id = opts.topicGroups[0].topic_group_id
  }
  const refSet = new Set(material.refs)
  const answers = opts.topicGroups
    .find((g) => g.topic_group_id === material.topic_group_id)
    ?.answers.filter((a) => refSet.has(a.id)) ?? []

  const dmHint =
    opts.dmKeywords.length > 0
      ? `\nIf the question naturally invites a DM follow-up, reference the brand's DM keyword (${opts.dmKeywords.map((k) => `"${k}"`).join(', ')}). Otherwise keep the question clean.`
      : ''

  const system = `You write a single-frame sticker story for Instagram/Facebook. Output STRICT JSON:
{
  "question": "the question text - max 14 words, sharp, opinion-splitting",
  "sticker_kind": "question" | "poll" | "slider"
}

Rules:
- The question MUST trigger a feeling, not a calculation. "Should creators reveal income?" splits. "What's the best time to post?" doesn't.
- Quote a specific belief in the audience's wording. Force them to react.
- "poll" = binary A/B. "question" = open reply. "slider" = scale.
- Default to "question" unless the brand context suggests a clear binary.
- PROOFREAD before output. No typos. No missing characters.${dmHint}`

  const user = `RAW MATERIAL (the brand's typed answers - draw the question from one of these specific moments / opinions):
${answers.map((a) => `- (${a.input_type}) ${a.answer}`).join('\n')}

TASK: Output the JSON now.`

  try {
    const { content } = await generateScript({
      system,
      user,
      temperature: 0.6,
      // Pro needs room for its reasoning budget on top of the tiny JSON
      // output. Thinking is capped at 1024 and counts against this number -
      // 1200 left it ~200 tokens of real output on a thoughtful roll.
      maxTokens: 1800,
      jsonObject: true,
      quality: 'high', // Pro - keep the sticker question on the same tier as the rest
      route: 'planner.story_sticker',
      clientId: opts.clientId,
      usageMeta: { format_slug: opts.format.slug },
    })
    const parsed = safeParseJson(content)
    if (!parsed) return null
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : ''
    const stickerKind =
      typeof parsed.sticker_kind === 'string' &&
      ['question', 'poll', 'slider'].includes(parsed.sticker_kind)
        ? parsed.sticker_kind
        : 'question'
    if (!question) return null

    const stickerType = stickerKind as StickerKind
    const frames: StoryFrameV2[] = [
      {
        role: 'HOOK',
        text_blocks: [{ text: question, emphasis: 'normal' }],
        visual: 'text card',
        sticker: { type: stickerType },
      },
      {
        role: 'CTA',
        text_blocks: [
          {
            text:
              stickerKind === 'poll'
                ? 'Vote.'
                : stickerKind === 'slider'
                  ? 'Slide it.'
                  : 'Tap the sticker. Reply.',
            emphasis: 'normal',
          },
        ],
        visual: 'text card',
      },
    ]

    return {
      prompt_text: question,
      visual_direction: `Sticker story (${stickerKind})`,
      frames,
      refs: material.refs,
      topic_group_id: material.topic_group_id,
      intent: 'engage',
      campaign: null,
      mechanic: 'reply',
      // A sticker is one poll question + "Vote." - no narrative frames to grade.
      checklist: [],
    }
  } catch (err) {
    console.error('sticker brief generation failed:', err)
    return null
  }
}

function safeParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
