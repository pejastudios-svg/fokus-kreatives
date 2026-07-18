import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { BrandProfile } from '@/components/clients/brandProfile'
import type { TopicPillar } from '@/lib/types/topics'
import {
  TOPIC_AXES,
  type FormTopic,
  type FormTopicQuestion,
  type TopicAxis,
  type TopicInputType,
} from '@/lib/types/questionForm'
import { resolveTierConfig, type CustomConfig, type TierKey } from '@/lib/campaignTiers'
import { generateScript } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  clientProfile?: BrandProfile | null
  clientName?: string
  businessName?: string
  industry?: string
  topicCount?: number
  clientId?: string
  /** Pre-seeded topic titles. The AI keeps these titles verbatim and just
   *  generates the questions per seed. Any remaining quota
   *  (topicCount - seeds.length) gets fully AI-generated topics. */
  seedTopics?: string[]
  /** Optional override for how many questions each topic gets. Defaults to
   *  the client's tier: the largest per-campaign stream quota, so every
   *  script in a campaign can anchor on its own answer. Clamped 6-12. */
  questionsPerTopic?: number
}

const VALID_PILLARS: TopicPillar[] = [
  'educational',
  'storytelling',
  'authority',
  'series',
  'doubledown',
]

// Locked arc - the 6 input_types in order. The first 5 are the Hero's
// Journey beats; the 6th (opinion) is a contrarian/perspective question
// that surfaces the raw material the planner needs for engagement reels
// (Poll, Debate Starter, Spicy Question, Tier-list, Defend This Take) and
// for short-form opinion formats (Hot Take, This vs That, Ranking, Reaction).
// Without it, ~10 formats can never score above zero.
const INPUT_TYPE_ORDER: TopicInputType[] = [
  'scene',
  'failed_attempt',
  'turning_point',
  'framework',
  'proof',
  'opinion',
]

// Questions-per-topic bounds. 6 = the locked arc (back-compat default).
// Above 6, the arc repeats as a "second pass" (question 7 = a second scene,
// 8 = another failed attempt, ...) so every planner slot gets a FRESH anchor
// answer instead of recycling one - the planner anchors script N on answer N.
// Capped at 12 to keep the client-facing form answerable.
const QUESTIONS_PER_TOPIC_MIN = 6
const QUESTIONS_PER_TOPIC_MAX = 12

/** The input_type at each question position: the locked arc, cycled. */
function questionTypeSequence(n: number): TopicInputType[] {
  const out: TopicInputType[] = []
  for (let i = 0; i < n; i++) out.push(INPUT_TYPE_ORDER[i % INPUT_TYPE_ORDER.length])
  return out
}

/** Questions per topic = the client's largest per-campaign stream quota
 *  (short-form / reels / carousels / stories), so a tier or custom config
 *  that generates 10 scripts from one topic gets 10 distinct anchors.
 *  Explicit override wins; no client or tier falls back to the locked 6. */
async function deriveQuestionsPerTopic(
  clientId: string | undefined,
  override: number | undefined,
): Promise<number> {
  const clamp = (n: number) =>
    Math.min(QUESTIONS_PER_TOPIC_MAX, Math.max(QUESTIONS_PER_TOPIC_MIN, Math.round(n)))
  if (typeof override === 'number' && Number.isFinite(override)) return clamp(override)
  if (!clientId) return QUESTIONS_PER_TOPIC_MIN
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data } = await supabase
      .from('clients')
      .select('package_tier, custom_config')
      .eq('id', clientId)
      .maybeSingle()
    if (!data?.package_tier) return QUESTIONS_PER_TOPIC_MIN
    const cfg = resolveTierConfig({
      package_tier: data.package_tier as TierKey,
      custom_config: (data.custom_config as CustomConfig | null) ?? null,
    })
    const largest = Math.max(
      cfg.perCampaign.shortForm,
      cfg.perCampaign.engagementReels,
      cfg.perCampaign.carousels,
      cfg.perCampaign.stories,
    )
    return clamp(largest)
  } catch {
    return QUESTIONS_PER_TOPIC_MIN
  }
}

