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
import { listFormats } from '@/lib/contentFormats'
import type { ContentFormat } from '@/lib/contentFormats/types'

import { plannerAdmin } from './db'
import { loadAvailableTopicGroups } from './material'
import { pickBestMaterial } from './scoring'
import type { RawTopicAnswer, TopicGroup } from './types'

const STORIES_PER_GROUP_CAP = 5
const MATERIAL_FIT_THRESHOLD = 5
const CAPTURE_ROTATION_WINDOW = 8

// Word budgets per beat label. The prompt asks the AI to respect these,
// and the post-processor truncates only when WAY over (>1.5x). Slight
// overshoot is allowed if it preserves a sentence boundary - hard-cutting
// at exactly the budget produces broken sentences like "Got this DM: How
// do I get clients without a." (a real failure case from production).
const WORD_BUDGETS: Record<StoryBeatLabel, number> = {
  HOOK: 10,
  VALUE: 15,
  REHOOK: 12,
  CTA: 10,
  POLL: 14,
}

// Per-bucket narrative arc. The four frames must form ONE story, not four
// disconnected lines. This template tells the AI what each label is for in
// the context of the format's bucket, replacing the vague strategy_beats
// dump that produced incoherent stories before.
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
    cta: 'invite a DM for the full framework.',
  },
  opinion: {
    hook: 'the spicy take - one sentence that splits the room. Pick a side.',
    value: 'ONE piece of evidence or reasoning that defends the take. Specific, not generic.',
    rehook: 'frame the opposite side as wrong (or shaky) and dare the viewer to disagree.',
    cta: 'invite a DM, share, or follow to continue the debate.',
  },
  proof_community: {
    hook: 'the win/result - a specific outcome from the raw material. Quote it verbatim if a number exists; do NOT invent numbers.',
    value: 'the ONE lever that produced the result - the specific thing that mattered.',
    rehook: 'what this means for the viewer (the implication, not a generic platitude).',
    cta: 'invite a DM for the breakdown.',
  },
}

