/**
 * One-shot rephrase: takes a question_forms row by token and rewrites every
 * question's `text` field from a customer-interview frame to a brand-owner
 * self-reflection frame, in place. Preserves every id, input_type, and
 * placeholder so existing answers stay linked via topic_group_id.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/rephrase_form_questions.ts <form-token>
 *
 * Idempotent - re-running on an already-fixed form is a no-op (the rewriter
 * recognizes brand-owner phrasing and returns it unchanged).
 */

import { createClient } from '@supabase/supabase-js'
import { generateScript } from '../src/lib/ai/provider'
import type { FormTopic, FormTopicQuestion } from '../src/lib/types/questionForm'

const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error('FAIL - missing form token. Usage: npx tsx scripts/rephrase_form_questions.ts <token>')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface FormRow {
  id: string
  client_id: string
  topics: FormTopic[] | null
}

async function main() {
  const { data, error } = await supabase
    .from('question_forms')
    .select('id, client_id, topics')
    .eq('token', TOKEN)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    console.error(`FAIL - no form found for token ${TOKEN}`)
    process.exit(1)
  }

  const form = data as FormRow
  const topics = Array.isArray(form.topics) ? form.topics : []
  if (topics.length === 0) {
    console.error('FAIL - form has no topics jsonb (might be a legacy flat-questions form).')
    process.exit(1)
  }

  // Pull brand context for the rewrite prompt so the AI knows what brand name
  // to swap "as-customer" framing against.
  const { data: clientRow } = await supabase
    .from('clients')
    .select('name, business_name, industry, brand_profile')
    .eq('id', form.client_id)
    .maybeSingle()

  const brandName = (clientRow?.business_name as string | null) || (clientRow?.name as string | null) || 'the brand'

  // Build a single batched payload of every question we need rewritten. One
  // call beats 20 small ones for cost and consistency.
  const flat: Array<{ topicIdx: number; qIdx: number; text: string; topicTitle: string; inputType: string }> = []
  topics.forEach((t, ti) => {
    t.questions.forEach((q, qi) => {
      flat.push({
        topicIdx: ti,
        qIdx: qi,
        text: q.text,
        topicTitle: t.title,
        inputType: q.input_type,
      })
    })
  })

  console.log(`Rewriting ${flat.length} questions for form ${form.id}, brand "${brandName}"...`)

  const system = `You rewrite braindump-form questions so they sound like the brand OWNER is being asked about their OWN journey, not like a customer being interviewed about the brand.

The form's brand is "${brandName}". The person answering IS the founder/owner/operator. They built ${brandName}. They are NOT a customer of it.

Wrong framing (rewrite these): "before you partnered with ${brandName}", "since working with ${brandName}", "what made you discover ${brandName}", "the framework ${brandName} implemented for you".

Right framing (rewrite TO this style): "before you built ${brandName}", "since you started applying this yourself", "in the early days", "the framework you developed", "the system you put in place".

Rules:
- Preserve the question's intent and what input_type it surfaces (scene / failed_attempt / turning_point / framework / proof).
- Keep questions in second person ("you" = the owner).
- Don't add or remove information beyond the customer-vs-owner reframe.
- If a question is already in owner-frame, return it unchanged.
- Output STRICT JSON only.`

  const user = `Rewrite these ${flat.length} questions. Return JSON in this exact shape:

{
  "rewrites": [
    { "i": 0, "text": "the rewritten question" },
    { "i": 1, "text": "..." }
  ]
}

Questions to rewrite:
${flat.map((q, i) => `${i}. [topic: "${q.topicTitle}", input_type: ${q.inputType}] ${q.text}`).join('\n')}`

  const { content } = await generateScript({
    system,
    user,
    temperature: 0.3,
    maxTokens: 4000,
    jsonObject: true,
    quality: 'cheap',
    route: 'question_form.rephrase',
    clientId: form.client_id,
    usageMeta: { token: TOKEN, count: flat.length },
  })

  let parsed: { rewrites?: Array<{ i?: number; text?: string }> }
  try {
    parsed = JSON.parse(content)
  } catch {
    console.error('FAIL - AI returned unparseable JSON:')
    console.error(content)
    process.exit(1)
  }

  const rewrites = parsed.rewrites || []
  if (rewrites.length !== flat.length) {
    console.error(`FAIL - expected ${flat.length} rewrites, got ${rewrites.length}. Aborting to avoid partial writes.`)
    process.exit(1)
  }

  // Apply rewrites in place. Topics array is cloned so we don't mutate the row
  // we read.
  const newTopics: FormTopic[] = topics.map((t) => ({
    ...t,
    questions: t.questions.map((q) => ({ ...q })),
  }))

  let changed = 0
  for (const r of rewrites) {
    if (typeof r.i !== 'number' || typeof r.text !== 'string') continue
    const item = flat[r.i]
    if (!item) continue
    const newText = r.text.trim()
    if (!newText) continue
    const old = newTopics[item.topicIdx].questions[item.qIdx] as FormTopicQuestion
    if (old.text !== newText) {
      console.log(`  [${item.topicIdx + 1}.${item.qIdx + 1}] ${item.inputType}`)
      console.log(`    -  ${old.text}`)
      console.log(`    +  ${newText}`)
      changed += 1
    }
    newTopics[item.topicIdx].questions[item.qIdx] = { ...old, text: newText }
  }

  if (changed === 0) {
    console.log('No changes needed - questions already in owner frame.')
    return
  }

  const { error: updateErr } = await supabase
    .from('question_forms')
    .update({ topics: newTopics })
    .eq('id', form.id)

  if (updateErr) {
    console.error('FAIL - update error:', updateErr)
    process.exit(1)
  }

  console.log(`\nPASS - rewrote ${changed} question(s) on form ${form.id}.`)
  console.log(`Existing answers stay linked via topic_group_id - reload the form to see the new wording.`)
}

main().catch((e) => {
  console.error('FAIL - script error:', e)
  process.exit(1)
})
