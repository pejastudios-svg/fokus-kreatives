// GET /api/admin/overview
//
// Header strip data + sparklines + per-client/per-team summaries.
// Single call, fans out into ~6 parallel queries against the
// service-role admin DB. Cached briefly (no-store on the response;
// React Query / SWR layer can hold it for a bit).
//
// Returns:
//   counts: { clients, team, activePlans, eventsToday, errorsToday }
//   spendThisMonth: number (USD)
//   sparklines: { eventsPerHour: number[24], costPerDay: number[7], successRate: number[7] }
//   clients: ClientSummary[]
//   team: UserSummary[]

import { NextResponse } from 'next/server'
import { checkAdminAccess } from '@/lib/admin/guard'
import { adminDb } from '@/lib/admin/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ClientSummary {
  id: string
  name: string
  tier: 'top' | 'middle' | 'lower' | 'custom' | null
  slotsActive: number
  spendThisMonth: number
}

interface UserSummary {
  id: string
  name: string
  email: string | null
  role: string
  actionsToday: number
}

function startOfDayUTC(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function startOfMonthUTC(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export async function GET() {
  const gate = await checkAdminAccess()
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  try {
    const supabase = adminDb()
    const now = new Date()
    const monthStart = startOfMonthUTC(now).toISOString()
    const dayStart = startOfDayUTC(now).toISOString()
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [
      clientsRes,
      usersRes,
      activeSlotsRes,
      spendRes,
      todayUsageRes,
      last24hUsageRes,
      last7dUsageRes,
    ] = await Promise.all([
      supabase
        .from('clients')
        .select('id, name, business_name, package_tier'),
      // Mirror the /team page exactly: only agency staff. CRM-team
      // members get a users row too (role='employee', is_agency_user=
      // false) when they accept a per-client invite - those don't
      // belong on the admin Team list.
      supabase
        .from('users')
        .select('id, name, email, role')
        .eq('is_agency_user', true),
      supabase
        .from('content_plan_slots')
        .select('client_id, status'),
      supabase
        .from('ai_usage_log')
        .select('client_id, cost_usd')
        .gte('created_at', monthStart),
      supabase
        .from('ai_usage_log')
        .select('id, user_id, success, created_at')
        .gte('created_at', dayStart),
      supabase
        .from('ai_usage_log')
        .select('created_at')
        .gte('created_at', last24h)
        .order('created_at', { ascending: true }),
      supabase
        .from('ai_usage_log')
        .select('created_at, success, cost_usd')
        .gte('created_at', last7d)
        .order('created_at', { ascending: true }),
    ])

    // ---- Per-client summaries ----
    const slotsActiveByClient = new Map<string, number>()
    for (const r of activeSlotsRes.data ?? []) {
      const row = r as { client_id: string; status: string }
      if (row.status === 'drafted' || row.status === 'planned') {
        slotsActiveByClient.set(
          row.client_id,
          (slotsActiveByClient.get(row.client_id) ?? 0) + 1,
        )
      }
    }
    const spendByClient = new Map<string, number>()
    let totalSpend = 0
    for (const r of spendRes.data ?? []) {
      const row = r as { client_id: string | null; cost_usd: number | null }
      const cost = row.cost_usd ?? 0
      totalSpend += cost
      if (row.client_id) {
        spendByClient.set(row.client_id, (spendByClient.get(row.client_id) ?? 0) + cost)
      }
    }
    const clients: ClientSummary[] = (clientsRes.data ?? []).map((c) => {
      const row = c as {
        id: string
        name: string | null
        business_name: string | null
        package_tier: 'top' | 'middle' | 'lower' | 'custom' | null
      }
      return {
        id: row.id,
        name: row.business_name || row.name || row.id.slice(0, 6),
        tier: row.package_tier,
        slotsActive: slotsActiveByClient.get(row.id) ?? 0,
        spendThisMonth: spendByClient.get(row.id) ?? 0,
      }
    })
    clients.sort((a, b) => b.spendThisMonth - a.spendThisMonth)

    // ---- Team summaries ----
    const actionsByUser = new Map<string, number>()
    let errorsToday = 0
    for (const r of todayUsageRes.data ?? []) {
      const row = r as { user_id: string | null; success: boolean }
      if (!row.success) errorsToday += 1
      if (row.user_id) {
        actionsByUser.set(row.user_id, (actionsByUser.get(row.user_id) ?? 0) + 1)
      }
    }
    const team: UserSummary[] = (usersRes.data ?? [])
      .filter((u) => {
        const role = (u as { role: string }).role
        return role && role !== 'client'
      })
      .map((u) => {
        const row = u as {
          id: string
          name: string | null
          email: string | null
          role: string
        }
        return {
          id: row.id,
          name: row.name || row.email || row.id.slice(0, 6),
          email: row.email,
          role: row.role,
          actionsToday: actionsByUser.get(row.id) ?? 0,
        }
      })
    team.sort((a, b) => b.actionsToday - a.actionsToday)

    // ---- Sparklines ----
    // events per hour for last 24h - 24 buckets
    const eventsPerHour = new Array<number>(24).fill(0)
    const nowMs = now.getTime()
    for (const r of last24hUsageRes.data ?? []) {
      const t = Date.parse((r as { created_at: string }).created_at)
      const hoursAgo = Math.floor((nowMs - t) / (60 * 60 * 1000))
      const bucket = 23 - hoursAgo
      if (bucket >= 0 && bucket < 24) eventsPerHour[bucket] += 1
    }

    // cost per day for last 7d - 7 buckets
    const costPerDay = new Array<number>(7).fill(0)
    const succPerDay = new Array<number>(7).fill(0)
    const totalPerDay = new Array<number>(7).fill(0)
    for (const r of last7dUsageRes.data ?? []) {
      const row = r as { created_at: string; success: boolean; cost_usd: number | null }
      const t = Date.parse(row.created_at)
      const daysAgo = Math.floor((nowMs - t) / (24 * 60 * 60 * 1000))
      const bucket = 6 - daysAgo
      if (bucket >= 0 && bucket < 7) {
        costPerDay[bucket] += row.cost_usd ?? 0
        totalPerDay[bucket] += 1
        if (row.success) succPerDay[bucket] += 1
      }
    }
    const successRate = totalPerDay.map((t, i) => (t === 0 ? 1 : succPerDay[i] / t))

    // ---- Active plans count: clients with at least one drafted slot ----
    const activePlans = new Set<string>()
    for (const id of slotsActiveByClient.keys()) activePlans.add(id)

    return NextResponse.json({
      success: true,
      counts: {
        clients: clients.length,
        team: team.length,
        activePlans: activePlans.size,
        eventsToday: todayUsageRes.data?.length ?? 0,
        errorsToday,
      },
      spendThisMonth: totalSpend,
      sparklines: {
        eventsPerHour,
        costPerDay,
        successRate,
      },
      clients,
      team,
    })
  } catch (err) {
    console.error('admin/overview error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
