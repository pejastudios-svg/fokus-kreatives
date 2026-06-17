import { admin } from '@/lib/emailOutbox'
import { generateScript } from '@/lib/ai/provider'
import { sanitize, findHardBanHit, surgicalBanRemoval } from '@/lib/prompt/engine'
import { clientContextBlock, voiceFingerprintLine } from '@/lib/prompt/brandContext'
import { normalizeBrandProfile } from '@/components/clients/brandProfile'
import type { EmailCta, EmailMarketingSettings } from './types'

/**
 * AI generation for campaign value emails.
 *
 * Source material is the client's REAL documented answers (topics table,
 * source='form') plus their brand profile - the same substrate scripts are
 * generated from, so the email teaches something the client actually said,
 * never invented content. Every used answer id is recorded in source_refs
 * and excluded from future picks, so material is never reused.
 *
 * Structure follows the researched value-email anatomy: short subject,
 * preheader extending it, hook title, one-idea body (story -> lesson ->
 * application), rotated CTA block, single PS line.
 */

interface TopicAnswer {
  id: string
  question: string | null
  answer: string
  input_type: string | null
  topic_group_id: string | null
}

export interface GeneratedEmailDraft {
  subject: string
  preheader: string
  hook_title: string
  body: string
  ps: string
  source_refs: string[]
  /** Unused form answers left AFTER this email - drives the "running low,
   *  send the client a new questions form" alert. */
  remainingAnswers: number
}

/** Collect every topics.id already consumed by this client's campaign emails. */
async function loadUsedRefs(clientId: string): Promise<Set<string>> {
  const { data } = await admin()
    .from('email_campaign_emails')
    .select('source_refs')
    .eq('client_id', clientId)
  const used = new Set<string>()
  for (const row of data || []) {
    for (const id of (row.source_refs as string[] | null) || []) used.add(id)
  }
  return used
}

/**
 * Pick the next answer group to teach from: prefer whole topic groups (5-6
 * answers around one story arc), newest first, skipping thin answers and
 * anything already used. Falls back to the 4 most substantial loose answers.
 * Also reports how many fresh answers exist overall, for the low-material
 * alert.
 */
async function pickSourceMaterial(
  clientId: string,
): Promise<{ material: TopicAnswer[]; freshTotal: number }> {
  const { data } = await admin()
    .from('topics')
    .select('id, question, answer, input_type, topic_group_id, created_at')
    .eq('client_id', clientId)
    .eq('source', 'form')
    .or('thin_flag.is.null,thin_flag.eq.false')
    .order('created_at', { ascending: false })
    .limit(400)
  const rows = ((data || []) as unknown as TopicAnswer[]).filter(
    (r) => r.answer && r.answer.trim().length >= 30,
  )
  if (rows.length === 0) return { material: [], freshTotal: 0 }

  const used = await loadUsedRefs(clientId)
  const fresh = rows.filter((r) => !used.has(r.id))
  if (fresh.length === 0) return { material: [], freshTotal: 0 }

  // Group by topic_group_id; newest group with >= 2 fresh answers wins.
  const groups = new Map<string, TopicAnswer[]>()
  for (const r of fresh) {
    if (!r.topic_group_id) continue
    const arr = groups.get(r.topic_group_id) || []
    arr.push(r)
    groups.set(r.topic_group_id, arr)
  }
  for (const arr of groups.values()) {
    if (arr.length >= 2) return { material: arr.slice(0, 6), freshTotal: fresh.length }
  }
  return { material: fresh.slice(0, 4), freshTotal: fresh.length }
}

/** Last sent/drafted emails for the client - the AI is told to take a
 *  different angle from these so consecutive emails never feel repetitive. */
async function loadRecentEmailAngles(
  clientId: string,
): Promise<Array<{ subject: string; hook: string }>> {
  const { data } = await admin()
    .from('email_campaign_emails')
    .select('subject, hook_title, created_at')
    .eq('client_id', clientId)
    .neq('status', 'canceled')
    .order('created_at', { ascending: false })
    .limit(10)
  return (data || [])
    .map((r) => ({ subject: String(r.subject || ''), hook: String(r.hook_title || '') }))
    .filter((r) => r.subject || r.hook)
}

/** Round-robin CTA pick driven by how many emails the campaign already has. */
export function rotateCtas(
  allCtas: EmailCta[],
  campaignCtaIds: string[],
  pastEmailCount: number,
): EmailCta[] {
  const pool = campaignCtaIds.length
    ? allCtas.filter((c) => campaignCtaIds.includes(c.id))
    : allCtas
  if (pool.length <= 2) return pool
  // Two CTAs per email (link-count ceiling), rotating through the pool.
  const start = pastEmailCount % pool.length
  return [pool[start], pool[(start + 1) % pool.length]]
}

export function pickCustomPs(psPool: string[], pastEmailCount: number): string {
  if (psPool.length === 0) return ''
  return psPool[pastEmailCount % psPool.length]
}

