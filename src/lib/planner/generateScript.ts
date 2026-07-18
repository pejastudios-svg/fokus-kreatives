// M4 generation core - turns a planner slot into a finished script.
//
// Flow (per spec section 12.1):
//   1. Load slot + format + raw material (topic answers).
//   2. Load brand profile + content_stage + brand_content_settings.
//   3. Build system prompt = framework + format module + brand context.
//   4. Use Gemini context cache for the system prompt (cache key includes
//      profile version so updates invalidate).
//   5. Build user prompt = raw material + slot-specific instruction +
//      output schema.
//   6. Tier-routed model:
//        long-form          -> high     (Pro)
//        short_form/ER/C    -> standard (Flash)
//        story              -> cheap    (Flash-Lite)
//   7. Hybrid Pro polish for short-form ONLY: Flash drafts the body, Pro
//      polishes hook + close. Long-form is already Pro. Stories use the
//      structured story flow elsewhere - not this function.
//   8. Long-form mid-roll CTA: read slot.midroll_cta -> fall back to
//      brand_content_settings.default_long_form_cta. When present, the AI
//      is told to weave it conversationally between INFLECTION and RISING
//      ACTION.
//   9. Sanitize via existing engine.ts.
//   10. Save to slot: status='drafted', generation_meta.script,
//       generation_meta.checklist, generation_meta.polish (telemetry).

import { generateScript, resolveGeminiModel } from '@/lib/ai/provider'
import { withContentRetry } from '@/lib/ai/contentRetry'
import { getOrCreateContextCache } from '@/lib/ai/contextCache'
import {
  analyzePersonConsistency,
  autoTightenScript,
  detectFabricatedNumbers,
  polishLongFormScript,
  rewriteForPersonConsistency,
} from '@/lib/ai/scriptValidation'
import {
  buildCtaKeywordPromptBlock,
  enforceCtaKeyword,
} from '@/lib/ai/dmKeyword'
import {
  countSpokenWords,
  enforceLengthChecklistItem,
  enforceCarouselValueChecklistItem,
  getChecklistForFormat,
  lengthTargetWindow,
  reconcileChecklist,
  type ChecklistItem,
} from '@/lib/checklist/items'
import { evaluateChecklistForScript } from '@/lib/checklist/evaluate'
import { verifyMidrollCtaPresent, insertMidrollCta } from '@/lib/ai/midrollCheck'
import { grammarPolishScript } from '@/lib/ai/grammarPolish'
import { listFormats } from '@/lib/contentFormats'
import { buildFormatPromptBlock } from '@/lib/contentFormats/promptBlock'
import { buildBrandContextBlock } from '@/lib/prompt/brandContext'
import { frameworkBlockForStream, LONGFORM_FRAMEWORK } from '@/lib/prompt/framework'
import { sanitize } from '@/lib/prompt/engine'
import type { BrandProfile } from '@/components/clients/brandProfile'
import type { ContentFormat } from '@/lib/contentFormats/types'

import { plannerAdmin } from './db'
import { logDbError } from '@/lib/db/logError'
import type { SlotStream } from './types'

export interface ScriptForSlotResult {
  scriptText: string
  checklist: ChecklistItem[]
  /** Polish telemetry - populated only for short-form. Lets the UI surface
   *  whether the hook/close were rewritten by Pro. */
  polish?: {
    hookRewritten: boolean
    closeRewritten: boolean
    newHook?: string
    newClose?: string
  }
}

function normalizeStoredHandle(raw: unknown): string | null {
  // Stored verbatim - the brand pastes a full social URL (e.g.
  // "https://www.instagram.com/saint_000777/") so YouTube can auto-
  // hyperlink it when the description is rendered. We only trim
  // whitespace; the URL content itself passes through untouched.
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed || null
}

function normalizeStoredText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed || null
}

function normalizeStoredHashtags(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const out = raw
    .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    .map((h) => h.trim().startsWith('#') ? h.trim() : `#${h.trim()}`)
  return out.length > 0 ? out : null
}

/**
 * Hardcoded fallback for the long-form mid-roll CTA when the brand has
 * not configured `brand_content_settings.default_long_form_cta`. YouTube
 * long-form CTAs are website-link / done-for-you offers - NEVER the
 * comment-keyword pattern feed posts use. Brand can override per-slot
 * (slot.midroll_cta) or per-brand (default_long_form_cta).
 */
const DEFAULT_LONG_FORM_CTA_FALLBACK =
  'If you want this done for you, click the link in the description below.'

/**
 * Generate a full script for a single planner slot. On success, mutates the
 * slot row: status -> 'drafted', generation_meta.script + .checklist set.
 *
 * This function does NOT touch slots whose status is 'approved' - approved
 * scripts are immutable.
 */
/** Sentinel error thrown when another generation is in flight for the same
 *  slot. The API route maps this to a 409 response so the UI can show
 *  "already generating, try again in a minute". */
export class GenerationLockedError extends Error {
  constructor(slotId: string) {
    super(`Slot ${slotId} is already being generated. Try again in a minute.`)
    this.name = 'GenerationLockedError'
  }
}

export async function generateScriptForSlot(
  slotId: string,
): Promise<ScriptForSlotResult> {
  const supabase = plannerAdmin()

  // 0. Acquire per-slot generation lock. Prevents a double-click on
  //    Generate / Regenerate from firing two simultaneous Pro generations
  //    on the same slot. Stale-lock TTL is 3 minutes (max worst-case
  //    pipeline duration). Released in finally below.
  //
  // The acquire+release run as Postgres RPCs (acquire_slot_generation_lock /
  // release_slot_generation_lock). Doing the atomic check-and-set in a
  // function avoids a PostgREST filter-parsing edge case where the .or()
  // filter with an ISO timestamp value would error with "column does not
  // exist" even though the column was present. See the matching migration
  // 20260521_slot_generation_lock_rpcs.sql.
  const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const { data: acquiredId, error: lockErr } = await supabase.rpc(
    'acquire_slot_generation_lock',
    { p_slot_id: slotId, p_token: lockToken },
  )
  if (lockErr) {
    logDbError(lockErr, {
      op: 'rpc',
      table: 'acquire_slot_generation_lock',
      context: { slotId, lockToken },
    })
    throw new Error(`Failed to acquire generation lock: ${lockErr.message}`)
  }
  if (!acquiredId) {
    throw new GenerationLockedError(slotId)
  }

  try {
    return await generateScriptForSlotInner(slotId, supabase)
  } finally {
    // Release the lock - token-matched server-side so a stale lock that
    // we replaced doesn't get cleared by the wrong caller.
    await supabase.rpc('release_slot_generation_lock', {
      p_slot_id: slotId,
      p_token: lockToken,
    })
  }
}

