import { NextRequest, NextResponse } from 'next/server'
import type { BrandProfile } from '@/components/clients/brandProfile'
import {
  buildPrompt,
  coerceInput,
  sanitize,
  findHardBanHit,
  surgicalBanRemoval,
  ensureTitle,
  ensureCtaVerbatim,
  deriveTitle,
  type ContentType,
} from '@/lib/prompt/engine'
import { generateScript } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GenerateBody {
  clientId?: string
  clientProfile?: BrandProfile | null
  contentType?: string
  contentPillar?: string
  tier?: string
  ideaInput?: string
  ctaText?: string
  referenceScript?: string
  seriesDay?: number
  competitorPatterns?: string[]
}

function isRateLimit(msg: string): boolean {
  return /rate_limit_exceeded|Rate limit reached|RESOURCE_EXHAUSTED|429/i.test(msg || '')
}

async function callLLM(
  system: string,
  user: string,
  maxTokens: number,
  temperature: number,
  // Default to 'standard' (Flash) here — this legacy route generates ad-hoc
  // scripts and supporting micro-completions where Pro isn't needed. The
  // dedicated longform package route is what pays for Pro.
  quality: 'high' | 'standard' | 'cheap' = 'standard',
): Promise<string> {
  const { content } = await generateScript({ system, user, temperature, maxTokens, quality })
  return content
}

function needsPublishingPack(type: ContentType): boolean {
  return type !== 'story' && type !== 'text'
}

async function appendPublishingPack(script: string, system: string): Promise<string> {
  const user = `Return ONLY a publishing pack for this script. Format:
[PUBLISHING PACK]
HEADER: (6–14 words)
CAPTION: (90–160 words, 3 bullets, ends with a question)
HASHTAGS: (12–18 tags)

SCRIPT:
"""${script}"""`
  // Auxiliary description/CTA stub — short, mechanical, doesn't need Pro.
  const raw = await callLLM(system, user, 700, 0.4, 'cheap')
  return `${script.trim()}\n\n${sanitize(raw).trim()}\n`
}

/**
 * Targeted micro-repair: ask the model to rewrite ONLY the sentence
 * containing a banned phrase. Much cheaper than full regen.
 */
