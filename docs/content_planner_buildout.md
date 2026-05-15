# Content Planner Buildout - Handoff Document

> **Purpose:** This is a self-contained reference for continuing the content planner build across multiple Claude sessions. Every decision, spec, file path, format definition, and rule lives here. A fresh chat with no prior context should be able to pick up from any point in this doc and continue the build without asking the user clarifying questions.
>
> **Last updated:** End of session 3 (M1 + M2 + M3 complete; ready to start M4).
>
> **Read this top to bottom before doing any work.**
>
> **Current status:**
> - ✅ **M1 (section 9)** complete. All 9 sub-tasks done, type-check clean, byte-identical snapshot test passing (`npx tsx scripts/verify_brand_context.ts`).
> - ✅ **M2 (section 10)** complete. Type-check clean, M1 snapshot still passing.
> - ✅ **M3 (section 11)** complete. All sub-tasks shipped, type-check clean, lint clean on new files, M1 snapshot still passing. See section 11 status block for the file inventory.
> - 🔲 **M4 (section 12)** is the next milestone. Start at section 12.1.
>
> **One deviation to know about (M1 / 9.3):** `src/lib/prompt/external.ts` `brandProfileSummary()` was NOT migrated to `buildBrandContextBlock()`. The doc directed replacing it, but its multi-section labeled output (`--- BUSINESS ---` etc.) is meaningfully different from what the composer would produce, and rewriting it would change the user-visible external-prompt copy-paste output, conflicting with M1's "zero user-visible changes" goal. Defer until M3+ when there's a UX path to absorb the change. Engine.ts and packagePrompt.ts WERE refactored and are byte-identical via `brandContext.ts`.

---

## Table of contents

