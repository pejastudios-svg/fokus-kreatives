import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Tier = 'beginner' | 'mid' | 'advanced'

type BioTemplate = {
  title: string
  bio_lines: string[] // EXACTLY 4 lines
  link_line: string   // EXACTLY 1 line
  notes: string
}

function normalizeOneLine(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

function titleCase(s: string): string {
  return normalizeOneLine(s)
    .split(' ')
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : w)
    .join(' ')
}

function normalizeLinkLine(url: string): string {
  const u = (url || '').trim()
  if (!u) return '👇 link below'
  return u
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .trim()
}

function pickCategory(industry: string): string {
  const i = (industry || '').toLowerCase()

  if (i.includes('content')) return 'Content Marketing'
  if (i.includes('personal brand')) return 'Personal Branding'
  if (i.includes('social media')) return 'Social Media'
  if (i.includes('marketing')) return 'Marketing'
  if (i.includes('coach')) return 'Coaching'

  // fallback: first 2–4 words of industry
  const cleaned = titleCase(industry || 'Content Marketing')
  const words = cleaned.split(' ')
  return words.slice(0, Math.min(4, Math.max(2, words.length))).join(' ')
}

function extractMechanismNames(uniqueMechanisms: string): string[] {
  // Try to grab “named systems” from your unique mechanisms field.
  // e.g. "Shoot‑Once Content System™ — ..." => "Shoot‑Once Content System™"
  const lines = (uniqueMechanisms || '')
    .split('\n')
    .map(l => normalizeOneLine(l))
    .filter(Boolean)

  const names: string[] = []
  for (const l of lines) {
    const beforeDash = l.split('—')[0]?.trim() || ''
    const beforeColon = l.split(':')[0]?.trim() || ''
    const candidate =
      (beforeDash.length >= 6 && beforeDash.length <= 40) ? beforeDash :
      (beforeColon.length >= 6 && beforeColon.length <= 40) ? beforeColon :
      ''

    if (candidate) names.push(candidate)
  }

  // Dedup
  const seen = new Set<string>()
  return names.filter(n => {
    const k = n.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 3)
}

function extractProofLine(socialProof: string): string | null {
  // Use the first line containing a digit as proof (no inventing).
  const lines = (socialProof || '')
    .split('\n')
    .map(l => normalizeOneLine(l))
    .filter(Boolean)

  const withDigits = lines.find(l => /\d/.test(l))
  return withDigits || null
}

function uniq<T>(arr: T[], keyFn: (x: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const x of arr) {
    const k = keyFn(x)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  return out
}

function buildBioTemplates(opts: {
  displayName: string
  industry: string
  targetAudience: string
  socialProof: string
  uniqueMechanisms: string
  tier: Tier
  linkLine: string
}): BioTemplate[] {
  const {
    displayName, industry, targetAudience, socialProof, uniqueMechanisms, tier, linkLine
  } = opts

  const category = pickCategory(industry)
  const mechNames = extractMechanismNames(uniqueMechanisms)
  const proof = extractProofLine(socialProof)

  // DM keywords: must be unique and “new wave”
  const keywords = tier === 'advanced'
    ? ['AUDIT', 'SYSTEM', 'MONTH', 'HOOKS', 'SCRIPTS', 'CALENDAR', 'PLAN', 'VIDEO']
    : tier === 'mid'
    ? ['MONTH', 'HOOKS', 'SCRIPTS', 'CALENDAR', 'PLAN', 'SYSTEM', 'SHOOT', 'VIDEO']
    : ['MONTH', 'HOOKS', 'SCRIPTS', 'CALENDAR', 'SHOOT', 'PLAN', 'SYSTEM', 'VIDEO']

  // Helper lines we reuse without sounding generic
  const mechLine =
    mechNames[0] ? `🧠 | ${mechNames[0]}` : '🧠 | Hooks → script → payoff'

  const proofLine = proof
    ? `📊 | ${proof}` // uses your exact proof (safe)
    : '📌 | Scripts + edits + rollout'

  // We use “you” heavily (your voice rule).
  const templates: BioTemplate[] = [
    {
      title: 'Option 1',
      bio_lines: [
        `${displayName} | ${category}`,
        '🎥 | You shoot once → post all month',
        '🪝 | Hook-first scripts (no rambling)',
        `⬇️ | DM "${keywords[0]}" for the workflow`,
      ],
      link_line: linkLine,
      notes: 'Clear process + open-loop DM CTA. Matches modern creator bio structure.',
    },
    {
      title: 'Option 2',
      bio_lines: [
        `${displayName} | ${category}`,
        '🗓️ | Monthly plan so you don’t guess',
        mechLine,
        `⬇️ | DM "${keywords[1]}" for 30 hooks`,
      ],
      link_line: linkLine,
      notes: 'Positioning + repeatable system + hooks offer. Strong for beginner/mid.',
    },
    {
      title: 'Option 3',
      bio_lines: [
        `${displayName} | ${category}`,
        '😮‍💨 | Busy? Stop forcing daily posting',
        '🎬 | Film once → we turn it into clips',
        `⬇️ | DM "${keywords[2]}" to see the system`,
      ],
      link_line: linkLine,
      notes: 'Relatable pain opener + simple transformation + curiosity CTA.',
    },
    {
      title: 'Option 4',
      bio_lines: [
        `${displayName} | ${category}`,
        '📈 | Turn expertise into inbound leads',
        '🧩 | Open loops + payoff scripts',
        `⬇️ | DM "${keywords[3]}" for a script sample`,
      ],
      link_line: linkLine,
      notes: 'Outcome-forward. Great if you want lead-gen positioning without hype.',
    },
    {
      title: 'Option 5',
      bio_lines: [
        `${displayName} | ${category}`,
        '🪝 | People skip because there’s no hook',
        '✍️ | We write hooks that keep attention',
        `⬇️ | DM "${keywords[4]}" for the hook pack`,
      ],
      link_line: linkLine,
      notes: 'Hot-take style. Fits your brand myths/hook belief.',
    },
    {
      title: 'Option 6',
      bio_lines: [
        `${displayName} | ${category}`,
        '📱 | Content that feels like you',
        proofLine,
        `⬇️ | DM "${keywords[5]}" for the monthly plan`,
      ],
      link_line: linkLine,
      notes: 'Uses real proof if available; otherwise credibility without numbers.',
    },
    {
      title: 'Option 7',
      bio_lines: [
        `${displayName} | ${category}`,
        '🎯 | Clear message → consistent content',
        '🧠 | Education • proof • story rotation',
        `⬇️ | DM "${keywords[6]}" for the content map`,
      ],
      link_line: linkLine,
      notes: 'Strong for “personal brand + authority” vibe without being salesy.',
    },
    {
      title: 'Option 8',
      bio_lines: [
        `${displayName} | ${category}`,
        '📹 | Shorts + longform that connect',
        '🧲 | Soft CTAs that pull DMs',
        `⬇️ | DM "${keywords[7]}" to get started`,
      ],
      link_line: linkLine,
      notes: 'Format coverage + lead-gen CTA. Keep for mid/advanced.',
    },
  ]

  // Fix any accidental “get started” (we used it once above) → replace with better wording
  for (const t of templates) {
    t.bio_lines = t.bio_lines.map((l) =>
      l.includes('to get started')
        ? l.replace('to get started', 'to see the workflow')
        : l
    )
  }

  // Ensure exactly 4 unique lines in bio_lines
  const cleaned = templates.map((t) => ({
    ...t,
    bio_lines: uniq(
      t.bio_lines.map(normalizeOneLine).filter(Boolean),
      (x) => x.toLowerCase()
    ).slice(0, 4),
  }))

  return cleaned
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: 'Supabase env not configured' }, { status: 500 })
    }

    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const clientId = String(body.clientId || '').trim()
    const websiteUrl = body.websiteUrl ? String(body.websiteUrl).trim() : ''
    const tierRaw = String(body.tier || '').trim().toLowerCase()
    const tier: Tier = tierRaw === 'mid' || tierRaw === 'advanced' ? (tierRaw as Tier) : 'beginner'

    if (!clientId) return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })

    const admin = createAdminClient(supabaseUrl, serviceKey)

    const { data: client, error: cErr } = await admin
      .from('clients')
      .select('id,name,business_name,industry,target_audience,social_proof,unique_mechanisms,website_url')
      .eq('id', clientId)
      .single()

    if (cErr || !client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })

    const displayName = titleCase(client.business_name || client.name || 'Brand')
    const linkLine = normalizeLinkLine(websiteUrl || client.website_url || '')

    const templates = buildBioTemplates({
      displayName,
      industry: String(client.industry || ''),
      targetAudience: String(client.target_audience || ''),
      socialProof: String(client.social_proof || ''),
      uniqueMechanisms: String(client.unique_mechanisms || ''),
      tier,
      linkLine,
    })

    // Guarantee 8 always
    return NextResponse.json({ success: true, templates })
  } catch (e: any) {
    console.error('bio/generate error', e)
    return NextResponse.json({ success: false, error: e?.message || 'Server error' }, { status: 500 })
  }
}