async function generateScriptForSlotInner(
  slotId: string,
  supabase: ReturnType<typeof plannerAdmin>,
): Promise<ScriptForSlotResult> {
  // 1. Load the slot + adjacent context.
  const { data: slotData, error: slotErr } = await supabase
    .from('content_plan_slots')
    .select(
      'id, client_id, stream, format_id, scheduled_date, status, topic_group_id, raw_material_refs, generation_meta, midroll_cta',
    )
    .eq('id', slotId)
    .maybeSingle()
  if (slotErr || !slotData) throw new Error('Slot not found')
  if (slotData.status === 'approved') {
    throw new Error('Cannot regenerate an approved slot')
  }

  const stream = slotData.stream as SlotStream
  console.log(
    `[generateScript] slot=${slotId} stream=${stream} format_id=${slotData.format_id} format=${(slotData as { format_id?: string }).format_id ?? 'none'}`,
  )
  // Scripts always cover feed-post streams (long_form / short_form /
  // engagement_reel / carousel) - stories are generated separately by
  // storyQueue.ts. So the CTA platform is always 'comment' here.
  const ctaPlatform: 'dm' | 'comment' = 'comment'

  // Cross-slot hook AVOID list. Other slots in this client + same stream
  // that already have a saved script get their HOOK lines pulled and
  // passed to the prompt as "do not paraphrase any of these". The
  // answer-indexed model already gives each slot a different anchor; this
  // is the second line of defense for when two answers are thematically
  // similar across topics and produce near-identical hooks.
  const siblingHooks = await loadSiblingHooks({
    clientId: slotData.client_id as string,
    stream,
    excludeSlotId: slotData.id as string,
  })
  const refs = Array.isArray(slotData.raw_material_refs)
    ? (slotData.raw_material_refs as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : []
  if (refs.length === 0) throw new Error('Slot has no raw_material_refs')

  // 2. Load the format. Long-form has no row in content_formats - synthesize
  //    a pseudo-format so downstream code can treat it uniformly.
  const format = await loadFormat(stream, slotData.format_id as string | null)
  if (!format) throw new Error('Format not found for slot')

  // 3. Load topic answers.
  const { data: topicRows, error: topicErr } = await supabase
    .from('topics')
    .select('id, question, answer, input_type, thin_flag')
    .in('id', refs)
  if (topicErr) throw new Error(`Failed to load topic answers: ${topicErr.message}`)
  const answers = (topicRows ?? []) as Array<{
    id: string
    question: string | null
    answer: string
    input_type: string
    thin_flag: boolean
  }>
  if (answers.length === 0) throw new Error('No topic answers resolved from refs')

  // Re-order to match raw_material_refs. The plan's answer-indexed campaign
  // model puts the slot's ANCHOR answer at refs[0] (each sibling slot in the
  // campaign anchors a DIFFERENT answer) - but .in() returns rows in
  // arbitrary order, so without this sort every slot fed the model the same
  // undifferentiated blob and six short-forms came back telling one story.
  const refOrder = new Map(refs.map((r, i) => [r, i]))
  answers.sort((a, b) => (refOrder.get(a.id) ?? 99) - (refOrder.get(b.id) ?? 99))
  // Long-form has no anchor - it deliberately uses the whole answer set.
  let anchor = stream !== 'long_form' ? answers[0] ?? null : null

  // Progression reels cannot anchor on an opinion - opinions contain no
  // events, and reels anchored on one fake the arc with slogans regardless
  // of prompt rules. Slots planned before this rule may still carry an
  // opinion anchor; remap to the first story-typed answer so regeneration
  // fixes them without a re-plan. The opinion stays in supporting material.
  if (
    stream === 'engagement_reel' &&
    format.slug !== 'engagement_reel.caption_list' &&
    anchor?.input_type === 'opinion'
  ) {
    let storyAnchor = answers.find((a) => a.input_type !== 'opinion') ?? null
    if (!storyAnchor && slotData.topic_group_id) {
      // The slot's refs are opinion-only (opinion-critical formats ref just
      // the opinion). Pull the topic's story answers in so the reel has
      // events to build from.
      const { data: extraRows } = await supabase
        .from('topics')
        .select('id, question, answer, input_type, thin_flag')
        .eq('topic_group_id', slotData.topic_group_id)
        .neq('input_type', 'opinion')
        .order('group_position', { ascending: true })
      const extras = (extraRows ?? []) as typeof answers
      if (extras.length > 0) {
        storyAnchor = extras[0]
        answers.unshift(...extras)
      }
    }
    if (storyAnchor) {
      console.log(
        `[generateScript] reel anchored on opinion - remapping anchor to (${storyAnchor.input_type}) for slot ${slotId}`,
      )
      anchor = storyAnchor
    }
  }

  // 4. Load brand profile + content settings for prompt context + cache key.
  const { data: clientData } = await supabase
    .from('clients')
    .select('id, name, business_name, brand_profile, content_tier, website_url')
    .eq('id', slotData.client_id)
    .maybeSingle()
  const brandProfile = (clientData?.brand_profile as BrandProfile | null) ?? null
  // Two distinct names threaded into long-form descriptions:
  //   creatorName  - the human's name (clients.name) - used in the
  //                  description hook line ("Saint shares how to...")
  //                  and the "In this video, [Creator] breaks down..."
  //                  line. Falls back to business_name if name is null.
  //   brandName    - the business name (clients.business_name) - used
  //                  in the "📌 ABOUT [Brand]" section. Falls back to
  //                  the creator name if business_name is null.
  const creatorName =
    (clientData?.name as string | null) ??
    (clientData?.business_name as string | null) ??
    null
  const brandName =
    (clientData?.business_name as string | null) ??
    (clientData?.name as string | null) ??
    null
  const brandWebsite = (clientData?.website_url as string | null) ?? null

  const { data: settingsData } = await supabase
    .from('brand_content_settings')
    .select(
      'default_long_form_cta, dm_keywords, instagram_handle, tiktok_handle, youtube_handle, linkedin_handle, x_handle, brand_bio, audience_blurb, default_hashtags',
    )
    .eq('client_id', slotData.client_id)
    .maybeSingle()
  const defaultLongFormCta =
    (settingsData?.default_long_form_cta as string | null) ?? null
  const dmKeywordsRaw = (settingsData?.dm_keywords as string[] | null) ?? []
  const dmKeywords = dmKeywordsRaw
    .map((k) => (typeof k === 'string' ? k.trim() : ''))
    .filter(Boolean)

  // Brand description settings - threaded into long-form [DESCRIPTION].
  // Empty values pass through as null so the framework prompt can OMIT
  // the corresponding line rather than fabricate a handle.
  const descriptionSettings = {
    instagramHandle: normalizeStoredHandle(settingsData?.instagram_handle),
    tiktokHandle: normalizeStoredHandle(settingsData?.tiktok_handle),
    youtubeHandle: normalizeStoredHandle(settingsData?.youtube_handle),
    linkedinHandle: normalizeStoredHandle(settingsData?.linkedin_handle),
    xHandle: normalizeStoredHandle(settingsData?.x_handle),
    brandBio: normalizeStoredText(settingsData?.brand_bio),
    audienceBlurb: normalizeStoredText(settingsData?.audience_blurb),
    defaultHashtags: normalizeStoredHashtags(settingsData?.default_hashtags),
  }

  // 5. Resolve mid-roll CTA for long-form.
  //    YouTube long-form uses a website-link CTA, NOT the comment-keyword
  //    pattern that feed posts use. Resolution order:
  //      1. Per-slot override (slot.midroll_cta)
  //      2. Brand default (brand_content_settings.default_long_form_cta)
  //      3. Hardcoded fallback - a soft, conversational link-out
  //    Hardcoded so the AI ALWAYS has a CTA to weave; brand can polish
  //    via default_long_form_cta when ready.
  const midrollCta =
    stream === 'long_form'
      ? ((slotData.midroll_cta as string | null) ??
        defaultLongFormCta ??
        DEFAULT_LONG_FORM_CTA_FALLBACK)
      : null

  // 6. Build system prompt - this is the cacheable prefix.
  const systemPrompt = buildSystemPrompt({
    stream,
    format,
    brandProfile,
  })
  // 7. Pick quality tier per stream. Computed BEFORE the cache call so the
  //    cache key + model match the call we'll make later. Mismatch causes
  //    Gemini to reject the request: "Model used by GenerateContent
  //    request and CachedContent has to be the same."
  const quality = qualityForStream(stream)
  const cacheModel = resolveGeminiModel(quality)

  // Cache key: client + format + profile-hash + quality + system-prompt-hash.
  //
  // The system-prompt hash is CRITICAL. Without it, framework.ts edits get
  // shadowed by a stale Gemini-side cached prefix for up to 1h - the AI
  // keeps reading the old prompt even after we re-deploy. Hashing the
  // actual system prompt content auto-busts the cache the moment ANY
  // upstream input changes (framework, format module, brand profile).
  const profileVersion = computeProfileVersion(brandProfile)
  const promptHash = hashSystemPrompt(systemPrompt)
  const cacheKey = `script:${slotData.client_id}:${format.id}:${profileVersion}:${quality}:${promptHash}`

  // 8. Get or create the context cache. Failures fall back to non-cached.
  let cachedContextName: string | null = null
  try {
    cachedContextName = await getOrCreateContextCache(cacheKey, {
      systemInstruction: systemPrompt,
      ttlSeconds: 3600,
      model: cacheModel,
      displayName: `${format.slug} for ${brandName ?? slotData.client_id}`,
    })
  } catch (err) {
    console.warn('[generateScript] context cache create failed; using inline system prompt', err)
  }

  // 9. Build user prompt with the slot-specific tail.
  const userPrompt = buildUserPrompt({
    stream,
    format,
    answers,
    anchor,
    brandName,
    creatorName,
    brandWebsite,
    midrollCta,
    descriptionSettings,
    dmKeywords,
    ctaPlatform,
    siblingHooks,
    checklistDefs: getChecklistForFormat(format.slug, stream),
  })

  // 10. Run generation. Long-form takes a different path because its
  //     payload is too large to wrap in a JSON+checklist response (the
  //     escaping + checklist tokens push past Pro's effective output
  //     ceiling, causing mid-script truncation). We mirror the package
  //     pattern: plain-text generation for the script + a separate
  //     checklist call.
  let rawScript: string
  let rawChecklist: ChecklistItem[]

  if (stream === 'long_form') {
    // Plain-text generation. No JSON wrapper, no embedded checklist.
    rawScript = await withContentRetry(
      `planner.script.long_form`,
      async () => {
        const result = await generateScript({
          system: systemPrompt,
          user: userPrompt,
          cachedContextName: cachedContextName ?? undefined,
          temperature: 0.6,
          maxTokens: maxTokensForStream(stream, quality),
          jsonObject: false, // PLAIN TEXT - matches package generation
          quality,
          route: `planner.script.long_form`,
          clientId: slotData.client_id as string,
          usageMeta: { format_slug: format.slug, slot_id: slotData.id as string },
        })
        const text = result.content.trim()
        if (!text) throw new Error('Long-form script generation returned empty')
        return text
      },
    )
    // Long-form's checklist is evaluated AFTER all post-processing
    // (person rewrite -> polish -> auto-tighten -> mid-roll check ->
    // sanitize). Doing it here against the raw output would grade a
    // version the user never sees. Defer.
    rawChecklist = []
  } else {
    // Short-form / engagement-reel / carousel: combined JSON+checklist
    // generation works fine because the output is small enough.
    // maxAttempts 3 (default is 2): the failure mode here is a truncated /
    // misshapen JSON roll, and in bulk runs the default meant ~3 slots per
    // campaign died on two bad rolls in a row and surfaced as "N failed".
    const parsed = await withContentRetry(
      `planner.script.${stream}`,
      async () => {
        const result = await generateScript({
          system: systemPrompt,
          user: userPrompt,
          cachedContextName: cachedContextName ?? undefined,
          temperature: 0.7,
          maxTokens: maxTokensForStream(stream, quality),
          jsonObject: true,
          quality,
          route: `planner.script.${stream}`,
          clientId: slotData.client_id as string,
          usageMeta: { format_slug: format.slug, slot_id: slotData.id as string },
        })
        return parseScriptOutput(result.content)
      },
      { maxAttempts: 3 },
    )
    rawScript = parsed.script
    rawChecklist = parsed.checklist
  }

  // For non-long-form streams, reconcile the checklist NOW so any later
  // deterministic flags (length, fabrication) can override the AI grade.
  // Long-form's checklist is built later after sanitize via a separate
  // Pro evaluation call, so we just hold a reference to fill in below.
  let checklist = reconcileChecklist(format.slug, rawChecklist, stream)

  // 11. The hook+close polish step is no longer needed. Pro now drafts
  //     the entire script in step 10, so there's no Flash output to clean
  //     up. The polish module (src/lib/ai/scriptPolish.ts) is kept for
  //     reference but no longer called from this path.
  let finalScript = rawScript
  const polishMeta: ScriptForSlotResult['polish'] = undefined

  // 12. Person-consistency safety net. Pro respects the rule most of the
  //     time, but occasionally still mixes I↔we mid-script. When detected,
  //     run a small Pro rewrite to lock to the opener's person.
  const personAnalysis = analyzePersonConsistency(finalScript)
  if (personAnalysis.mixing && personAnalysis.opener) {
    console.log(
      `[generateScript] person mixing detected (I:${personAnalysis.singularCount} we:${personAnalysis.pluralCount}, opener=${personAnalysis.opener}). Running rewrite...`,
    )
    const rewritten = await rewriteForPersonConsistency({
      script: finalScript,
      target: personAnalysis.opener,
      clientId: slotData.client_id as string,
    })
    if (rewritten) finalScript = rewritten
  }

  // 12b. Long-form Pro polish. Runs after person-consistency, before the
  //      auto-tightener. Targets the residual failure class regex can't
  //      reach: broken sentences, meta-writing leaks, INTRO over 220 words.
  //      Surgical edits only - the polish prompt forbids rewriting and
  //      length is sanity-checked (rejected if <85% of original).
  if (stream === 'long_form') {
    const polished = await polishLongFormScript({
      script: finalScript,
      clientId: slotData.client_id as string,
    })
    if (polished) finalScript = polished
  }

  // 13. Auto-tightener safety net. ONLY runs for streams whose length is
  //     spoken-word constrained (long-form, short-form). Engagement reels
  //     are silent overlays + caption + hashtags - the spoken-word math
  //     doesn't apply, AND the auto-tightener's hardcoded short-form
  //     section labels would corrupt the overlay-scene structure.
  //     Carousels are 10-slide decks + caption + hashtags - same problem.
  //     Both are constrained by structure (scene count / slide count), not
  //     word ceiling, so skip the tightener for them.
  if (stream === 'long_form' || stream === 'short_form') {
    const window = lengthTargetWindow(stream, {
      target_length_min: format.target_length_min,
      target_length_max: format.target_length_max,
    })
    if (window) {
      const wordCount = countSpokenWords(finalScript)
      const ceiling = Math.ceil(window.maxWords * 1.1)
      if (wordCount > ceiling) {
        console.log(
          `[generateScript] auto-tightening: ${wordCount} > ceiling ${ceiling}. Compressing to <=${window.maxWords}...`,
        )
        const compressed = await autoTightenScript({
          script: finalScript,
          targetMaxWords: window.maxWords,
          clientId: slotData.client_id as string,
        })
        if (compressed) finalScript = compressed
      }
    }
  }

  // 14. CTA keyword enforcement. Stories use "DM me X" form; short-form /
  //     carousel feed posts use "comment X" form.
  //     LONG-FORM IS DIFFERENT - YouTube uses a website-link CTA and never
  //     a comment-keyword. Skip enforcement entirely for long_form so we
  //     don't rewrite the website-link CTA into a "comment KEYWORD" form.
  //     ENGAGEMENT REELS (except caption_list) are CTA-free story
  //     progressions - enforcement would inject the very "comment KEYWORD"
  //     line the format bans.
  const skipCtaEnforcement =
    stream === 'long_form' ||
    (stream === 'engagement_reel' && format.slug !== 'engagement_reel.caption_list')
  if (dmKeywords.length > 0 && !skipCtaEnforcement) {
    const enforced = enforceCtaKeyword(finalScript, dmKeywords, ctaPlatform)
    if (enforced.rewrites.length > 0) {
      console.log(
        `[generateScript] CTA keyword enforced (${ctaPlatform}): ${enforced.rewrites.join(', ')}`,
      )
    }
    finalScript = enforced.text
  }

  // 15. Mid-roll CTA presence check (long-form only). Verify the supplied
  //     CTA TEXT (or a close paraphrase) appears between POINT 2 and
  //     POINT 3 in [BODY]. If missing, run a single targeted Pro call to
  //     insert it - cheaper than regenerating the whole script. Capped at
  //     one retry; if that still fails we flag the checklist item and let
  //     staff decide whether to regenerate.
  let midrollFlag: { status: 'flag' | 'pass'; note: string } = {
    status: 'pass',
    note: 'Mid-roll CTA woven naturally into POINT 2 -> POINT 3 transition.',
  }
  if (stream === 'long_form' && midrollCta) {
    const present = verifyMidrollCtaPresent(finalScript, midrollCta)
    if (!present) {
      console.log('[generateScript] mid-roll CTA missing - running targeted insert...')
      const fixed = await insertMidrollCta({
        script: finalScript,
        ctaText: midrollCta,
        clientId: slotData.client_id as string,
      })
      if (fixed) {
        finalScript = fixed
        console.log('[generateScript] mid-roll CTA inserted on retry.')
      } else {
        midrollFlag = {
          status: 'flag',
          note: 'Mid-roll CTA was not placed between POINT 2 and POINT 3. Insert manually or regenerate.',
        }
      }
    }
  }

  // 16. Sanitize through existing engine.
  let cleanScript = sanitize(finalScript)

  // 16b. Final grammar / spelling polish (Flash-Lite). Runs on EVERY
  //      stream - this is where we catch the residual class of small
  //      grammar bugs that regex repairs miss (subject-verb disagreement,
  //      missed contractions, comma splices, typos). The pass is strictly
  //      surgical; the prompt forbids stylistic rewrites and the length
  //      sanity check rejects anything under 95% of the original size.
  //      Skipped on tiny inputs to avoid grammar-ifying broken stubs.
  const grammarFixed = await grammarPolishScript({
    script: cleanScript,
    clientId: slotData.client_id as string,
    streamLabel: stream,
  })
  if (grammarFixed) cleanScript = grammarFixed

  // 16c. Caption safety net. Short-form / engagement-reel / carousel posts
  //      MUST ship with a [CAPTION], but unlike long-form there's no
  //      required-section validator, so an occasional model omission (or a
  //      post-step rewrite that drops it) slips through. If the caption is
  //      missing or empty, generate one from the finished script and splice it
  //      in before [HASHTAGS]. Long-form uses [DESCRIPTION], not [CAPTION].
  if (stream === 'short_form' || stream === 'engagement_reel' || stream === 'carousel') {
    if (!scriptHasCaption(cleanScript)) {
      console.log(`[generateScript] caption missing for ${stream} - repairing.`)
      const caption = await generateCaptionForScript({
        script: cleanScript,
        stream,
        brandName: brandName ?? null,
        clientId: slotData.client_id as string,
      })
      // Sanitize the repaired caption - it's spliced AFTER the main sanitize
      // pass, so without this an em-dash / AI tell in the repair would ship.
      if (caption) cleanScript = spliceCaption(cleanScript, sanitize(caption))
    }
    // Same safety net for [HASHTAGS] - the last section, so the most likely
    // to be dropped or truncated.
    if (!scriptHasHashtags(cleanScript)) {
      console.log(`[generateScript] hashtags missing for ${stream} - repairing.`)
      const hashtags = await generateHashtagsForScript({
        script: cleanScript,
        clientId: slotData.client_id as string,
      })
      if (hashtags) cleanScript = spliceHashtags(cleanScript, hashtags)
    }
  }

  // 17. For long-form, evaluate the checklist via a SEPARATE Pro call now
  //     that the script is fully post-processed and sanitized. Replaces
  //     the manual_check defaults from step 10 with real grades. For
  //     short-form / engagement-reel / carousel, the checklist already
  //     came from the JSON output - skip the extra call.
  if (stream === 'long_form') {
    const aiChecklist = await evaluateChecklistForScript({
      script: cleanScript,
      formatSlug: format.slug,
      checklistDefs: getChecklistForFormat(format.slug),
      clientId: slotData.client_id as string,
    })
    checklist = aiChecklist
  }

  // 18. Apply deterministic length check against the sanitized script.
  //     This OVERRIDES any AI grade for the length item - word-count math
  //     is not AI judgment.
  enforceLengthChecklistItem(checklist, cleanScript, stream, {
    target_length_min: format.target_length_min,
    target_length_max: format.target_length_max,
  })

  // 18b. Carousel "teaching, not selling" check - force-flag any teaching
  //      slide that describes the service instead of teaching the viewer.
  enforceCarouselValueChecklistItem(checklist, cleanScript, stream)

  // 19. Number-fabrication check against the sanitized script. Flags the
  //     no-fabrication checklist item rather than silently rewriting.
  const rawMaterialAggregate = answers.map((a) => a.answer).join(' \n ')
  const fabricated = detectFabricatedNumbers(cleanScript, rawMaterialAggregate)
  if (fabricated.length > 0) {
    console.log(
      `[generateScript] fabricated numbers detected: ${fabricated.join(', ')}`,
    )
    const fabIdx = checklist.findIndex((i) => i.id === 'universal.no_fabrication')
    if (fabIdx >= 0) {
      checklist[fabIdx] = {
        ...checklist[fabIdx],
        status: 'flag',
        ai_note: `Numbers in script not found in raw material: ${fabricated.join(', ')}. Likely fabricated - verify or strip.`,
      }
    }
  }

  // 20. Apply mid-roll flag if the retry didn't recover. We do this AFTER
  //     the AI checklist evaluation so it can't be overwritten.
  if (stream === 'long_form' && midrollFlag.status === 'flag') {
    const idx = checklist.findIndex((i) => i.id === 'long_form.midroll_cta_natural')
    if (idx >= 0) {
      checklist[idx] = {
        ...checklist[idx],
        status: 'flag',
        ai_note: midrollFlag.note,
      }
    }
  }

  // 13. Persist into the slot's generation_meta + flip status -> drafted.
  const meta = (slotData.generation_meta as Record<string, unknown> | null) ?? {}
  const nextMeta = {
    ...meta,
    script: cleanScript,
    checklist,
    ...(polishMeta ? { polish: polishMeta } : {}),
    script_generated_at: new Date().toISOString(),
  }
  const { error: updateErr } = await supabase
    .from('content_plan_slots')
    .update({ status: 'drafted', generation_meta: nextMeta })
    .eq('id', slotId)
  if (updateErr) {
    console.error('[generateScript] failed to persist script to slot:', updateErr)
    throw new Error(`Failed to save script: ${updateErr.message}`)
  }

  return {
    scriptText: cleanScript,
    checklist,
    polish: polishMeta,
  }
}

// =============================================================================
// HELPERS
// =============================================================================

async function loadFormat(
  stream: SlotStream,
  formatId: string | null,
): Promise<ContentFormat | null> {
  if (stream === 'long_form') {
    return synthesizeLongFormFormat()
  }
  if (!formatId) return null
  const all = await listFormats({ is_active: true })
  return all.find((f) => f.id === formatId) ?? null
}

function synthesizeLongFormFormat(): ContentFormat {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    slug: 'long_form.long_form',
    content_type: 'short_form', // unused for long-form path
    name: 'Long-Form',
    description:
      'Long-form anchor video pulling all 5 typed answers from one topic.',
    starting_point: 'A topic with all input_types answered.',
    strategy_beats: [],
    secret_sauce: '',
    mad_libs: [],
    gating_rule: '',
    pillar: 'storytelling',
    bucket: 'storytelling',
    // Word-count window. Calibrated to ~4 wps (240 wpm) - the actual
    // delivery pace established YouTube creators in this genre run at
    // (verified against a 1,765-word reference script that runs 7:16).
    // 10 min ≈ 2400 words; 15 min ≈ 3600 words.
    target_length_min: 2400,
    target_length_max: 3600,
    cooldown_posts: 0,
    is_active: true,
    sort_order: 0,
    hook_patterns: [],
    reference_scripts: [],
  } as ContentFormat
}

