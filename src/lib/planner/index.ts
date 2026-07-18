// Planner orchestrator. The single entry point the API routes call.
//
// generatePlan() does the heavy lifting:
//   1. Resolves the brand's content_stage + per-brand setting overrides
//   2. Computes the horizon's slot count (long-form / short-form / engagement
//      reels / carousels / stories) from clients.package_tier
//   3. Walks dates Mon-Fri across the horizon, generating slot picks per
//      stream until quotas are met
//   4. For each slot: filters formats by stream + cooldown + gating,
//      scores survivors, picks the winner, generates a hook preview
//   5. Persists into content_plan_slots
//
// Locked slots from a previous run survive: they aren't regenerated, but
// they DO count toward coverage targets and cooldown history so the rest
// of the plan responds to them.
//
// Stories use a separate refill flow (refillStoryQueue) - they don't get
// dated slots unless explicitly pinned via the API.

import type { ContentFormat } from '@/lib/contentFormats/types'
import { listFormats } from '@/lib/contentFormats'

// Date helpers - kept inline so the planner doesn't pull in a dep just to
// add days and detect weekends. All dates are 'yyyy-MM-dd' UTC strings;
// the planner doesn't care about hours.
function ymd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10))
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}
function addDaysYmd(s: string, days: number): string {
  const d = parseYmd(s)
  d.setUTCDate(d.getUTCDate() + days)
  return ymd(d)
}
function isWeekendYmd(s: string): boolean {
  const dow = parseYmd(s).getUTCDay()
  return dow === 0 || dow === 6
}
import { resolveTierConfig, type CustomConfig, type TierKey } from '@/lib/campaignTiers'

import { plannerAdmin } from './db'
import { loadAvailableTopicGroups } from './material'
import { buildUsageHistory, isOnCooldown, type FormatUsageEntry } from './cooldowns'
import { effectiveTargets, tallyCoverage } from './coverage'
import { generateHookPreview, hookPreviewFallback } from './hookPreview'
import { scoreFormat } from './scoring'
import { generateStoriesForPlan } from './storyQueue'
import {
  FORMAT_TYPE_TO_STREAM,
  bucketKey,
  type ContentStage,
  type CoverageSnapshot,
  type PlannerSlotRow,
  type RawTopicAnswer,
  type SlotStream,
  type TopicGroup,
} from './types'

export type { ContentStage, SlotStream, PlannerSlotRow } from './types'

interface ClientRow {
  id: string
  name: string | null
  business_name: string | null
  package_tier: TierKey | null
  custom_config: CustomConfig | null
}

interface SettingsRow {
  bucket_target_storytelling: number | null
  bucket_target_educational: number | null
  bucket_target_opinion: number | null
  bucket_target_proof_community: number | null
  format_overrides: Record<string, { cooldown_posts?: number }>
  plan_horizon_months: number
}

interface SlotRow {
  id: string
  client_id: string
  stream: SlotStream
  format_id: string | null
  scheduled_date: string
  status: 'planned' | 'drafted' | 'approved'
  topic_group_id: string | null
  raw_material_refs: unknown
  hook_preview: string | null
  generation_meta: unknown
  generated_script_id: string | null
  approved_at: string | null
  approved_by: string | null
  locked: boolean
  created_at: string
  updated_at: string
}

export interface GeneratePlanInput {
  clientId: string
  /** Legacy: how many months forward from anchorDate. Ignored when endDate is set. */
  monthsAhead?: number
  forceRegenerateLocked?: boolean
  /** Start of the horizon (YYYY-MM-DD). Defaults to today. */
  anchorDate?: string
  /** Inclusive end date (YYYY-MM-DD). When set, the planner covers exactly
   *  [anchorDate, endDate] and ignores monthsAhead. Lets the UI drive an
   *  arbitrary date range from a from/to date picker. */
  endDate?: string
  /** When set, the planner only uses topic groups whose id is in this list.
   *  Lets the UI scope generation to a specific subset of question batches
   *  via the picker modal. When omitted, all unused topic groups are used. */
  topicGroupIds?: string[]
}

export interface GeneratePlanResult {
  slotsCreated: number
  slotsSkipped: number
  warnings: string[]
}


function defaultAnchorDate(): string {
  // Anchor to TODAY, not start-of-month. Generating a fresh plan on May 5
  // shouldn't put slots on May 1-4 where they're already in the past.
  return ymd(new Date())
}

function todayYmd(): string {
  return ymd(new Date())
}

// Generate Mon-Fri dates between [start, end). end is exclusive. Past dates
// (earlier than today) are skipped so a fresh plan generated mid-month doesn't
// land slots on dates that have already passed.
function monFriBetween(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const today = todayYmd()
  const effectiveStart = startISO < today ? today : startISO
  let cursor = effectiveStart
  while (cursor < endISO) {
    if (!isWeekendYmd(cursor)) out.push(cursor)
    cursor = addDaysYmd(cursor, 1)
  }
  return out
}