function stripBans(text: string): string {
  let out = sanitize(text)
  for (let i = 0; i < 6; i++) {
    const hit = findHardBanHit(out)
    if (!hit) break
    out = surgicalBanRemoval(out, hit)
  }
  return out
}

export async function generateCampaignEmail(args: {
  clientId: string
  campaignId: string
  topicFocus?: string | null
  psMode: 'ai' | 'custom' | 'none'
  settings: EmailMarketingSettings
  /** For CTA/PS rotation. */
  pastEmailCount: number
  campaignCtaIds: string[]
}): Promise<GeneratedEmailDraft & { ctas: EmailCta[] }> {
  const db = admin()
  const { data: client } = await db
    .from('clients')
    .select('name, business_name, brand_profile, email_from_name')
    .eq('id', args.clientId)
    .maybeSingle()
  if (!client) throw new Error('Client not found')

  const profile = normalizeBrandProfile(
    (client.brand_profile as Record<string, unknown> | null) ?? null,
  )
  const senderName =
    (client.email_from_name as string | null) ||
    (client.business_name as string | null) ||
    (client.name as string | null) ||
    'the sender'

  const { material, freshTotal } = await pickSourceMaterial(args.clientId)
  if (material.length === 0) {
    throw new Error(
      'No unused form answers available. Have the client fill a questions form, or write this email manually.',
    )
  }
  const recentAngles = await loadRecentEmailAngles(args.clientId)

  const materialBlock = material
    .map((m, i) => {
      const q = (m.question || '').trim()
      return `${i + 1}. ${q ? `Q: ${q}\n   A: ` : ''}${m.answer.trim()}`
    })
    .join('\n')

  const system = [
    `You write value emails for ${senderName}'s email list. The list is leads who opted in - warm but not customers yet.`,
    '',
    clientContextBlock(profile, 'minimal'),
    voiceFingerprintLine(profile, 'light'),
    '',
    'STRUCTURE (one idea per email, taught from the documented material below):',
    '- subject: under 45 characters, payload word first, curiosity with enough clarity that the open feels safe. No clickbait, no exclamation marks, no emoji.',
    '- preheader: 40-90 characters that extend the subject (never repeat it).',
    '- hook_title: one line shown at the top of the email, a quick hook on what the email is about.',
    '- body: 150-250 words of genuine teaching. Arc: a concrete moment or struggle from the material, the lesson it taught, then exactly how the reader applies it today. Short paragraphs (1-3 lines) separated by blank lines. Write like a person, first person, as the sender.',
    '- ps: one witty, warm line (max 25 words) that teases the next email or restates the value. No links.',
    '',
    'HARD RULES:',
    '- Use ONLY facts, stories and opinions present in the material. Never invent results, numbers or anecdotes.',
    ...(recentAngles.length > 0
      ? [
          '- The list already received the emails below. Do NOT repeat their angle, story, opening move, or subject-line pattern. Pick a clearly different way in (different emotion, different format: story vs list vs hot take vs question).',
          ...recentAngles.map((r) => `  * "${r.subject}" / hook: "${r.hook}"`),
        ]
      : []),
    '- Never use em dashes.',
    '- No "Hey {name}" greeting line; the body starts directly with the hook moment.',
    '- No sign-off line; the email template adds everything after the body.',
    '- Plain text only. No markdown, no asterisks, no headings.',
    '',
    'Return JSON: {"subject": "...", "preheader": "...", "hook_title": "...", "body": "...", "ps": "..."}',
  ].join('\n')

  const user = [
    `DOCUMENTED MATERIAL (the sender's real answers):\n${materialBlock}`,
    args.topicFocus ? `\nANGLE TO FOCUS ON: ${args.topicFocus}` : '',
    '\nWrite the email now.',
  ].join('\n')

  const { content: raw } = await generateScript({
    system,
    user,
    temperature: 0.7,
    maxTokens: 1200,
    jsonObject: true,
    quality: 'standard',
    route: 'email_marketing.generate',
    clientId: args.clientId,
    usageMeta: { campaign_id: args.campaignId },
  })

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    throw new Error('AI returned malformed output. Try again.')
  }

  const subject = stripBans(String(parsed.subject || '')).trim()
  const body = stripBans(String(parsed.body || '')).trim()
  if (!subject || !body) throw new Error('AI returned an empty email. Try again.')

  let ps = ''
  if (args.psMode === 'ai') ps = stripBans(String(parsed.ps || '')).trim()
  else if (args.psMode === 'custom') ps = pickCustomPs(args.settings.ps_pool, args.pastEmailCount)

  return {
    subject,
    preheader: stripBans(String(parsed.preheader || '')).trim(),
    hook_title: stripBans(String(parsed.hook_title || '')).trim(),
    body,
    ps,
    source_refs: material.map((m) => m.id),
    remainingAnswers: Math.max(0, freshTotal - material.length),
    ctas: rotateCtas(args.settings.ctas, args.campaignCtaIds, args.pastEmailCount),
  }
}