function qualityForStream(stream: SlotStream): 'high' | 'standard' | 'cheap' {
  // Pro for everything that isn't a story. Pro is constraint-respecting -
  // it follows person consistency, anti-invention, length, and no-AI-tells
  // rules far more reliably than Flash. The cost jump (~$0.011/slot) is
  // worth it for "close to perfect" output. Stories stay on Flash-Lite -
  // they're 4-frame text fragments, no need for Pro.
  if (stream === 'long_form') return 'high'
  if (stream === 'short_form' || stream === 'engagement_reel' || stream === 'carousel') {
    return 'high'
  }
  return 'cheap'
}

function maxTokensForStream(stream: SlotStream, quality: 'high' | 'standard' | 'cheap'): number {
  // Pro reserves up to ~1024 tokens for internal reasoning ("thinking
  // budget") out of maxOutputTokens. We add a per-stream Pro headroom
  // so the actual JSON output (script + full checklist) doesn't get
  // truncated mid-string. Long-form needs the most because it produces
  // the largest payload (1800-2800 spoken words + 4 body points with
  // CONTEXT/APPLICATION/FRAMING/RE-HOOK + outro + description + 8-10
  // checklist items with ai_notes).
  const proReserve = quality === 'high' ? 1500 : 0
  switch (stream) {
    case 'long_form':
      // Long-form is plain-text now (no JSON wrapper, no embedded
      // checklist - the checklist is a separate Pro call after script
      // saves). 8000 matches the proven cap from the package generation
      // path (src/lib/prompt/packagePrompt.ts:142) and comfortably fits
      // a full 1800-2800-word script + Pro's ~1024 thinking budget.
      // Going higher invites the AI to pad sections beyond their target
      // word counts.
      return 8000
    // JSON streams get generous ceilings. maxOutputTokens is a CAP, not a
    // spend - unused headroom costs nothing, and the JSON structure (exact
    // scene/slide counts, fixed section labels) constrains padding. Tight
    // caps were the main source of bulk-generation failures: script + full
    // checklist + JSON escaping + Pro's thinking share would truncate
    // mid-string, fail the parse, and after two bad rolls the slot
    // surfaced as "failed" in the campaign banner.
    case 'short_form':
      return 2000 + proReserve
    case 'engagement_reel':
      // Progression reels have no scene ceiling - budget for 8+ scenes +
      // caption + checklist without truncation.
      return 2400 + proReserve
    case 'carousel':
      return 2600 + proReserve
  }
}