function rowToSlot(row: SlotRow, formatById: Map<string, ContentFormat>): PlannerSlotRow {
  const format = row.format_id ? formatById.get(row.format_id) : null
  return {
    ...row,
    format_slug: format?.slug ?? null,
    raw_material_refs: Array.isArray(row.raw_material_refs)
      ? (row.raw_material_refs as string[]).filter((x): x is string => typeof x === 'string')
      : [],
    generation_meta: (row.generation_meta && typeof row.generation_meta === 'object'
      ? row.generation_meta
      : {}) as Record<string, unknown>,
  }
}

async function loadStage(clientId: string): Promise<ContentStage> {
  const supabase = plannerAdmin()
  const { data } = await supabase
    .from('content_stage_state')
    .select('current_stage')
    .eq('client_id', clientId)
    .maybeSingle()
  const raw = (data?.current_stage as ContentStage | undefined) ?? 'foundation'
  return raw
}

async function loadSettings(clientId: string): Promise<SettingsRow> {
  const supabase = plannerAdmin()
  const { data } = await supabase
    .from('brand_content_settings')
    .select('bucket_target_storytelling, bucket_target_educational, bucket_target_opinion, bucket_target_proof_community, format_overrides, plan_horizon_months')
    .eq('client_id', clientId)
    .maybeSingle()
  return {
    bucket_target_storytelling: data?.bucket_target_storytelling ?? null,
    bucket_target_educational: data?.bucket_target_educational ?? null,
    bucket_target_opinion: data?.bucket_target_opinion ?? null,
    bucket_target_proof_community: data?.bucket_target_proof_community ?? null,
    format_overrides: (data?.format_overrides as Record<string, { cooldown_posts?: number }>) ?? {},
    plan_horizon_months: data?.plan_horizon_months ?? 1,
  }
}

function resolvedCooldown(format: ContentFormat, settings: SettingsRow): number {
  const override = settings.format_overrides?.[format.slug]?.cooldown_posts
  if (typeof override === 'number' && Number.isFinite(override)) return override
  return format.cooldown_posts
}

function buildCoverageOverrides(s: SettingsRow): Partial<CoverageSnapshot> | null {
  const has =
    s.bucket_target_storytelling !== null ||
    s.bucket_target_educational !== null ||
    s.bucket_target_opinion !== null ||
    s.bucket_target_proof_community !== null
  if (!has) return null
  return {
    storytelling: s.bucket_target_storytelling ?? undefined,
    educational: s.bucket_target_educational ?? undefined,
    opinion: s.bucket_target_opinion ?? undefined,
    proof_community: s.bucket_target_proof_community ?? undefined,
  } as Partial<CoverageSnapshot>
}