function clientContext(
  profile: BrandProfile | null,
  name?: string,
  business?: string,
  industry?: string,
): string {
  const lines: string[] = []
  if (name) lines.push(`name: ${name}`)
  if (business) lines.push(`business: ${business}`)
  if (industry) lines.push(`industry: ${industry}`)
  if (profile) {
    if (profile.business?.mission) lines.push(`mission: ${profile.business.mission}`)
    if (profile.business?.problem_solved) lines.push(`problem solved: ${profile.business.problem_solved}`)
    if (profile.business?.differentiation) lines.push(`differentiator: ${profile.business.differentiation}`)
    if (profile.business?.signature_offer) lines.push(`offer: ${profile.business.signature_offer}`)
    if (profile.audience?.work_roles) lines.push(`audience: ${profile.audience.work_roles}`)
    const pains = profile.audience?.pain_points?.filter(Boolean) || []
    if (pains.length) lines.push(`audience pain points: ${pains.join(' | ')}`)
    if (profile.audience?.desires) lines.push(`audience desires: ${profile.audience.desires}`)
    const evergreen = profile.content_strategy?.evergreen_topics?.filter(Boolean) || []
    if (evergreen.length) lines.push(`evergreen topics: ${evergreen.join(' | ')}`)
    const hot = profile.content_strategy?.hot_takes?.filter(Boolean) || []
    if (hot.length) lines.push(`hot takes: ${hot.join(' | ')}`)
  }
  return lines.length ? lines.join('\n- ') : 'No additional context.'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function normalizePillar(raw: unknown): TopicPillar {
  const s = asString(raw).toLowerCase()
  return (VALID_PILLARS as string[]).includes(s) ? (s as TopicPillar) : 'storytelling'
}

// Build a topic from one parsed JSON entry. Returns null when the entry is
// too malformed to use - we drop it rather than fall back to a synthetic
// shape, since a well-tagged question arc is the whole point.
//
// expectedTypes is the full position -> input_type sequence (the locked arc,
// cycled for second-pass questions). Questions are consumed FIRST-UNUSED per
// expected type so a topic with two `scene` questions assigns the first to
// position 1 and the second to the second-pass slot, preserving order. The
// locked first 6 are required; second-pass questions are best-effort (a
// topic that came back with only the arc still passes).
function normalizeTopic(raw: unknown, expectedTypes: TopicInputType[]): FormTopic | null {
  if (!isRecord(raw)) return null
  const title = asString(raw.title)
  if (!title) return null
  const rawQs = Array.isArray(raw.questions) ? raw.questions : []

  const pool: Array<{ q: Record<string, unknown>; used: boolean }> = []
  for (const q of rawQs) {
    if (isRecord(q)) pool.push({ q, used: false })
  }

  const questions: FormTopicQuestion[] = []
  for (let pos = 0; pos < expectedTypes.length; pos++) {
    const inputType = expectedTypes[pos]
    const entry = pool.find(
      (e) => !e.used && (asString(e.q.input_type) as TopicInputType) === inputType,
    )
    if (!entry) {
      // Missing a locked-arc question = drop the topic. Missing a
      // second-pass extra = accept what we have.
      if (pos < INPUT_TYPE_ORDER.length) return null
      break
    }
    const text = asString(entry.q.text) || asString(entry.q.question)
    if (!text) {
      if (pos < INPUT_TYPE_ORDER.length) return null
      break
    }
    entry.used = true
    const placeholder = asString(entry.q.placeholder) || asString(entry.q.hint) || undefined
    questions.push({
      id: crypto.randomUUID(),
      input_type: inputType,
      text,
      placeholder,
    })
  }

  // Read the axis the AI claims this topic uses. If it's not a valid axis
  // we leave the field undefined and let the caller stamp the assigned
  // axis defensively.
  const rawAxis = asString(raw.topic_axis)
  const topic_axis = (TOPIC_AXES as string[]).includes(rawAxis)
    ? (rawAxis as TopicAxis)
    : undefined

  return {
    id: crypto.randomUUID(),
    title,
    pillar_hint: normalizePillar(raw.pillar_hint ?? raw.pillar),
    questions,
    topic_axis,
  }
}

interface RecentAnswerSig {
  input_type: string
  excerpt: string
}

interface RecentMaterial {
  titles: string[]
  answers: RecentAnswerSig[]
  /** How many times each axis appeared in the last ~20 batches. Used to
   *  pick under-represented axes for the next batch. */
  axisCounts: Record<TopicAxis, number>
}

// Plain-English description per axis so the AI knows what shape each
// constrained topic should take. Lifted out of the prompt so the lookup
// is straightforward at generation time.
const AXIS_DESCRIPTION: Record<TopicAxis, string> = {
  transformation:
    'A before/after journey for the owner OR a specific client. Concrete starting state, concrete ending state, what bridged them.',
  mistake:
    'A specific thing the owner tried that flopped. Ground in a moment, a name, a number. The lesson is implied; the WAY THEY MISSED IT is the angle.',
  industry_myth:
    'A common belief in the niche the owner thinks is wrong. Quote the myth in the audience\'s exact wording. Surface what the truth actually is.',
  hot_take:
    'A contrarian opinion the owner holds and would defend in a debate. Sharp, no hedging. Push for the take itself plus a real case where the mainstream view fails.',
  origin:
    'An early-days moment from the owner\'s path. Time-anchored (e.g., before they had clients, before they raised prices the first time). NOT a generic "how I got started."',
  client_win:
    'A specific result the owner produced for a named client (or a vivid description of the client). Numbers, screenshots, before/after, a single deliverable.',
  framework_reveal:
    'Surface ONE component of the owner\'s methodology. The angle is HOW that component works, why most people skip it, and what it looks like in practice.',
  pivot:
    'A strategic decision that changed direction. Old approach, what triggered the pivot, new approach, the outcome.',
  mentor_lesson:
    'A lesson learned from a specific person - mentor, peer, public figure. Name the person or describe them vividly. Quote or vivid moment required.',
  industry_observation:
    'A pattern the owner notices in the niche - across clients, competitors, market shifts. Not a personal story; a meta-observation grounded in their experience.',
}

/**
 * Pick which axes to assign to this batch's slots, biased toward the axes
 * that have shown up LEAST in the brand's recent batches. Uses a stable but
 * lightly-randomized order so ties don't always resolve the same way.
 */
function pickAxesForBatch(slotCount: number, axisCounts: Record<TopicAxis, number>): TopicAxis[] {
  const ordered = [...TOPIC_AXES].sort((a, b) => {
    const diff = (axisCounts[a] ?? 0) - (axisCounts[b] ?? 0)
    if (diff !== 0) return diff
    // Stable tiebreaker with a small jitter so tied axes rotate over time.
    return Math.random() - 0.5
  })
  const out: TopicAxis[] = []
  let i = 0
  while (out.length < slotCount) {
    out.push(ordered[i % ordered.length])
    i += 1
  }
  return out
}

/**
 * Pull the brand's documented history so we can tell the AI both "don't
 * repeat these titles" AND "don't extract these specific stories again."
 *
 * Two layers:
 *   - titles: fast, catches obvious paraphrase repeats
 *   - answers: deeper signal, catches "different title, same underlying
 *     story" - the most common failure mode of pure title-dedup.
 *
 * Caps both for prompt budget. Answers are excerpted to ~180 chars.
 */
function emptyAxisCounts(): Record<TopicAxis, number> {
  const out = {} as Record<TopicAxis, number>
  for (const a of TOPIC_AXES) out[a] = 0
  return out
}

// Common English words we don't want polluting the overlap math. Tiny
// hand-curated list - we don't need a full NLP stopwords library to detect
// "How you stopped chasing clients" overlapping with "How you stopped
// chasing leads."
const STOPWORDS = new Set<string>([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'how',
  'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'so',
  'that', 'the', 'this', 'to', 'us', 'we', 'what', 'when', 'why', 'with',
  'you', 'your', 'were', 'was',
])

function tokenize(s: string): Set<string> {
  const out = new Set<string>()
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue
    if (STOPWORDS.has(raw)) continue
    if (raw.length < 3) continue
    out.add(raw)
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter += 1
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

interface SaturationReport {
  /** 0..1. Average max-overlap between each new topic and any past title. */
  score: number
  /** True when score crosses a threshold worth surfacing to staff. */
  saturated: boolean
  /** Up to 3 example pairs the user can read to understand the warning. */
  examples: Array<{ newTitle: string; pastTitle: string; overlap: number }>
}

/**
 * For each newly-generated title, find the highest-overlap past title and
 * average those scores. High average = the batch is largely recycled. The
 * threshold is set conservatively (0.45) so the warning fires only when
 * there's a real pattern, not on a single coincidence.
 */
function computeSaturation(newTopics: FormTopic[], pastTitles: string[]): SaturationReport {
  if (pastTitles.length === 0 || newTopics.length === 0) {
    return { score: 0, saturated: false, examples: [] }
  }
  const pastTokenized = pastTitles.map((t) => ({ title: t, tokens: tokenize(t) }))
  const perTopic: Array<{ newTitle: string; pastTitle: string; overlap: number }> = []
  for (const topic of newTopics) {
    const newTokens = tokenize(topic.title)
    let best = { pastTitle: '', overlap: 0 }
    for (const p of pastTokenized) {
      const o = jaccard(newTokens, p.tokens)
      if (o > best.overlap) best = { pastTitle: p.title, overlap: o }
    }
    perTopic.push({ newTitle: topic.title, pastTitle: best.pastTitle, overlap: best.overlap })
  }
  const avg = perTopic.reduce((acc, p) => acc + p.overlap, 0) / perTopic.length
  const examples = [...perTopic]
    .filter((p) => p.overlap >= 0.4)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 3)
  return { score: avg, saturated: avg >= 0.45, examples }
}

async function loadRecentMaterial(clientId: string): Promise<RecentMaterial> {
  const empty: RecentMaterial = { titles: [], answers: [], axisCounts: emptyAxisCounts() }
  if (!clientId) return empty
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Titles from the question_forms.topics jsonb on prior batches.
  const { data: forms } = await supabase
    .from('question_forms')
    .select('topics, created_at')
    .eq('client_id', clientId)
    .not('topics', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20)

  const titles: string[] = []
  const axisCounts = emptyAxisCounts()
  const validAxisSet = new Set<string>(TOPIC_AXES)
  for (const row of forms ?? []) {
    const topics: unknown[] = Array.isArray(row.topics) ? (row.topics as unknown[]) : []
    for (const t of topics) {
      if (t && typeof t === 'object') {
        const obj = t as { title?: unknown; topic_axis?: unknown }
        if (typeof obj.title === 'string') {
          const title = obj.title.trim()
          if (title) titles.push(title)
        }
        if (typeof obj.topic_axis === 'string' && validAxisSet.has(obj.topic_axis)) {
          axisCounts[obj.topic_axis as TopicAxis] += 1
        }
      }
    }
  }
  const seenTitle = new Set<string>()
  const dedupedTitles: string[] = []
  for (const t of titles) {
    const key = t.toLowerCase()
    if (seenTitle.has(key)) continue
    seenTitle.add(key)
    dedupedTitles.push(t)
    if (dedupedTitles.length >= 40) break
  }

  // Answer signatures from the topics table - the actual material the brand
  // has documented. This is the high-leverage anti-repeat signal: even when
  // titles vary, the AI can't ask for the same stories if it sees them here.
  const { data: answerRows } = await supabase
    .from('topics')
    .select('answer, input_type, created_at')
    .eq('client_id', clientId)
    .eq('source', 'form')
    .not('input_type', 'eq', 'untyped')
    .order('created_at', { ascending: false })
    .limit(60)

  const seenAns = new Set<string>()
  const answers: RecentAnswerSig[] = []
  for (const r of answerRows ?? []) {
    const raw = typeof r.answer === 'string' ? r.answer.trim() : ''
    if (!raw) continue
    // Stable signature for dedupe - lowercase first 80 chars, normalized.
    const key = raw.slice(0, 80).toLowerCase().replace(/\s+/g, ' ')
    if (seenAns.has(key)) continue
    seenAns.add(key)
    const excerpt = raw.length > 180 ? `${raw.slice(0, 177)}...` : raw
    answers.push({
      input_type: typeof r.input_type === 'string' ? r.input_type : 'untyped',
      excerpt,
    })
    if (answers.length >= 40) break
  }

  return { titles: dedupedTitles, answers, axisCounts }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    // Clean seed titles. Cap at 20 to match topicCount ceiling. Empty
    // strings filtered out (the UI sometimes sends them).
    const seedTopics = (body.seedTopics ?? [])
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 20)

    // topicCount is bumped to fit all seeds if the caller asked for fewer.
    const requestedCount = Math.min(20, Math.max(1, body.topicCount ?? 4))
    const topicCount = Math.max(requestedCount, seedTopics.length)

    // Questions per topic scales with the client's tier / custom config so
    // every script in a campaign anchors on its own answer (see
    // deriveQuestionsPerTopic). 6 = the locked arc; extras are second-pass
    // variants of the arc.
    const questionsPerTopic = await deriveQuestionsPerTopic(body.clientId, body.questionsPerTopic)
    const expectedTypes = questionTypeSequence(questionsPerTopic)

    const ctx = clientContext(body.clientProfile ?? null, body.clientName, body.businessName, body.industry)

    const recent = body.clientId
      ? await loadRecentMaterial(body.clientId)
      : { titles: [], answers: [], axisCounts: emptyAxisCounts() }
    const recentTitles = recent.titles
    const recentAnswers = recent.answers

    // Axis rotation: pick under-represented axes for the AI-generated slots
    // (positions AFTER the seeded ones). Seeds keep their natural axis since
    // the user picked the angle. axisAssignments[i] is the axis for slot i,
    // or null for seed positions where we don't constrain the angle.
    const aiSlotCount = Math.max(0, topicCount - seedTopics.length)
    const aiAxes = pickAxesForBatch(aiSlotCount, recent.axisCounts)
    const axisAssignments: (TopicAxis | null)[] = []
    for (let i = 0; i < topicCount; i++) {
      if (i < seedTopics.length) axisAssignments.push(null)
      else axisAssignments.push(aiAxes[i - seedTopics.length] ?? null)
    }

    const system = `You design braindump forms for content creators. Your output is a JSON list of TOPICS, each with exactly ${questionsPerTopic} questions in a locked input-type order.

WHO IS ANSWERING: the brand's OWNER / FOUNDER / OPERATOR is filling out this form about their OWN journey, expertise, and business. They are NOT a customer of the brand. The brand belongs to them. They are the one with the stories, the failed attempts, the frameworks, and the proof.

NEVER frame questions as if the answerer is a happy customer being interviewed about the brand. The brand name, when used, refers to THEIR OWN company that THEY built.

Wrong framing examples (NEVER do this):
- "Tell me about your typical day before you partnered with [Brand]." (they ARE [Brand], they didn't partner with it)
- "What results have you seen since working with [Brand]?" (they ARE [Brand])
- "Describe the framework [Brand] implemented for you." (they implemented it themselves)
- "What made you discover [Brand]?" (they founded it)

Right framing examples (always do this):
- "Tell me about your typical day before you built the systems behind [Brand]."
- "What did your scriptwriting process look like when you were just starting out?"
- "Walk me through the framework you developed. What makes it different?"
- "What did you try in the early days that didn't work?"

Each topic centers on ONE specific story, transformation, or lesson the OWNER can speak from their own experience running the business or building their craft. Examples of topic-shape titles:
- "How you stopped chasing clients"
- "The first time you raised your prices"
- "Why your old offer wasn't converting"

Each topic's 6 questions surface TYPED raw material. The first 5 form a Hero's Journey arc; the 6th surfaces a contrarian opinion. The 6 input_types are LOCKED in this exact order:

  1. input_type=scene          - the origin / setup. Where the OWNER was when this started, what their day looked like.
  2. input_type=failed_attempt - the mistake or thing the OWNER tried that didn't work.
  3. input_type=turning_point  - the moment, realization, or person that changed the OWNER's direction.
  4. input_type=framework      - the method or pattern the OWNER landed on that actually worked. Specific steps, named if possible.
  5. input_type=proof          - the outcome, the result, the evidence it worked - either for the owner directly or for clients they served.
  6. input_type=opinion        - a contrarian or sharp take adjacent to this topic. What does the OWNER believe about this that most people in the space disagree with? What would they argue with a peer about? This is the raw material for hot takes, debates, and engagement reels.
${
  questionsPerTopic > 6
    ? `
SECOND-PASS QUESTIONS (${7} through ${questionsPerTopic}): after the locked 6, the arc repeats from the top (question 7 = a second scene, 8 = another failed_attempt, and so on). Every answer becomes the anchor of its OWN script, so each second-pass question MUST surface a DIFFERENT specific story than its first-pass counterpart:
- A different moment in time, a different client, a different mistake, a different flavor of proof (client result vs personal result), a second sharper or adjacent opinion.
- NEVER rephrase an earlier question in the same topic. If question 2 asked about the mistake in their process, question 8 asks about a completely different failed attempt from a different chapter of the same topic.
- If two questions would pull the same answer out of the client, one of them is wrong - rewrite it until it extracts something new.
`
    : ''
}
Question writing rules:
- Anchor every question to the topic's title. Don't ask generic "tell me about your business" questions.
- Pull from the CLIENT CONTEXT below: name pain points, desires, evergreen topics, and the audience role when it sharpens the question.
- Each question should produce a 2-6 sentence answer. Specific moments, real numbers, named people, quotes. Not yes/no.
- Address the OWNER in second person ("you"). "You" = the brand owner, never a customer.
- Optional placeholder is a short example of the kind of answer expected (under 80 chars).

Tag each topic with pillar_hint - the best-fit pillar for the topic as a whole. Allowed: ${VALID_PILLARS.join(', ')}.`

    // Block of titles the brand has already gotten in previous batches. The
    // AI is told NOT to repeat or paraphrase any of these. Without this, the
    // same prompt + brand profile produces near-identical batches every week.
    // Two-layer dedupe block. Titles catch verbatim repeats; answer
    // signatures catch the harder case where titles vary but the underlying
    // story is the same one already on file. Without the answer-signature
    // layer, the AI can rename "How you stopped chasing clients" to "The
    // breakthrough that changed your prospecting" and extract the exact
    // same scene + proof + framework. Showing the answers themselves binds
    // the AI to actual covered ground.
    const titleBlock = recentTitles.length
      ? `\nALREADY-COVERED TOPIC ANGLES (do NOT repeat any of these or generate near-paraphrases - pick fresh angles the brand hasn't touched yet):\n${recentTitles.map((t) => `- ${t}`).join('\n')}\n`
      : ''
    const answerBlock = recentAnswers.length
      ? `\nSTORIES ALREADY DOCUMENTED (the brand has typed these specific moments / proofs / frameworks in past forms - do NOT design questions that would extract any of these AGAIN, even if you label the topic differently):\n${recentAnswers.map((a) => `- (${a.input_type}) ${a.excerpt}`).join('\n')}\n\nFresh angles must surface NEW specific moments the brand hasn't documented. If the brand context only supports angles already covered, push for adjacent stories: a different client, a different timeframe, a different lesson from the same arc, a contrarian counter-angle. Do not paraphrase an existing title or re-extract an existing story.\n`
      : ''
    const dedupeBlock = titleBlock + answerBlock

    // Pre-seeded titles get reused VERBATIM as topic titles. The AI just
    // writes the questions for each. The remaining (topicCount - seeds)
    // topics are fully AI-generated. The seeded topics MUST come first in
    // the output array so the caller can rely on the order.
    const seedBlock = seedTopics.length
      ? `\nPRE-SEEDED TOPIC TITLES (the first ${seedTopics.length} topic(s) in your output MUST use these exact titles - do NOT rewrite or paraphrase them, just generate the ${questionsPerTopic} questions for each):\n${seedTopics.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n${
          topicCount > seedTopics.length
            ? `\nTopics ${seedTopics.length + 1} through ${topicCount} are AI-generated as usual - fresh angles, full title + ${questionsPerTopic} questions per topic.\n`
            : '\nAll topics in this batch are seeded; no AI-generated titles.\n'
        }`
      : ''

    // Axis assignments: tells the AI what shape each AI-generated topic
    // should take, biased toward shapes the brand has used least recently.
    // Without this, the AI keeps picking the same "safe" axes (usually
    // transformation + framework_reveal) every batch, even when other
    // axes are wide open.
    const axisAssignmentRows: string[] = []
    for (let i = 0; i < axisAssignments.length; i++) {
      const a = axisAssignments[i]
      if (!a) continue
      axisAssignmentRows.push(`${i + 1}. axis="${a}" - ${AXIS_DESCRIPTION[a]}`)
    }
    const axisBlock = axisAssignmentRows.length
      ? `\nTOPIC AXIS ASSIGNMENTS (each AI-generated slot below has a required structural angle - the topic MUST take that shape, even if the brand context could support other shapes. Stamp the assigned axis into the topic's topic_axis field in the output):\n${axisAssignmentRows.join('\n')}\n`
      : ''

    const user = `CLIENT CONTEXT:
- ${ctx}
${dedupeBlock}${seedBlock}${axisBlock}
Return ONLY a JSON object with this exact shape (no prose, no markdown, no commentary):
{
  "topics": [
    {
      "title": "the topic angle in 4-10 words",
      "pillar_hint": "one of: ${VALID_PILLARS.join(' | ')}",
      "topic_axis": "the axis assigned for this slot (or omit on seeded slots)",
      "questions": [
${expectedTypes.map((t) => `        { "input_type": "${t}", "text": "...", "placeholder": "..." }`).join(',\n')}
      ]
    }
  ]
}

Generate exactly ${topicCount} topics. Each topic MUST have exactly ${questionsPerTopic} questions in exactly this input_type order.`

    const { content: raw } = await generateScript({
      system,
      user,
      temperature: 0.7,
      // Sized to the batch: ~80 tokens per question + headroom. The old
      // fixed 4000 truncated once topics carried second-pass questions.
      maxTokens: Math.min(8000, Math.max(4000, topicCount * questionsPerTopic * 80 + 800)),
      jsonObject: true,
      // Mechanical structured-JSON - Flash-Lite is plenty.
      quality: 'cheap',
      route: 'question_form.generate',
      clientId: body.clientId,
      usageMeta: { topic_count: topicCount, questions_per_topic: questionsPerTopic },
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(raw || '{}')
    } catch {
      return NextResponse.json(
        { success: false, error: 'AI returned unparseable output - try again.' },
        { status: 500 },
      )
    }

    const rawTopics = isRecord(parsed) && Array.isArray(parsed.topics) ? parsed.topics : []
    const topics: FormTopic[] = []
    for (const t of rawTopics) {
      const normalized = normalizeTopic(t, expectedTypes)
      if (normalized) topics.push(normalized)
    }

    // Defensive: force the seeded titles back into place even if the AI
    // ignored the "use these verbatim" instruction. Position by index since
    // the prompt told the AI to put seeds first. If the AI returned fewer
    // topics than seeds, this is a no-op for the missing slots.
    for (let i = 0; i < seedTopics.length && i < topics.length; i++) {
      topics[i] = { ...topics[i], title: seedTopics[i] }
    }

    // Defensive: stamp the assigned axis onto each topic so axis history
    // stays accurate even when the AI omits the field. Seeded slots get the
    // AI's claimed axis if any (since we don't pre-assign for seeds), or
    // undefined if not present.
    for (let i = 0; i < topics.length; i++) {
      const assigned = axisAssignments[i]
      if (assigned) {
        topics[i] = { ...topics[i], topic_axis: assigned }
      }
    }

    // Saturation check: how much do these new titles overlap with the
    // brand's recent ones? Pure word-overlap (after stopword strip). If
    // the average is high, the AI is recycling - either the brand has
    // genuinely run out of fresh material or the prompts need adjusting.
    // The caller surfaces the warning to the agency staff so they can
    // decide whether to add seeds, wait, or extend the brand profile.
    const saturation = computeSaturation(topics, recentTitles)

    if (!topics.length) {
      return NextResponse.json(
        { success: false, error: 'AI returned no usable topics - try again.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, topics, saturation })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('question-form generate error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