/** The expected output shape for the AI's `script` string field, keyed by
 *  stream. This MUST match the BUILDOUT for that stream - otherwise the AI
 *  follows whichever instruction is more concrete (usually the output
 *  schema) and ignores the framework. The most common failure mode this
 *  prevents: engagement reels coming out as short-form spoken scripts. */
function expectedSchemaForStream(stream: SlotStream, formatSlug?: string): string {
  console.log(`[generateScript] expectedSchemaForStream called with stream="${stream}"`)
  // Engagement reels split by format: caption_list is the ONLY reel with a
  // CTA (it lives in the caption). Every other reel is a story progression
  // with NO CTA - the schema text must match the buildout or the model
  // follows whichever is more concrete.
  if (stream === 'engagement_reel' && formatSlug !== 'engagement_reel.caption_list') {
    return `Shape:
{
  "script": "Engagement reel as one string. SILENT TEXT-ON-SCREEN STORY PROGRESSION - NO spoken script, NO voiceover, NO narration. Use these EXACT bracket section labels in this order: [TITLE], [ANGLE], [PACING], [LENGTH], [SCENES], [CAPTION], [HASHTAGS]. Inside [SCENES], format each scene as 'Scene N (X-Y sec): [overlay text]' on its own line - at least 4 scenes, no upper limit, as many beats as the story needs. The scenes are ONE story in time order with a MANDATORY arc: BEFORE (the low point), STRUGGLE (the buildup), TURN (the moment it changed - required), CLIMB (1-2 scenes of what the narrator actually DID after the turn - required; jumping from realization straight to the outcome fails the format), RESOLUTION (the concrete after-state for the SAME person who opened scene 1 - required). Every scene is a FILMABLE MOMENT - an event at a point in time a camera could catch; beliefs, slogans, quotes, and abstract claims are not scenes. The reel must end ABOVE where it started; ending on the low point or a moral fails the format. NO CTA anywhere - no comment keyword, no poll, no question finale, no 'save this'. Do NOT use [HOOK]/[REHOOK 1]/[BODY]/[REHOOK 2]/[CLOSE]/[RELOOP] - those are short-form labels and produce the wrong format.",
  "checklist": [ { "id": "...", "status": "pass" | "flag" | "manual_check", "ai_note": "..." } ]
}`
  }
  switch (stream) {
    case 'long_form':
      return `Shape:
{
  "script": "Long-form script as one string. Use these EXACT bracket section labels in this order: [TITLE], [THUMBNAIL IDEA], [OUTLINE], [INTRO], [BODY], [OUTRO], [CTA], [DESCRIPTION]. Line breaks separate sections.",
  "checklist": [ { "id": "...", "status": "pass" | "flag" | "manual_check", "ai_note": "..." } ]
}`
    case 'short_form':
      return `Shape:
{
  "script": "Short-form spoken script as one string. Use these EXACT bracket section labels in this order: [TITLE], [HOOK], [REHOOK 1], [BODY], [CTA], [REHOOK 2], [CLOSE], [RELOOP], [CAPTION], [HASHTAGS]. Line breaks separate sections. Single mid-script CTA, NO end-CTA. The CAPTION is the post caption (60-120 words) that goes below the video on IG/TikTok - it TEACHES the takeaway, doesn't describe the reel. HASHTAGS are 8-14 unique tags space-separated.",
  "checklist": [ { "id": "...", "status": "pass" | "flag" | "manual_check", "ai_note": "..." } ]
}`
    case 'engagement_reel':
      return `Shape:
{
  "script": "Engagement reel as one string. SILENT TEXT-ON-SCREEN format - NO spoken script, NO voiceover, NO narration. Use these EXACT bracket section labels in this order: [TITLE], [ANGLE], [PACING], [LENGTH], [SCENES], [CAPTION], [HASHTAGS]. Inside [SCENES], format each scene as 'Scene N (X-Y sec): [overlay text]' on its own line. Final scene drives engagement (poll / debate question / comment CTA). Do NOT use [HOOK]/[REHOOK 1]/[BODY]/[REHOOK 2]/[CLOSE]/[RELOOP] - those are short-form labels and produce the wrong format.",
  "checklist": [ { "id": "...", "status": "pass" | "flag" | "manual_check", "ai_note": "..." } ]
}`
    case 'carousel':
      return `Shape:
{
  "script": "Carousel deck as one string. NOT a spoken script, NOT a reel. Use these EXACT bracket section labels in this order: [TITLE], [ANGLE], [CAPTION], [SLIDES], [HASHTAGS]. Inside [SLIDES], format each slide as 'Slide N: [slide text]' on its own line. EXACTLY 10 slides. Do NOT use [HOOK]/[REHOOK 1]/[BODY]/[REHOOK 2]/[CLOSE]/[RELOOP] - those are short-form labels.",
  "checklist": [ { "id": "...", "status": "pass" | "flag" | "manual_check", "ai_note": "..." } ]
}`
  }
}