export async function generatePlan(input: GeneratePlanInput): Promise<GeneratePlanResult> {
  const supabase = plannerAdmin()
  // monthsAhead is the legacy fallback when no endDate is provided. Cap kept
  // at 3 to match brand_content_settings.plan_horizon_months CHECK constraint;
  // explicit endDate bypasses the cap so callers can plan arbitrary ranges.
  const monthsAhead = Math.max(1, Math.min(3, input.monthsAhead ?? 1))
  const warnings: string[] = []

  const { data: clientRow, error: clientErr } = await supabase
    .from('clients')
    .select('id, name, business_name, package_tier, custom_config')
    .eq('id', input.clientId)
    .maybeSingle()
  if (clientErr || !clientRow) throw new Error('Client not found')
  const client = clientRow as ClientRow

  const settings = await loadSettings(input.clientId)
  const stage = await loadStage(input.clientId)
  const overrides = buildCoverageOverrides(settings)
  const targets = effectiveTargets(stage, overrides)

  const allFormats = await listFormats({ is_active: true })
  const formatById = new Map<string, ContentFormat>()
  for (const f of allFormats) formatById.set(f.id, f)

  // Existing slots in the horizon (locked + everything else, so we can
  // preserve locked + decide what to delete). horizonEnd is exclusive: when
  // endDate is provided we treat it as INCLUSIVE and add one day; when not,
  // we fall back to the monthsAhead-based estimate.
  const anchor = input.anchorDate ?? defaultAnchorDate()
  const horizonStart = anchor
  const horizonEnd = input.endDate
    ? addDaysYmd(input.endDate, 1)
    : addDaysYmd(anchor, monthsAhead * 31)

  const { data: existing } = await supabase
    .from('content_plan_slots')
    .select('id, client_id, stream, format_id, scheduled_date, status, topic_group_id, raw_material_refs, hook_preview, generation_meta, generated_script_id, approved_at, approved_by, locked, created_at, updated_at')
    .eq('client_id', input.clientId)
    .gte('scheduled_date', horizonStart)
    .lt('scheduled_date', horizonEnd)
  const existingRows = ((existing ?? []) as SlotRow[]).map((r) => rowToSlot(r, formatById))

  // Non-locked planned rows get REPLACED by this run. The actual delete is
  // deferred to Phase C (right before the insert) so a run that dies mid-way
  // - AI outage, function timeout - leaves the existing plan intact instead
  // of wiping it and creating nothing. Nothing between here and Phase C
  // reads planned slots from the DB; all picks work off in-memory state.
  const wipeIds = existingRows
    .filter((r) => !r.locked && r.status === 'planned')
    .map((r) => r.id)

  // Survivors = locked + approved + drafted slots that anchor cooldowns / coverage.
  const survivors = existingRows.filter(
    (r) => r.locked || r.status === 'approved' || r.status === 'drafted',
  )

  // A topic group is CONSUMED once any drafted/approved/locked slot ANYWHERE
  // on the calendar was built from it - not just slots inside this run's
  // horizon. Horizon-only consumption let a fresh-month plan re-pick LAST
  // month's topics: their slots sat outside the new horizon, and the
  // freshness sort put them first, so an unscoped August re-plan re-told
  // July's campaigns and the user read it as hallucination. The single-slot
  // regenerate path (regeneratePlanSlot below) already uses all-time
  // consumption; this aligns plan generation with it. Explicitly scoping a
  // batch in the picker still overrides via includeOnlyTopicGroupIds.
  const { data: consumedRows } = await supabase
    .from('content_plan_slots')
    .select('topic_group_id, status, locked')
    .eq('client_id', input.clientId)
    .not('topic_group_id', 'is', null)
  const consumedGroupIds = Array.from(
    new Set(
      ((consumedRows ?? []) as Array<{ topic_group_id: string | null; status: string; locked: boolean }>)
        .filter((r) => r.locked || r.status === 'approved' || r.status === 'drafted')
        .map((r) => r.topic_group_id)
        .filter((x): x is string => !!x),
    ),
  )

  const allTopicGroups = await loadAvailableTopicGroups(
    supabase,
    input.clientId,
    consumedGroupIds,
    input.topicGroupIds && input.topicGroupIds.length > 0 ? input.topicGroupIds : null,
  )

  // ---- Answer-indexed campaign model ----
  //
  // The plan is built as a series of CAMPAIGNS, where each campaign = one
  // topic group. Per the user's spec:
  //   - Each topic produces 1 long-form using all answers in the topic.
  //   - For each non-longform stream (SF / ER / C), the topic produces
  //     `perCampaign[stream]` pieces, each anchored to a different answer
  //     slot (slot N -> answer N within the topic).
  //   - Carousel #N, ER #N, SF #N share answer #N as their anchor (sibling
  //     pieces in the campaign), but each is a different format so the
  //     presentation is different.
  //   - When `perCampaign[stream] > topic.answers.length`, the extra slots
  //     recycle answers (modulo) and get a `recycled: true` flag passed
  //     into hook generation so the AI writes a different angle.
  //
  // This guarantees structural hook uniqueness within a stream within a
  // topic - no two SF pieces in topic T can share the same anchor.
  const tierCfg = resolveTierConfig(client)
  const numCampaigns = Math.min(
    allTopicGroups.length,
    tierCfg.campaignsPerMonth * monthsAhead,
  )
  const topicGroups = allTopicGroups.slice(0, numCampaigns)

  if (topicGroups.length === 0) {
    warnings.push('No topic groups available for this client')
    return { slotsCreated: 0, slotsSkipped: 0, warnings }
  }

  const dates = monFriBetween(horizonStart, horizonEnd)
  if (dates.length === 0) {
    warnings.push('No business days in horizon')
    return { slotsCreated: 0, slotsSkipped: 0, warnings }
  }

  // Allocate a chunk of dates to each campaign so a topic's pieces cluster
  // together on the calendar (week 1 = topic 1 for top tier, etc.).
  const datesPerCampaign: string[][] = []
  for (let i = 0; i < topicGroups.length; i++) {
    const start = Math.floor((i * dates.length) / topicGroups.length)
    const end = Math.floor(((i + 1) * dates.length) / topicGroups.length)
    datesPerCampaign.push(dates.slice(start, end))
  }

  // Surviving drafted/approved/locked slots already occupy part of their
  // campaign's quota. Count them per (topic group, stream) and SUBTRACT
  // when building the queue below - otherwise re-planning a campaign whose
  // scripts were already generated stacks a second full-size set on top of
  // the survivors (a live campaign ended up with 31 slots instead of 16:
  // 15 drafted survivors from run 1 + a fresh full 16 from run 2).
  const survivorByGroupStream = new Map<string, number>()
  for (const s of survivors) {
    if (!s.topic_group_id) continue
    const key = `${s.topic_group_id}:${s.stream}`
    survivorByGroupStream.set(key, (survivorByGroupStream.get(key) ?? 0) + 1)
  }

  interface CampaignQueueItem {
    stream: SlotStream
    date: string
    campaignIdx: number
    /** The topic group this piece belongs to. */
    topic: TopicGroup
    /** 0-based slot index within the stream within the campaign. */
    slotIndex: number
    /** The single answer this piece anchors on. Null only for long-form
     *  (which uses all answers in the topic). */
    anchor: RawTopicAnswer | null
    /** True when slotIndex >= topic.answers.length (no fresh anchor
     *  available, so this slot recycles). */
    recycled: boolean
  }
  const queue: CampaignQueueItem[] = []

  for (let campaignIdx = 0; campaignIdx < topicGroups.length; campaignIdx++) {
    const topic = topicGroups[campaignIdx]
    const campaignDates = datesPerCampaign[campaignIdx]
    if (campaignDates.length === 0) continue

    // Every piece this campaign emits gets a slot in campaignDates.
    // Distribute pieces across the campaign's date chunk evenly.
    interface CampaignPiece {
      stream: SlotStream
      slotIndex: number
      anchor: RawTopicAnswer | null
      recycled: boolean
    }
    const pieces: CampaignPiece[] = []

    // Quota per stream = tier target minus what this campaign's surviving
    // drafted/approved/locked slots already cover. Re-planning tops the
    // campaign UP to its quota instead of duplicating it.
    const survived = (stream: SlotStream) =>
      survivorByGroupStream.get(`${topic.topic_group_id}:${stream}`) ?? 0

    // Long-form: uses all answers, no specific anchor.
    const lfCount = Math.max(0, tierCfg.perCampaign.longForm * monthsAhead - survived('long_form'))
    for (let i = 0; i < lfCount; i++) {
      pieces.push({ stream: 'long_form', slotIndex: i, anchor: null, recycled: false })
    }

    const streamCounts: Array<[SlotStream, number]> = [
      ['short_form', Math.max(0, tierCfg.perCampaign.shortForm * monthsAhead - survived('short_form'))],
      ['engagement_reel', Math.max(0, tierCfg.perCampaign.engagementReels * monthsAhead - survived('engagement_reel'))],
      ['carousel', Math.max(0, tierCfg.perCampaign.carousels * monthsAhead - survived('carousel'))],
    ]
    for (const [stream, count] of streamCounts) {
      // slotIndex starts AFTER the survivors so topped-up pieces anchor on
      // answers the surviving pieces haven't used yet.
      const offset = survived(stream)
      // Progression reels anchor on EVENTS. An opinion answer has no
      // events - reels anchored on one fake the arc with slogans no matter
      // how the prompt is worded (verified across repeated rolls). Rotate
      // reel anchors over story-typed answers only; opinions stay available
      // as supporting material and as anchors for opinion-native formats
      // (short-form hot takes).
      const anchorPool =
        stream === 'engagement_reel'
          ? topic.answers.filter((a) => a.input_type !== 'opinion')
          : topic.answers
      const pool = anchorPool.length > 0 ? anchorPool : topic.answers
      for (let i = 0; i < count; i++) {
        const slotIndex = offset + i
        if (pool.length === 0) continue
        const anchor = pool[slotIndex % pool.length]
        const recycled = slotIndex >= pool.length
        pieces.push({ stream, slotIndex, anchor, recycled })
      }
    }

    // Spread pieces across the campaign's date chunk evenly.
    if (pieces.length === 0) continue
    const step = campaignDates.length / pieces.length
    pieces.forEach((p, i) => {
      const dateIdx = Math.min(
        campaignDates.length - 1,
        Math.floor(i * step),
      )
      queue.push({
        stream: p.stream,
        date: campaignDates[dateIdx],
        campaignIdx,
        topic,
        slotIndex: p.slotIndex,
        anchor: p.anchor,
        recycled: p.recycled,
      })
    })
  }

  // Sort by date so coverage/cooldown advance in calendar order.
  queue.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    if (a.campaignIdx !== b.campaignIdx) return a.campaignIdx - b.campaignIdx
    return a.slotIndex - b.slotIndex
  })


  // Build the running history. Survivors anchor it.
  const runningHistory: FormatUsageEntry[] = buildUsageHistory(survivors)
  const runningBucketSequence: Array<keyof CoverageSnapshot> = []
  for (const s of survivors) {
    if (!s.format_id) continue
    const f = formatById.get(s.format_id)
    if (f) runningBucketSequence.push(bucketKey(f.bucket))
  }

  // Track buckets used by all slots in the (survivors + new picks) horizon
  // for the coverage ratio.
  const horizonBuckets: Array<keyof CoverageSnapshot> = [...runningBucketSequence]

  let slotsCreated = 0
  let slotsSkipped = 0

  const brandName = client.business_name ?? client.name ?? null

  // Phase A - pick formats sequentially. NO AI calls here. Each pick mutates
  // runningHistory + horizonBuckets so the next pick's coverage_need /
  // variance_bonus / recency_penalty stays accurate.
  //
  // Format selection is scoped to the queue item's TOPIC (the campaign
  // it belongs to). The anchor answer is also threaded through so hook
  // generation later can force it. We do NOT mutate topicGroups - each
  // queue item already declared which topic it belongs to.
  const decisions: Array<{ item: CampaignQueueItem; pick: PickResult } | null> = []
  for (const item of queue) {
    const pick = pickSlotFormat({
      clientId: input.clientId,
      brandName,
      stream: item.stream,
      date: item.date,
      stage,
      targets,
      currentBuckets: horizonBuckets,
      previousBucket: horizonBuckets[horizonBuckets.length - 1] ?? null,
      runningHistory,
      formats: allFormats,
      formatById,
      topicGroups: [item.topic],
      settings,
    })

    if (!pick) {
      decisions.push(null)
      slotsSkipped += 1
      warnings.push(`No usable format for ${item.stream} on ${item.date}`)
      continue
    }

    // Thread the anchor + recycled flag onto the pick so Phase B / Phase C
    // can use them. For long-form the anchor is null (uses all answers).
    pick.anchor = item.anchor
    pick.recycled = item.recycled
    pick.slotIndex = item.slotIndex

    // Override pick.answers so the hook prompt sees the anchor first then
    // the supporting answers from the same topic. Long-form keeps the
    // full set as-is.
    if (item.stream !== 'long_form' && item.anchor) {
      const anchorId = item.anchor.id
      const supporting = item.topic.answers.filter((a) => a.id !== anchorId)
      pick.answers = [item.anchor, ...supporting]
      // Refs lead with anchor so downstream consumers know which is primary.
      const formatRefs = pick.raw_material_refs.filter((r) => r !== anchorId)
      pick.raw_material_refs = [anchorId, ...formatRefs]
    }

    decisions.push({ item, pick })
    runningHistory.push({
      index: runningHistory.length,
      format_slug: pick.format.slug,
      format_id: pick.format.id,
      topic_group_id: pick.topic_group_id,
      scheduled_date: item.date,
    })
    horizonBuckets.push(bucketKey(pick.format.bucket))
  }

  // Phase B - generate hook previews in parallel batches. Each preview is
  // independent of every other slot, so this is the parallelizable step. At
  // batch size 8, ~64 slots = ~8 round trips instead of 64 sequential ones.
  const previewWork = decisions
    .filter((d): d is { item: CampaignQueueItem; pick: PickResult } => d !== null)
    .map((d) => ({ pick: d.pick, clientId: input.clientId, brandName }))
  await generateHookBatch(previewWork)

  // Phase C - persist all picks. Long-form uses format_id=null since the
  // pseudo-format isn't a real content_formats row (FK would reject the UUID).
  // display_order is per-date sequential so cards stack in the order the
  // queue placed them; users can reorder within a date later via drag-drop.
  const perDateCounter = new Map<string, number>()
  const insertRows = decisions
    .filter((d): d is { item: CampaignQueueItem; pick: PickResult } => d !== null)
    .map((d) => {
      const idx = perDateCounter.get(d.item.date) ?? 0
      perDateCounter.set(d.item.date, idx + 1)
      return {
        client_id: input.clientId,
        stream: d.item.stream,
        format_id: d.item.stream === 'long_form' ? null : d.pick.format.id,
        scheduled_date: d.item.date,
        status: 'planned' as const,
        topic_group_id: d.pick.topic_group_id,
        raw_material_refs: d.pick.raw_material_refs,
        hook_preview: d.pick.hook_preview,
        generation_meta: d.pick.generation_meta,
        display_order: idx,
      }
    })

  // Deferred wipe (see comment where wipeIds is computed): only now that the
  // new plan is fully built do we remove the planned rows it replaces.
  if (wipeIds.length) {
    const { error: deleteErr } = await supabase
      .from('content_plan_slots')
      .delete()
      .in('id', wipeIds)
    if (deleteErr) console.error('plan slot wipe error:', deleteErr)
  }

  if (insertRows.length) {
    const { error: insertErr, count } = await supabase
      .from('content_plan_slots')
      .insert(insertRows, { count: 'exact' })

    if (insertErr) {
      console.error('plan slot batch insert error:', insertErr)
      // Fall back to per-row inserts so one bad row doesn't kill the whole run.
      for (const row of insertRows) {
        const { error: rowErr } = await supabase.from('content_plan_slots').insert(row)
        if (rowErr) {
          console.error('plan slot row insert error:', rowErr, row)
          slotsSkipped += 1
        } else {
          slotsCreated += 1
        }
      }
    } else {
      slotsCreated += count ?? insertRows.length
    }
  }

  // Phase D - auto-pinned stories using the same answer-indexed campaign
  // walk as Phase A. Each campaign topic produces `perCampaign.stories`
  // stories, anchored to topic.answers[N] for slot N (with recycle when
  // slot count exceeds answer count).
  const storiesPerCampaign = tierCfg.perCampaign.stories * monthsAhead
  if (storiesPerCampaign > 0 && topicGroups.length > 0) {
    try {
      const result = await generateStoriesForPlan({
        clientId: input.clientId,
        start: horizonStart,
        end: horizonEnd,
        storiesPerCampaign,
        topicGroups,
      })
      if (result.skipped.length) warnings.push(...result.skipped.map((s) => `story: ${s}`))
    } catch (err) {
      console.error('phase D story generation error:', err)
      warnings.push(`story generation failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { slotsCreated, slotsSkipped, warnings }
}

interface PickSlotInput {
  clientId: string
  brandName: string | null
  stream: SlotStream
  date: string
  stage: ContentStage
  targets: CoverageSnapshot
  currentBuckets: Array<keyof CoverageSnapshot>
  previousBucket: keyof CoverageSnapshot | null
  runningHistory: FormatUsageEntry[]
  formats: ContentFormat[]
  formatById: Map<string, ContentFormat>
  topicGroups: TopicGroup[]
  settings: SettingsRow
}

interface PickResult {
  format: ContentFormat
  topic_group_id: string | null
  raw_material_refs: string[]
  /** Subset of the topic_group's answers that the format will actually use.
   *  Held on the result so hook-preview generation can run later in a
   *  parallel batch without re-querying. */
  answers: RawTopicAnswer[]
  hook_preview: string | null
  generation_meta: Record<string, unknown>
  /** Answer-indexed campaign model: the single anchor answer this piece
   *  is built around. Null only for long-form (uses all answers). */
  anchor?: RawTopicAnswer | null
  /** True when the anchor is being reused because the topic doesn't have
   *  enough fresh answers to fill the tier's quota. */
  recycled?: boolean
  /** 0-based slot index within the stream within the campaign. */
  slotIndex?: number
}

/**
 * Format pick only - NO AI. Pure scoring math. Runs sequentially per slot
 * because each pick mutates running history (cooldowns + variance) that the
 * next pick reads. Hook previews are generated separately in parallel batches
 * by generateHookBatch.
 */
function pickSlotFormat(input: PickSlotInput): PickResult | null {
  const { stream, formats, runningHistory, settings, topicGroups } = input

  // Long-form has no format library. Pick a topic_group with the most
  // complete answer set and emit a synthetic "long-form" format pick.
  if (stream === 'long_form') {
    const best = topicGroups
      .map((g) => ({
        g,
        score: g.answers.filter((a) => !a.thin_flag).length * 2 + g.answers.length,
      }))
      .sort((a, b) => b.score - a.score)[0]
    if (!best || best.g.answers.length === 0) return null

    const longFormPseudo: ContentFormat = {
      id: '00000000-0000-0000-0000-000000000000',
      slug: 'long_form.long_form',
      content_type: 'short_form', // unused
      name: 'Long-Form',
      description: 'Long-form anchor video pulling all 5 typed answers from one topic.',
      starting_point: 'A topic with all input_types answered.',
      strategy_beats: [],
      secret_sauce: '',
      mad_libs: [],
      gating_rule: '',
      pillar: 'storytelling',
      bucket: 'storytelling',
      target_length_min: null,
      target_length_max: null,
      cooldown_posts: 0,
      is_active: true,
      sort_order: 0,
      hook_patterns: [],
      reference_scripts: [],
    } as ContentFormat

    const refs = best.g.answers.map((a) => a.id)

    return {
      format: longFormPseudo,
      topic_group_id: best.g.topic_group_id,
      raw_material_refs: refs,
      answers: best.g.answers,
      hook_preview: null,
      generation_meta: {
        score: best.score,
        components: {
          material_fit: best.g.answers.filter((a) => !a.thin_flag).length * 2,
          coverage_need: 0,
          stage_weight: 0,
          variance_bonus: 0,
          recency_penalty: 0,
          total: best.score,
        },
        reason: 'long_form: selected topic_group with most complete answer set',
      },
    }
  }

  // Filter formats to this stream.
  const streamFormats = formats.filter((f) => {
    const mappedStream = FORMAT_TYPE_TO_STREAM[f.content_type]
    return mappedStream === stream
  })

  // Drop formats on cooldown.
  const eligible: ContentFormat[] = []
  const skipped: Array<{ format_id: string; format_slug: string; reason: string }> = []
  const currentIndex = runningHistory.length
  for (const f of streamFormats) {
    const cd = resolvedCooldown(f, settings)
    if (cd > 0 && isOnCooldown(runningHistory, f.id, cd, currentIndex)) {
      skipped.push({ format_id: f.id, format_slug: f.slug, reason: 'cooldown' })
      continue
    }
    eligible.push(f)
  }

  if (eligible.length === 0) return null

  const currentCoverage = tallyCoverage(input.currentBuckets as never)

  // Score each eligible format.
  const scored = eligible.map((f) => {
    const r = scoreFormat({
      format: f,
      stage: input.stage,
      currentCoverage,
      targetCoverage: input.targets,
      previousBucket: input.previousBucket,
      history: runningHistory,
      currentIndex,
      topicGroups,
    })
    return { format: f, ...r }
  })

  // Drop any with material_fit = 0 - the format's gating rule is failing
  // because no usable answer exists.
  const usable = scored.filter((s) => s.components.material_fit > 0)
  if (usable.length === 0) {
    for (const s of scored) {
      skipped.push({ format_id: s.format.id, format_slug: s.format.slug, reason: 'no_material' })
    }
    return null
  }

  usable.sort((a, b) => {
    if (b.components.total !== a.components.total) return b.components.total - a.components.total
    if (b.components.material_fit !== a.components.material_fit) return b.components.material_fit - a.components.material_fit
    return a.format.sort_order - b.format.sort_order
  })

  const winner = usable[0]
  const winnerAnswers = topicGroups
    .find((g) => g.topic_group_id === winner.topic_group_id)
    ?.answers.filter((a) => winner.refs.includes(a.id)) ?? []

  return {
    format: winner.format,
    topic_group_id: winner.topic_group_id,
    raw_material_refs: winner.refs,
    answers: winnerAnswers,
    hook_preview: null,
    generation_meta: {
      score: winner.components.total,
      components: winner.components,
      considered_format_ids: usable.slice(0, 5).map((u) => u.format.id),
      skipped: skipped.slice(0, 20),
    },
  }
}

/**
 * Wrapper kept for regenerateSlot which works on a single slot and benefits
 * from the inline hook-preview call. Uses pickSlotFormat under the hood, then
 * decorates with a hook preview.
 */
async function pickSlot(input: PickSlotInput): Promise<PickResult | null> {
  const pick = pickSlotFormat(input)
  if (!pick) return null
  pick.hook_preview = await generateHookPreview({
    format: pick.format,
    answers: pick.answers,
    clientId: input.clientId,
    brandName: input.brandName ?? undefined,
  })
  return pick
}

const HOOK_PREVIEW_BATCH_SIZE = 8

/** Hard time budget for the whole hook-preview phase. Previews are
 *  cosmetic (calendar card text) and every one has a deterministic
 *  fallback - they must NEVER be the reason a plan run dies. Without this
 *  budget, a provider outage made each preview call burn through the
 *  provider's full retry/backoff cycle, 64 slots of that blew past the
 *  serverless function's duration cap, and the run was killed before the
 *  slots were ever inserted. Normal runs finish this phase in ~30-40s. */
const HOOK_PREVIEW_TIME_BUDGET_MS = 90_000

/** Run hook-preview generation in parallel batches. Mutates each pick's
 *  hook_preview in place. Each preview is anchored to the pick's anchor
 *  answer (set during Phase A from the campaign queue), which structurally
 *  guarantees no two pieces in the same stream within a topic share the
 *  same opening moment. Recycled-anchor pieces are flagged so the AI
 *  writes a different angle. */
async function generateHookBatch(
  picks: Array<{ pick: PickResult; clientId: string; brandName: string | null }>,
): Promise<void> {
  const deadline = Date.now() + HOOK_PREVIEW_TIME_BUDGET_MS
  for (let i = 0; i < picks.length; i += HOOK_PREVIEW_BATCH_SIZE) {
    const batch = picks.slice(i, i + HOOK_PREVIEW_BATCH_SIZE)
    if (Date.now() > deadline) {
      // Out of time - fill the rest with deterministic fallbacks so the
      // plan still creates. The user can regenerate individual slots later
      // to get AI previews.
      console.warn(
        `[generateHookBatch] time budget exhausted - falling back for ${picks.length - i} remaining previews`,
      )
      for (const entry of picks.slice(i)) {
        entry.pick.hook_preview = hookPreviewFallback(
          entry.pick.format,
          entry.pick.anchor ?? entry.pick.answers[0] ?? null,
        )
      }
      return
    }
    await Promise.all(
      batch.map(async (entry) => {
        entry.pick.hook_preview = await generateHookPreview({
          format: entry.pick.format,
          answers: entry.pick.answers,
          anchorAnswer: entry.pick.anchor ?? null,
          recycled: !!entry.pick.recycled,
          clientId: entry.clientId,
          brandName: entry.brandName ?? undefined,
        })
      }),
    )
  }
}

export async function regenerateSlot(slotId: string): Promise<PlannerSlotRow> {
  const supabase = plannerAdmin()
  const { data: slotData, error: lookupErr } = await supabase
    .from('content_plan_slots')
    .select('id, client_id, stream, format_id, scheduled_date, status, topic_group_id, raw_material_refs, hook_preview, generation_meta, generated_script_id, approved_at, approved_by, locked, created_at, updated_at')
    .eq('id', slotId)
    .maybeSingle()
  if (lookupErr || !slotData) throw new Error('Slot not found')
  const slot = slotData as SlotRow

  if (slot.status === 'approved') {
    throw new Error('Cannot regenerate an approved slot')
  }

  // Re-run pickSlot for this single date.
  const { data: clientData } = await supabase
    .from('clients')
    .select('id, name, business_name, package_tier, custom_config')
    .eq('id', slot.client_id)
    .maybeSingle()
  const client = (clientData ?? null) as ClientRow | null

  const settings = await loadSettings(slot.client_id)
  const stage = await loadStage(slot.client_id)
  const overrides = buildCoverageOverrides(settings)
  const targets = effectiveTargets(stage, overrides)

  const formats = await listFormats({ is_active: true })
  const formatById = new Map<string, ContentFormat>()
  for (const f of formats) formatById.set(f.id, f)

  const { data: peers } = await supabase
    .from('content_plan_slots')
    .select('id, client_id, stream, format_id, scheduled_date, status, topic_group_id, raw_material_refs, hook_preview, generation_meta, generated_script_id, approved_at, approved_by, locked, created_at, updated_at')
    .eq('client_id', slot.client_id)
    .neq('id', slot.id)
  const peerRows = ((peers ?? []) as SlotRow[]).map((r) => rowToSlot(r, formatById))

  const consumedGroupIds = peerRows
    .filter((r) => r.status === 'approved' || r.status === 'drafted')
    .map((r) => r.topic_group_id)
    .filter((x): x is string => !!x)
  const topicGroups = await loadAvailableTopicGroups(supabase, slot.client_id, consumedGroupIds)

  const earlier = peerRows
    .filter((r) => r.scheduled_date <= slot.scheduled_date)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
  const history = buildUsageHistory(earlier)
  const earlierBuckets: Array<keyof CoverageSnapshot> = []
  for (const r of earlier) {
    if (!r.format_id) continue
    const f = formatById.get(r.format_id)
    if (f) earlierBuckets.push(bucketKey(f.bucket))
  }

  const result = await pickSlot({
    clientId: slot.client_id,
    brandName: client?.business_name ?? client?.name ?? null,
    stream: slot.stream,
    date: slot.scheduled_date,
    stage,
    targets,
    currentBuckets: earlierBuckets,
    previousBucket: earlierBuckets[earlierBuckets.length - 1] ?? null,
    runningHistory: history,
    formats,
    formatById,
    topicGroups,
    settings,
  })

  if (!result) throw new Error('No usable format for this slot')

  // Long-form persists with format_id=null (no content_formats row exists).
  const persistedFormatId = slot.stream === 'long_form' ? null : result.format.id

  const { data: updated, error: updateErr } = await supabase
    .from('content_plan_slots')
    .update({
      format_id: persistedFormatId,
      topic_group_id: result.topic_group_id,
      raw_material_refs: result.raw_material_refs,
      hook_preview: result.hook_preview,
      generation_meta: result.generation_meta,
      status: 'planned',
    })
    .eq('id', slot.id)
    .select('id, client_id, stream, format_id, scheduled_date, status, topic_group_id, raw_material_refs, hook_preview, generation_meta, generated_script_id, approved_at, approved_by, locked, created_at, updated_at')
    .single()

  if (updateErr || !updated) throw new Error('Failed to update slot')
  return rowToSlot(updated as SlotRow, formatById)
}

export { coverageReport, tallyCoverage, effectiveTargets } from './coverage'