function buildNarrativeArc(bucket: string): string {
  const arc = NARRATIVE_ARCS[bucket as FormatBucket] ?? NARRATIVE_ARCS.storytelling
  return `NARRATIVE ARC (the 4 frames must tell ONE story - same protagonist, same situation, same scene throughout):
- HOOK   = ${arc.hook}
- VALUE  = ${arc.value}
- REHOOK = ${arc.rehook}
- CTA    = ${arc.cta}`
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
  const brandName = clientRow?.business_name ?? clientRow?.name ?? null
  let created = 0
  const recentCaptures: string[] = []
  const recentHooks: string[] = []
  const sortedFormats = [...pools.story].sort((a, b) => a.cooldown_posts - b.cooldown_posts)

  for (let i = 0; i < needed; i++) {
    const format = sortedFormats[i % sortedFormats.length]
    const generated = await generateOneStoryBrief({
      clientId,
      brandName,
      format,
      topicGroups,
      dmKeywords,
      recentCaptures: [...recentCaptures],
      recentHooks: [...recentHooks],
    })
    if (!generated) {
      skipped.push(`${format.slug}: generation failed`)
      continue
    }

    const { error } = await supabase.from('story_queue_items').insert({
      client_id: clientId,
      format_id: format.id,
      source_format_id: format.id,
      carrier: 'video', // unified frame model reuses 'video' carrier (no enum migration)
      prompt_text: generated.prompt_text,
      visual_direction: generated.visual_direction,
      frames: generated.beats,
      who_films: generated.who_films,
      raw_material_refs: generated.refs,
    })
    if (error) {
      skipped.push(`${format.slug}: ${error.message}`)
      continue
    }
    created += 1

    for (const b of generated.beats) {
      if (b.capture) recentCaptures.push(b.capture)
      if (b.label === 'HOOK' && b.on_screen_text) recentHooks.push(b.on_screen_text)
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
  const generated = await generateOneStoryBrief({
    clientId: input.clientId,
    brandName,
    format,
    topicGroups,
    seedText: input.seedText ?? null,
    dmKeywords,
    recentCaptures: [],
    recentHooks: [],
  })

  if (!generated) throw new Error('Story prompt generation failed')

  const { data: inserted, error } = await supabase
    .from('story_queue_items')
    .insert({
      client_id: input.clientId,
      format_id: format.id,
      source_format_id: format.id,
      carrier: 'video',
      prompt_text: generated.prompt_text,
      visual_direction: generated.visual_direction,
      frames: generated.beats,
      who_films: generated.who_films,
      raw_material_refs: generated.refs,
      seed_text: input.seedText ?? null,
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
    beats: StoryBeatOut[]
    whoFilms: 'agency' | 'client'
    refs: string[]
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
      batchSlice.map(async (unit) => {
        // Pick the best format for this anchor in the story pool. We
        // prefer formats whose required input_types include the anchor's
        // input_type, falling back to whatever scores highest. Cooldown
        // is approximated by rotating through the pool by formatRotation.
        const fittingFormats = sortedFormats.filter(
          (f) => pickBestMaterial(f, [unit.topic]).fit >= MATERIAL_FIT_THRESHOLD,
        )
        const pool = fittingFormats.length > 0 ? fittingFormats : sortedFormats
        const format = pool[unit.formatRotation % pool.length]

        const generated = await generateOneStoryBrief({
          clientId: input.clientId,
          brandName,
          format,
          topicGroups: [unit.topic],
          dmKeywords,
          anchorAnswer: unit.anchor,
          recycled: unit.recycled,
          recentCaptures: [],
          recentHooks: [],
        })
        if (!generated) return null
        return {
          date: unit.date,
          sourceFormatId: format.id,
          promptText: generated.prompt_text,
          visualDirection: generated.visual_direction,
          beats: generated.beats,
          whoFilms: generated.who_films,
          refs: generated.refs,
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
        carrier: 'video', // unified frame model
        prompt_text: r.promptText,
        visual_direction: r.visualDirection,
        frames: r.beats,
        who_films: r.whoFilms,
        raw_material_refs: r.refs,
        pinned_to_date: r.date,
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
    .select('id, client_id, format_id, source_format_id, carrier, seed_text')
    .eq('id', itemId)
    .maybeSingle()
  if (!row) return null

  const carrierRaw = row.carrier as string | null
  const isSticker = carrierRaw === 'sticker'
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
      })
  if (!generated) return null

  const { error } = await supabase
    .from('story_queue_items')
    .update({
      prompt_text: generated.prompt_text,
      visual_direction: generated.visual_direction,
      frames: generated.beats,
      who_films: generated.who_films,
      raw_material_refs: generated.refs,
      source_format_id: format.id,
      carrier: isSticker ? 'sticker' : 'video',
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

type WhoFilmsOut = 'agency' | 'client'
type StoryBeatLabel = 'HOOK' | 'VALUE' | 'REHOOK' | 'CTA' | 'POLL'

interface StoryBeatOut {
  label: StoryBeatLabel
  capture: string
  on_screen_text: string
  voiceover: string // always '' on new rows; preserved for legacy compat
}

interface GeneratedBrief {
  prompt_text: string
  visual_direction: string | null
  beats: StoryBeatOut[]
  who_films: WhoFilmsOut
  refs: string[]
  topic_group_id: string | null
}

function deriveBriefSummary(beats: StoryBeatOut[]): string {
  const hook = beats.find((b) => b.label === 'HOOK')
  if (!hook) return ''
  return (hook.on_screen_text || hook.capture).trim()
}

function deriveBriefVisual(beats: StoryBeatOut[]): string | null {
  const captures = beats.map((b) => b.capture?.trim()).filter((c): c is string => !!c)
  if (captures.length === 0) return null
  return captures.join(' / ')
}

interface DmKeywordRule {
  placeholder: string
  hardRule: string
}

function buildDmKeywordRules(dmKeywords: string[]): DmKeywordRule {
  if (dmKeywords.length === 0) {
    return {
      placeholder: '[KEYWORD]',
      hardRule: `- The DM keyword is a short uppercase word the brand picks (e.g. "PLAYBOOK", "FRAMEWORK"). Pick something topical to THIS story's value beat, not a generic word.`,
    }
  }
  if (dmKeywords.length === 1) {
    const kw = dmKeywords[0]
    return {
      placeholder: kw,
      hardRule: `- DM KEYWORD IS LOCKED. The ONLY valid DM keyword for this brand is "${kw}". Use it verbatim in uppercase. Do NOT substitute SYSTEM, FRAMEWORK, SCRIPT, SKELETON, FORMULA, PLAN, STRATEGY, VOICE, VALUE, or any other word - even if the format's hook patterns or secret sauce reference them.`,
    }
  }
  const list = dmKeywords.map((k) => `"${k}"`).join(' or ')
  return {
    placeholder: dmKeywords[0],
    hardRule: `- DM KEYWORD IS LOCKED to one of: ${list}. Pick whichever fits this story's value beat. Do NOT invent or substitute any other keyword.`,
  }
}

function buildCaptureAvoidBlock(recentCaptures: string[]): string {
  if (recentCaptures.length === 0) return ''
  const trimmed = recentCaptures.slice(-CAPTURE_ROTATION_WINDOW).map((c) => `- ${c}`)
  return `\nRECENT VISUAL HINTS TO AVOID (the last ${trimmed.length} stories already used these - pick a different visual for at least 2 of your 4 beats):\n${trimmed.join('\n')}\n`
}

function buildHookAvoidBlock(recentHooks: string[]): string {
  if (recentHooks.length === 0) return ''
  const trimmed = recentHooks.slice(-CAPTURE_ROTATION_WINDOW).map((h) => `- "${h}"`)
  return `\nRECENT HOOKS TO AVOID (already used in this batch - your HOOK must anchor on a DIFFERENT moment from raw material):\n${trimmed.join('\n')}\n`
}

/**
 * Generate one 4-frame text-first story brief. The AI takes a short-form,
 * engagement-reel, or carousel format and produces 4 beats: HOOK -> VALUE
 * -> REHOOK -> CTA. Each beat has on_screen_text (what the viewer reads)
 * and a one-phrase visual hint. No voiceover.
 *
 * STORY CTA RULES:
 *   - "Save this" is INVALID (Instagram stories cannot be saved)
 *   - Brand DM keywords (when set) anchor DM CTAs
 */
async function generateOneStoryBrief(opts: {
  clientId: string
  brandName: string | null
  format: ContentFormat
  topicGroups: TopicGroup[]
  seedText?: string | null
  dmKeywords: string[]
  recentCaptures: string[]
  /** HOOK on_screen_text strings from recently-generated stories in the
   *  same batch. Passed to the AI as an "AVOID these openers" list. With
   *  the answer-indexed model this is mostly a fallback - structural
   *  anchor uniqueness already prevents duplicate hooks. */
  recentHooks: string[]
  /** Specific answer this story must anchor on. When set, all 4 frames
   *  build on THIS one moment (not just whichever one pickBestMaterial
   *  picks). This is how the campaign model forces hook uniqueness. */
  anchorAnswer?: RawTopicAnswer | null
  /** True when the anchor is being reused because the topic doesn't have
   *  enough fresh answers to fill the campaign quota. Triggers a
   *  "must use a totally different angle" rule in the prompt. */
  recycled?: boolean
}): Promise<GeneratedBrief | null> {
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
  // Build the answers list: anchor first, then everything else from the
  // same topic for supporting context. The prompt will explicitly tell the
  // AI to ANCHOR all 4 frames on the first answer and treat the rest as
  // supporting context only.
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

  const dmRule = buildDmKeywordRules(opts.dmKeywords)
  const captureAvoidBlock = buildCaptureAvoidBlock(opts.recentCaptures)
  const hookAvoidBlock = buildHookAvoidBlock(opts.recentHooks)
  const KW = dmRule.placeholder
  const recycledBlock = opts.recycled
    ? `\nANCHOR IS RECYCLED. This topic doesn't have enough fresh answers to fill the campaign quota, so this anchor moment is being used a SECOND time across the brand's content. Your 4 frames MUST take a totally different angle than any prior piece using this same anchor: different hook framing, different value beat, different rehook, different CTA wording. Treat this as a separate post about the same situation, not a paraphrase.\n`
    : ''

  const system = `You write Instagram story production briefs. The output is a 4-frame TEXT-FIRST story sequence. The viewer READS each frame silently for 5-7 seconds. There is NO voiceover. The on_screen_text is the message.

Output STRICT JSON:
{
  "who_films": "agency" | "client",
  "beats": [
    { "label": "HOOK",   "capture": "talking head|text card|b-roll|screen recording", "on_screen_text": "..." },
    { "label": "VALUE",  "capture": "...", "on_screen_text": "..." },
    { "label": "REHOOK", "capture": "...", "on_screen_text": "..." },
    { "label": "CTA",    "capture": "...", "on_screen_text": "..." }
  ]
}

EXACTLY 4 beats, in the order HOOK -> VALUE -> REHOOK -> CTA. No voiceover field. No prose paragraphs.

${buildNarrativeArc(opts.format.bucket)}

ONE-SITUATION RULE (most-violated rule - read twice):
- All 4 frames describe ONE specific situation, ONE protagonist, ONE scene. Do NOT pivot topics between frames.
- If HOOK is about "creator's block on Tuesday morning", VALUE/REHOOK/CTA must stay anchored to THAT moment - not jump to "first time filming" or "imposter syndrome" or some other angle.
- Pick the single moment from raw material that best supports the narrative arc above. Build all 4 frames from THAT moment. Stories that pivot read as 4 disconnected slogans.

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
- The 4 frames are ONE PERSON SPEAKING in sequence, not 4 independent slogans. Read frames 1-4 aloud - they should sound like one person finishing one thought, then the next, then the next.
- Frames 2-4 should each open with a connective so they LINK to the previous frame: "but", "so", "then", "that's when", "instead", "here's what", "what changed:", "so I tried", "the result:".
- WRONG (disconnected): "Creator's block hit hard." / "A/B testing this content format proved it works." / "That's how I knew to trust it."
- RIGHT (linked): "Creator's block hit hard." / "So I started A/B testing the format." / "That's when I knew it actually worked."
- The HOOK does not need a connective (it opens the story). All other frames should.

BANNED LANGUAGE PATTERNS (these are AI tells - do NOT use them):
- Rhetorical question + fragment answer: "That one story? It's 8 posts." / "The real difference? Not features." / "The fix? Real stories." Rewrite as ONE statement.
- Sentence opening with "Now, ..." or "And here's the thing,". Just say the thing.
- Em-dash for dramatic reframe ("--it's the one that fits YOUR brain").
- Formulaic three-item lists with Oxford "and": "We analyze, craft, and handle." Drop the formula or pick ONE specific verb.
- "Game-changer", "level up", "unlock the secret", "the truth about", "this changes everything".
- Generic "system" / "framework" / "playbook" without specifics. Stories that just say "DM for the system" are weak. The CTA should hint at WHAT the system actually delivers (drawn from raw material).

WORD BUDGETS (count words before output - over-budget output gets truncated):
- HOOK   ~10 words. Drop the viewer mid-thought. Specific, sharp, no greetings.
- VALUE  ~15 words. The single punchiest piece of the format. ONE idea. Not the whole arc.
- REHOOK ~12 words. Stops the swipe - reframe what they just read or tease the CTA's payoff.
- CTA    ~10 words. Drive a DM, share, or follow. NEVER "save this".

CAPTURE FIELD (one short phrase only - 2-5 words):
Pick ONE per beat from these options (or an obvious variant):
- "talking head"        : the client/founder on camera silently, viewer reads overlay
- "talking head, b-roll": cuts away to b-roll while text overlay plays
- "text card"           : designed text overlay on solid/gradient background
- "screen recording"    : phone/laptop screen showing the thing being discussed
- "b-roll"              : silent b-roll footage
DO NOT write paragraph-length production directions. DO NOT describe choreography. DO NOT mix multiple options on one beat (pick one).

WRITING STYLE:
- Conversational, contractions, fragments OK. ${opts.brandName ? `Brand: ${opts.brandName}.` : ''}
- No throat-clearing ("Hey friends", "So today...", "Welcome").
- No AI tells, no colon-led labels, no greetings.
- PROOFREAD before output. NO typos. NO missing characters. NO fragmented words ("Soli reliance"). If unsure of spelling, pick a different word.

SOURCE FORMAT (the angle - shapes WHICH moment from raw material to anchor on):
Name: ${opts.format.name}
Description: ${opts.format.description}
Secret sauce: ${opts.format.secret_sauce}
${opts.format.hook_patterns.length ? `Hook patterns (use one for the HOOK beat - keep its grammatical shape, fill specifics from raw material):\n${opts.format.hook_patterns.map((h) => `- ${h.pattern} (e.g. ${h.example})`).join('\n')}` : ''}

CTA RULES (this is the most-failed rule - read carefully):
${dmRule.hardRule}
- The CTA beat MUST be one of these shapes:
    1. DM-DRIVEN: "DM me ${KW} for [thing].", "DM me ${KW} to [verb].", "Reply ${KW} for [thing]."
    2. SHARE: "Send this to someone who [needs it]."
    3. FOLLOW: "Follow for [specific next thing]."
- BANNED: "Save this", "Save it for later", "Bookmark this".
- BANNED trail-off endings: "You're not alone", "Felt like time was running out". Rewrite as one of the valid CTAs above.

WHO_FILMS (single value for the whole story - pick the one that MOST beats need):
- "agency" when the agency can produce in-house: text cards, screenshots, b-roll, designed graphics.
- "client" when the client must physically be on camera (talking head needed for >= 2 beats).
${captureAvoidBlock}${hookAvoidBlock}${recycledBlock}`

  const user = anchor
    ? `ANCHOR MOMENT (your 4 frames MUST be built around THIS one specific moment - this is THE moment the story is about; do not pivot to other moments):
- (${anchor.input_type}) ${anchor.answer}

${answers.length > 1 ? `SUPPORTING CONTEXT (use ONLY for body context if absolutely needed - your hook and rehook do NOT reference these):\n${answers.slice(1).map((a) => `- (${a.input_type}) ${a.answer}`).join('\n')}\n` : ''}
${opts.seedText ? `SEED IDEA from the team: ${opts.seedText}\n` : ''}TASK: Generate the structured JSON brief now. Exactly 4 beats (HOOK, VALUE, REHOOK, CTA). Strict JSON. No voiceover field. Respect word budgets. Proofread before output.`
    : `RAW MATERIAL (anchor every specific to this; don't invent details not present here):
${answers.map((a) => `- (${a.input_type}) ${a.answer}`).join('\n')}

${opts.seedText ? `SEED IDEA from the team: ${opts.seedText}\n` : ''}TASK: Generate the structured JSON brief now. Exactly 4 beats (HOOK, VALUE, REHOOK, CTA). Strict JSON. No voiceover field. Respect word budgets. Proofread before output.`

  try {
    const { content } = await generateScript({
      system,
      user,
      temperature: 0.6,
      maxTokens: 1200,
      jsonObject: true,
      quality: 'cheap',
      route: 'planner.story_brief',
      clientId: opts.clientId,
      usageMeta: { format_slug: opts.format.slug, has_seed: !!opts.seedText },
    })
    const parsed = safeParseJson(content)
    if (!parsed) return null

    const whoRaw = typeof parsed.who_films === 'string' ? parsed.who_films.toLowerCase() : ''
    const who_films: WhoFilmsOut = whoRaw === 'client' ? 'client' : 'agency'

    const rawBeats = Array.isArray(parsed.beats) ? parsed.beats : []
    const beats: StoryBeatOut[] = []
    for (const b of rawBeats) {
      if (!b || typeof b !== 'object') continue
      const raw = b as Record<string, unknown>
      const labelStr = typeof raw.label === 'string' ? raw.label.toUpperCase() : ''
      const label: StoryBeatLabel | null =
        labelStr === 'HOOK' || labelStr === 'VALUE' || labelStr === 'REHOOK' || labelStr === 'CTA'
          ? labelStr
          : null
      if (!label) continue
      const capture = typeof raw.capture === 'string' ? raw.capture.trim() : ''
      let on_screen_text = typeof raw.on_screen_text === 'string' ? raw.on_screen_text.trim() : ''
      // Word budget enforcement.
      on_screen_text = truncateToWordBudget(on_screen_text, WORD_BUDGETS[label])
      if (!capture && !on_screen_text) continue
      beats.push({ label, capture, on_screen_text, voiceover: '' })
    }

    if (beats.length === 0) return null
    beats.sort((a, b) => beatOrder(a.label) - beatOrder(b.label))

    // Pro polish for narrative coherence. Reads all 4 frames in context
    // and rewrites HOOK + REHOOK to make the story flow as ONE narrative.
    // VALUE stays as-is (it's the meat); CTA stays as-is (we own keyword
    // enforcement below). Polish is a no-op when frames already cohere.
    await polishStoryCoherence({
      beats,
      format: opts.format,
      bucket: opts.format.bucket,
      brandName: opts.brandName,
      clientId: opts.clientId,
    })

    // Apply word budget AFTER polish (Pro might rewrite slightly over budget).
    for (const beat of beats) {
      const budget = WORD_BUDGETS[beat.label]
      if (beat.on_screen_text && budget) {
        beat.on_screen_text = truncateToWordBudget(beat.on_screen_text, budget)
      }
    }

    if (opts.dmKeywords.length > 0) {
      enforceDmKeyword(beats, opts.dmKeywords)
    }

    return {
      prompt_text: deriveBriefSummary(beats),
      visual_direction: deriveBriefVisual(beats),
      beats,
      who_films,
      refs: material.refs,
      topic_group_id: material.topic_group_id,
    }
  } catch (err) {
    console.error('story brief generation failed:', err)
    return null
  }
}

function beatOrder(label: StoryBeatLabel): number {
  const order: Record<StoryBeatLabel, number> = {
    HOOK: 0,
    VALUE: 1,
    REHOOK: 2,
    CTA: 3,
    POLL: 4,
  }
  return order[label]
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
  beats: StoryBeatOut[]
  format: ContentFormat
  bucket: string
  brandName: string | null
  clientId?: string
}): Promise<void> {
  const hook = opts.beats.find((b) => b.label === 'HOOK')
  const value = opts.beats.find((b) => b.label === 'VALUE')
  const rehook = opts.beats.find((b) => b.label === 'REHOOK')
  const cta = opts.beats.find((b) => b.label === 'CTA')
  // Polish only when all 4 are present - degrades gracefully on partial drafts.
  if (!hook || !value || !rehook || !cta) return

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

HOOK   (current, candidate for rewrite): ${hook.on_screen_text}
VALUE  (DO NOT TOUCH, but use to anchor HOOK rewrite): ${value.on_screen_text}
REHOOK (current, candidate for rewrite): ${rehook.on_screen_text}
CTA    (DO NOT TOUCH, but use to anchor REHOOK rewrite): ${cta.on_screen_text}

TASK: Read all 4 frames. Identify the ONE specific situation VALUE describes. Rewrite HOOK so it drops the viewer into that exact situation. Rewrite REHOOK so it bridges VALUE to CTA in the same scene. Default to rewriting both. Strict JSON only.`

  console.log(`[story_brief] polish entering for format=${opts.format.slug}`)
  try {
    const { content } = await generateScript({
      system,
      user,
      temperature: 0.5,
      maxTokens: 500,
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
      console.log(`[story_brief] polish rewrote HOOK: "${hook.on_screen_text}" -> "${newHook}"`)
      hook.on_screen_text = newHook
    }
    if (rehookRewritten) {
      console.log(`[story_brief] polish rewrote REHOOK: "${rehook.on_screen_text}" -> "${newRehook}"`)
      rehook.on_screen_text = newRehook
    }
    if (!hookRewritten && !rehookRewritten) {
      console.log(`[story_brief] polish kept frames unchanged for ${opts.format.slug}`)
    }
  } catch (err) {
    console.error('[story_brief] polish failed - leaving Flash draft as-is:', err)
  }
}

const DM_PATTERN = /\b((?:DM|Reply)(?:\s+(?:me|us|with))?\s+)(['"`]?)([A-Z][A-Z0-9_]{2,})\2/g

function enforceDmKeyword(beats: StoryBeatOut[], allowed: string[]): void {
  const allowedSet = new Set(allowed.map((k) => k.toUpperCase()))
  const replacement = allowed[0].toUpperCase()
  const rewrites: string[] = []
  const rewrite = (text: string): string =>
    text.replace(DM_PATTERN, (match, lead: string, quote: string, kw: string) => {
      if (allowedSet.has(kw)) return match
      rewrites.push(`${kw} -> ${replacement}`)
      return `${lead}${quote}${replacement}${quote}`
    })
  for (const beat of beats) {
    if (beat.label !== 'CTA') continue
    if (beat.on_screen_text) beat.on_screen_text = rewrite(beat.on_screen_text)
  }
  if (rewrites.length > 0) {
    console.log(`[story_brief] enforceDmKeyword rewrote ${rewrites.length} CTA(s):`, rewrites.join(', '))
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
      maxTokens: 200,
      jsonObject: true,
      quality: 'cheap',
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

    const beats: StoryBeatOut[] = [
      {
        label: 'HOOK',
        capture: 'text card',
        on_screen_text: question,
        voiceover: '',
      },
      {
        label: 'CTA',
        capture: 'text card',
        on_screen_text:
          stickerKind === 'poll' ? 'Vote.' : stickerKind === 'slider' ? 'Slide it.' : 'Tap the sticker. Reply.',
        voiceover: '',
      },
    ]

    return {
      prompt_text: question,
      visual_direction: `Sticker story (${stickerKind})`,
      beats,
      who_films: 'agency',
      refs: material.refs,
      topic_group_id: material.topic_group_id,
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