interface BuildSystemPromptInput {
  stream: SlotStream
  format: ContentFormat
  brandProfile: BrandProfile | null
}

function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const { stream, format, brandProfile } = input
  const sections: string[] = []

  // Stream-aware framework. Long-form gets BASE + 5-step LONGFORM_BUILDOUT.
  // Everything else (short-form / engagement-reel / carousel / story) gets
  // BASE + 8-beat SHORTFORM_BUILDOUT.
  sections.push(frameworkBlockForStream(stream, format.slug))

  // Long-form ALSO gets the detailed output schema (LONGFORM_FRAMEWORK).
  // Short-form's output schema is baked into SHORTFORM_BUILDOUT itself.
  if (stream === 'long_form') {
    sections.push(LONGFORM_FRAMEWORK)
  }

  // Format module - description, strategy beats, hook patterns, reference
  // scripts. Long-form skips this (no row in content_formats).
  if (stream !== 'long_form') {
    sections.push(buildFormatPromptBlock(format, stream))
  }

  // Brand context.
  sections.push(
    buildBrandContextBlock(brandProfile, {
      voiceMode: 'full',
      clientMode: 'extended',
      includeVoiceSamples: true,
      includeAmmo: true,
      includeBans: true,
    }),
  )

  return sections.filter(Boolean).join('\n\n---\n\n')
}

interface BuildUserPromptInput {
  stream: SlotStream
  format: ContentFormat
  answers: Array<{
    id: string
    question: string | null
    answer: string
    input_type: string
    thin_flag: boolean
  }>
  /** The single answer this slot is anchored to (refs[0] from the plan's
   *  answer-indexed campaign model). Null for long-form, which uses the
   *  whole answer set. When set, the prompt centers the piece on this
   *  answer and demotes the rest to supporting context - sibling slots
   *  anchor different answers, which is where campaign variety comes from. */
  anchor: {
    id: string
    question: string | null
    answer: string
    input_type: string
    thin_flag: boolean
  } | null
  brandName: string | null
  /** Creator's personal name (clients.name). Used by the long-form
   *  description for the hook line and "In this video, [Creator]..."
   *  Falls back to brandName when null. */
  creatorName: string | null
  /** Brand website URL from clients.website_url. Used by the long-form
   *  description to fill link slots; null/empty = leave links blank in
   *  the description. */
  brandWebsite: string | null
  midrollCta: string | null
  /** Long-form description settings - social handles + bio + audience
   *  blurb + hashtags. Null fields cause the framework to OMIT the
   *  corresponding description line rather than fabricate one. */
  descriptionSettings: {
    instagramHandle: string | null
    tiktokHandle: string | null
    youtubeHandle: string | null
    linkedinHandle: string | null
    xHandle: string | null
    brandBio: string | null
    audienceBlurb: string | null
    defaultHashtags: string[] | null
  }
  dmKeywords: string[]
  ctaPlatform: 'dm' | 'comment'
  /** Hooks of other slots in this client + same stream that already have
   *  a saved script. Passed to the AI as "do not paraphrase any of these"
   *  to prevent thematically-similar answers across topics from producing
   *  duplicate hooks. */
  siblingHooks: string[]
  checklistDefs: ReturnType<typeof getChecklistForFormat>
}

