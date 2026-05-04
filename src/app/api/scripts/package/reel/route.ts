import { NextRequest, NextResponse } from 'next/server'
import type { BrandProfile } from '@/components/clients/brandProfile'
import { sanitize, findHardBanHit, surgicalBanRemoval } from '@/lib/prompt/engine'
import { buildReelPrompt, type PackagePillar } from '@/lib/prompt/packagePrompt'
import { validateReelStructure, formatIssuesForRetry } from '@/lib/prompt/validator'
import { generateScript } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  clientProfile?: BrandProfile | null
  pillar?: string
  longformScript?: string
  index?: number
  total?: number
  previousAngles?: string[]
  ctaText?: string | null
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
    const longformScript = (body.longformScript || '').trim()
    if (!longformScript) {
      return NextResponse.json({ success: false, error: 'longformScript is required' }, { status: 400 })
    }

    const prompt = buildReelPrompt({
      profile: body.clientProfile ?? null,
      pillar: normalizePillar(body.pillar),
      longformScript,
      index: body.index ?? 1,
      total: body.total ?? 10,
      previousAngles: body.previousAngles ?? [],
      ctaText: body.ctaText ?? null,
    })

    const runOnce = async (userPrompt: string) => {
      const { content } = await generateScript({
        system: prompt.system,
        user: userPrompt,
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
        // Repurpose inherits voice from the longform source - Flash handles
        // it cleanly at ~4x lower cost than Pro.
        quality: 'standard',
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
    let issues = validateReelStructure(output)
    if (issues.length) {
      const retryPrompt = `${prompt.user}\n\n${formatIssuesForRetry(issues)}`
      const retried = await runOnce(retryPrompt)
      const retriedIssues = validateReelStructure(retried)
      if (retriedIssues.length <= issues.length) {
        output = retried
        issues = retriedIssues
      }
    }

    return NextResponse.json({ success: true, content: output, structural_issues: issues.length ? issues : undefined })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('package reel error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