1. [Quick orientation](#1-quick-orientation)
2. [Project landmarks - DON'T BREAK](#2-project-landmarks--dont-break)
3. [Decisions locked (full ledger)](#3-decisions-locked-full-ledger)
4. [The three "tier" concepts](#4-the-three-tier-concepts)
5. [Pillars + Buckets blend](#5-pillars--buckets-blend)
6. [Voice & UX rules (apply to ALL work)](#6-voice--ux-rules-apply-to-all-work)
7. [Token economy strategy](#7-token-economy-strategy)
8. [End-to-end content flow](#8-end-to-end-content-flow)
9. [M1 - Foundation (status + remaining specs)](#9-m1--foundation-status--remaining-specs)
10. [M2 - Topic + Question Refactor](#10-m2--topic--question-refactor)
11. [M3 - Planner + Calendar + Story Queue + Stage Tracking + Share](#11-m3--planner--calendar--story-queue--stage-tracking--share)
12. [M4 - Per-Format Generators + Checklist](#12-m4--per-format-generators--checklist)
13. [Format library - all 35 definitions](#13-format-library--all-35-definitions)
14. [Planner scoring algorithm (exact)](#14-planner-scoring-algorithm-exact)
15. [Stage advancement criteria (exact)](#15-stage-advancement-criteria-exact)
16. [Coverage targets per stage](#16-coverage-targets-per-stage)
17. [Format-specific QA checklists](#17-format-specific-qa-checklists)
18. [Pre-test checklist (before user burns credits)](#18-pre-test-checklist-before-user-burns-credits)

---

## 1. Quick orientation

**App:** Fokus Kreatives - Next.js 16 (App Router) + Supabase + Tailwind v4 agency CRM and content-generation platform. The agency creates social-media content packages for clients across multiple tiers.

**What we're building:** A *content planner* - a calendar-based system that generates a month's worth of content slots across multiple streams (long-form video, short-form/Reels, engagement reels, carousels, IG/FB stories), drives format selection from a per-brand format library with cooldown + coverage logic, and produces scripts on demand from typed raw material extracted via 5-question topic forms.

**Key user persona:** Agency staff (admin, manager, employee) creating content for client brands. Each brand has a `package_tier` (top/middle/lower) that drives how much content they get per month.

**Key technical anchors already in place:**
- Gemini API (primary) + Groq (fallback) - `src/lib/ai/provider.ts`
- Three quality tiers in code: `high` (Gemini Pro), `standard` (Flash), `cheap` (Flash-Lite)
- Brand profile schema with rich voice + audience fields (`src/components/clients/brandProfile.ts`)
- Existing prompt framework with EVR + 2-1-3-4 method + 100+ HARD_BANS (`src/lib/prompt/engine.ts` + `framework.ts` + `packagePrompt.ts`)
- Existing `campaigns` + ClickUp flow that creates tasks per package - **DO NOT REPLACE THIS**
- Existing `/api/generate` route used for ad-hoc scripts, competitor research, prompt building - **DO NOT REPLACE THIS**

---

## 2. Project landmarks - DON'T BREAK

| File / system | Status | Note |
|---|---|---|
| `src/lib/ai/provider.ts` | KEEP, EXTEND | Add caching + usage-log wrapping. Don't change retry / fallback logic. |
| `src/lib/prompt/engine.ts` | KEEP, EXTEND | Append new HARD_BANS + REPAIR_REGEX. Refactor brand-profile renderers to call shared brandContext. |
| `src/lib/prompt/packagePrompt.ts` | KEEP, REFACTOR | Same - call shared brandContext. Behavior must be byte-identical post-refactor (snapshot test). |
| `src/lib/prompt/external.ts` | KEEP, REFACTOR | Same. |
| `src/lib/prompt/framework.ts` | KEEP, EXTEND | New "conversation with friends" voice block + appended bans. |
| `src/app/api/generate/route.ts` | KEEP AS-IS | Used for ad-hoc generation, competitor research, prompt building. The planner adds NEW endpoints; both share a `generateContent()` core in lib/ where useful. |
| `src/app/api/scripts/package/longform/route.ts` | KEEP AS-IS | Long-form generation stays exactly as it is. The planner reads from it; doesn't modify it. |
| `src/app/api/scripts/package/{carousel,reel,story}/route.ts` | KEEP AS-IS in M1-M3, REPLACE in M4 | These are rule-based today. M4 replaces them with format-module-driven generators. |
| `src/lib/campaignTiers.ts` | KEEP AS-IS | Per-tier deliverable counts. Read-only reference for planner. |
| `src/app/api/campaigns/route.ts` | KEEP AS-IS | Creates ClickUp tasks. Planner triggers task creation through this on slot approval. |
| `src/app/api/clickup/helpers.ts` | KEEP AS-IS | ClickUp wiring. Untouched. |
| `src/app/api/question-form/generate/route.ts` | EXTEND in M2 | Today: flat N questions. M2: 5-question topics with input-type progression. |
| `src/app/api/question-form/submit/route.ts` | EXTEND in M2 | Today: one-shot submit. M2: editable, with thin-answer detection. |
| `src/app/api/series-form/*` | KEEP AS-IS | Series is its own pillar/flow, out of planner scope. |
| `topics` table | EXTEND | M1 migration adds: `input_type`, `thin_flag`, `topic_group_id`, `group_position`. |

**Voice / brand profile fields that already flow into prompts:**
- `profile.voice.profanity_level` - used; controls cursing in scripts
- `profile.voice.signature_phrases` / `forbidden_words` / `banned_phrases` - used
- `profile.voice.address_audience_as`, `casualness`, `funny`, `enthusiastic`, `emotional`, `irreverent`, `uses_jargon`, `shares_personal_stories`, `traits` - all used
- `profile.audience.*` - used (work_roles, desires, pain_points, fears, objections, etc.)
- `profile.content_strategy.myths` / `hot_takes` / `evergreen_topics` - used

**Re-using these in M3+: ALWAYS via the new `buildBrandContextBlock()` (M1 deliverable).** Do not duplicate the rendering logic.

---

## 3. Decisions locked (full ledger)

Every decision made across the planning sessions, in numerical order. Treat as authoritative.

| # | Decision |
|---|---|
| 1 | 19 short-form formats: Kallaway 10 (Hero's Journey, Personal Learning, About Me, Before & After, Goal/Dream Journey, Challenge, Win, Day In The Life, Personal Update, Lesson From Others) + 9 new (This vs That, Ranking, Hot Take, Myth Bust, Listicle, How-To, Q&A, Reaction, Behind the Scenes). |
| 2 | 6 engagement reel formats (Poll Reel, Debate Starter, Spicy Question, Tier-list bait, Defend This Take, Hero's Journey text-only). All text-on-screen, no voiceover, no narration. |
| 3 | 5 carousel formats (Framework, List, Story, Hero's Journey, Personal Learning). 5-8 slides variable; AI picks based on material. |
| 4 | 5 story formats (Proof Drop, Day Moment, Behind the Curtain, Question for Audience, Vulnerable Share). Stories = Instagram/Facebook stories (24-hr ephemeral). |
| 5 | Mad-libs are spoken-cadence references, NEVER colon-led labels. AI is told to use them as rhythm, not fill-in-the-blank. |
| 6 | "Conversation with friends" voice rule encoded as concrete instructions in framework.ts (write like coffee chat, no greetings unless brand opens with greetings, no labels-with-colons, contractions always, fragments OK, vary length violently, asides like "anyway"/"honestly"/"look" allowed). |
| 7 | Per-format length targets, hard cap at 60s for short-form/reels, AI told to aim for the lower bound when material lands. Carousel: 5-8 slides. Stories: 1-4 frames. |
| 8 | 4 buckets: storytelling / educational / opinion / proof_community. |
| 9 | 3 content stages: foundation / growing / established. Distinct from package_tier and engine.ts Tier (see [Section 4](#4-the-three-tier-concepts)). |
| 10 | Coverage targets per stage: Foundation 55/25/10/10, Growing 35/30/20/15, Established 25/35/25/15 (storytelling/educational/opinion/proof_community). |
| 11 | Stage advancement triggered by **foundation saturation**, not post count. (See [Section 15](#15-stage-advancement-criteria-exact).) |
| 12 | Stage advancement is auto-PROPOSED, manually CONFIRMED by admin/manager. Notification + optional email fires to all team members assigned to that client when a proposal is created. |
| 13 | Content stage shown on brand profile page with progress toward next stage ("3 of 4 advancement criteria met"). |
| 14 | All targets, cooldowns, length bounds editable per-brand in `brand_content_settings` (overriding stage defaults when set). |
| 15 | View-only share link: revocable, 90-day expiry, no email gate, hides planner internals (no scoring math, no "why this format" rationale, no cooldown state). |
| 16 | Topic stays 5-question, but each question is tagged for the **input type** it extracts (scene / failed_attempt / turning_point / framework / proof) - typed raw material pool. Plus optional types: opinion, named_mentor, win_moment for richer tagging. |
| 17 | The 5-question arc IS Hero's Journey by accident - that's a feature, not a coincidence. Long-form pulls all 5 in natural order. |
| 18 | Short-form planner pulls from the **cross-topic** raw material pool, not per-topic. Format picked first, then best-fitting material across all topics. This is the correct shape - see [Section 5](#5-pillars--buckets-blend) and [Section 14](#14-planner-scoring-algorithm-exact). |
| 19 | Long-form stays single-topic, uses the 5 typed answers in their natural order. Structure unchanged. |
| 20 | Planner produces a horizon plan based on package cadence (Top 20 short-forms/mo, Middle 8/mo, Lower 5/mo, etc.). Default 1 month, max 3 months. |
| 21 | Planner stores: format pick, raw-material reference, scoring breakdown (internal), status (planned/drafted/approved), date. NO posting state - "approved" is the terminal state and consumes the raw material. |
| 22 | Posting log feeds back into the planner state for next round. |
| 23 | Each script ships with a format-specific QA checklist; approval gated on it. (See [Section 17](#17-format-specific-qa-checklists).) |
| 24 | Profanity uses existing `profile.voice.profanity_level`; no new flag. |
| 25 | All brand profile voice + audience fields flow into every format prompt via single `buildBrandContextBlock()` injector - consolidating today's drift across 3 different renderers. |
| 26 | Horizon = 1 month of slots at the client's package cadence. "Extend" button for 2/3-month view. |
| 27 | Two-phase generation: planner produces slot metadata only (cheap); full scripts generated on demand per slot (expensive). |
| 28 | Tier-based model selection. Long-form = `high` (Pro). Short-form scripts = `standard` (Flash). Story prompts, planner scoring, checklists, hooks = `cheap` (Flash-Lite). |
| 29 | Gemini context caching used for the framework + format module + brand profile context block (cache prefix). |
| 30 | Skip regeneration when inputs unchanged (hash format+material+profile_version). |
| 31 | Per-brand monthly token budget with warning + soft block (default tied to tier; configurable per brand). |
| 32 | Story queue UX: auto-refill below threshold + manual "+" button + seed-input option + promote-to-date. |
| 33 | Topic generation cadence is tier-aware (Top 4/wk, Middle 1-2/wk, Lower 1/2wk). |
| 34 | Thin-answer detection: word count < 25 AND no number/proper-noun/quote = thin. Inline UI nudge during the form. Persists as `thin_flag` on the answer. Client can save anyway (informational, not blocker). |
| 35 | Calendar covers all content streams: long-form, short-form, engagement reels, carousels, stories. Color-coded by type. Mon-Fri default placement, draggable to weekends. |
| 36 | Each content type has its own format library and cadence; planner core (scoring/cooldown/coverage) applies uniformly. |
| 37 | Carousel + story-repurpose dates anchor to long-form drop date; draggable. Long-form is dated in the calendar too. |
| 38 | Stories: prompt queue (un-dated), team pulls reactively. Counter on calendar. Hybrid: any prompt can be promoted to a dated slot. |
| 39 | Engagement reels: separate ~6-format library focused on comment-provocation, text-only, no voiceover. |
| 40 | Carousels: ~5-format library, 5-8 slides variable. |
| 41 | Long-form: 1 format, lives on calendar, picks from topic queue. |
| 42 | Mid-month package change: leave current month's plan, apply new cadence next month. |
| 43 | Generation defaults to Mon-Fri only; slots draggable to any day. |
| 44 | Checklist waivers: admin/manager AND employees can waive. Logged with user_id + reason. |
| 45 | Quote Cards + Text Posts NOT in v1 - flag for later add-on. |
| 46 | Calendar = CONTENT CALENDAR, not posting platform - no third-party integrations in v1. |
| 47 | Hard cap at 60s for short-form lengths, no spillover. If material can't fit, it's a long-form. |
| 48 | Pillars + Buckets coexist. Pillar = voice routing. Bucket = coverage math. (See [Section 5](#5-pillars--buckets-blend).) |
| 49 | `/api/generate` kept; planner adds new endpoints; both share `generateContent()` core where useful. |
| 50 | Campaigns + ClickUp untouched. Planner approval optionally triggers existing campaign task creation. |
| 51 | Series + doubledown stay user-initiated, out of planner scope. |
| 52 | Question form re-editable by client (revisit → update existing answers). Staff-side answer viewer in M2. |
| 53 | M3 UI: no AI tells in copy or layout, draws from `awesome-design-md-main/design-md/` references (Linear / Cal / Notion / Figma). |
| 54 | In-app confirm modals only, never browser confirm. |
| 55 | Maintain popup/modal sizes consistent with current app. |
| 56 | Light + dark mode parity for every new surface. |
| 57 | NO em-dashes anywhere (code, copy, scripts, comments). |
| 58 | Build path: M1 → M2 → M3 → M4 in sequence, fresh chats per milestone (this handoff doc). One big test pass after M3 (no AI credits burned), final test after M4. |

---

## 4. The three "tier" concepts

Critical to keep straight. They're three different things that all use "tier"-like words.

| Concept | Values | Where stored | Purpose |
|---|---|---|---|
| `clients.package_tier` | `top`, `middle`, `lower` | Column on `clients` table | Subscription level. Drives campaign cadence + per-month deliverable counts. Existing system. |
| Engine `Tier` | `beginner`, `mid`, `advanced` | Code-only enum in `src/lib/prompt/engine.ts` | Voice tier inside the prompt framework. Drives pillar gating and voice register inside scripts. Existing system. |
| `content_stage_state.current_stage` | `foundation`, `growing`, `established` | Table created in M1 | Where the brand is in their content roll-out. Drives planner coverage targets. NEW. |

**Don't conflate them. A brand can be `package_tier=top` (paying for top-tier service), engine `tier=beginner` (still building voice), and `content_stage=foundation` (still posting introductory content). All three are independent.**

---

## 5. Pillars + Buckets blend

| Concept | Values | Drives |
|---|---|---|
| **Pillar** | educational, storytelling, authority, series, doubledown | Voice routing inside the AI prompt. `pillarBlock()` in engine.ts. Existing. |
| **Bucket** | storytelling, educational, opinion, proof_community | Coverage targets in the planner. NEW. |

Each format in `content_formats` has both:
- `pillar` (nullable text, maps to engine.ts pillar) - for voice routing during script generation
- `bucket` (enum, NOT NULL) - for coverage math in the planner

**They're not the same thing.** Format "Hot Take" has pillar=`authority` (or null) and bucket=`opinion`. Format "About Me" has pillar=`storytelling` and bucket=`storytelling`. Format "How-To" has pillar=`educational` and bucket=`educational`.

**Series + doubledown pillars stay first-class but are out of planner scope.** They're user-initiated flows (staff explicitly picks a series or doubledown). The planner produces regular cadence content; series/doubledown are out-of-band.

---

## 6. Voice & UX rules (apply to ALL work)

### Code & UI

- **No em-dashes anywhere** (`-` and `-`). Plain hyphens in compound modifiers (`5-part`, `lead-generating`) are fine.
- **In-app confirm modals only.** Never use `window.confirm()` or any browser-native dialog. Match the existing app's modal pattern.
- **Maintain popup/modal sizes** consistent with current app (the user has called this out specifically - don't introduce new sizes).
- **Light + dark mode parity.** Every new surface must work cleanly in both themes. The existing CSS variables are: `--bg-primary`, `--bg-card`, `--bg-card-hover`, `--bg-secondary`, `--bg-tertiary`, `--bg-input`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--border-primary`. Brand accent is `#2B79F7`.
- **No AI-generated boilerplate in UI copy.** Don't write labels like "Streamline your workflow" or "Powerful insights at your fingertips." Concrete verbs only ("Generate plan", "Add prompt", "Lock slot").
- **UI design references:** `awesome-design-md-main/design-md/` has style guides for Linear, Cal, Notion, Figma, etc. Use them when designing the planner UI in M3 - task-list density (Linear), calendar grid interactions (Cal), inline editability (Notion), drag-and-drop (Figma). The user explicitly does NOT want generic AI dashboard styling.

### Script content rules (the AI's output)

These are appended to the existing `HARD_BANS` and `framework.ts` rules in M1:

**Bans (extend existing list):**
- Colon-led labels in spoken lines: `"What I learned: …"`, `"What's actually happening: …"`, `"Here's why: …"`, `"What they miss: …"`, `"The bigger lesson: …"`, `"What they should have said: …"`, `"The takeaway: …"`. State the thing directly instead.
- Preambles before the final list item: `"And the last one is the one most people miss"`, `"Saving the best for last"`. Just say the item.
- Generic friendly openers: `"Hey friend"`, `"Listen up"`, `"Let me tell you"`, `"Let me share"`. Skip the throat-clearing.

**Positive guidance (add to framework.ts):**
> Write the way you'd say it to a friend over coffee. Use the words you'd actually use out loud, not writerly upgrades of those words. Personal asides like "anyway", "honestly", "look", "so" are fine inside sentences (not as standalone transitions). "You" not "one." "I" not "we" unless the brand is a team. No greetings unless the brand actually opens with greetings. Cursing allowed only if `profile.voice.profanity_level` is `light`, `medium`, or `high`.

### Mad-libs in the format library

**CRITICAL.** When writing the 35 format definitions ([Section 13](#13-format-library--all-35-definitions)), every mad-lib line must read as spoken phrasing, NOT as a colon-led label. Examples of the rewrite pattern:

| ❌ Wrong (colon-led label) | ✅ Right (spoken) |
|---|---|
| "What I learned: [takeaway]." | "[Takeaway]. That's what stuck with me." |
| "Here's why: [reason]." | "[Reason]." or "Because [reason]." |
| "What they miss: [factor]." | "They forget [factor]." |
| "And the last one is the one most people miss: [item]." | "Number [N] - most people skip this. [Item]." |
| "The bigger lesson: [insight]." | "The bigger lesson is [insight]." |

The Kallaway 10 the user pasted contained colon-led labels. **Rewrite them to spoken phrasing when writing the seed.** Do NOT preserve the original phrasing where it conflicts with these rules.

---

## 7. Token economy strategy

The user is paying for Gemini API tokens. We MUST minimize burn. Rules:

### 1. Two-phase generation (THE most important rule)
- **Phase A - planner output is metadata only.** Format pick, raw-material reference, ~30-token hook preview. No full script. Cheap. ~Flash-Lite.
- **Phase B - full scripts on demand per slot.** When a team member clicks "Generate script," the full script + checklist generates in one call. One slot = one call.

### 2. Tier-based model selection
- **`high` (Gemini Pro)** - long-form scripts only. Quality matters most for the anchor.
- **`standard` (Flash)** - short-form scripts, engagement reels, carousels.
- **`cheap` (Flash-Lite)** - story prompts, planner scoring, checklist auto-checks, hook generation, plan rationale, thin-answer review.

### 3. Gemini context caching
The framework + format module + brand profile context block is the cacheable prefix. The raw material + slot-specific instructions are the uncached tail.

Implementation in M1: `src/lib/ai/contextCache.ts`. Default TTL 1 hour. Cache key includes brand profile version (when profile updates, cache invalidates).

Without caching, every call re-tokenizes the full framework + bans + voice fingerprint. With caching, those tokens are billed at ~25% the input rate.

### 4. Skip regeneration when inputs unchanged
Hash `(format_id + raw_material_signature + brand_profile_version)`. If a slot is regenerated and the hash hasn't changed, return the cached output. Brand profile version invalidates only that brand's cached outputs.

### 5. Per-brand monthly token budget
Stored in `brand_content_settings.monthly_token_budget`. Warn at `monthly_token_warn_at`. Hitting the cap surfaces a warning banner and soft-blocks new generation until manually overridden by admin.

### 6. Question generation = one call for all 5
The 5 questions per topic generate in a single API call returning structured JSON, not 5 separate calls. Same for batch topic generation.

---

## 8. End-to-end content flow

The full lifecycle a brand goes through. Each phase is a milestone-aware feature.

### Phase 1 - Topic + Question Generation (staff weekly)
**Cadence by package_tier:**
- Top: 4 topics/week (~16 topics/month, ~80 raw answers feeds 84 monthly pieces)
- Middle: 1-2 topics/week (~4-6 topics/month, ~20-30 answers for 26 pieces)
- Lower: 1 topic every 2 weeks (~2 topics/month, ~10 answers for 16 pieces)

**Each topic = 5 questions** with locked input-type progression:
1. **Scene/Origin** → input_type=`scene`
2. **Failed attempt or mistake** → input_type=`failed_attempt`
3. **Turning point or insight** → input_type=`turning_point`
4. **Method or framework** → input_type=`framework`
5. **Proof or outcome** → input_type=`proof`

AI generates batch in one call (Flash-Lite). Staff reviews, edits, swaps individual questions. Approves → question form link generated, sent to client.

### Phase 2 - Client Answers
- Form opens with topics' 20 questions (4 topics × 5).
- **Real-time thin-answer detection:** when the client tabs out of an answer field, JS checks: word count < 25 AND no number / no proper noun / no quoted phrase. If thin, inline prompt nudges them. Client can save anyway, but `thin_flag` persists.
- **Client can return and edit** their answers later (form is editable, not one-shot).
- Answers stored with input_type tag + thin_flag. One row per answer in the existing `topics` table, with `topic_group_id` linking the 5 answers from the same topic.

### Phase 3 - Plan Generation (staff monthly)
- Once enough topics have answers, staff clicks "Generate this month's plan."
- Planner reads: package_tier (cadence + quantities), content_stage (coverage targets), available raw material, posting log.
- Produces slot metadata for each stream: long-form, short-form, engagement reels, carousels. Refills story queue if Top tier.
- Each slot has format pick, raw-material reference, hook preview - **no full script yet**.
- Calendar shows all streams overlaid, color-coded. Mon-Fri default placement, draggable.
- Staff reviews calendar - edit, lock, swap, regenerate slots.
- View-only share link can be generated and shared with the client.

### Phase 4 - Script Generation (per slot, on demand)
- Click slot → "Generate script."
- Format module + raw material + brand profile → script + checklist in one call.
- Script: full text. Checklist: structured JSON, format-specific, AI pre-checks what it can.
- Staff edits script, resolves or waives flags (any user with edit access can waive; logged with reason).
- Click "Approve" → status = approved → **slot marked used (raw material consumed).** No "posted" state - approval is terminal.

### Phase 5 - Story Queue (Top tier only, ongoing)
- Sidebar panel with 5-10 prompt cards.
- "+" generates one prompt (auto pick) OR with seed input.
- Auto-refill below threshold (e.g., < 5 cards).
- "Use" marks consumed, planner refills.
- Any prompt can be promoted to a dated calendar slot.

### Hand-off to existing campaigns
- When a slot is approved, an adapter triggers task creation through the existing `/api/campaigns` flow so ClickUp tasks still get created.
- Existing campaigns flow is **not modified** - just called from the new approval action.

---

## 9. M1 - Foundation (status + remaining specs)

Goal: zero user-visible changes. All foundation pieces in place so M2/M3/M4 can be built without rework.

### Status

✅ **All M1 sub-tasks complete (end of session 2).** Type-check clean, snapshot verifier passing.

✅ Done in session 1 (migrations only):
- `sql/migrations/20260505_content_formats.sql` - format library table
- `sql/migrations/20260505_brand_content_settings.sql` - per-brand overrides
- `sql/migrations/20260505_content_stage_state.sql` - stage tracking
- `sql/migrations/20260505_ai_usage_log.sql` - token tracking
- `sql/migrations/20260505_topics_input_type.sql` - topics extension

✅ Done in session 2:
- `sql/seeds/content_formats_seed.sql` - 35 INSERTs (19 short_form / 6 engagement_reel / 5 carousel / 5 story), idempotent via `ON CONFLICT (slug) DO UPDATE`
- `src/lib/contentFormats/{types,index,promptBlock}.ts`
- `src/lib/prompt/brandContext.ts` + engine.ts/packagePrompt.ts refactor (external.ts deferred — see deviation note at top of doc)
- `src/lib/ai/{pricing,usage,contextCache}.ts`
- `src/lib/ai/provider.ts` updates (cachedContextName, route, clientId, userId, usageMeta; usage logging on success and failure)
- HARD_BANS + REPAIR_REGEX additions in engine.ts; framework.ts FRAMEWORK_CORE DO NOT additions
- `scripts/verify_brand_context.ts` (snapshot diff, PASSING) and `scripts/validate_content_formats.ts`

🔲 **(historical) Specs that were remaining in M1:**

### 9.1 Format library seed

**File:** `sql/seeds/content_formats_seed.sql`

35 INSERT statements, one per format. Use the definitions in [Section 13](#13-format-library--all-35-definitions) verbatim.

Schema reminder (from migration):
```
id, slug, content_type, name, description, starting_point,
strategy_beats (jsonb), secret_sauce, mad_libs (jsonb),
gating_rule, pillar (nullable), bucket, target_length_min,
target_length_max, cooldown_posts, is_active, sort_order
```

`strategy_beats` shape: `[{ "label": "HOOK", "description": "..." }, ...]`

`mad_libs` shape: `[{ "beat": "HOOK", "lines": ["...", "..."] }, ...]`

Slug naming: `<content_type>.<snake_case_name>`, e.g. `short_form.heros_journey`, `engagement_reel.poll_reel`, `carousel.framework_carousel`, `story.proof_drop`.

After writing the seed, validate by counting: should be 19 short_form + 6 engagement_reel + 5 carousel + 5 story = **35 rows.**

### 9.2 contentFormats library

**Files:**
- `src/lib/contentFormats/types.ts`
- `src/lib/contentFormats/index.ts`
- `src/lib/contentFormats/promptBlock.ts`

**`types.ts`** - exports:
```typescript
export type ContentFormatType = 'short_form' | 'engagement_reel' | 'carousel' | 'story'
export type ContentBucket = 'storytelling' | 'educational' | 'opinion' | 'proof_community'
export type ContentPillar = 'educational' | 'storytelling' | 'authority' | 'series' | 'doubledown'

export interface FormatBeat { label: string; description: string }
export interface FormatMadLib { beat: string; lines: string[] }

export interface ContentFormat {
  id: string
  slug: string
  content_type: ContentFormatType
  name: string
  description: string
  starting_point: string
  strategy_beats: FormatBeat[]
  secret_sauce: string
  mad_libs: FormatMadLib[]
  gating_rule: string
  pillar: ContentPillar | null
  bucket: ContentBucket
  target_length_min: number | null
  target_length_max: number | null
  cooldown_posts: number
  is_active: boolean
  sort_order: number
}
```

**`index.ts`** - exports:
```typescript
export async function getFormatBySlug(slug: string): Promise<ContentFormat | null>
export async function getFormatById(id: string): Promise<ContentFormat | null>
export async function listFormats(filter?: {
  content_type?: ContentFormatType
  bucket?: ContentBucket
  is_active?: boolean
}): Promise<ContentFormat[]>
```

Implementation: queries `public.content_formats` via the existing `supabaseAdmin()` pattern used in other lib files. Order results by `sort_order, name`.

**`promptBlock.ts`** - exports:
```typescript
export function buildFormatPromptBlock(format: ContentFormat): string
```

Returns the format's structure + secret_sauce + mad_libs as a system-prompt-ready text block for the AI. Format:

```
FORMAT: [name]
DESCRIPTION: [description]

STARTING POINT (this format only works if the raw material has): [starting_point]

STRUCTURE (write the script in this order):
- [beat 1 label] - [beat 1 description]
- [beat 2 label] - [beat 2 description]
...

SECRET SAUCE (the rule that makes this format land):
[secret_sauce]

CADENCE REFERENCES (these are RHYTHM hints, NEVER copy them verbatim. The AI tells you these patterns to MATCH, not to fill in like mad-libs):

[for each mad_lib]:
For [beat]:
- [line 1]
- [line 2]

GATING / SKIP CONDITION:
[gating_rule]
```

### 9.3 brandContext.ts (consolidation)

**File:** `src/lib/prompt/brandContext.ts`

Current state: 3 different functions render the brand profile across `engine.ts`, `packagePrompt.ts`, `external.ts`, with intentional drift. Consolidate into one composable module.

**Existing (DO NOT REMOVE YET, refactor TO call this):**

In `engine.ts`:
- `voiceFingerprint(profile)` - full voice line with profanity, personal_stories, all dials
- `voiceSamples(profile)` - VOICE SAMPLES block
- `commonEnemyLine(profile, tier)` - COMMON ENEMY block (tier-aware framing)
- `bansBlock(profile)` - BANNED list (HARD_BANS + custom)
- `tierVoiceBlock(tier)` - TIER block
- `pillarBlock(pillar, tier, seriesDay)` - PILLAR block
- `businessBlock(profile)` - CLIENT CONTEXT (mission, problem, diff, offer, audience, desires, objections, tried_failed)
- `ammoBlock(profile)` - AMMO (pain points, myths, hot takes, evergreen)

In `packagePrompt.ts`:
- `voiceLine(profile)` - shorter voice line (no profanity, no personal_stories)
- `clientLine(profile)` - shorter CLIENT CONTEXT (no objections, no tried_failed, no fears)

In `external.ts`:
- `brandProfileSummary(profile)` - full profile dump for external AI

**New API in `brandContext.ts`:**

```typescript
import type { BrandProfile } from '@/components/clients/brandProfile'

export interface BrandContextOptions {
  /** 'light' = packagePrompt-style (no profanity, no personal_stories). 'full' = engine.ts-style (everything). */
  voiceMode?: 'light' | 'full'
  /** 'minimal' = packagePrompt-style (mission/problem/diff/offer/audience/desires). 'extended' = engine.ts-style (+objections, tried_failed). */
  clientMode?: 'minimal' | 'extended'
  includeVoiceSamples?: boolean      // default false
  includeAmmo?: boolean               // default false
  includeCommonEnemy?: boolean        // default false (caller passes tier separately)
  includeBans?: boolean               // default true
  /** Required if includeCommonEnemy=true. */
  tierForEnemy?: 'beginner' | 'mid' | 'advanced'
}

export function buildBrandContextBlock(
  profile: BrandProfile | null,
  opts?: BrandContextOptions
): string
```

Returns a multi-section text block with whichever sections were requested, separated by `\n\n`.

**Each section function exported individually** so callers can compose differently if needed:
```typescript
export function voiceFingerprintLine(profile: BrandProfile | null, mode: 'light' | 'full'): string
export function voiceSamplesBlock(profile: BrandProfile | null): string
export function clientContextBlock(profile: BrandProfile | null, mode: 'minimal' | 'extended'): string
export function ammoBlock(profile: BrandProfile | null): string
export function commonEnemyLine(profile: BrandProfile | null, tier: 'beginner' | 'mid' | 'advanced'): string
export function bansBlock(profile: BrandProfile | null, extraBans?: string[]): string
export function deriveCommonEnemy(profile: BrandProfile | null): string  // for tests
```

**Refactor in same M1 task:**
- `engine.ts`: replace inline `voiceFingerprint`/`voiceSamples`/`commonEnemyLine`/`bansBlock`/`businessBlock`/`ammoBlock` with calls to brandContext exports. Behavior must be byte-identical (snapshot test catches drift).
- `packagePrompt.ts`: replace `voiceLine`/`clientLine` with `voiceFingerprintLine(profile, 'light')` + `clientContextBlock(profile, 'minimal')`.
- `external.ts`: replace `brandProfileSummary` with `buildBrandContextBlock(profile, { voiceMode: 'full', clientMode: 'extended', includeAmmo: true, includeBans: true, includeVoiceSamples: true })`.

**Critical:** snapshot tests (Section 9.7) must show byte-identical output for the same inputs after refactor.

### 9.4 ai/pricing.ts + ai/usage.ts

**File:** `src/lib/ai/pricing.ts`

```typescript
export interface ModelPricing {
  inputPerMillion: number   // USD per 1M input tokens
  outputPerMillion: number  // USD per 1M output tokens
  cachedInputPerMillion?: number  // USD per 1M cached input tokens (Gemini ~25% of normal)
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.00, cachedInputPerMillion: 0.3125 },
  'gemini-2.5-flash': { inputPerMillion: 0.30, outputPerMillion: 2.50, cachedInputPerMillion: 0.075 },
  'gemini-2.5-flash-lite': { inputPerMillion: 0.10, outputPerMillion: 0.40, cachedInputPerMillion: 0.025 },
  'llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 }, // Groq
}

export function estimateCost(
  model: string,
  input: number | null,
  output: number | null,
  cached?: number | null
): number | null
```

**File:** `src/lib/ai/usage.ts`

```typescript
export interface UsageLogInput {
  clientId?: string | null
  userId?: string | null
  route: string
  provider: 'gemini' | 'groq'
  model: string
  quality: 'high' | 'standard' | 'cheap'
  inputTokens?: number | null
  outputTokens?: number | null
  cachedTokens?: number | null
  success: boolean
  errorCode?: string | null
  durationMs: number
  meta?: Record<string, unknown>
}

export async function logAIUsage(input: UsageLogInput): Promise<void>

/** Returns (used_tokens, budget, warn_at) for current calendar month. */
export async function getMonthlyUsage(clientId: string): Promise<{
  used: number
  budget: number | null
  warnAt: number | null
}>
```

`logAIUsage()` writes to `ai_usage_log` table. Uses `estimateCost()` from pricing.ts. Failure to log should NEVER fail the parent generation - wrap in try/catch and console.error.

### 9.5 ai/contextCache.ts (Gemini context caching)

**File:** `src/lib/ai/contextCache.ts`

Gemini supports `cachedContents` API for reusing large prompt prefixes. Implement an opt-in path.

```typescript
export interface CachedContextOptions {
  systemInstruction: string  // the text to cache (framework + format + brand profile prefix)
  ttlSeconds?: number         // default 3600 (1 hour)
  displayName?: string        // optional, shown in Gemini console
}

/**
 * Creates or retrieves a cached context. Returns the cache name (e.g.
 * "cachedContents/abc123") that can be passed to generateContent() in lieu of
 * a system_instruction. Returns null on failure - caller falls back to
 * non-cached path.
 */
export async function getOrCreateContextCache(
  cacheKey: string,  // e.g. `brand:${clientId}:v${profileVersion}`
  opts: CachedContextOptions
): Promise<string | null>

export async function deleteContextCache(cacheName: string): Promise<void>

/** Invalidate all caches for a brand (called when profile updates). */
export async function invalidateBrandCaches(clientId: string): Promise<void>
```

Implementation uses the `@google/genai` SDK's `caches.create()` API. Maintains an in-memory map (or Supabase table if persistence needed across deploys) of `cacheKey → cacheName + expiresAt`.

**Decision flag:** for v1, in-memory map is fine. The cache only needs to live for a few minutes within a single planner generation session. If this is too aggressive, add a small `ai_context_caches` table later.

### 9.6 provider.ts updates

**File:** `src/lib/ai/provider.ts`

Add to `GenerateScriptInput`:
```typescript
/** Optional cached context name (from getOrCreateContextCache). When set, the system prompt is served from cache. */
cachedContextName?: string

/** Logical route name for usage logging. e.g. 'planner.script.generate' */
route?: string

/** For usage logging. Optional. */
clientId?: string
userId?: string
```

In `generateScript()`:
- Wrap the call in `Date.now()` start/end for `durationMs`.
- After call (success OR failure), call `logAIUsage()` with all the metadata.
- For Gemini calls, when `cachedContextName` is set, swap `systemInstruction` for `cachedContent` in the request config.
- The response from Gemini SDK includes `usageMetadata.promptTokenCount`, `usageMetadata.candidatesTokenCount`, `usageMetadata.cachedContentTokenCount`. Pass these to logAIUsage.

**Behavior preservation:** existing callers that don't pass `route`/`clientId`/`userId` still work - usage logs just have null fields for those. No new errors, no new exceptions thrown.

### 9.7 New HARD_BANS + REPAIR_REGEX entries

**File:** `src/lib/prompt/engine.ts`

Append to the `HARD_BANS` array:
```typescript
// Colon-led label patterns - state the thing instead.
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
"listen up",
```

Append to the `REPAIR_REGEX` array:
```typescript
// Strip colon-led labels at sentence start - the AI tends to use these as cadence even when the exact phrase isn't in the bans.
{ re: /\bwhat['']?s actually happening\s*[:,]?\s*/gi, replace: "what's happening is " },
{ re: /\bwhat i learned\s*[:,]?\s*/gi, replace: '' },
{ re: /\bthe bigger lesson\s*[:,]?\s*/gi, replace: 'the bigger lesson is ' },
{ re: /\bthe takeaway\s*[:,]?\s*/gi, replace: 'the takeaway is ' },
{ re: /\bwhat they miss\s*[:,]?\s*/gi, replace: 'they forget ' },
{ re: /\bwhat they should have said\s*[:,]?\s*/gi, replace: 'what they should have said is ' },
{ re: /\bhere['']?s why\s*[:,]?\s*/gi, replace: '' },
// "and the last one..." preambles
{ re: /\band the last one is the one most people miss\s*[:,]?\s*/gi, replace: '' },
{ re: /\bsaving the best for last\s*[:,]?\s*/gi, replace: '' },
// Generic friendly openers
{ re: /\b(hey|hi)\s+friends?\s*[,.]?\s*/gi, replace: '' },
{ re: /\blet me (tell|share)(\s+you)?\s*[,.]?\s*/gi, replace: '' },
{ re: /\blisten up\s*[,.]?\s*/gi, replace: '' },
```

**Also append to `framework.ts` SHARED_GUARDRAILS** (or the equivalent voice block):
```
- No colon-led labels in spoken lines: "What I learned: ...", "What's actually happening: ...", "Here's why: ...". Just say the thing.
- No "and the last one is the one most people miss" preamble. State the final item directly.
- Write like you're talking to a friend over coffee. Don't open with "Hey friend" or "Listen up." Start mid-thought.
```

#### 9.7a Stream-aware framework split (added in M4 prep)

`framework.ts` exports three composable framework constants plus a stream-aware selector:

- `FRAMEWORK_BASE` - universals applied to every script (EVR, source rule, vocabulary fidelity, framing fidelity, scroll-stop principle, DO-NOTs that apply across long and short-form). Em-dash rule is RELAXED here: only "X - Y" dramatic-reframe patterns are banned; em-dashes for natural pauses or parenthetical asides are fine.
- `LONGFORM_BUILDOUT` - the 5-step writing process (PACKAGING / OUTLINE / 5-part INTRO / 2-1-3-4 BODY / fortune-cookie OUTRO) plus the NATIVE CTA EMBED rule plus mid-roll CTA placement (embedded inside step 4 BODY between POINT 2 and POINT 3).
- `SHORTFORM_BUILDOUT` - the 8-beat 30-60s structure: `[TITLE] -> [HOOK] -> [REHOOK 1] -> [BODY] -> [CTA] -> [REHOOK 2] -> [CLOSE] -> [RELOOP]`. Length cap 75-180 words. ONE mid-script CTA, no end-CTA. Body uses the format module's strategy_beats in natural order (no 2-1-3-4 reordering). RELOOP optional.

`frameworkBlockForStream(stream)` returns:
- `'long_form'` -> `FRAMEWORK_BASE + LONGFORM_BUILDOUT`
- `'short_form' | 'engagement_reel' | 'carousel' | 'story'` -> `FRAMEWORK_BASE + SHORTFORM_BUILDOUT`

`FRAMEWORK_CORE` is kept as a backward-compat alias = `FRAMEWORK_BASE + LONGFORM_BUILDOUT`. Existing callers (engine.ts `buildPrompt`, external.ts) continue to work; new code should use the stream-aware selector.

`packagePrompt.ts` repurpose paths (carousel / reel / story) now use `FRAMEWORK_BASE + SHORTFORM_BUILDOUT` instead of `FRAMEWORK_CORE` since their output is short-form-shaped.

### 9.8 Snapshot tests

**Files:** `src/lib/prompt/__tests__/brandContext.snapshot.test.ts` (or similar)

Goal: ensure the brandContext refactor doesn't change byte-by-byte output.

Approach:
1. Construct 3 representative brand profiles (minimal, full-featured, edge-case-heavy).
2. For each:
   - Capture output of pre-refactor `voiceFingerprint`/`bansBlock`/`businessBlock`/`ammoBlock` (call them as they exist now).
   - Capture output of new `voiceFingerprintLine`/`bansBlock`/`clientContextBlock`/`ammoBlock` from brandContext.
   - Assert byte-identical.

If running test infra is heavy, save the "before" outputs as `.txt` snapshot files first, then compare the "after" against them.

**Project doesn't have a test framework wired up - confirm with user before adding one.** If no green light, write the snapshot comparison as a one-shot script in `scripts/verify_brand_context.ts` that prints PASS/FAIL on stdout.

### 9.9 Format library validation script

**File:** `scripts/validate_content_formats.ts`

Reads all rows from `content_formats`, validates:
- Every row has non-empty `description`, `starting_point`, `secret_sauce`, `gating_rule`
- `strategy_beats` is a non-empty array of `{ label, description }`
- `mad_libs` is a non-empty array of `{ beat, lines: [string] }`
- `target_length_min` <= `target_length_max` (both null is OK)
- `bucket` is valid enum
- `pillar` if set is a valid enum
- `slug` matches `^<content_type>\\.[a-z_]+$`
- Total count = 35
- Per-content-type counts: short_form=19, engagement_reel=6, carousel=5, story=5

Exits non-zero on any failure with details.

### M1 file inventory (final state)

**New files:**
- `sql/migrations/20260505_content_formats.sql` ✅
- `sql/migrations/20260505_brand_content_settings.sql` ✅
- `sql/migrations/20260505_content_stage_state.sql` ✅
- `sql/migrations/20260505_ai_usage_log.sql` ✅
- `sql/migrations/20260505_topics_input_type.sql` ✅
- `sql/seeds/content_formats_seed.sql` 🔲
- `src/lib/contentFormats/types.ts` 🔲
- `src/lib/contentFormats/index.ts` 🔲
- `src/lib/contentFormats/promptBlock.ts` 🔲
- `src/lib/prompt/brandContext.ts` 🔲
- `src/lib/ai/pricing.ts` 🔲
- `src/lib/ai/usage.ts` 🔲
- `src/lib/ai/contextCache.ts` 🔲
- `scripts/validate_content_formats.ts` 🔲
- `scripts/verify_brand_context.ts` 🔲 (or test file)

**Modified (refactor only, behavior preserved):**
- `src/lib/prompt/engine.ts` - call brandContext, append HARD_BANS + REPAIR_REGEX 🔲
- `src/lib/prompt/packagePrompt.ts` - call brandContext 🔲
- `src/lib/prompt/external.ts` - call brandContext 🔲
- `src/lib/prompt/framework.ts` - append voice rules + bans 🔲
- `src/lib/ai/provider.ts` - cachedContextName param + logAIUsage wrap 🔲

---

## 10. M2 - Topic + Question Refactor

Goal: 5-question topic groups with input-type tagging, real-time thin-answer detection, client-editable forms, staff-side answer viewer.

### Status

✅ **All M2 sub-tasks complete (end of session 2).** Type-check clean. M1 snapshot still passing.

Files shipped:
- `sql/migrations/20260512_question_forms_topics.sql` - adds `topics jsonb` column
- `src/lib/types/questionForm.ts` - new `TopicInputType`, `FormTopicQuestion`, `FormTopic` types; `QuestionForm` carries both legacy `questions` and M2 `topics`
- `src/app/api/question-form/generate/route.ts` - produces 5-question topics in locked input-type order
- `src/app/api/question-form/create/route.ts` - accepts `topics` or legacy `questions`
- `src/app/api/question-form/info/route.ts` - returns prefill (answers + topicAnswers + thinFlags) on revisit via deterministic `topic_group_id`
- `src/app/api/question-form/submit/route.ts` - dual-shape; topic-form revisits delete-then-reinsert by `topic_group_id`; first-submit-only `submitted_at` and notification
- `src/app/api/question-form/answers/route.ts` - returns grouped topic answers with thin-flag per question
- `src/app/questions/[token]/page.tsx` - public form: expandable topic groups, real-time thin-answer detection on blur, revisit pre-fill, "Update Answers" label
- `src/app/questions/[token]/answers/page.tsx` - staff viewer with thin-only filter
- `src/components/dashboard/QuestionsFormEngine.tsx` - rewritten as topic-batch generator with tier-aware default count (top=4, middle=2, lower=1)

Notes for M3+:
- The `topic_group_id` written by submit is a deterministic SHA-256-based UUID derived from `(form.id, topic.id)` so revisits idempotently overwrite. The same helper is duplicated in `info/route.ts` and `answers/route.ts` - consider extracting to a shared lib if it grows further.
- Thin-flag detection runs client-side only (server trusts the flag). Heuristic: `< 25 words AND no number AND no proper noun (excluding sentence start) AND no quoted phrase`.

### 10.1 Update topic generation

**File:** `src/app/api/question-form/generate/route.ts`

Change the system prompt to produce **topics with 5 questions each** instead of a flat list of N questions.

New input shape:
```typescript
{
  clientId: string
  topicCount: number  // e.g., 4 for a Top-tier weekly batch
  // pillars param removed - topic-driven now, pillar derived from input_type per question
}
```

New output shape (returned to staff for review):
```typescript
{
  topics: Array<{
    title: string                    // e.g., "How you stopped chasing clients"
    pillar_hint: string              // best-fit pillar for the topic as a whole
    questions: [
      { input_type: 'scene', text: string, placeholder: string },
      { input_type: 'failed_attempt', text: string, placeholder: string },
      { input_type: 'turning_point', text: string, placeholder: string },
      { input_type: 'framework', text: string, placeholder: string },
      { input_type: 'proof', text: string, placeholder: string },
    ]
  }>
}
```

**Prompt rules:**
- Each topic centers on ONE specific story/transformation/lesson the brand can speak from experience.
- The 5 questions form Hero's Journey arc: scene → mistake → turning point → method → proof.
- Each question is anchored to the topic - they're not independent siblings.
- Each question uses the existing thin-answer-friendly cadence (specific, concrete, 2-6 sentence answer expected).

**Quality tier:** stays `cheap` (Flash-Lite) - mechanical structured JSON.

### 10.2 Update question_forms schema

**File:** `sql/migrations/20260512_question_forms_topics.sql`

Add to `question_forms`:
```sql
ALTER TABLE public.question_forms
  ADD COLUMN IF NOT EXISTS topics jsonb NOT NULL DEFAULT '[]'::jsonb;
-- topics shape: [{ id, title, pillar_hint, questions: [{ id, input_type, text, placeholder }] }]
```

Keep the existing `questions` column for backward compat with already-created forms. New forms write to `topics`. The submit endpoint handles both shapes.

### 10.3 Form UI - client-side

**File:** `src/app/(public)/question-form/[token]/page.tsx` (or wherever the existing public form lives - find it)

Render topics as expandable groups. Each group shows the 5 questions in order. UI features:

**a. Editable on revisit.**
- The form fetches existing `submitted_at` + answers on load.
- If `submitted_at` is set, show the existing answers pre-filled in the inputs.
- Submit button label: "Update answers" instead of "Submit" when revisiting.
- On submit, the API merges new answers with existing ones (only updates fields that changed).

**b. Real-time thin-answer detection.**
- On `blur` of each textarea, run client-side check:
  ```typescript
  function isThinAnswer(text: string): boolean {
    const trimmed = text.trim()
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length
    if (wordCount >= 25) return false
    const hasNumber = /\d/.test(trimmed)
    if (hasNumber) return false
    const hasProperNoun = /\b[A-Z][a-z]+/.test(trimmed.replace(/^[A-Z]/, ''))  // exclude sentence start
    if (hasProperNoun) return false
    const hasQuote = /["']/.test(trimmed)
    if (hasQuote) return false
    return true
  }
  ```
- If thin: render an inline soft nudge below the field. Copy:
  > "This reads thin - can you ground it? A specific moment ('It was Tuesday morning when…'), a number, or a name makes it usable. You can save anyway."
- Don't block save. Persist the thin status as `thin_flag=true` on the answer when saved.

**c. Visual style:**
- Match existing form aesthetic. No AI-tell copy in headings.
- Use existing brand colors (`#2B79F7` accent, dark/light mode parity).
- No em-dashes in any UI text.

### 10.4 Form submit endpoint

**File:** `src/app/api/question-form/submit/route.ts`

- Accept new shape: `{ token, topicAnswers: { [topicId]: { [questionId]: answerText } } }`.
- Backward compat: if old `answers` shape received, route through old logic.
- For each answer, write to `topics` table (the existing one, now extended in M1):
  - `client_id`: from question_form.client_id
  - `question`: question text (kept for context)
  - `answer`: client's text
  - `pillar`: derive from question's pillar_hint (or 'unassigned')
  - `input_type`: from the question's input_type
  - `thin_flag`: client-supplied; trust the client check (server-side double-check is not worth the cost)
  - `topic_group_id`: shared uuid for all 5 answers from the same topic
  - `group_position`: 1-5 based on input_type position
  - `source`: `'form'`
- On revisit, **upsert** by `(topic_group_id, group_position)` - update existing rows instead of inserting duplicates.
- Mark question_form.submitted_at on first submit (don't update on subsequent edits).

### 10.5 Staff-side answer viewer

Find: where is the existing answer viewer? Likely `src/app/(app)/clients/[id]/page.tsx` or a tab within it. Audit existing UI.

Extend / build:
- A "Topics + Answers" view for the client, grouped by `topic_group_id`.
- Each topic shows: title, 5 questions in order with their answers, thin-flag indicator.
- "Edit" affordance to manually correct an answer (rare but needed for typos).
- Filter: show only thin-flagged answers (for follow-up).

### 10.6 Tier-aware topic generation cadence

Surface a "Generate weekly batch" button on the client dashboard that creates the right number of topics for the brand's `package_tier`:
- Top → 4 topics
- Middle → 1-2 topics (default 2)
- Lower → 1 topic (every 2 weeks; show "next batch in N days" if recently generated)

This is a UI helper, not a hard constraint. Staff can override topic count.

### M2 file inventory

**New:**
- `sql/migrations/20260512_question_forms_topics.sql`

**Modified:**
- `src/app/api/question-form/generate/route.ts`
- `src/app/api/question-form/submit/route.ts`
- `src/app/(public)/question-form/[token]/page.tsx` (or current public form path)
- `src/app/(app)/clients/[id]/...` (answer viewer extension)
- Component: client dashboard "Generate batch" button (find existing dashboard)

---

## 11. M3 - Planner + Calendar + Story Queue + Stage Tracking + Share

Goal: the calendar UI + planner core. Zero AI calls except for story-prompt generation + per-slot hook preview (Flash-Lite).

### Status

✅ **All M3 sub-tasks complete (end of session 3).** Type-check clean, lint clean on new files, M1 snapshot still passing.

Files shipped:
- Migrations: `sql/migrations/20260519_content_plan_slots.sql`, `20260519_story_queue_items.sql`, `20260519_content_plan_share_links.sql`
- Planner core: `src/lib/planner/{types,db,cooldowns,coverage,scoring,material,hookPreview,storyQueue,index}.ts`
- Stage lib: `src/lib/contentStage/index.ts` (evaluate / propose / confirm / dismiss)
- API routes: `src/app/api/planner/generate/route.ts`, `src/app/api/planner/data/route.ts`, `src/app/api/planner/public-data/route.ts`, `src/app/api/planner/share-link/route.ts`, `src/app/api/planner/slot/[id]/{route,regenerate,lock,swap-format,reschedule}/route.ts`, `src/app/api/planner/story-queue/{refill,generate,[id]/use,[id]/pin}/route.ts`, `src/app/api/planner/stage/{confirm,dismiss}/route.ts`
- UI: `src/app/(app)/clients/[id]/planner/page.tsx`, `src/app/plan/[token]/page.tsx`, `src/components/planner/{types,CoverageBar,PlannerCalendarGrid,StoryQueuePanel,SlotDetailDrawer,StageAdvancementBanner,StageBadge}.tsx`
- Brand profile: stage badge + planner link added to `src/app/(app)/clients/[id]/page.tsx` under the package tier line

Notes for M4:
- Hook preview generation lives in `src/lib/planner/hookPreview.ts`. It's a Flash-Lite call per slot during planning (Phase A) - `generateScriptForSlot` (M4) replaces / augments this with the full script + checklist via `standard` quality.
- Material fit is DETERMINISTIC, mapping `format.slug -> required input_types` in `src/lib/planner/scoring.ts:FORMAT_INPUT_REQUIREMENTS`. M4 may add an AI-scored fallback for formats whose required types aren't in the topic answers but where a freeform pillar match would still work.
- Long-form has no `content_formats` row - the planner emits a synthetic pseudo-format (`long_form.long_form`) so it can flow through the same slot pipeline. M4's `generateScriptForSlot` should detect this slug and route to the existing long-form generator.
- Stories don't get `content_plan_slots` rows; they live entirely in `story_queue_items`. Pinning a story sets `pinned_to_date`. The calendar UI does NOT yet render pinned stories on the calendar - it only renders the queue. M4 / M3.1 follow-up: render pinned stories on the calendar grid as a 5th color.
- The `DELETE /api/planner/slot/[id]` route is added beyond the spec for the slot drawer's Delete action. Not in section 11.3 list but needed for the UI.
- Plan generation auto-fires `proposeStageAdvancement` after each run - the banner appears next page load when criteria flip.

### 11.1 Migrations

**Files:**
- `sql/migrations/20260519_content_plan_slots.sql`
- `sql/migrations/20260519_story_queue_items.sql`
- `sql/migrations/20260519_content_plan_share_links.sql`

**`content_plan_slots`:**
```sql
CREATE TYPE public.slot_status AS ENUM ('planned', 'drafted', 'approved');
CREATE TYPE public.slot_stream AS ENUM ('long_form', 'short_form', 'engagement_reel', 'carousel');

CREATE TABLE public.content_plan_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  stream public.slot_stream NOT NULL,
  format_id uuid REFERENCES public.content_formats(id) ON DELETE SET NULL,  -- null for long_form
  scheduled_date date NOT NULL,
  status public.slot_status NOT NULL DEFAULT 'planned',
  topic_group_id uuid,                       -- which topic this slot draws from
  raw_material_refs jsonb NOT NULL DEFAULT '[]'::jsonb,  -- topic ids consumed
  hook_preview text,                         -- ~30-token preview shown on calendar
  generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb,    -- internal: scoring rationale, cooldown state at pick time
  generated_script_id uuid,                  -- FK to scripts table when drafted (optional, scripts table TBD)
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  locked boolean NOT NULL DEFAULT false,    -- locked slots survive plan regeneration
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```
With indexes on (client_id, scheduled_date), (client_id, status), and a trigger for updated_at.

**`story_queue_items`:**
```sql
CREATE TABLE public.story_queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  format_id uuid REFERENCES public.content_formats(id),  -- one of the 5 story formats
  prompt_text text NOT NULL,
  visual_direction text,
  raw_material_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pinned_to_date date,                       -- when promoted-to-date
  pinned_slot_id uuid REFERENCES public.content_plan_slots(id) ON DELETE SET NULL,
  seed_text text,                            -- if generated from a seed input
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**`content_plan_share_links`:**
```sql
CREATE TABLE public.content_plan_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_plan_share_links_token_idx ON public.content_plan_share_links (token);
```

### 11.2 Planner core

**File:** `src/lib/planner/index.ts`

The scoring algorithm. See [Section 14](#14-planner-scoring-algorithm-exact) for the full spec.

Exports:
```typescript
export async function generatePlan(input: {
  clientId: string
  monthsAhead: number      // 1, 2, or 3
  forceRegenerateLocked?: boolean  // default false - locked slots preserved
}): Promise<{ slotsCreated: number, slotsSkipped: number, warnings: string[] }>

export async function regenerateSlot(slotId: string): Promise<ContentPlanSlot>

export async function refillStoryQueue(clientId: string, targetCount?: number): Promise<{ created: number }>

export async function generateStoryPrompt(clientId: string, seedText?: string): Promise<{ promptId: string }>
```

### 11.3 Planner endpoints

**Files:**
- `src/app/api/planner/generate/route.ts` - POST: generate horizon plan
- `src/app/api/planner/slot/[id]/regenerate/route.ts` - POST: regenerate single slot
- `src/app/api/planner/slot/[id]/lock/route.ts` - POST: toggle lock
- `src/app/api/planner/slot/[id]/swap-format/route.ts` - POST: force a different format
- `src/app/api/planner/slot/[id]/reschedule/route.ts` - POST: change date (drag-drop)
- `src/app/api/planner/story-queue/refill/route.ts` - POST: refill queue
- `src/app/api/planner/story-queue/generate/route.ts` - POST: generate one (with optional seed)
- `src/app/api/planner/story-queue/[id]/use/route.ts` - POST: mark consumed
- `src/app/api/planner/story-queue/[id]/pin/route.ts` - POST: promote to dated slot

### 11.4 Calendar UI

**File:** `src/app/(app)/clients/[id]/planner/page.tsx` (or similar - find best location in existing routing)

Layout (drawing from Linear / Cal / Notion design references):

- **Top bar:** brand name, content_stage badge, "Generate plan" button, "Share view-only" button, current month + month switcher, "Extend horizon" toggle.
- **Coverage bar:** horizontal stacked bar showing current month's bucket distribution vs target. Color-coded. Tooltip on hover shows exact percentages.
- **Calendar grid:** 7-column week view (Sun-Sat) or month view. Slots colored by stream:
  - Long-form: deep blue
  - Short-form / Reels: lighter blue
  - Engagement reels: purple
  - Carousels: yellow
  - (Stories live in the sidebar queue)
- **Slot card:** time placeholder (set by user, optional), format name, hook preview (1 line), source topic title, status pill.
- **Slot detail drawer (right side or modal):** opens on slot click. Shows: format full info, raw material answers used, "Generate script" button, "Lock", "Swap format", "Reschedule", "Delete" actions. After script is drafted, shows the script editor + checklist panel.
- **Story queue sidebar:** persistent panel on the right (collapsible). Shows current queue. "+" button at top to generate a new prompt with optional seed input. Each card has "Use", "Pin to date", "Regenerate" actions.
- **Stage advancement banner:** if `proposed_stage` is set on `content_stage_state`, show a banner at the top: "Ready to advance to Growing - 4 of 4 criteria met. [Confirm] [Dismiss]"
- **Mon-Fri default:** plan generation places slots Mon-Fri only. Drag to weekend revalidates cooldowns.

**Drag-and-drop:** slots can be dragged to other dates. On drop, validate that no cooldown is violated (e.g., dropping a Hero's Journey within 7 posts of another Hero's Journey shows a warning toast - but allows the move).

**No AI tells in copy.** Instead of "AI is working its magic…", say "Generating plan… (about 30 seconds)". Instead of "Streamline your content," say "Plan content."

### 11.5 View-only share

**File:** `src/app/(public)/plan/[token]/page.tsx`

- Public route, no auth required.
- Validates token: not revoked, not expired.
- Renders the calendar in read-only mode. Strips:
  - Internal scoring math from `generation_meta`
  - "Why this format" rationale
  - Cooldown state
  - Any edit affordances (no buttons render at all, not just disabled)
- Shows: dates, format names, hook previews, status pills, color-coded streams.
- Top bar: brand name + month, no "Generate" button, no settings.

### 11.6 Stage tracking

**File:** `src/lib/contentStage/index.ts`

```typescript
export async function evaluateStageCriteria(clientId: string): Promise<{
  currentStage: ContentStage
  nextStage: ContentStage | null
  criteriaProgress: Record<string, number>
  criteriaMet: string[]
  criteriaTotal: number
}>

export async function proposeStageAdvancement(clientId: string): Promise<void>
// fires notifications + email to assigned team members

export async function confirmStageAdvancement(clientId: string, userId: string): Promise<void>

export async function dismissStageAdvancement(clientId: string, userId: string): Promise<void>
```

Triggered by the planner whenever a plan is generated. If criteria are met and no proposal/dismissal exists, propose. See [Section 15](#15-stage-advancement-criteria-exact) for criteria.

### 11.7 Brand profile stage badge

Find: brand profile page (likely `src/app/(app)/clients/[id]/page.tsx`).

Add: small badge near brand name showing current_stage with progress underneath ("Foundation • 3 of 4 criteria for Growing met").

### M3 file inventory

**New:**
- `sql/migrations/20260519_content_plan_slots.sql`
- `sql/migrations/20260519_story_queue_items.sql`
- `sql/migrations/20260519_content_plan_share_links.sql`
- `src/lib/planner/index.ts` (+ helpers: `scoring.ts`, `cooldowns.ts`, `coverage.ts`)
- `src/lib/contentStage/index.ts`
- 8 new API routes (see 11.3)
- `src/app/(app)/clients/[id]/planner/page.tsx`
- `src/app/(public)/plan/[token]/page.tsx`
- Calendar components: grid, slot card, slot detail drawer, story queue panel
- Stage advancement banner component

**Modified:**
- `src/app/(app)/clients/[id]/page.tsx` (add stage badge + planner link)

---

## 12. M4 - Per-Format Generators + Checklist

Goal: replace rule-based repurposing with format-module-driven generation; ship checklist alongside every script; gate approval on the checklist.

### 12.1 Generation core

**File:** `src/lib/planner/generateScript.ts`

```typescript
export async function generateScriptForSlot(slotId: string): Promise<{
  scriptText: string
  checklist: ChecklistItem[]
  rawTokens: { input: number, output: number, cached?: number }
}>
```

Pipeline:
1. Load slot + format + raw material (topics from `topic_group_id`).
2. Load brand profile + content_stage + brand_content_settings.
3. Build system prompt (stream-aware):
   - **`frameworkBlockForStream(stream)`** - long-form gets `FRAMEWORK_BASE + LONGFORM_BUILDOUT` (5-step process, 2-1-3-4 body, fortune-cookie outro, mid-roll CTA placement embedded in step 4). Short-form / engagement-reel / carousel / story get `FRAMEWORK_BASE + SHORTFORM_BUILDOUT` (8-beat structure, 75-180 words, single mid-script CTA, no fortune-cookie outro). See section 9.7a for the constants.
   - For long-form ONLY: also append `LONGFORM_FRAMEWORK` (the detailed output-section schema with bracket labels). Short-form's output schema is already inside `SHORTFORM_BUILDOUT`.
   - Format module (`buildFormatPromptBlock(format)` from M1) - includes hook patterns + reference scripts (added late M3).
   - Brand context (`buildBrandContextBlock(profile, opts)` from M1).
4. Build user prompt: typed raw material answers + slot-specific instruction (target length, output schema). For long-form with mid-roll CTA, just hand over the CTA TEXT - the framework handles WHERE it goes.
5. Use Gemini context cache for the system prompt (cache key: `script:${clientId}:${formatId}:${profileVersion}`). Failures fall back to inline system prompt non-fatal.
6. Output schema: structured JSON with `{ script: string, checklist: [{ id, status, ai_note }] }`.
7. Quality tier: `high` for long-form, `standard` for short-form/engagement reels/carousels, `cheap` for stories.
8. **Wrapped in `withContentRetry`**: JSON parse failure or missing script triggers a second attempt automatically. Network/transient failures are already handled by the provider's 5-retry backoff.
9. **Hybrid polish for short-form ONLY**: after the Flash draft, run `polishHookAndClose()` from `src/lib/ai/scriptPolish.ts`. Single Pro call (~80 output tokens, ~$0.002/slot) that evaluates and rewrites hook + close if they fall below 9/10. Body stays Flash. Long-form skips polish (already Pro). Stories skip (structured).
10. **Reconcile checklist** against the registry from `src/lib/checklist/items.ts`: drops unknown ids, backfills missing items as `manual_check` so the UI always renders the full list.
11. **Override length item with deterministic word-count**: `enforceLengthChecklistItem()` from `src/lib/checklist/items.ts` replaces the AI's self-grade on `universal.length_in_target` with a computed pass/flag based on `format.target_length_min..max` (10% slack each side). The AI rubber-stamps this item even when the script is way over budget; we force the truth.
12. On response: sanitize script through existing `sanitize()` from engine.ts.
13. Save to slot: update `status='drafted'`, `generation_meta.checklist`, `generation_meta.script`, `generation_meta.script_generated_at`. Log `generation_meta.polish` with `{ hookRewritten, closeRewritten }` for telemetry when present.

**For mid-roll CTA on long-form**: read `slot.midroll_cta` first, fall back to `brand_content_settings.default_long_form_cta`. The placement rule is embedded inside `LONGFORM_BUILDOUT` step 4 (BODY) - between POINT 2 and POINT 3, framed conversationally. The user prompt only carries the CTA text; the framework decides where it lands.

**Format gating (planner-side, runs at slot-pick time, not generation time)**: `FORMAT_CRITICAL_INPUTS` in `src/lib/planner/scoring.ts` lists load-bearing input types per format (e.g. `short_form.win` -> `['proof']`, `short_form.heros_journey` -> `['turning_point']`). Missing OR thin-only on any critical input gates the format out (fit=0) regardless of partial-credit math on other input types. This prevents formats whose entire premise depends on a specific input type from being picked when the topic group can't support them.

### 12.2 Checklist data model

Each script row carries a `checklist` jsonb:
```typescript
type ChecklistItem = {
  id: string             // stable, e.g. 'universal.hook_2s', 'win.proof_visible'
  label: string          // human-readable
  status: 'pass' | 'flag' | 'manual_check'
  ai_note?: string       // AI's self-assessment reasoning
  human_status?: 'fixed' | 'waived' | null
  human_note?: string
  edited_by?: string     // user_id
  edited_at?: string     // iso timestamp
}
```

### 12.3 Checklist UI

In the slot detail drawer, render the checklist as a panel next to the script editor:

- Each item: status icon (✓ pass, ⚠ flag, ? manual_check), label, AI note (collapsed), human note input.
- "Fix" action: edits script, then "Re-check" re-runs AI evaluation on just this item (cheap call).
- "Waive" action: opens an in-app modal asking for a reason. Saves with `human_status='waived'`, `human_note`, `edited_by`, `edited_at`.
- Approval button: disabled until every item is `pass` OR `human_status in ('fixed', 'waived')`.

### 12.4 Replace rule-based repurposing

Files to MODIFY (not delete - but the body is rewritten):
- `src/app/api/scripts/package/carousel/route.ts`
- `src/app/api/scripts/package/reel/route.ts`
- `src/app/api/scripts/package/story/route.ts`

These existing routes can still be called (they're used outside the planner too). But internally, they now route through `generateScriptForSlot()` if a slot is provided, otherwise they use a default-format fallback (Framework Carousel, Hero's Journey reel, Proof Drop story).

### 12.5 Format-specific QA checklist definitions

See [Section 17](#17-format-specific-qa-checklists). Each format has its own list of checklist items defined alongside the format in the seed (or in code, depending on what's cleaner - putting them in the DB row's `mad_libs` adjacent field is fine).

### 12.6 Approve gate + waiver log

**File:** `src/app/api/planner/slot/[id]/approve/route.ts`

- Validates: every checklist item is `pass` or `human_status in ('fixed', 'waived')`.
- On success: updates slot status to `approved`, marks `topic_group_id` as consumed (`used_at` on each `topics` row).
- Triggers: optional task creation in existing campaigns flow.
- Logs: who approved, when, with which waivers in place.

### 12.7 Tier-aware campaign export

When exporting an approved plan to a Google Doc (or .docx), the export must
read the client's `package_tier` and distribute slots across the tier's
campaign cadence FROM `src/lib/campaignTiers.ts:TIER_CONFIG`. The exporter
does NOT decide its own grouping by week or by date - the campaign count
and per-campaign mix come straight from `TIER_CONFIG`.

For a single-month export:
- **Top** (`campaignsPerMonth: 4`, `cadence: 'weekly'`): 4 campaigns. Each
  campaign carries the tier's per-campaign mix (1 long-form, 5 short-form,
  5 engagement reels, 5 carousels, 5 stories). Total ~84 deliverables.
- **Middle** (`campaignsPerMonth: 2`, `cadence: 'biweekly'`): 2 campaigns.
  Each campaign: 1 long-form, 4 short-form, 4 engagement reels, 4 carousels,
  0 stories. Total ~26 deliverables.
- **Lower** (`campaignsPerMonth: 1`, `cadence: 'monthly'`): 1 campaign.
  1 long-form, 5 short-form, 5 engagement reels, 5 carousels, 0 stories.
  Total ~16 deliverables.

Distribution rule: anchor each campaign to a long-form (the first long-form
slot in the chronological window for that campaign), then attach the next
N short-forms / N engagement reels / N carousels / N stories from the same
window. If a campaign would be short on a stream (e.g. only 3 short-forms
exist when 5 are needed), the doc shows the missing ones as empty
placeholders so staff can see at a glance what's underfilled.

For multi-month exports, repeat the per-month structure: each month gets
its own header + N campaigns + tier-mix slot count.

Doc shape (tabs / sections per campaign):
```
Header: <Brand> - <Month> Campaigns
─────────────────────────────────────
Campaign 1 (Week 1, May 5-9)
  LONG-FORM  - <topic title>, <full script>
  SHORT-FORM #1 ... #5
  ENGAGEMENT REEL #1 ... #5
  CAROUSEL #1 ... #5
  STORIES (5) ...
─────────────────────────────────────
Campaign 2 (Week 2, May 12-16)
  ...
```

This is M4 work, not M3. Captured here so the export implementation reads
TIER_CONFIG instead of inventing a grouping.

### M4 file inventory

**New:**
- `src/lib/planner/generateScript.ts`
- `src/app/api/planner/slot/[id]/generate-script/route.ts`
- `src/app/api/planner/slot/[id]/approve/route.ts`
- `src/app/api/planner/slot/[id]/checklist/[itemId]/waive/route.ts`
- `src/app/api/planner/slot/[id]/checklist/[itemId]/recheck/route.ts`
- Checklist UI components

**Modified:**
- `src/app/api/scripts/package/carousel/route.ts` (route through new core)
- `src/app/api/scripts/package/reel/route.ts`
- `src/app/api/scripts/package/story/route.ts`

---

## 13. Format library - all 35 definitions

Use these verbatim when writing `sql/seeds/content_formats_seed.sql`. Each definition is in Kallaway shape: description / starting_point / strategy_beats / secret_sauce / mad_libs / gating_rule / pillar / bucket / target lengths / cooldown_posts.

**CRITICAL VOICE NOTE:** All mad-libs below are spoken-cadence references. The user explicitly forbade colon-led labels. If you find any mad-lib that uses a label-then-colon construction (e.g. `"What I learned: …"`), rewrite to spoken form per [Section 6](#6-voice--ux-rules-apply-to-all-work).

---

### 13.1 Short-form (19 formats)

#### 1. `short_form.heros_journey` - Hero's Journey
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 45-60s, **cooldown:** 10
- **description:** 1st person POV transformation arc, problem → solution. The viewer emotionally relates to the pain so they stay for the solution.
- **starting_point:** A core problem the creator faced + the solution that finally worked + the result that came from it.
- **strategy_beats:**
  1. HOOK - pattern interrupt establishing the problem
  2. INTRO - establish the hero (you) and the problem
  3. INFLECTION - pain points / lowest moment
  4. RISING ACTION - failed solutions you tried
  5. CLIMAX - the solution that finally worked
  6. FALLING ACTION - the result you saw
  7. RESOLUTION - optional CTA tying back to the offer
- **secret_sauce:** The viewer must FEEL the pain. If they don't relate to your before-state, they don't care about your solution. Specificity over polish.
- **mad_libs:**
  - HOOK - "X years ago I [insert problem you were experiencing]." / "I was a [role] struggling with [problem], and I had no clue how to fix it."
  - INFLECTION - "It got so bad that I [lowest moment]."
  - RISING ACTION - "I tried [#1], [#2], and [#3]. Nothing worked."
  - CLIMAX - "Then I figured out the one thing that actually worked. [Solution]."
  - FALLING ACTION - "Within [timeframe] I went from [before] to [after]."
  - RESOLUTION - "Now I help [audience] do the same. [CTA]."
- **gating_rule:** Skip if the brand has no specific transformation arc with concrete before/after. A vague "I struggled, then I figured it out" without a named solution is too thin.

#### 2. `short_form.personal_learning` - Personal Learning / Epiphany
- **bucket:** educational, **pillar:** authority
- **target:** 30-50s, **cooldown:** 5
- **description:** Lead with proof, then teach how the result was achieved. Reverse-engineer from the win.
- **starting_point:** A specific result with visible proof (screenshot, number, outcome) + the non-obvious insight that produced it.
- **strategy_beats:**
  1. HOOK - lead with the result or proof
  2. BACKSTORY - brief context on where you were before
  3. INSIGHT - the realization that changed it
  4. BREAKDOWN - how you applied the insight (steps)
  5. CTA - bridge to action
- **secret_sauce:** Strong visible proof creates the curiosity hook ("how did they do that?"). The solution must be non-obvious - if it's "I worked harder," the proof loses its weight.
- **mad_libs:**
  - HOOK - "I [impressive result] in [timeframe]. Here's exactly how." / "[Screenshot]. Everyone keeps asking me how I did this."
  - BACKSTORY - "Before this, I was [previous state] and I thought [old belief]."
  - INSIGHT - "Then I realized [realization] and that changed everything." / "The mistake I was making was [mistake]. The fix was [fix]."
  - BREAKDOWN - "Here's exactly what I did. First [step 1], then [step 2], finally [step 3]."
  - CTA - "Comment LEARN if you want the full breakdown."
- **gating_rule:** Skip if the result isn't quantifiable or specific. "Things are going great" doesn't work - needs a number, screenshot, or named outcome.

#### 3. `short_form.about_me` - About Me / Origin Story
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 45-60s, **cooldown:** 14
- **description:** Personal backstory explaining the WHY behind the brand. Pinned-to-profile fodder. Builds personal trust, not professional expertise.
- **starting_point:** Where you were before (normal life), what changed, the why driving the brand now.
- **strategy_beats:**
  1. HOOK - pull from hook bank
  2. INTRO - context on normal life
  3. CONFLICT - what set you on this path
  4. EPIPHANY - the realization
  5. CHANGE - the action you took
  6. PURPOSE - the deeper why
- **secret_sauce:** Don't sell. This is parasocial fuel - the audience comes away knowing who you are, not what you sell. The CTA is the brand existing, not a product.
- **mad_libs:**
  - HOOK - "Hi I'm [name]. [X years] ago I was a normal [role] living a normal life."
  - CONFLICT - "Then [trigger event] happened, and I couldn't ignore it anymore."
  - EPIPHANY - "That moment made me understand [realization]."
  - CHANGE - "So I [bold action]. Fast forward to today and I've [current result]."
  - PURPOSE - "Now everything I do is about helping [who] achieve [what] without [common pain]."
- **gating_rule:** Skip if the brand has already published 2+ origin stories in the last 30 posts. This format saturates fast.

#### 4. `short_form.before_after` - Before & After
- **bucket:** proof_community, **pillar:** authority
- **target:** 15-30s, **cooldown:** 7
- **description:** Two contrasting states with a dramatic reveal. Format relies entirely on the gap.
- **starting_point:** Two contrasting states with a measurable, visible gap between them.
- **strategy_beats:**
  1. HOOK - tease the transformation
  2. BEFORE - show the starting point
  3. TRANSITION - visual cut synced to audio
  4. AFTER - reveal the result
  5. CONTEXT - brief note on time/effort (optional)
  6. CTA - drive next action (optional)
- **secret_sauce:** Bigger gap = bigger watch time. The cut must be sharp and synced to audio. Best Before&Afters are 15-30s - explanation kills it.
- **mad_libs:**
  - HOOK - "[X months] of [effort] in [X seconds]." / "Watch this transformation."
  - BEFORE - "This is where I started. [Before state]." / "[X years] ago, this was my reality."
  - AFTER - "And this is where I am now." / "[X months] later."
  - CONTEXT - "[X months] of [effort]. Worth every second."
  - CTA - "Want to see how I did it? [CTA]."
- **gating_rule:** Skip if the gap isn't measurable or visible. A vague "things are better now" without a screenshot, number, or visual contrast doesn't land.

#### 5. `short_form.goal_journey` - Goal / Dream Journey
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 45-60s, **cooldown:** 14
- **description:** Long-held dream + where you are on the path. Open-ended, ongoing pursuit. Audience invited to follow along.
- **starting_point:** A long-term goal that's genuinely unfinished, with vulnerable moments about whether you'll make it.
- **strategy_beats:**
  1. HOOK
  2. INTRODUCE DREAM - origin of the goal
  3. PURSUIT - when you started taking it seriously
  4. PROGRESS - where you are now
  5. CTA - invite participation
- **secret_sauce:** The goal must feel ambitious enough that the audience genuinely wonders if you'll achieve it. Vulnerable moments about doubt make this format land.
- **mad_libs:**
  - INTRODUCE DREAM - "For as long as I can remember, I've wanted to [dream]."
  - PURSUIT - "Then [X weeks/months] ago, I finally stopped talking about it and [first action]."
  - PROGRESS - "Here's where I'm at. I've [progress]. Next I need to [next step]. Deadline is [date]."
  - CTA - "I'm going to document the whole thing. Follow along and hold me accountable."
- **gating_rule:** Skip if the goal is already achieved or fake-ambitious. The audience can smell a manufactured journey.

#### 6. `short_form.challenge` - Challenge
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 45-60s, **cooldown:** 10
- **description:** A bounded mission with rules and a deadline. Mission completed (or actively completing).
- **starting_point:** A specific challenge with stated rules + obstacles + a clear outcome or cliffhanger.
- **strategy_beats:**
  1. HOOK - state the challenge and stakes
  2. RULES - the constraints
  3. JOURNEY - plot arc with obstacles
  4. RESOLUTION - outcome OR cliffhanger
- **secret_sauce:** The challenge must be ambitious + the obstacles must be specific. "I tried to write 30 posts in 30 days" isn't a challenge unless something almost made it fail.
- **mad_libs:**
  - HOOK - "I gave myself [X days] to [challenge]. No shortcuts."
  - RULES - "Rules. [#1], [#2], [#3]."
  - JOURNEY - "Day [X]. [Setback or progress]. Things were [going well / falling apart] because [reason]."
  - RESOLUTION - "Final result. I went from [start] to [end] in [timeframe]." / "And with [X hours] left… [cliffhanger]. Follow for part 2."
- **gating_rule:** Skip if the challenge has no real obstacles. A challenge that went smoothly isn't a challenge.

#### 7. `short_form.win` - Win / Victory Announcement
- **bucket:** proof_community, **pillar:** authority
- **target:** 15-30s, **cooldown:** 7
- **description:** A specific achievement, celebrated with proof. Distinct from Personal Learning (which teaches backward) - Wins celebrate forward.
- **starting_point:** A specific, recent achievement with visible proof.
- **strategy_beats:**
  1. HOOK - state the win
  2. PROOF - show evidence
  3. EMOTIONAL BEAT - what it means
  4. ACKNOWLEDGMENT - brief journey nod (optional)
  5. CTA - channel the energy forward (optional)
- **secret_sauce:** Proof must be undeniable and visual - a screenshot, a notification, a physical result. Keep it short and raw, not produced.
- **mad_libs:**
  - HOOK - "It finally happened. [Win]." / "We just [achievement] and I'm still in shock."
  - PROOF - "Look at this. [Show proof]." / "[X months/years] ago this number was [old number]."
  - EMOTIONAL BEAT - "You have no idea how long I've worked for this. [X months] of [effort]."
  - ACKNOWLEDGMENT - "From [before] to [after]. Wild."
  - CTA - "Next goal. [Next milestone]. Follow to watch."
- **gating_rule:** Skip if there's no visible proof. A Win without proof reads as a brag.

#### 8. `short_form.day_in_the_life` - Day In The Life
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 45-60s, **cooldown:** 7
- **description:** A day's events from 1st person POV. Personality + lifestyle aspiration.
- **starting_point:** A real day with at least one unexpected/different beat that breaks the typical pattern.
- **strategy_beats:**
  1. HOOK - establish identity and context
  2. MORNING - set the tone
  3. CORE WORK - what you actually do + a complication
  4. RESOLUTION - close the day
- **secret_sauce:** The audience comes for the lifestyle. Show something unexpected - a different way of doing things, a quirk, a deliberate weird choice. Generic productivity content flops here.
- **mad_libs:**
  - HOOK - "A day in the life of a [age] year old [role]." / "What a typical [weekday] looks like when you [lifestyle detail]."
  - MORNING - "I start every day with [routine] because [reason]." / "First thing. [Action]. Most people don't know I [unexpected detail]."
  - CORE WORK - "Today's biggest priority is [task]. The challenge is [complication]."
  - RESOLUTION - "End of day. Here's what I got done. [Summary]. Tomorrow I need to [next priority]."
- **gating_rule:** Skip if the day is genuinely uneventful. The audience won't watch a polished version of nothing happening.

#### 9. `short_form.personal_update` - Personal Update
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 30-45s, **cooldown:** 14
- **description:** A personal update or change in life/mission, shared from 1st person. Community building, not authority.
- **starting_point:** A real recent change/decision + the why behind it.
- **strategy_beats:**
  1. HOOK - tease the update
  2. CONTEXT - situation
  3. UPDATE - deliver the news
  4. RATIONALE - explain the why
  5. CTA (optional)
- **secret_sauce:** Let people see behind the curtain. This is for community building. Vulnerability lands.
- **mad_libs:**
  - HOOK - "I need to tell you something. [Teaser]." / "Something big just changed in my [life/business] and I want to explain why."
  - CONTEXT - "For the past [X months] I've been [previous state]."
  - UPDATE - "As of [date], I'm [the change]."
  - RATIONALE - "The reason is simple. [Core reason]." / "I realized that [insight], and once I saw it I couldn't un-see it."
- **gating_rule:** Skip if the update is fake-personal (e.g., a product launch dressed as a personal moment). Audience smells it.

#### 10. `short_form.lesson_from_others` - Lesson From Others / Mentor Story
- **bucket:** storytelling, **pillar:** authority
- **target:** 45-60s, **cooldown:** 7
- **description:** Someone else's story - mentor, client, peer, public figure - taught you something. You're the narrator/student.
- **starting_point:** A real, specific person + a specific situation/quote/moment + how you applied it.
- **strategy_beats:**
  1. HOOK - introduce the person and lesson
  2. SITUATION - describe their context
  3. LESSON - reveal the insight
  4. APPLICATION - how you applied it and what changed
  5. CTA (optional)
- **secret_sauce:** The other person must feel real to the viewer - name them, describe the specific situation, deliver the lesson as a vivid quote or moment. Generic mentor stories ("a smart person once told me…") flop.
- **mad_libs:**
  - HOOK - "I learned something powerful from [person/role]." / "Here's the best advice [figure] ever gave me."
  - SITUATION - "When I met them, they had just [event]." / "At the time, they were [situation]."
  - LESSON - "They told me, '[golden lesson/quote].'" / "Their advice was simple. [Lesson]."
  - APPLICATION - "I took that and [action]. Within [timeframe] I [outcome]."
  - CTA - "Save this. You'll need it on a hard day."
- **gating_rule:** Skip if the person can't be named (or at least specifically described) and there's no quoted/vivid moment.

#### 11. `short_form.this_vs_that` - This vs That / Comparison Verdict
- **bucket:** opinion, **pillar:** authority
- **target:** 30-50s, **cooldown:** 5
- **description:** Direct head-to-head between two named options ending in a clear verdict.
- **starting_point:** Two specific, comparable options the creator has first-hand experience with + a real opinion on which wins.
- **strategy_beats:**
  1. HOOK - frame the matchup
  2. CRITERION - what we're judging on
  3. CASE A - option A's case with evidence
  4. CASE B - option B's case with evidence
  5. VERDICT - winner + the deciding factor
  6. CTA (optional)
- **secret_sauce:** The verdict must be earned. Hedging kills the format. Bonus points for picking the side the audience doesn't expect.
- **mad_libs:**
  - HOOK - "[A] vs [B]. One of these [outcome]. The other doesn't."
  - CRITERION - "I'm judging this on [single criterion]. Nothing else matters."
  - CASE A - "[A] does [X] well. I tested it on [real thing], got [result]."
  - CASE B - "[B] does [Y] better. When I switched, [what changed]."
  - VERDICT - "Winner. [Option]. Not because [popular reason], but because [non-obvious reason]."
- **gating_rule:** Skip if the creator hasn't used both, or if the answer is "it depends."

#### 12. `short_form.ranking` - Ranking / Tier List
- **bucket:** opinion, **pillar:** authority
- **target:** 45-60s, **cooldown:** 5
- **description:** 3-7 items ranked with a one-beat justification per item.
- **starting_point:** A defined category and a real opinion on each item.
- **strategy_beats:**
  1. HOOK - category + criterion
  2. SETUP - quick rules
  3. ITEMS - walk the list, one sentence + reason each
  4. SURPRISE BEAT - defend the most-disagreed pick
  5. CTA - invite pushback
- **secret_sauce:** At least one item ranked far higher or far lower than expected, with a sharp reason. Obvious #1 picks are boring.
- **mad_libs:**
  - HOOK - "Ranking [N items] worst to best. You're going to disagree with #[surprise position]."
  - SETUP - "Judging by [criterion]."
  - ITEM (repeat) - "#[N]. [Item]. [One-line reason]."
  - DEFENSE - "Before you fight me on [item], [defense]."
  - CTA - "Tell me where I got it wrong."
- **gating_rule:** Skip if you can't articulate a sharp reason for each rank.

#### 13. `short_form.hot_take` - Hot Take / Contrarian
- **bucket:** opinion, **pillar:** authority
- **target:** 30-45s, **cooldown:** 5
- **description:** State an opinion the audience or industry rejects, defend it. Comments section becomes the show.
- **starting_point:** A genuine contrarian view + at least one reason it's true that most people miss.
- **strategy_beats:**
  1. HOOK - state the take, no hedging
  2. CONVENTIONAL - acknowledge the mainstream view briefly
  3. THE MISS - what conventional view misses
  4. EVIDENCE - specific case
  5. RESTATE + INVITE - restate take, invite pushback
- **secret_sauce:** No softening in the first 3 seconds. "This might be controversial but…" kills it instantly. Punch first, justify after.
- **mad_libs:**
  - HOOK - "[Contrarian take]. I know that's not what you want to hear."
  - CONVENTIONAL - "Most people will tell you [mainstream advice]. They're wrong."
  - THE MISS - "They forget [overlooked factor]." / "[Factor] is the part that breaks it."
  - EVIDENCE - "[Specific case]. That's what it actually looks like."
  - RESTATE - "[Take, restated]. Fight me in the comments."
- **gating_rule:** Skip if the take is actually mainstream, or if the creator can't name a specific case where the mainstream view fails.

#### 14. `short_form.myth_bust` - Myth Bust
- **bucket:** educational, **pillar:** educational
- **target:** 30-50s, **cooldown:** 5
- **description:** Take a specific common belief, dismantle it, replace with the real mechanism.
- **starting_point:** A specific belief (quotable in audience's exact wording) + the real mechanism that contradicts it.
- **strategy_beats:**
  1. HOOK - quote the myth
  2. WHY BELIEVED - gives permission to have been wrong
  3. THE TRUTH - real mechanism
  4. PROOF - concrete example
  5. CORRECTED RULE - one-line replacement
- **secret_sauce:** Quote the myth in the audience's exact wording. "Everyone says you need to post twice a day to grow" lands; "people think X is bad" doesn't.
- **mad_libs:**
  - HOOK - "'[Myth in quotes].' This is wrong. Here's why."
  - WHY BELIEVED - "It sounds right because [surface logic]."
  - THE TRUTH - "What's happening is [real mechanism]."
  - PROOF - "[Example] proves it."
  - CORRECTED RULE - "The actual rule. [One-line replacement]."
- **gating_rule:** Skip if nobody actually believes the myth.

#### 15. `short_form.listicle` - Listicle
- **bucket:** educational, **pillar:** educational
- **target:** 45-60s, **cooldown:** 4
- **description:** Numbered list (3-5 items) of mistakes / lessons / habits / frameworks.
- **starting_point:** N items the creator has earned the right to list.
- **strategy_beats:**
  1. HOOK - stake the list
  2. ITEMS - one-line setup + payoff per item
  3. CLOSER - strongest item last
  4. CTA
- **secret_sauce:** Every item carries a one-line punch. If you need 3 sentences to explain it, the item is too soft. 3 sharp items beats 5 mid ones.
- **mad_libs:**
  - HOOK - "[N] [things/mistakes/habits] [I learned / wish I knew]."
  - ITEM (repeat) - "[N]. [Item]. [One-line punch]."
  - CLOSER - "Number [N], most people skip this. [Item]."
  - CTA - "Save this. Go do #[N]."
- **gating_rule:** Skip if items can't each carry a one-line punch.

#### 16. `short_form.how_to` - How-To (Compressed)
- **bucket:** educational, **pillar:** educational
- **target:** 45-60s, **cooldown:** 4
- **description:** One specific skill taught in 45-60s. Three steps max. Pure utility.
- **starting_point:** A bounded teachable skill + 3 concrete steps.
- **strategy_beats:**
  1. HOOK - state the outcome
  2. STEP 1
  3. STEP 2
  4. STEP 3
  5. PITFALL - common mistake to avoid
  6. CTA (optional)
- **secret_sauce:** Specificity over completeness. "Research your audience" is dead. "Open your top 3 competitors' comments and screenshot every question" is alive.
- **mad_libs:**
  - HOOK - "How to [specific outcome] in [timeframe]."
  - STEP 1 - "First, [action]. Use [specific tool]."
  - STEP 2 - "Then, [action]. The trick is [non-obvious detail]."
  - STEP 3 - "Finally, [action]. Make sure [what to check]."
  - PITFALL - "Everyone messes this up by [mistake]. Don't."
- **gating_rule:** Skip if the skill genuinely takes more than 3 steps.

#### 17. `short_form.qa_mailbag` - Q&A / Mailbag
- **bucket:** proof_community, **pillar:** authority
- **target:** 30-45s, **cooldown:** 5
- **description:** A real audience question becomes the script.
- **starting_point:** A real, specific question someone actually asked.
- **strategy_beats:**
  1. HOOK - show or voice the question
  2. CONTEXT - why it's common
  3. ANSWER - direct
  4. PROOF - specific example
  5. BROADER - reframe to a bigger lesson (optional)
  6. CTA
- **secret_sauce:** Specific questions get specific answers. "How do I grow on Instagram?" is dead - "Should I delete old posts that don't fit my new niche?" is alive.
- **mad_libs:**
  - HOOK - "[Asker]. '[Question verbatim].'"
  - CONTEXT - "Great question because [why it's common]."
  - ANSWER - "Short answer. [Direct take]."
  - PROOF - "Because [reason / example]."
  - BROADER - "The bigger lesson is [insight]."
  - CTA - "Got a question? DM it. I'll answer the next one on camera."
- **gating_rule:** Skip if there's no real question. Fabricated mailbags are obvious.

#### 18. `short_form.reaction` - Reaction / Reframe
- **bucket:** opinion, **pillar:** authority
- **target:** 30-45s, **cooldown:** 5
- **description:** Surface a piece of conventional advice or external take, reframe with a sharper version.
- **starting_point:** A specific external claim + a sharper reframe.
- **strategy_beats:**
  1. HOOK - show the claim
  2. ACKNOWLEDGE - why it resonates
  3. REFRAME - where the original is partial
  4. SHARPER VERSION - the version that actually works
  5. CTA
- **secret_sauce:** Don't rage-react. Calm and specific reframes are stronger. "They're not wrong, they're thinking about it at the wrong level."
- **mad_libs:**
  - HOOK - "Saw this take. '[Claim].' Let me reframe it."
  - ACKNOWLEDGE - "It sounds right because [reason]."
  - REFRAME - "The level it's actually true at is [deeper layer]."
  - SHARPER VERSION - "What they should have said is [version]."
  - CTA - "Save this for the next time you hear that one."
- **gating_rule:** Skip if the reframe is just "I disagree" with no sharper version.

#### 19. `short_form.behind_the_scenes` - Behind the Scenes
- **bucket:** educational, **pillar:** authority
- **target:** 45-60s, **cooldown:** 7
- **description:** Show the actual process behind a known output. Process-focused (vs Day In The Life which is personality-focused).
- **starting_point:** A specific output + the unglamorous process behind it.
- **strategy_beats:**
  1. HOOK - the output they've seen
  2. CURTAIN - pull back
  3. MIDDLE - messy middle (friction, rework, pivot)
  4. LESSON - one specific takeaway
  5. CTA
- **secret_sauce:** Don't sanitize. Show friction, rework, the version that flopped. Polished BTS is just ad copy.
- **mad_libs:**
  - HOOK - "You saw [output]. You didn't see [hidden part]."
  - CURTAIN - "Here's what actually went into it."
  - MIDDLE - "[Specific friction beat. 'We shot v4 before we got the take', 'I redid the deck three times', 'The first launch flopped']."
  - LESSON - "[Takeaway]. That's what stuck with me."
  - CTA - "Most polished content hides this. I want you to see it."
- **gating_rule:** Skip if the process is genuinely uneventful or the creator won't show the unflattering part.

---

### 13.2 Engagement reels (6 formats)

**All engagement reels:** text-on-screen only, NO voiceover, NO narration. Pillar = `authority` or null. Bucket varies. Target 15-25s.

#### 20. `engagement_reel.poll_reel` - Poll Reel
- **bucket:** opinion, **pillar:** null
- **target:** 15-20s, **cooldown:** 4
- **description:** Visual two-option poll, asks viewer to pick in comments.
- **starting_point:** A binary choice the audience genuinely splits on, plus a brief reason each side might pick.
- **strategy_beats:**
  1. TRIGGER overlay - pattern interrupt question
  2. CONTEXT overlay - narrows the topic
  3. BAIT overlay - the binary choice
  4. ON-SCREEN reveal - your stance hinted
  5. CTA overlay - comment your pick
- **secret_sauce:** The two options must be near-equal in plausibility. Lopsided polls flop because there's no debate.
- **mad_libs:**
  - TRIGGER - "5-10 words. Pattern interrupt."
  - CONTEXT - "Sets up the bait. 8-14 words."
  - BAIT - "[Option A] or [Option B]?"
  - ON-SCREEN - "I'd pick [option]. You?"
  - CTA - "Comment A or B."
- **gating_rule:** Skip if one option is obviously correct. Polls flop without real disagreement.

#### 21. `engagement_reel.debate_starter` - Debate Starter
- **bucket:** opinion, **pillar:** authority
- **target:** 15-25s, **cooldown:** 4
- **description:** Present a tension between two takes, ask audience which side.
- **starting_point:** Two opposing takes that both have legitimate defenders + a brief reason for each.
- **strategy_beats:**
  1. TRIGGER - name the tension
  2. CONTEXT - both takes briefly
  3. BAIT - which side
  4. ON-SCREEN - your hint
  5. CTA - debate me
- **secret_sauce:** Both takes must have actual defenders. If one side is obviously right, the format flops.
- **mad_libs:**
  - TRIGGER - "There's a fight in [niche] right now."
  - CONTEXT - "Side A says [take]. Side B says [opposite]."
  - BAIT - "Which side are you on?"
  - ON-SCREEN - "I'm on side [X]."
  - CTA - "Defend yours in the comments."
- **gating_rule:** Skip if one side has no real defenders.

#### 22. `engagement_reel.spicy_question` - Spicy Question
- **bucket:** opinion, **pillar:** null
- **target:** 15-20s, **cooldown:** 4
- **description:** One provocative question that splits the audience.
- **starting_point:** A genuinely provocative question - one that triggers a strong opinion either way.
- **strategy_beats:**
  1. TRIGGER - the spicy question
  2. CONTEXT - set the stakes
  3. BAIT - your hint of an answer
  4. CTA - comment your take
- **secret_sauce:** The question must trigger a feeling, not a calculation. "Should creators reveal income?" splits. "What's the best time to post?" doesn't.
- **mad_libs:**
  - TRIGGER - "[Spicy question]?"
  - CONTEXT - "I have a feeling about this."
  - BAIT - "Most people will say [common answer]. They're wrong."
  - CTA - "What's your take?"
- **gating_rule:** Skip if the question is calculative, not emotional.

#### 23. `engagement_reel.tier_list_bait` - Tier-List Bait
- **bucket:** opinion, **pillar:** null
- **target:** 15-25s, **cooldown:** 4
- **description:** Half-finished ranking that begs viewers to argue.
- **starting_point:** N items where you've ranked some controversially + leave gaps for the audience.
- **strategy_beats:**
  1. TRIGGER - the partial ranking
  2. CONTEXT - your top pick + reason
  3. BAIT - your worst pick + provocation
  4. ON-SCREEN - open slots
  5. CTA - fill in the rest
- **secret_sauce:** Leave the most-debatable ranks empty. Audience fills them in for engagement.
- **mad_libs:**
  - TRIGGER - "Ranking [items]. The top is [item]. The bottom is [controversial item]."
  - BAIT - "[Bottom item] doesn't deserve [perceived value]."
  - CTA - "Where would you rank [missing item]?"
- **gating_rule:** Skip if your ranking has no controversy.

#### 24. `engagement_reel.defend_this_take` - Defend This Take
- **bucket:** opinion, **pillar:** authority
- **target:** 10-15s, **cooldown:** 4
- **description:** Drop a contrarian one-liner with no explanation. Force comment debate.
- **starting_point:** A sharp, defendable contrarian one-liner.
- **strategy_beats:**
  1. TRIGGER - the take
  2. ON-SCREEN - "Defend or disagree."
  3. CTA - comments
- **secret_sauce:** The take must be SHORT (8 words max) and provocative. No explanation.
- **mad_libs:**
  - TRIGGER - "[Sharp 8-word take]."
  - ON-SCREEN - "Defend or disagree."
  - CTA - "I'm reading every comment."
- **gating_rule:** Skip if the take requires explanation to land.

#### 25. `engagement_reel.heros_journey_text` - Hero's Journey (Text-Only)
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 20-25s, **cooldown:** 7
- **description:** Hero's Journey arc told via text overlays + B-roll, no voiceover.
- **starting_point:** Same as Hero's Journey - problem + solution + result, but compressed for visual storytelling.
- **strategy_beats:**
  1. TRIGGER overlay - the before-state pain
  2. STRUGGLE overlay - failed attempts
  3. TURN overlay - what changed
  4. RESULT overlay - the after
  5. CTA overlay - follow for the playbook
- **secret_sauce:** Each overlay 5-10 words max. The visual carries the emotion; text just narrates beats.
- **mad_libs:**
  - TRIGGER - "[X] years ago. Stuck in [problem]."
  - STRUGGLE - "Tried [thing 1]. [Thing 2]. Nothing worked."
  - TURN - "Then I figured out [solution]."
  - RESULT - "Now. [Specific result]."
  - CTA - "Follow for the playbook."
- **gating_rule:** Skip if the brand has no clear visual b-roll for the transformation.

---

### 13.3 Carousels (5 formats)

**All carousels:** 5-8 slides variable. Each slide max 18 words. Bucket varies.

#### 26. `carousel.framework` - Framework Carousel
- **bucket:** educational, **pillar:** educational
- **target:** 7-8 slides, **cooldown:** 4
- **description:** Teaches one framework from the long-form, slide by slide.
- **starting_point:** A named framework with 3-5 components that can be diagrammed or explained one slide at a time.
- **strategy_beats:**
  1. HOOK SLIDE - the framework name + promise
  2. CONTEXT SLIDE - why most people get this wrong
  3. COMPONENT 1
  4. COMPONENT 2
  5. COMPONENT 3 (and optional 4, 5)
  6. SUMMARY SLIDE - "Save this"
  7. CTA SLIDE
- **secret_sauce:** The framework must be NAMED. Vague "5 things to do" carousels flop. "The 2-1-3-4 method" works.
- **mad_libs:**
  - HOOK - "The [framework name] that [outcome]."
  - CONTEXT - "Most people [common mistake]."
  - COMPONENT - "[Component name]. [What it does in 12 words]."
  - SUMMARY - "Save this. Use it next time you [situation]."
- **gating_rule:** Skip if the framework isn't named.

#### 27. `carousel.list` - List Carousel
- **bucket:** educational, **pillar:** educational
- **target:** 5-7 slides, **cooldown:** 4
- **description:** 3-5 items with intro + outro slides.
- **starting_point:** N items the creator has earned the right to list.
- **strategy_beats:**
  1. HOOK SLIDE
  2. ITEM SLIDES (3-5)
  3. CTA SLIDE
- **secret_sauce:** One item per slide. Each item readable in 2 seconds.
- **mad_libs:**
  - HOOK - "[N] [items] [I wish I knew / nobody talks about]."
  - ITEM - "[N]. [Item]. [One-line punch]."
  - CTA - "Save this. Tell me which one hit."
- **gating_rule:** Skip if items can't each fit one slide cleanly.

#### 28. `carousel.story` - Story Carousel
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 6-8 slides, **cooldown:** 7
- **description:** Narrative arc pulled from a long-form story beat.
- **starting_point:** A single story moment from the long-form or from a topic answer.
- **strategy_beats:**
  1. HOOK - the moment
  2. SCENE - sensory detail
  3. CONFLICT - what was at stake
  4. TURN - what shifted
  5. RESOLUTION - what changed
  6. LESSON - what stuck
  7. CTA - your turn
- **secret_sauce:** Specificity. Generic "I had a hard day" stories flop; "I was at the airport at 6am when my flight cancelled" lands.
- **mad_libs:**
  - HOOK - "I was [specific scene] when [event]."
  - SCENE - "[One sensory detail per line]."
  - CONFLICT - "I had to [decision] in [timeframe]."
  - TURN - "Then [shift]."
  - RESOLUTION - "Now [outcome]."
  - LESSON - "[Takeaway]."
- **gating_rule:** Skip if the story has no specific details.

#### 29. `carousel.heros_journey` - Hero's Journey Carousel
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 7-8 slides, **cooldown:** 10
- **description:** Full Hero's Journey arc compressed to a swipeable.
- **starting_point:** Same as Hero's Journey short-form - problem + failed attempts + turn + solution + result.
- **strategy_beats:**
  1. HOOK - "X years ago"
  2. PROBLEM SLIDE
  3. FAILED ATTEMPTS SLIDE
  4. TURN SLIDE
  5. SOLUTION SLIDE
  6. RESULT SLIDE
  7. LESSON SLIDE
  8. CTA SLIDE
- **secret_sauce:** Same as the short-form - viewer must FEEL the pain. Compressing for swipe doesn't change the rule.
- **mad_libs:** (mirror short-form heros_journey, but each beat = 1 slide, 12-18 words)
- **gating_rule:** Same as short-form. Skip if no specific transformation.

#### 30. `carousel.personal_learning` - Personal Learning Carousel
- **bucket:** educational, **pillar:** authority
- **target:** 5-7 slides, **cooldown:** 5
- **description:** Lead with proof, then teach how it was achieved.
- **starting_point:** Same as Personal Learning short-form - result with visible proof + non-obvious insight.
- **strategy_beats:**
  1. PROOF SLIDE
  2. BACKSTORY SLIDE
  3. INSIGHT SLIDE
  4. STEP 1
  5. STEP 2
  6. STEP 3 (optional)
  7. CTA
- **secret_sauce:** Same as short-form. Proof first, insight non-obvious.
- **mad_libs:** (mirror short-form personal_learning)
- **gating_rule:** Same. Skip if no quantifiable proof.

---

### 13.4 Stories (5 formats)

**All stories:** Instagram/Facebook stories. 1-4 frames. No caption, no hashtags. Sticker text if poll/question. Pillar varies.

#### 31. `story.proof_drop` - Proof Drop
- **bucket:** proof_community, **pillar:** authority
- **target:** 1 frame, **cooldown:** 3
- **description:** Screenshot/result + one-line caption.
- **starting_point:** A specific recent result with visible proof (screenshot, notification, photo).
- **strategy_beats:**
  1. FRAME 1 - proof + 1 line
- **secret_sauce:** Single frame. No setup. Just the proof.
- **mad_libs:**
  - FRAME 1 - "[Screenshot]. [One-line context like 'A year ago this said zero.']"
- **gating_rule:** Skip if there's no visible proof.

#### 32. `story.day_moment` - Day Moment
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 1-2 frames, **cooldown:** 3
- **description:** Single moment from the day with personality.
- **starting_point:** Something genuinely happening today worth sharing.
- **strategy_beats:**
  1. FRAME 1 - moment captured
  2. FRAME 2 (optional) - quick reaction or detail
- **secret_sauce:** Reactive, not produced. Polish kills it.
- **mad_libs:**
  - FRAME 1 - "[Photo/video of moment]. [Honest one-liner]."
- **gating_rule:** Skip if the moment is fabricated or fake-spontaneous.

#### 33. `story.behind_the_curtain` - Behind the Curtain
- **bucket:** educational, **pillar:** authority
- **target:** 1-3 frames, **cooldown:** 4
- **description:** Process snippet from current work.
- **starting_point:** A specific in-progress moment from work - not a polished output.
- **strategy_beats:**
  1. FRAME 1 - what you're working on
  2. FRAME 2 - the messy detail most people don't see
  3. FRAME 3 - the takeaway (optional)
- **secret_sauce:** Show the unglamorous beat. Sanitized BTS is dead.
- **mad_libs:**
  - FRAME 1 - "Working on [thing]."
  - FRAME 2 - "Most people don't realize [hidden detail]."
- **gating_rule:** Skip if the work is genuinely uneventful or won't show the unflattering part.

#### 34. `story.question_for_audience` - Question for Audience
- **bucket:** proof_community, **pillar:** null
- **target:** 1 frame, **cooldown:** 3
- **description:** Direct question with reply box.
- **starting_point:** A specific question the audience has a real opinion on.
- **strategy_beats:**
  1. FRAME 1 - question + reply sticker
- **secret_sauce:** Specific, not generic. "What's your favorite color?" flops. "Should I keep posting daily or drop to 3x/week?" lands.
- **mad_libs:**
  - FRAME 1 - "[Specific question]." (with question/reply sticker)
- **gating_rule:** Skip if the question is generic.

#### 35. `story.vulnerable_share` - Vulnerable Share
- **bucket:** storytelling, **pillar:** storytelling
- **target:** 1-2 frames, **cooldown:** 7
- **description:** Honest moment, low-polish, parasocial fuel.
- **starting_point:** A real, recent moment of doubt / struggle / honesty the brand is willing to share.
- **strategy_beats:**
  1. FRAME 1 - the honest moment
  2. FRAME 2 - what you're choosing to do (optional)
- **secret_sauce:** Real, not performative. If it sounds like a "vulnerability flex," cut it.
- **mad_libs:**
  - FRAME 1 - "[Honest line about a real feeling/moment]."
  - FRAME 2 - "[What you're doing about it]."
- **gating_rule:** Skip if the brand isn't willing to actually be vulnerable.

---

## 14. Planner scoring algorithm (exact)

Per-slot scoring. The planner iterates slot-by-slot in date order and scores all available formats per slot.

### Step 1 - Filter to available formats

Drop any format that:
- Is on cooldown (last use of this format slug for this client was less than `format.cooldown_posts` plan-slots ago - NOT calendar days, slot count)
- Fails its gating rule against the available raw material pool (e.g., Lesson From Others requires `topic_input_type='named_mentor'`; if no available answer is tagged with that, the format is dropped)
- Doesn't match the current stream (e.g., when scoring a short_form slot, only short_form formats are evaluated)

Typically 8-12 formats survive per slot.

### Step 2 - Score each surviving format

```
score = material_fit + coverage_need + stage_weight + variance_bonus + recency_penalty
```

| Component | Range | Calculation |
|---|---|---|
| **material_fit** | 0-10 | How well the best-available raw material satisfies the format's `starting_point`. Strong evidence (specific numbers, named persons, vivid scenes) = 10. Vague or partial = 3-5. Determined by a Flash-Lite call OR a deterministic scoring rule against the raw material's input_type + thin_flag. |
| **coverage_need** | 0-10 | `(target_pct - current_pct) * 0.5`, where target_pct is the bucket target for current stage and current_pct is the % of that bucket in the existing horizon plan. Boosts under-represented buckets. Capped at 10. |
| **stage_weight** | 0-5 | Stage-specific format boost. Foundation: +5 to about_me / personal_learning / win / before_after; +3 to heros_journey. Growing: 0 (neutral). Established: +3 to hot_take / this_vs_that / ranking. |
| **variance_bonus** | 0-3 | If the immediately previous slot was the same bucket, subtract 2. If a different bucket, add 2. Prevents 3 storytelling posts in a row. |
| **recency_penalty** | -10 to 0 | Subtract 5 if this format was used in the last 3 slots. Subtract 3 if used 4-7 slots ago. Subtract 1 if used 8-14 slots ago. 0 if older. Subtract additional 5 if the same `topic_group_id` was used in the last 5 slots. |

### Step 3 - Pick the winner

Highest score wins. Ties broken by:
1. Least recently used format (any time)
2. Format with highest material_fit
3. Lower sort_order in `content_formats`

### Step 4 - Consume raw material

Mark the chosen `topic_group_id` as "in use" for this plan. Subsequent slots in the same plan can't pick the same `topic_group_id` until older topic groups are exhausted. (If only one topic group is available, this rule relaxes.)

### Step 5 - Persist

Insert row in `content_plan_slots` with `format_id`, `topic_group_id`, `raw_material_refs` (array of topic ids actually used), `hook_preview` (~30 tokens via Flash-Lite call), `generation_meta` (the full scoring breakdown for debug + planner UI tooltip).

### Cooldown reference table (defaults - overridable per-brand)

| Format | Default cooldown (slots) |
|---|---|
| Hero's Journey | 10 |
| About Me | 14 |
| Personal Update | 14 |
| Goal/Dream Journey | 14 |
| Hero's Journey Carousel | 10 |
| Hero's Journey (Text-Only Reel) | 7 |
| Win, Before & After | 7 |
| Day In The Life | 7 |
| Lesson From Others, BTS | 7 |
| Personal Learning | 5 |
| Story Carousel | 7 |
| Personal Learning Carousel | 5 |
| Listicle, How-To, Myth Bust | 4 |
| Hot Take, This vs That, Ranking, Reaction | 5 |
| Q&A | 5 |
| Engagement Reels | 4 |
| Framework / List Carousel | 4 |
| Stories | 3-7 (per format) |

---

## 15. Stage advancement criteria (exact)

Evaluated on every plan generation. If criteria are met and no proposal/dismissal exists:
- `content_stage_state.proposed_stage = next_stage`
- `proposed_at = now()`
- Notification sent to all `client_memberships` for the client + email to opted-in users

### Foundation → Growing
ALL of:
1. `about_me` published count ≥ 1 (slot status='approved' with format slug `short_form.about_me`)
2. `heros_journey` OR `personal_learning` published count ≥ 2
3. `win` OR `before_after` published count ≥ 1
4. Total approved slots ≥ 10

### Growing → Established
ALL of:
1. Educational bucket approved count ≥ 3 (across How-To, Listicle, Myth Bust, BTS)
2. Opinion bucket approved count ≥ 2 (across Hot Take, Ranking, This vs That, Reaction)
3. Total approved slots ≥ 30

### Confirmation
- Admin or manager clicks "Confirm" → `current_stage = proposed_stage`, `proposed_stage = null`, `confirmed_at`/`confirmed_by` populated
- Anyone can click "Dismiss" → `proposed_stage = null`, `dismissed_at`/`dismissed_by` populated. Won't re-propose until `criteria_progress` changes (a new approved slot bumps the count).

---

## 16. Coverage targets per stage

Default targets per stage. Overridable per-brand in `brand_content_settings.bucket_target_*`.

| Stage | Storytelling | Educational | Opinion | Proof+Community |
|---|---|---|---|---|
| Foundation | 55% | 25% | 10% | 10% |
| Growing | 35% | 30% | 20% | 15% |
| Established | 25% | 35% | 25% | 15% |

Coverage is calculated over the current horizon plan (planned + drafted + approved slots, excluding deleted/skipped). The planner aims to balance toward target across the horizon, NOT post-by-post.

---

## 17. Format-specific QA checklists

Universal items present on every script's checklist:

| ID | Label |
|---|---|
| `universal.hook_2s` | Hook lands in first 2 seconds (no throat-clearing) |
| `universal.voice_conversational` | Reads as spoken, not written |
| `universal.no_fabrication` | Every claim traces to braindump or brand profile |
| `universal.no_banned_phrases` | No banned phrases / colon-led labels (auto-scan against HARD_BANS) |
| `universal.length_in_target` | Length within format target_length_min..max |
| `universal.profanity_match` | Profanity matches `profile.voice.profanity_level` |
| `universal.signature_phrases` | Signature phrases used naturally (or absent if none defined) |
| `universal.forbidden_words` | No forbidden words / banned phrases from brand profile |

Format-specific items added to the universal set per format. Examples:

| Format | Specific items |
|---|---|
| Win, Personal Learning | `proof_visible` - visible proof shown or referenced |
| Hero's Journey | `failed_attempts_first` - failed attempts established before solution. `pain_specific` - emotional pain point present and specific. |
| Before & After | `gap_measurable` - gap is measurable, not vague |
| Lesson From Others | `mentor_named` - third party named or specifically described. `quote_or_moment` - a specific quote or vivid moment present |
| Hot Take | `take_no_hedge` - take stated without hedging in first 3s |
| Myth Bust | `myth_quoted` - myth quoted in audience-recognizable wording |
| How-To | `step_specific` - each step is specific, not generic |
| Listicle | `item_punch` - each item carries a one-line punch |
| This vs That | `verdict_earned` - clear verdict, no "it depends" |
| Ranking | `surprise_pick` - at least one surprise rank with a sharp reason |
| Q&A | `real_question` - anchored to a real question |
| Reaction | `sharper_version` - reframe goes beyond "I disagree" |
| BTS | `friction_shown` - process friction shown, not sanitized |
| Day In The Life | `unexpected_beat` - at least one unexpected beat |
| Personal Update | `vulnerable_real` - rationale is honest, not a product launch in disguise |
| Goal/Dream | `goal_unfinished` - goal is genuinely unfinished |
| Challenge | `obstacle_specific` - specific obstacles, not a smooth path |

Each item lives in code under `src/lib/checklist/items.ts` keyed by `format_slug → ChecklistItem[]`. Universal items always prepended.

---

## 18. Pre-test checklist (before user burns credits)

Run through this list at the end of M3 (calendar built, no AI yet) and end of M4 (everything wired) before any test session.

### After M3
- [ ] All 5 M1 migrations applied to dev DB
- [ ] M2 migration applied
- [ ] All 3 M3 migrations applied
- [ ] `content_formats` seeded with 35 rows (run `scripts/validate_content_formats.ts`)
- [ ] Snapshot tests pass (brandContext refactor produces byte-identical output)
- [ ] Tier-aware "Generate batch" creates correct topic count
- [ ] Question form: revisit shows existing answers, edit + save persists, thin-answer detection nudges inline
- [ ] Calendar renders for a test client with package_tier set
- [ ] Plan generation produces correct slot count for the tier (Top 84/mo, etc.)
- [ ] Drag-drop a slot - date updates, cooldown warning fires when violation
- [ ] Lock a slot, regenerate plan - locked slot survives
- [ ] Story queue refills below threshold
- [ ] "+" with seed input generates a prompt around the seed
- [ ] Promote a story prompt to a date - shows on calendar
- [ ] View-only share link renders read-only, hides internals
- [ ] Stage advancement banner fires on a brand that meets criteria
- [ ] Light/dark mode parity verified on every new surface
- [ ] No em-dashes in any new file (grep `\\-\\|\\-` over new code)
- [ ] Confirm modals match existing app pattern (no `window.confirm`)

### After M4
- [ ] Generate a script for a slot - full text returns
- [ ] Checklist appears with format-specific items
- [ ] Approve gate blocks until all items resolved/waived
- [ ] Waiver records user_id + reason
- [ ] Token usage logged in `ai_usage_log` after each generation
- [ ] Gemini context cache hits on second call within window (verify in logs)
- [ ] Cost estimate within reasonable range for a test brand
- [ ] No AI tells in generated copy (grep against the appended HARD_BANS on a few generated samples)

---

## End of handoff

If you're a fresh chat reading this: pick the next milestone in [Section 9](#9-m1--foundation-status--remaining-specs) - [Section 12](#12-m4--per-format-generators--checklist), follow the spec for that milestone, work through the file inventory at the bottom of each section, and update the status checkboxes in [Section 9.X status] as you go.

If anything is ambiguous, refer to the decisions ledger in [Section 3](#3-decisions-locked-full-ledger) before asking the user. Most ambiguity has already been resolved there.

Don't break the existing systems listed in [Section 2](#2-project-landmarks--dont-break).

Voice and UX rules in [Section 6](#6-voice--ux-rules-apply-to-all-work) apply to EVERY piece of work, not just script content.