function buildUserPrompt(input: BuildUserPromptInput): string {
  const { stream, format, answers, anchor, brandName, creatorName, brandWebsite, midrollCta, descriptionSettings, dmKeywords, ctaPlatform, siblingHooks, checklistDefs } = input
  const sections: string[] = []

  if (brandName) sections.push(`BRAND: ${brandName}`)

  if (anchor) {
    // Anchor-centered raw material. Feeding every answer as one flat list
    // made the model gravitate to the most vivid answer in ALL of a
    // campaign's slots - six short-forms retelling the same story. The
    // anchor rotates per slot at plan time; the prompt has to enforce it.
    const supporting = answers.filter((a) => a.id !== anchor.id)
    const parts = [
      `ANCHOR ANSWER (${anchor.input_type}) - THE CORE OF THIS PIECE:`,
      anchor.answer,
      '',
      'ANCHOR RULE (STRICT): This piece exists to deliver the ANCHOR answer. The [TITLE], the hook, and the main narrative or teaching of the body all come from the ANCHOR - its specific moment, claim, story, or method is the star of this piece. Every other slot in this campaign anchors on a DIFFERENT answer from the same topic; if you build this script around the supporting material instead, two posts in the same week end up telling the same story.',
      '',
      'DO NOT RETELL THE WHOLE JOURNEY. The answers in this topic are facets of one story, and the audience sees several pieces from it in the same week. A piece that walks the full arc (the struggle, then the realization, then the system, then the results) is a duplicate of every other piece that does the same. Enter the story AT the anchor\'s moment and stay there: zoom in, add its specific details, and go deeper instead of wider. Supporting material earns at most one passing clause - never its own beat.',
    ]
    if (supporting.length > 0) {
      parts.push(
        '',
        `SUPPORTING MATERIAL - IDEAS ONLY, WORDING OFF-LIMITS: each answer below is the ANCHOR of a different script in this campaign, and its wording belongs to that script. You may use a supporting answer's idea as context (one clause, restated in completely fresh words), but do NOT quote it, closely paraphrase it, or reuse its distinctive phrases. When several scripts each lean on the same vivid lines, the whole week reads like one post copy-pasted.${
          stream === 'engagement_reel'
            ? ' EXCEPTION FOR THIS PROGRESSION REEL: the arc must cross a turn and resolve, so the TURN and RESOLUTION beats may take their FACTS (the turning point, the proof, the numbers) from the supporting answers - stated in fresh words, never their phrasing.'
            : ''
        }\n${supporting
          .map((a) => `- (${a.input_type}) ${a.answer}`)
          .join('\n')}`,
      )
    }
    parts.push('', 'Do NOT invent details beyond this material.')
    sections.push(parts.join('\n'))
  } else {
    sections.push(
      `RAW MATERIAL (anchor every specific to this; do NOT invent details):\n${answers
        .map((a) => `- (${a.input_type}) ${a.answer}`)
        .join('\n')}`,
    )
  }

  // CTA keyword rule (when set on brand_content_settings.dm_keywords).
  // Stories use "DM me [keyword]" form; short-form / carousel feed posts
  // use "comment [keyword]" form. Long-form does NOT use a comment-keyword
  // CTA - YouTube's CTA is a website link-out (handled below via MID-ROLL
  // CTA TEXT). Engagement reels are CTA-free story progressions, EXCEPT
  // caption_list whose caption ends with the keyword CTA.
  const wantsCtaKeyword =
    stream !== 'long_form' &&
    !(stream === 'engagement_reel' && format.slug !== 'engagement_reel.caption_list')
  if (wantsCtaKeyword) {
    const ctaKeywordBlock = buildCtaKeywordPromptBlock(dmKeywords, ctaPlatform)
    if (ctaKeywordBlock) sections.push(ctaKeywordBlock)
  }

  // Hard word ceiling - explicit number per format. AI is bad at counting
  // words from a "75-180 words" rule alone; spelling out the ceiling for
  // THIS format makes it land more reliably.
  const lengthWindow = lengthTargetWindow(stream, {
    target_length_min: format.target_length_min,
    target_length_max: format.target_length_max,
  })
  if (lengthWindow) {
    sections.push(
      `WORD BUDGET (HARD): ${lengthWindow.minWords}-${lengthWindow.maxWords} words for this script. ${lengthWindow.maxWords} is the ceiling - if your draft is over, cut a body beat before submitting. Count words before output.`,
    )
  }

  if (stream === 'long_form' && midrollCta) {
    // Placement rule lives in the framework's LONGFORM_BUILDOUT step 4.
    // User prompt hands over the CTA TEXT and the strict tone contract:
    // the CTA is a conversational aside that flows STRAIGHT into the next
    // body point - no hard break, no signoff, no separate paragraph.
    sections.push(
      [
        `MID-ROLL CTA TEXT: ${midrollCta}`,
        '',
        'MID-ROLL CTA TONE (STRICT):',
        '- This is a YouTube long-form video. The CTA is a SOFT, CONVERSATIONAL aside, not a hard sell. NEVER use "Comment KEYWORD" or "DM me KEYWORD" form here - that is a feed-post pattern, not a YouTube pattern.',
        '- The CTA must flow STRAIGHT into the next body point in the same breath. After delivering the CTA line, immediately return to teaching using a connector like "...so now that we have that covered..." or "...okay, so let\'s keep going..." or "...anyway, here\'s what happens next...". NO paragraph break, NO "back to the video", NO sign-off.',
        '- Use the supplied CTA TEXT as the link-out, but you may lightly conversationalize the lead-in (e.g. "and quick aside - if you want this done for you, click the link in the description below, so now that we have that covered..."). Keep the website-link instruction VERBATIM. Do not invent a separate URL.',
      ].join('\n'),
    )
  }

  if (stream === 'long_form') {
    // Description block inputs. Each line is either an explicit value or
    // the literal string "(none)" - the framework treats "(none)" as
    // "OMIT this line from the description" rather than fabricating.
    const renderField = (raw: string | null) => raw && raw.trim() ? raw.trim() : '(none)'
    // Social URL fields are stored verbatim as full URLs the brand pasted.
    // Pass through with no stripping so YouTube auto-hyperlinks them.
    const renderHandle = (raw: string | null) =>
      raw && raw.trim() ? raw.trim() : '(none)'
    const hashtags = descriptionSettings.defaultHashtags
    const renderHashtags =
      hashtags && hashtags.length > 0 ? hashtags.join(' ') : '(none)'
    sections.push(
      [
        '====================',
        'DESCRIPTION INPUTS (long-form):',
        `CREATOR_NAME: ${renderField(creatorName)}  (the human - first name preferred - used in the hook line and "In this video, [Creator]..." paragraph)`,
        `BRAND_NAME: ${renderField(brandName)}  (the business / channel name - used in the 📌 ABOUT section)`,
        `BRAND_WEBSITE: ${renderField(brandWebsite)}`,
        `BRAND_OFFER: ${renderField(midrollCta)}  (used for the 🔥 pinned CTA line - paraphrase, do not copy verbatim)`,
        `BRAND_BIO: ${renderField(descriptionSettings.brandBio)}  (REFERENCE material for the ABOUT section - rewrite in fresh language for THIS video; do NOT paste verbatim)`,
        `BRAND_AUDIENCE: ${renderField(descriptionSettings.audienceBlurb)}  (REFERENCE material for WHO THIS IS FOR + first-time-here lines - rewrite descriptively for THIS video)`,
        `BRAND_INSTAGRAM: ${renderHandle(descriptionSettings.instagramHandle)}`,
        `BRAND_TIKTOK: ${renderHandle(descriptionSettings.tiktokHandle)}`,
        `BRAND_YOUTUBE: ${renderHandle(descriptionSettings.youtubeHandle)}`,
        `BRAND_LINKEDIN: ${renderHandle(descriptionSettings.linkedinHandle)}`,
        `BRAND_X: ${renderHandle(descriptionSettings.xHandle)}`,
        `BRAND_HASHTAGS: ${renderHashtags}`,
        '',
        'RULES:',
        '- For ANY social URL or BIO/AUDIENCE field whose value is literally "(none)", OMIT that line/paragraph entirely from the [DESCRIPTION]. Do NOT fabricate URLs, handles, or biographical claims.',
        '- The BRAND_INSTAGRAM/TIKTOK/YOUTUBE/LINKEDIN/X values are FULL PROFILE URLS (https://...). Paste them verbatim after the "➡︎" arrow in the Connect block - do NOT strip "https://" or "@" or add a leading slash. YouTube auto-hyperlinks the line when it sees a recognized URL.',
        '- BRAND_BIO and BRAND_AUDIENCE are REFERENCE inputs, not copy-paste targets. Rewrite the ABOUT and WHO THIS IS FOR / first-time-here paragraphs IN YOUR OWN WORDS, contextualized to the specific video topic the script teaches. The reader should not see the raw bio sentence twice. Synthesize a fresh, descriptive paragraph that fits the video.',
        '- BRAND_HASHTAGS: when supplied (not "(none)"), paste verbatim at the bottom. When "(none)", GENERATE 15-20 hashtags relevant to THIS video\'s topic / niche / audience (mix of broad, mid-specificity, and narrow tags). Never omit the hashtag block; either use the supplied tags or generate them.',
        '====================',
      ].join('\n'),
    )
  }

  // Cross-slot hook dedup. Other slots in this client + same stream that
  // already have a saved script - their HOOK lines are fed in as "do
  // not paraphrase any of these". The answer-indexed model gives each
  // slot a unique anchor; this is the second-line defense when two
  // anchors are thematically similar enough to produce duplicate hooks.
  if (siblingHooks.length > 0) {
    const trimmed = siblingHooks.slice(-12) // cap to keep prompt size sane
    sections.push(
      `TITLES + HOOKS ALREADY USED IN THIS PLAN (same stream). Do NOT paraphrase any of these, and do NOT reuse their distinctive phrases ANYWHERE in your script - not the hook, the body, the caption, or the title. If a vivid phrase below already carried another post, find different words for this one. Your piece must enter at a clearly different moment with a different opening angle:\n${trimmed
        .map((h) => `- "${h}"`)
        .join('\n')}`,
    )
  }

  // Length target.
  if (format.target_length_min || format.target_length_max) {
    const min = format.target_length_min ?? 0
    const max = format.target_length_max ?? min
    sections.push(
      stream === 'long_form'
        ? `TARGET LENGTH: ${min}-${max} spoken words across INTRO + BODY + OUTRO. Hit this range by going DEEPER into raw material - never invent.`
        : `TARGET LENGTH: ${min}-${max} ${stream === 'carousel' ? 'words across slides' : 'seconds spoken (~${Math.round(min * 2.5)}-${Math.round(max * 2.5)} words)'}.`,
    )
  }

  // Long-form takes a different output path: plain-text generation, with
  // checklist evaluated separately afterwards (see generateScriptForSlot
  // for the two-step flow). For long-form we DON'T inject the checklist
  // contract or the JSON output schema - both confuse the AI when the
  // expected output is plain bracket-formatted text.
  if (stream !== 'long_form') {
    // Checklist evaluation contract (combined-call streams only).
    sections.push(
      `CHECKLIST: After writing the script, evaluate it against these items. For each item, return id + status ('pass' | 'flag' | 'manual_check') + a one-sentence ai_note. Be honest - flag what doesn't meet the rule rather than rubber-stamping.\n\nITEMS:\n${checklistDefs
        .map((d) => `- id: ${d.id}\n  rule: ${d.rule}`)
        .join('\n')}`,
    )

    // Output schema. The bracket labels listed here MUST match the stream's
    // BUILDOUT (short-form / engagement-reel / carousel). If they don't,
    // the AI follows the output schema instead of the framework block - and
    // you end up with engagement reels written as short-form scripts. This
    // is the rule that crystalizes the structure.
    sections.push(
      `OUTPUT (STRICT JSON):
The response must be a single JSON object with EXACTLY these two top-level keys: "script" (string) and "checklist" (array). Use these exact key names - do NOT use "scriptText", "content", "output", "qa", or any other variant. No additional top-level keys.

${expectedSchemaForStream(stream, format.slug)}

No prose outside the JSON. No markdown code fences. No "Here's the JSON:" preamble. The response must START with { and END with }. Nothing else.`,
    )
  } else {
    // Long-form: plain-text instruction. Tell the AI to output the
    // bracket-formatted script directly, no JSON wrapper, no checklist.
    sections.push(
      `OUTPUT (PLAIN TEXT):
Write the full long-form script directly as plain text. Use the bracket section labels from LONG-FORM STRUCTURE: [TITLE], [THUMBNAIL IDEA], [OUTLINE], [INTRO], [BODY], [OUTRO], [CTA], [DESCRIPTION]. Each label on its own line with blank lines around it.

DO NOT wrap the response in JSON.
DO NOT add markdown code fences.
DO NOT add a preamble like "Here's the script:".
DO NOT include any QA checklist - the checklist is evaluated separately.

The response starts with [TITLE] and runs through [DESCRIPTION] without stopping. Hitting [DESCRIPTION] all the way through is mandatory; truncating before [DESCRIPTION] is a failure.`,
    )
  }

  return sections.join('\n\n')
}

