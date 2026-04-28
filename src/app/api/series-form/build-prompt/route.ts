import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  buildExternalPrompt,
  type SeriesAnswerForPrompt,
  type ExternalFormat,
  type SeriesLabel as ExternalSeriesLabel,
} from '@/lib/prompt/external'
import { normalizeBrandProfile } from '@/components/clients/brandProfile'
import type { SeriesFormat } from '@/lib/types/seriesForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface Body {
  seriesFormId?: string
}

function asExternalFormat(f: SeriesFormat | string | null | undefined): ExternalFormat {
  switch (f) {
    case 'longform':
      return 'longform'
    case 'short':
      return 'short'
    case 'carousel':
      return 'carousel'
    case 'engagement':
      return 'engagement'
    case 'story':
      return 'story'
    default:
      return 'short'
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body = (await req.json()) as Body
    const id = body.seriesFormId?.trim()
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing seriesFormId' },
        { status: 400 },
      )
    }

    const { data: form, error: formErr } = await admin
      .from('series_forms')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (formErr || !form) {
      return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 })
    }

    const { data: client } = await admin
      .from('clients')
      .select('*')
      .eq('id', form.client_id)
      .maybeSingle()

    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
    }

    const { data: answerRows } = await admin
      .from('series_answers')
      .select('question_id, question_text, entry_index, answer')
      .eq('series_form_id', id)
      .order('entry_index', { ascending: true })

    if (!answerRows || answerRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No answers yet - the client needs to submit the form before you can build the prompt.',
        },
        { status: 400 },
      )
    }

    // Map question_id -> question metadata so we can attach beat_type + anchor.
    type FormQuestion = {
      id: string
      text: string
      entry_index: number
      beat_type?: string
      anchor_field?: string
      anchor_value?: string
    }
    const questions = (Array.isArray(form.questions) ? form.questions : []) as FormQuestion[]
    const qMap = new Map<string, FormQuestion>()
    for (const q of questions) {
      if (q && typeof q.id === 'string') qMap.set(q.id, q)
    }

    const seriesAnswers: SeriesAnswerForPrompt[] = answerRows.map((row) => {
      const q = qMap.get(row.question_id)
      return {
        entry_index: row.entry_index,
        question: row.question_text,
        answer: row.answer,
        beat_type: q?.beat_type,
        anchor_field: q?.anchor_field,
        anchor_value: q?.anchor_value,
      }
    })

    const profile = normalizeBrandProfile(client.brand_profile)

    const prompt = buildExternalPrompt({
      clientProfile: profile,
      clientName: client.name,
      businessName: client.business_name,
      industry: client.industry,
      format: asExternalFormat(form.format),
      pillar: 'series',
      ctaText: form.cta_text || null,
      seriesLabel: (form.series_label as ExternalSeriesLabel) || 'Day',
      seriesLength: form.series_length || seriesAnswers.length,
      seriesAnswers,
      seriesTitle: form.title,
      brandLine: form.brand_line,
      framing: form.framing,
    })

    return NextResponse.json({
      success: true,
      prompt,
      answer_count: seriesAnswers.length,
      expected_count: form.series_length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('series-form build-prompt exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