async function microRepairSentence(text: string, phrase: string, system: string): Promise<string> {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const offIdx = sentences.findIndex((s) => s.toLowerCase().includes(phrase.toLowerCase()))
  if (offIdx < 0) return text

  const before = sentences.slice(Math.max(0, offIdx - 1), offIdx).join(' ')
  const offender = sentences[offIdx]
  const after = sentences.slice(offIdx + 1, offIdx + 2).join(' ')

  const user = `Rewrite ONLY the middle sentence below to remove the phrase "${phrase}". Keep the meaning, the voice, and the length. Return ONLY the rewritten sentence, nothing else.

Before: ${before}
Rewrite: ${offender}
After: ${after}`

  try {
    // One-sentence micro-repair — cheap tier is plenty for swapping a banned phrase.
    const raw = await callLLM(system, user, 200, 0.4, 'cheap')
    const fixed = raw.trim().replace(/^["']|["']$/g, '')
    if (!fixed || fixed.toLowerCase().includes(phrase.toLowerCase())) {
      return surgicalBanRemoval(text, phrase)
    }
    sentences[offIdx] = fixed
    return sentences.join(' ')
  } catch {
    return surgicalBanRemoval(text, phrase)
  }
}

/**
 * Lightweight section-presence validator for the individual-creation flow.
 * The package flow has its own richer validators in validator.ts; this one
 * just checks the output contains the expected bracket sections + any count
 * constraints per content type.
 */
interface IndividualIssue { code: string; detail: string }

function requiredSectionsFor(type: ContentType): string[] {
  switch (type) {
    case 'long': return ['[TITLE]', '[HOOK]', '[SETUP]', '[ANTICIPATION]', '[TEACH]', '[REHOOK]', '[PAYOFF]', '[CTA]', '[PUBLISHING PACK]']
    case 'short': return ['[TITLE]', '[HOOK]', '[REHOOK]', '[CONNECT]', '[ENEMY]', '[REHOOK 2]', '[RELATE]', '[CLOSE]', '[CTA]', '[RELOOP]', '[PUBLISHING PACK]']
    case 'engagement': return ['[TITLE]', '[TRIGGER]', '[CONTEXT]', '[BAIT]', '[ON-SCREEN TEXT]', '[CTA]', '[PUBLISHING PACK]']
    case 'carousel': return ['[TITLE]', '[CTA]', '[PUBLISHING PACK]']
    case 'story': return ['[TITLE]']
    case 'text': return ['[TITLE]']
  }
}

function validateIndividualOutput(type: ContentType, text: string): IndividualIssue[] {
  const issues: IndividualIssue[] = []
  const t = text || ''
  for (const tag of requiredSectionsFor(type)) {
    if (!t.includes(tag)) {
      issues.push({ code: 'missing_section', detail: `Missing required section ${tag}. Every ${type} output MUST include all expected sections on their own lines.` })
    }
  }
  if (type === 'carousel') {
    const slides = (t.match(/^\s*Slide\s+\d+\s*:/gim) || []).length
    if (slides < 6 || slides > 10) {
      issues.push({ code: 'slide_count', detail: `Carousel has ${slides} slides. It MUST have 6–10 slides.` })
    }
  }
  if (type === 'story') {
    const frames = (t.match(/^\s*Frame\s+\d+\b/gim) || []).length
    if (frames < 3 || frames > 5) {
      issues.push({ code: 'frame_count', detail: `Story has ${frames} frames. It MUST have 3–5 frames.` })
    }
  }
  return issues
}

function formatIndividualIssuesForRetry(issues: IndividualIssue[]): string {
  if (!issues.length) return ''
  const bullets = issues.map((i) => `- ${i.detail}`).join('\n')
  return `YOUR PREVIOUS ATTEMPT had these structural problems. Fix ALL of them on this pass while keeping every other rule in the system prompt:\n${bullets}`
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
      return NextResponse.json({ success: false, error: 'Missing LLM credentials - set GEMINI_API_KEY (preferred) or GROQ_API_KEY.' }, { status: 500 })
    }

    const body = (await request.json()) as GenerateBody
    const input = coerceInput({
      profile: body.clientProfile ?? null,
      tier: body.tier,
      pillar: body.contentPillar,
      contentType: body.contentType,
      topic: body.ideaInput,
      cta: body.ctaText,
      referenceScript: body.referenceScript,
      seriesDay: body.seriesDay,
    })

    const prompt = buildPrompt({ ...input, competitorPatterns: body.competitorPatterns })

    console.log(
      `Generate: client=${body.clientId || 'anon'} type=${input.contentType} pillar=${input.pillar} tier=${input.tier}`,
    )

    const runOnce = async (userPrompt: string): Promise<string> => {
      return sanitize(await callLLM(prompt.system, userPrompt, prompt.maxTokens, prompt.temperature))
    }

    // ===== 1. First-pass generation =====
    let output = await runOnce(prompt.user)

    // ===== 2. Structural repairs =====
    if (needsPublishingPack(input.contentType) && !/\[publishing pack\]/i.test(output)) {
      output = await appendPublishingPack(output, prompt.system)
    }
    output = ensureCtaVerbatim(output, input.cta)
    output = ensureTitle(output, deriveTitle(input.topic))

    // ===== 3. Banned-phrase surgical repair (up to 3 phrases) =====
    for (let i = 0; i < 3; i++) {
      const ban = findHardBanHit(output)
      if (!ban) break
      console.log(`Surgical repair for banned phrase: "${ban}"`)
      output = await microRepairSentence(output, ban, prompt.system)
      output = sanitize(output)
    }

    // ===== 4. Final ban check - soft fail, never 422 the user =====
    const finalBan = findHardBanHit(output)
    if (finalBan) {
      output = surgicalBanRemoval(output, finalBan)
      output = sanitize(output)
    }

    // ===== 5. Structural validation + single retry =====
    let issues = validateIndividualOutput(input.contentType, output)
    if (issues.length) {
      console.log(`Structural issues on first pass (${issues.length}), retrying once.`)
      const retryPrompt = `${prompt.user}\n\n${formatIndividualIssuesForRetry(issues)}`
      try {
        let retried = await runOnce(retryPrompt)
        if (needsPublishingPack(input.contentType) && !/\[publishing pack\]/i.test(retried)) {
          retried = await appendPublishingPack(retried, prompt.system)
        }
        retried = ensureCtaVerbatim(retried, input.cta)
        retried = ensureTitle(retried, deriveTitle(input.topic))
        for (let i = 0; i < 3; i++) {
          const ban = findHardBanHit(retried)
          if (!ban) break
          retried = await microRepairSentence(retried, ban, prompt.system)
          retried = sanitize(retried)
        }
        const retriedIssues = validateIndividualOutput(input.contentType, retried)
        if (retriedIssues.length <= issues.length) {
          output = retried
          issues = retriedIssues
        }
      } catch (retryErr) {
        console.warn('Retry attempt failed, keeping first-pass output:', retryErr)
      }
    }

    return NextResponse.json({
      success: true,
      content: output,
      structural_issues: issues.length ? issues : undefined,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (isRateLimit(msg)) {
      return NextResponse.json({ success: false, error: msg }, { status: 429 })
    }
    console.error('Script Gen Error:', error)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
