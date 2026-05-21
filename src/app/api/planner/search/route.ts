// GET /api/planner/search?q=<query>&clientIds=id1,id2,...
//
// Cross-client slot search for the planner index page. The page sends
// the list of client ids the current user can access (resolved via
// client_memberships, same scoping as /api/planner/slot-stats) plus a
// free-text query. We search across:
//   - content_plan_slots.hook_preview (ILIKE)
//   - content_plan_slots.scheduled_date (exact match when the query
//     parses as YYYY-MM-DD)
//   - clients.name / business_name (filter by matching client ids first,
//     then return slots for those clients matching the query)
//
// Returns up to 30 most-recently-updated results across all matched
// slots, with the client name + format slug joined so the UI can render
// them directly without a second round-trip.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const RESULT_LIMIT = 30

interface SearchResult {
  slot_id: string
  client_id: string
  client_name: string
  scheduled_date: string
  stream: string
  format_slug: string | null
  hook_preview: string | null
  status: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').trim()
    const idsParam = url.searchParams.get('clientIds') ?? ''
    const clientIds = idsParam.split(',').map((s) => s.trim()).filter(Boolean)

    if (!q || clientIds.length === 0) {
      return NextResponse.json({ success: true, results: [] })
    }

    // 1. Match clients by name/business_name within the allowed set, so
    //    "acme" will surface every slot under Acme even if the slot's
    //    own text doesn't contain the query.
    const { data: nameMatches } = await admin
      .from('clients')
      .select('id')
      .in('id', clientIds)
      .or(`name.ilike.%${q}%,business_name.ilike.%${q}%`)
    const nameMatchIds = (nameMatches ?? []).map((c) => (c as { id: string }).id)

    // 2. Slot-level query. Build the OR list dynamically: always include
    //    hook_preview ILIKE. If the query is a YYYY-MM-DD, add a date
    //    equality match. Slots under name-matched clients are unioned
    //    in via id filter (separate query, then merged below).
    const orParts: string[] = [`hook_preview.ilike.%${q}%`]
    if (DATE_RE.test(q)) {
      orParts.push(`scheduled_date.eq.${q}`)
    }

    const { data: textRows, error: textErr } = await admin
      .from('content_plan_slots')
      .select('id, client_id, scheduled_date, stream, hook_preview, status, format_id, updated_at')
      .in('client_id', clientIds)
      .or(orParts.join(','))
      .order('updated_at', { ascending: false })
      .limit(RESULT_LIMIT)

    if (textErr) {
      console.error('planner search text-rows error:', textErr)
      return NextResponse.json({ success: false, error: textErr.message }, { status: 500 })
    }

    let nameRows: typeof textRows = []
    if (nameMatchIds.length > 0) {
      const { data, error } = await admin
        .from('content_plan_slots')
        .select('id, client_id, scheduled_date, stream, hook_preview, status, format_id, updated_at')
        .in('client_id', nameMatchIds)
        .order('updated_at', { ascending: false })
        .limit(RESULT_LIMIT)
      if (error) {
        console.error('planner search name-rows error:', error)
      } else {
        nameRows = data
      }
    }

    // Dedupe (a slot can match both text and client-name) and trim.
    const byId = new Map<string, NonNullable<typeof textRows>[number]>()
    for (const r of [...(textRows ?? []), ...(nameRows ?? [])]) byId.set(r.id as string, r)
    const merged = Array.from(byId.values())
      .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
      .slice(0, RESULT_LIMIT)

    // Resolve client names + format slugs in two batched queries.
    const involvedClientIds = Array.from(new Set(merged.map((r) => r.client_id as string)))
    const involvedFormatIds = Array.from(
      new Set(merged.map((r) => r.format_id as string | null).filter(Boolean)),
    ) as string[]

    const [{ data: clientsData }, { data: formatsData }] = await Promise.all([
      involvedClientIds.length > 0
        ? admin
            .from('clients')
            .select('id, name, business_name')
            .in('id', involvedClientIds)
        : Promise.resolve({ data: [] }),
      involvedFormatIds.length > 0
        ? admin
            .from('content_formats')
            .select('id, slug')
            .in('id', involvedFormatIds)
        : Promise.resolve({ data: [] }),
    ])

    const clientById = new Map(
      ((clientsData ?? []) as Array<{ id: string; name: string | null; business_name: string | null }>).map((c) => [
        c.id,
        c.business_name || c.name || 'Unnamed',
      ]),
    )
    const formatById = new Map(
      ((formatsData ?? []) as Array<{ id: string; slug: string }>).map((f) => [f.id, f.slug]),
    )

    const results: SearchResult[] = merged.map((r) => ({
      slot_id: r.id as string,
      client_id: r.client_id as string,
      client_name: clientById.get(r.client_id as string) ?? 'Unknown',
      scheduled_date: (r.scheduled_date as string) ?? '',
      stream: (r.stream as string) ?? '',
      format_slug: r.format_id ? formatById.get(r.format_id as string) ?? null : null,
      hook_preview: (r.hook_preview as string | null) ?? null,
      status: (r.status as string) ?? '',
    }))

    return NextResponse.json({ success: true, results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
