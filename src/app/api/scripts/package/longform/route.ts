import { NextRequest, NextResponse } from 'next/server'
import type { BrandProfile } from '@/components/clients/brandProfile'
import { sanitize, findHardBanHit, surgicalBanRemoval } from '@/lib/prompt/engine'
import { buildLongformPackagePrompt, type PackagePillar } from '@/lib/prompt/packagePrompt'
import { validateLongformStructure, formatIssuesForRetry } from '@/lib/prompt/validator'
import { generateScript } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  clientProfile?: BrandProfile | null
  pillar?: string
  topicAnswer?: string
  topicQuestion?: string | null
  ctaText?: string | null
  referenceScript?: string | null
  seriesDay?: number | null
}

function normalizePillar(p: string | undefined): PackagePillar {
  const x = (p || '').toLowerCase().replace(/\s|-/g, '')
  if (x.includes('story')) return 'storytelling'
  if (x.includes('author')) return 'authority'
  if (x.includes('series')) return 'series'
  if (x.includes('double')) return 'doubledown'
  return 'educational'
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    const topicAnswer = (body.topicAnswer || '').trim()
    if (!topicAnswer) {
      return NextResponse.json({ success: false, error: 'topicAnswer is required — pick a topic from the bank first.' }, { status: 400 })
    }

    const prompt = buildLongformPackagePrompt({
      profile: body.clientProfile ?? null,
      pillar: normalizePillar(body.pillar),
      topicAnswer,
      topicQuestion: body.topicQuestion ?? null,
      ctaText: body.ctaText ?? null,
      referenceScript: body.referenceScript ?? null,
      seriesDay: body.seriesDay ?? null,
    })

    const runOnce = async (userPrompt: string) => {
      const { content } = await generateScript({
        system: prompt.system,
        user: userPrompt,
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
      })
      let sanitized = sanitize(content)
      for (let i = 0; i < 2; i++) {
        const ban = findHardBanHit(sanitized)
        if (!ban) break
        sanitized = sanitize(surgicalBanRemoval(sanitized, ban))
      }
      return sanitized
    }

    let output = await runOnce(prompt.user)
    let issues = validateLongformStructure(output)

    if (issues.length) {
      const retryPrompt = `${prompt.user}\n\n${formatIssuesForRetry(issues)}`
      const retried = await runOnce(retryPrompt)
      const retriedIssues = validateLongformStructure(retried)
      if (retriedIssues.length <= issues.length) {
        output = retried
        issues = retriedIssues
      }
    }

    return NextResponse.json({
      success: true,
      content: output,
      structural_issues: issues.length ? issues : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('package longform error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