/** Parse the AI's raw JSON output into { script, checklist }. Throws on
 *  malformed JSON or missing script - the content-retry wrapper picks up
 *  the throw and runs another attempt. The checklist is returned in its
 *  raw shape (just whatever the AI wrote); the caller reconciles it
 *  against the registry. */
function parseScriptOutput(content: string): {
  script: string
  checklist: ChecklistItem[]
} {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    // Surface the truncation + a snippet of what came back so we can see
    // whether the model hit its token cap, returned markdown fences, or
    // produced some other shape we don't handle.
    const snippet = content.length > 200 ? `${content.slice(0, 100)}...${content.slice(-100)}` : content
    console.warn(`[generateScript] JSON parse failed. Length=${content.length}. Snippet:`, snippet)
    throw new Error(`Script output was not valid JSON (length=${content.length})`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Script output JSON was not an object')
  }
  const obj = raw as Record<string, unknown>

  // Try canonical `script` first, then common variants Pro sometimes
  // returns. If we end up needing more, the diagnostic below will show
  // what keys came back.
  let script = ''
  for (const key of ['script', 'scriptText', 'script_text', 'content', 'output', 'text']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) {
      script = v.trim()
      break
    }
  }

  // Double-wrap salvage: the model sometimes nests a SECOND JSON envelope
  // inside the script string ('{"script": "{\"script\": \"[TITLE]...\"}"}').
  // A live carousel saved the whole inner envelope - braces, escaped \n's,
  // checklist and all - as its script. If the extracted script looks like
  // another envelope, unwrap it (best-effort; a parse failure keeps the
  // string as-is and the [CHECKLIST] strip below still cleans the tail).
  if (script.startsWith('{') && script.includes('"script"')) {
    try {
      const inner = JSON.parse(script) as Record<string, unknown>
      if (inner && typeof inner.script === 'string' && inner.script.trim()) {
        console.warn('[generateScript] script field contained a nested JSON envelope - unwrapped.')
        script = inner.script.trim()
      }
    } catch {
      // Not valid JSON - fall through with the raw string.
    }
  }

  // Salvage: the model sometimes returns `script` as a STRUCTURED OBJECT
  // ({ title, angle, slides: [...] }) instead of the bracket-labeled string
  // the schema demands. The content is all there - flatten keys into
  // bracket sections rather than burning a retry (or failing the slot).
  if (!script && obj.script && typeof obj.script === 'object' && !Array.isArray(obj.script)) {
    const parts: string[] = []
    for (const [k, v] of Object.entries(obj.script as Record<string, unknown>)) {
      const label = k.replace(/[_\-\s]+/g, ' ').trim().toUpperCase()
      let text = ''
      if (typeof v === 'string') {
        text = v
      } else if (Array.isArray(v)) {
        text = v
          .map((item) =>
            typeof item === 'string'
              ? item
              : item && typeof item === 'object'
                ? Object.values(item as Record<string, unknown>)
                    .filter((x): x is string | number => typeof x === 'string' || typeof x === 'number')
                    .join(': ')
                : '',
          )
          .filter(Boolean)
          .join('\n')
      } else if (typeof v === 'number') {
        text = String(v)
      }
      if (label && text.trim()) parts.push(`[${label}]\n${text.trim()}`)
    }
    if (parts.length > 0) {
      console.warn('[generateScript] script field was an object - flattened to bracket sections.')
      script = parts.join('\n\n')
    }
  }

  if (!script) {
    const keys = Object.keys(obj).slice(0, 10).join(', ')
    const snippet = content.length > 300 ? `${content.slice(0, 200)}...${content.slice(-100)}` : content
    console.warn(
      `[generateScript] script field missing. Top-level keys returned: [${keys}]. Snippet:`,
      snippet,
    )
    throw new Error(`Script output had no script field (keys: ${keys})`)
  }

  // The model occasionally embeds its checklist INSIDE the script string as
  // a trailing "[CHECKLIST] {...}" section (one shipped to a live carousel
  // and would have printed raw JSON into the export doc). The checklist is
  // parsed from its own JSON field - anything after a [CHECKLIST] label in
  // the script body is garbage. Cut it.
  script = script.replace(/\n?\s*\[CHECKLIST\][\s\S]*$/i, '').trim()
  if (!script) {
    throw new Error('Script output was only a checklist - no script content')
  }

  // Checklist might also live under a couple of variants.
  let checklistRaw: unknown[] = []
  for (const key of ['checklist', 'checklist_items', 'qa']) {
    const v = obj[key]
    if (Array.isArray(v)) {
      checklistRaw = v
      break
    }
  }
  return { script, checklist: checklistRaw as unknown as ChecklistItem[] }
}

