import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Tier = 'beginner' | 'mid' | 'advanced'

type ResearchInputs = {
  painPoints: string
  competitorInsights: string
  transcriptHighlights: string[] // OPTIONAL: we treat as highlight lines, not raw transcripts
}

type EvidenceItem = {
  id: string
  source: 'pain_points' | 'competitor_insights' | 'transcript_highlight'
  text: string
}

type CalendarItemOut = {
  content_type: string
  platform: string
  pillar: string
  hook: string
  topic: string
  rationale: string
  research_basis: string
  evidence_id: string
  cta: string
}

function extractJson(raw: string): unknown | null {
  const t = (raw || '').trim()
  if (!t) return null
  try { return JSON.parse(t) } catch {}
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try { return JSON.parse(t.slice(start, end + 1)) } catch { return null }
}

function normalizeOneLine(s: string) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

function totalCount(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, v) => sum + (Number(v) || 0), 0)
}

function monthDates(monthStartISO: string): string[] {
  const d = new Date(monthStartISO + 'T00:00:00Z')
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const out: string[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    const yyyy = String(year)
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    out.push(`${yyyy}-${mm}-${dd}`)
  }
  return out
}

function hasRealResearch(inputs: ResearchInputs) {
  const pp = (inputs.painPoints || '').trim()
  const ci = (inputs.competitorInsights || '').trim()
  const th = (inputs.transcriptHighlights || []).map(s => (s || '').trim()).filter(Boolean)
  return pp.length >= 120 || ci.length >= 120 || th.length >= 5
}

function buildEvidence(inputs: ResearchInputs): EvidenceItem[] {
  const out: EvidenceItem[] = []

  const ppLines = (inputs.painPoints || '')
    .split('\n')
    .map((l) => normalizeOneLine(l))
    .filter((l) => l.length >= 25)

  const ciLines = (inputs.competitorInsights || '')
    .split('\n')
    .map((l) => normalizeOneLine(l))
    .filter((l) => l.length >= 25)

  const thLines = (inputs.transcriptHighlights || [])
    .flatMap((block) => block.split('\n'))
    .map((l) => normalizeOneLine(l))
    .filter((l) => l.length >= 25)

  let i = 1
  for (const l of ppLines.slice(0, 40)) out.push({ id: `PP${i++}`, source: 'pain_points', text: l })

  i = 1
  for (const l of ciLines.slice(0, 40)) out.push({ id: `CI${i++}`, source: 'competitor_insights', text: l })

  i = 1
  for (const l of thLines.slice(0, 40)) out.push({ id: `TH${i++}`, source: 'transcript_highlight', text: l })

  return out
}

function hasNumbersOrMoneyOrPercent(s: string) {
  return /[$%]|\d/.test(s)
}

