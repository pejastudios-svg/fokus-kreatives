// GET /api/admin/running
//
// Returns currently in-flight slot generations. Combines two signals:
//   - content_plan_slots.generation_lock_at within the 3-min TTL window
//     (server-truth: which slots are actively being processed)
//   - the in-memory concurrency counter (per-instance: who's holding a
//     slot in the pipeline RIGHT NOW)
//
// Both are surfaced. The per-client in-memory counts only reflect the
// Vercel instance that handles this request - documented as such so the
// admin understands why the number may differ from the slot count when
// there are multiple instances. At single-region small-team scale they
// match.

import { NextResponse } from 'next/server'
import { checkAdminAccess } from '@/lib/admin/guard'
import { adminDb } from '@/lib/admin/db'
import { getAllInFlight } from '@/lib/ai/concurrency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await checkAdminAccess()
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  try {
    const supabase = adminDb()
    const lockTtlMs = 3 * 60 * 1000
    const cutoff = new Date(Date.now() - lockTtlMs).toISOString()

    const [slotsRes, clientsRes] = await Promise.all([
      supabase
        .from('content_plan_slots')
        .select('id, client_id, stream, scheduled_date, generation_lock_at')
        .not('generation_lock_at', 'is', null)
        .gte('generation_lock_at', cutoff)
        .order('generation_lock_at', { ascending: false }),
      supabase.from('clients').select('id, name, business_name'),
    ])

    const clientName = new Map<string, string>()
    for (const c of clientsRes.data ?? []) {
      const row = c as { id: string; name: string | null; business_name: string | null }
      clientName.set(row.id, row.business_name || row.name || row.id.slice(0, 6))
    }

    const now = Date.now()
    const running = (slotsRes.data ?? []).map((s) => {
      const row = s as {
        id: string
        client_id: string
        stream: string
        scheduled_date: string
        generation_lock_at: string
      }
      const startedMs = Date.parse(row.generation_lock_at)
      const elapsedMs = now - startedMs
      return {
        slotId: row.id,
        clientId: row.client_id,
        clientName: clientName.get(row.client_id) ?? row.client_id.slice(0, 6),
        stream: row.stream,
        scheduledDate: row.scheduled_date,
        startedAt: row.generation_lock_at,
        elapsedMs,
        linkTarget: `/clients/${row.client_id}/planner?slot=${row.id}`,
      }
    })

    const inMemoryConcurrency = getAllInFlight().map((c) => ({
      clientId: c.clientId,
      clientName: clientName.get(c.clientId) ?? c.clientId.slice(0, 6),
      count: c.count,
    }))

    return NextResponse.json({
      success: true,
      running,
      inMemoryConcurrency,
    })
  } catch (err) {
    console.error('admin/running error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