/** True when the script has a [CAPTION] section with non-empty content. */
function scriptHasCaption(script: string): boolean {
  const m = script.match(/\[CAPTION\][^\n]*((?:\n(?!\[[A-Z])[^\n]*)*)/i)
  return !!m && m[1].trim().length > 0
}

/** Insert (or fill an empty) [CAPTION] section, before [HASHTAGS] when present. */
function spliceCaption(script: string, caption: string): string {
  const block = `[CAPTION]\n${caption.trim()}`
  // Fill an existing (empty) [CAPTION] label in place.
  if (/\[CAPTION\]/i.test(script)) {
    return script.replace(/\[CAPTION\][^\n]*(?:\n(?!\[[A-Z])[^\n]*)*/i, block)
  }
  // Otherwise insert before [HASHTAGS].
  const hashMatch = script.match(/\n?\[HASHTAGS\]/i)
  if (hashMatch && hashMatch.index !== undefined) {
    const i = hashMatch.index
    return `${script.slice(0, i).trimEnd()}\n\n${block}\n\n${script.slice(i).replace(/^\n+/, '')}`
  }
  return `${script.trimEnd()}\n\n${block}`
}

/** Targeted caption generation for a finished non-long-form script. Used only
 *  as a repair when the main generation dropped the [CAPTION] section. */
async function generateCaptionForScript(opts: {
  script: string
  stream: SlotStream
  brandName: string | null
  clientId: string
}): Promise<string | null> {
  const lengthHint =
    opts.stream === 'carousel'
      ? 'A 40-80 word caption that complements the carousel and teaches the takeaway.'
      : 'A 60-120 word caption that TEACHES the takeaway. Do NOT describe the video.'
  const system = `You write the Instagram/TikTok post CAPTION for a finished ${opts.stream.replace('_', ' ')} script.${opts.brandName ? ` Brand: ${opts.brandName}.` : ''}
- ${lengthHint}
- Plain prose. No hashtags, no "link in bio".
- No AI tells, no em dashes, no "the truth about", no rhetorical-question-then-fragment answers.
- Return ONLY the caption text. No labels, no brackets, no surrounding quotes.`
  const user = `SCRIPT:\n${opts.script}\n\nWrite the caption now.`
  try {
    const result = await generateScript({
      system,
      user,
      temperature: 0.6,
      maxTokens: 400,
      quality: 'standard',
      route: `planner.caption_repair.${opts.stream}`,
      clientId: opts.clientId,
    })
    const text = (result.content || '').trim().replace(/^["'[]+|["'\]]+$/g, '').trim()
    return text.length > 0 ? text : null
  } catch (e) {
    console.warn('[generateScript] caption repair failed:', e)
    return null
  }
}

/** True when the script has a [HASHTAGS] section with at least one tag. */
function scriptHasHashtags(script: string): boolean {
  const m = script.match(/\[HASHTAGS\][^\n]*((?:\n(?!\[[A-Z])[^\n]*)*)/i)
  if (!m) return false
  return /#\w/.test(`${m[0]}`)
}

/** Insert (or fill an empty) [HASHTAGS] section at the end of the script. */
function spliceHashtags(script: string, hashtags: string): string {
  const block = `[HASHTAGS]\n${hashtags.trim()}`
  if (/\[HASHTAGS\]/i.test(script)) {
    return script.replace(/\[HASHTAGS\][^\n]*(?:\n(?!\[[A-Z])[^\n]*)*/i, block)
  }
  return `${script.trimEnd()}\n\n${block}`
}

/** Targeted hashtag generation, used only when the main generation dropped
 *  the [HASHTAGS] section. Returns a single space-separated line of tags. */
async function generateHashtagsForScript(opts: {
  script: string
  clientId: string
}): Promise<string | null> {
  const system = `You write the hashtag set for a finished Instagram/TikTok post.
- Return 8-14 unique, relevant hashtags on ONE line, space-separated, each starting with #.
- Mix broad and niche tags drawn from the script's topic. No banned/spammy tags, no duplicates.
- Return ONLY the hashtag line. No labels, no brackets, no commentary.`
  const user = `SCRIPT:\n${opts.script}\n\nWrite the hashtags now.`
  try {
    const result = await generateScript({
      system,
      user,
      temperature: 0.5,
      maxTokens: 150,
      quality: 'cheap',
      route: 'planner.hashtag_repair',
      clientId: opts.clientId,
    })
    const text = (result.content || '').trim().replace(/^["'[]+|["'\]]+$/g, '').trim()
    return /#\w/.test(text) ? text : null
  } catch (e) {
    console.warn('[generateScript] hashtag repair failed:', e)
    return null
  }
}

/** Pull the HOOK line from each saved script in `client + same stream`,
 *  excluding the slot we're currently generating for. Returns up to 12
 *  hooks (cap on prompt size). Used as the cross-slot AVOID list so the
 *  AI can't paraphrase another slot's opener. */
async function loadSiblingHooks(opts: {
  clientId: string
  stream: SlotStream
  excludeSlotId: string
}): Promise<string[]> {
  const supabase = plannerAdmin()
  const { data, error } = await supabase
    .from('content_plan_slots')
    .select('id, generation_meta')
    .eq('client_id', opts.clientId)
    .eq('stream', opts.stream)
    .neq('id', opts.excludeSlotId)
  if (error) {
    console.warn('[generateScript] loadSiblingHooks query error:', error.message)
    return []
  }
  const hooks: string[] = []
  for (const row of data ?? []) {
    const meta = row.generation_meta as Record<string, unknown> | null
    if (!meta) continue
    const script = typeof meta.script === 'string' ? meta.script : ''
    const hook = extractHookLine(script)
    const title = extractTitleLine(script)
    // Title + hook together define the sibling's angle AND its vocabulary -
    // both feed the avoid-list so later scripts dodge the phrasing, not
    // just the opening line.
    const combined = [title, hook].filter(Boolean).join(' / ')
    if (combined) hooks.push(combined)
  }
  return hooks
}

/** Pull the [TITLE] line out of a bracket-formatted script. */
function extractTitleLine(script: string): string | null {
  if (!script) return null
  const m = script.match(/\[TITLE\]\s*\n+([^\n\[]+)/i)
  return m && m[1].trim() ? m[1].trim() : null
}

/** Pull the [HOOK] line out of a bracket-formatted script. Falls back to
 *  the first non-empty line if [HOOK] isn't present (long-form scripts
 *  use [TITLE] then prose - no separate HOOK label). */
function extractHookLine(script: string): string | null {
  if (!script) return null
  const hookMatch = script.match(/\[HOOK\]\s*\n+([^\n\[]+)/i)
  if (hookMatch && hookMatch[1].trim()) return hookMatch[1].trim()
  // Fallback: first non-bracket, non-empty line.
  const lines = script.split('\n').map((l) => l.trim())
  for (const line of lines) {
    if (!line) continue
    if (/^\[[A-Z]/.test(line)) continue
    return line
  }
  return null
}

/** Stable string version of the brand profile for cache invalidation.
 *  Anything that changes the prompt should change this string. */
function computeProfileVersion(profile: BrandProfile | null): string {
  if (!profile) return 'none'
  // Cheap hash: JSON length + a few key fields. Not cryptographic - we just
  // need a token that changes when the profile changes.
  try {
    const s = JSON.stringify(profile)
    let hash = 0
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) | 0
    }
    return `v${(hash >>> 0).toString(36)}`
  } catch {
    return 'none'
  }
}

/** Stable, non-cryptographic hash of the assembled system prompt. Folded
 *  into the cache key so any change to framework.ts, format module, or
 *  brand context block auto-invalidates the prior Gemini-side cached
 *  prefix instead of leaving stale content live for the 1-hour TTL. */
function hashSystemPrompt(prompt: string): string {
  let hash = 0
  for (let i = 0; i < prompt.length; i++) {
    hash = (hash * 31 + prompt.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