function splitIntoBatches(n: number, batchSize: number): number[] {
  const out: number[] = []
  let remaining = n
  while (remaining > 0) {
    out.push(Math.min(batchSize, remaining))
    remaining -= batchSize
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const groqKey = process.env.GROQ_API_KEY

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: 'Supabase env not configured' }, { status: 500 })
    }
    if (!groqKey) {
      return NextResponse.json({ success: false, error: 'GROQ_API_KEY not configured' }, { status: 500 })
    }

    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient(supabaseUrl, serviceKey)

    const body = (await req.json()) as {
      clientId: string
      name: string
      monthStart: string
      tier: Tier
      platforms: string[]
      counts: Record<string, number>
      painPoints: string
      competitorInsights: string
      transcripts?: string[] // we treat these as optional; best practice is highlights
    }

    const clientId = String(body.clientId || '').trim()
    const name = String(body.name || '').trim() || 'Content Calendar'
    const monthStart = String(body.monthStart || '').trim()
    const tier = (String(body.tier || 'beginner').toLowerCase() as Tier) || 'beginner'
    const platforms = Array.isArray(body.platforms) ? body.platforms.map((p) => String(p).toLowerCase()) : ['instagram']
    const counts = (body.counts && typeof body.counts === 'object') ? body.counts : {}

    const researchInputs: ResearchInputs = {
      painPoints: String(body.painPoints || ''),
      competitorInsights: String(body.competitorInsights || ''),
      transcriptHighlights: Array.isArray(body.transcripts) ? body.transcripts.map(String) : [],
    }

    const wanted = totalCount(counts)
    if (!clientId || !monthStart) {
      return NextResponse.json({ success: false, error: 'Missing clientId or monthStart' }, { status: 400 })
    }
    if (wanted <= 0) {
      return NextResponse.json({ success: false, error: 'Counts total must be > 0' }, { status: 400 })
    }
    if (!hasRealResearch(researchInputs)) {
      return NextResponse.json(
        { success: false, error: 'Add real research first (pain points/competitor insights/transcript highlights). Generator will not guess.' },
        { status: 400 }
      )
    }

    const evidence = buildEvidence(researchInputs)
    if (evidence.length < 8) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Your research text is too unstructured. Paste it as one idea per line (25+ chars each). Need at least 8 usable evidence lines.',
        },
        { status: 400 }
      )
    }

    const evidenceMap = new Map<string, EvidenceItem>(evidence.map((e) => [e.id, e]))
    const evidenceBlock = evidence
      .map((e) => `${e.id} [${e.source}]: ${e.text}`)
      .join('\n')

    const groq = new Groq({ apiKey: groqKey })

    const system = `
You are a senior content strategist building a research-based content calendar.
You DO NOT guess. You ONLY use the evidence lines provided.
Return ONLY valid JSON. No markdown.
`.trim()

    const allowedPlatforms = platforms.length ? platforms : ['instagram']
    const batchSize = 10

    const countsEntries = Object.entries(counts)
      .map(([k, v]) => [String(k), Number(v) || 0] as const)
      .filter(([, v]) => v > 0)

    const allItems: CalendarItemOut[] = []

    for (const [contentType, countForType] of countsEntries) {
      const batches = splitIntoBatches(countForType, batchSize)

      for (const size of batches) {
        // retry this batch a couple times if the model picks invalid evidence_id
        let lastRaw = ''
        let batchItems: CalendarItemOut[] | null = null

        for (let attempt = 1; attempt <= 3; attempt++) {
          const userPrompt = `
SETTINGS
- Tier: ${tier}
- Allowed platforms: ${allowedPlatforms.join(', ')}
- Content type for this batch: ${contentType}
- Items to generate in this batch: ${size}

LOCKED EVIDENCE LINES (the ONLY allowed research)
You MUST cite one evidence_id from this list for every item (do not invent IDs):

${evidenceBlock}

NON-NEGOTIABLE RULES
- Generate EXACTLY ${size} items.
- All items must have content_type exactly "${contentType}".
- platform must be one of: ${allowedPlatforms.join(', ')}.
- evidence_id must be one of the IDs listed above.
- Do NOT invent numbers, money, or percentages. If hook/topic/cta contains any number/$/% then the chosen evidence line MUST contain that same number/$/%.
- Avoid generic hooks. No "What if I told you..." more than once.
- Every string must be ONE LINE. No trailing commas.

Return JSON:

{
  "items": [
    {
      "content_type": "${contentType}",
      "platform": "instagram|tiktok|youtube|linkedin|facebook",
      "pillar": "Educational|Storytelling|Authority|Series|Double Down",
      "hook": "...",
      "topic": "...",
      "rationale": "...",
      "research_basis": "Explain why this evidence line matters",
      "evidence_id": "PP1|CI2|TH3",
      "cta": "..."
    }
  ]
}
`.trim()

          const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            temperature: 0.45,
            max_tokens: 2200,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userPrompt },
            ],
          })

          lastRaw = completion.choices[0]?.message?.content || ''
          const parsedUnknown = extractJson(lastRaw)
          if (!parsedUnknown || typeof parsedUnknown !== 'object') continue

          const parsed = parsedUnknown as { items?: unknown }
          if (!Array.isArray(parsed.items) || parsed.items.length !== size) continue

          const candidate = parsed.items as CalendarItemOut[]

          // Validate evidence IDs exist + numeric claim rule
          let ok = true
          for (const it of candidate) {
            const eid = normalizeOneLine(it.evidence_id)
            const ev = evidenceMap.get(eid)
            if (!ev) { ok = false; break }

            const hook = normalizeOneLine(it.hook)
            const topic = normalizeOneLine(it.topic)
            const cta = normalizeOneLine(it.cta)

            if (hasNumbersOrMoneyOrPercent(hook + ' ' + topic + ' ' + cta) && !hasNumbersOrMoneyOrPercent(ev.text)) {
              ok = false
              break
            }

            it.content_type = contentType
            it.platform = normalizeOneLine(it.platform).toLowerCase()
          }

          if (ok) {
            batchItems = candidate
            break
          }
        }

        if (!batchItems) {
          return NextResponse.json(
            { success: false, error: `AI failed validation for batch "${contentType}"`, raw: lastRaw },
            { status: 500 }
          )
        }

        allItems.push(...batchItems)
      }
    }

    if (allItems.length !== wanted) {
      return NextResponse.json(
        { success: false, error: `Internal mismatch: got ${allItems.length}, expected ${wanted}` },
        { status: 500 }
      )
    }

    // Create calendar row
    const { data: cal, error: calErr } = await admin
      .from('content_calendars')
      .insert({
        client_id: clientId,
        name,
        month_start: monthStart,
        tier,
        platforms: allowedPlatforms,
        counts,
        research_inputs: researchInputs,
        created_by: user.id,
      })
      .select()
      .single()

    if (calErr || !cal) {
      return NextResponse.json({ success: false, error: calErr?.message || 'Failed to create calendar' }, { status: 500 })
    }

    const calendarId = cal.id as string
    const days = monthDates(monthStart)

    // Insert items with server-assigned dates + stored evidence text
    const rows = allItems.map((it, idx) => {
      const day = days[idx % days.length]
      const eid = normalizeOneLine(it.evidence_id)
      const ev = evidenceMap.get(eid)!

      return {
        calendar_id: calendarId,
        day,
        content_type: normalizeOneLine(it.content_type),
        platform: normalizeOneLine(it.platform).toLowerCase(),
        pillar: normalizeOneLine(it.pillar),
        hook: normalizeOneLine(it.hook),
        topic: normalizeOneLine(it.topic),
        rationale: normalizeOneLine(it.rationale),
        research_basis: normalizeOneLine(it.research_basis),
        evidence_id: eid,
        evidence_source: ev.source,
        evidence_snippet: ev.text, // exact line you provided
        cta: normalizeOneLine(it.cta),
        script: null,
        position: idx,
      }
    })

    const { error: insErr } = await admin.from('content_calendar_items').insert(rows)
    if (insErr) {
      return NextResponse.json({ success: false, error: insErr.message || 'Failed to insert items' }, { status: 500 })
    }

    return NextResponse.json({ success: true, calendarId })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Server error'
    console.error('calendars/create error', e)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}