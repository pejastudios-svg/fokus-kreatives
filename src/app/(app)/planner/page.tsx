'use client'

// Planner index. The planner is per-client, so this page lists clients with
// quick links into each one's calendar. Sorted by most-recently-active in the
// planner (most recent slot updated_at) so the brands you're working on now
// surface to the top.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { CalendarRange, Loader2, Sparkles } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { createClient } from '@/lib/supabase/client'
import { useAgencyUser } from '@/components/auth/AgencyUserContext'

interface ClientRow {
  id: string
  name: string | null
  business_name: string | null
  profile_picture_url: string | null
  package_tier: 'top' | 'middle' | 'lower' | null
  archived_at: string | null
  created_at: string | null
}

interface ClientWithStats extends ClientRow {
  totalSlots: number
  approvedSlots: number
  lastActivity: string | null
}

const TIER_TONE: Record<NonNullable<ClientRow['package_tier']>, 'success' | 'info' | 'warning'> = {
  top: 'success',
  middle: 'info',
  lower: 'warning',
}

export default function PlannerIndexPage() {
  const supabase = useMemo(() => createClient(), [])
  const { role, id: userId } = useAgencyUser()
  const [rows, setRows] = useState<ClientWithStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      // Mirror the /clients page: admins see every client; managers and
      // employees only see CRMs they have a client_memberships row for.
      // Without this scoping the query falls under RLS and silently returns
      // empty for non-admins (and is brittle even for admins until the auth
      // context resolves).
      let allowedIds: string[] | null = null
      if (role && role !== 'admin' && userId) {
        const { data: mems } = await supabase
          .from('client_memberships')
          .select('client_id')
          .eq('user_id', userId)
        allowedIds = (mems || []).map((m) => m.client_id as string)
        if (allowedIds.length === 0) {
          setRows([])
          setLoading(false)
          return
        }
      }

      let q = supabase
        .from('clients')
        .select('id, name, business_name, profile_picture_url, package_tier, archived_at, created_at')
        .is('archived_at', null)
        .order('created_at', { ascending: false })
      if (allowedIds) q = q.in('id', allowedIds)

      const { data: clients } = await q

      const list = (clients ?? []) as ClientRow[]

      const ids = list.map((c) => c.id)
      const stats = new Map<string, { total: number; approved: number; lastActivity: string | null }>()

      if (ids.length) {
        // Route through /api/planner/slot-stats because content_plan_slots
        // RLS is service-role-only. A direct browser query against the
        // table silently returns empty rows and makes every client card
        // render "No plan yet" even when slots exist.
        try {
          const r = await fetch(`/api/planner/slot-stats?clientIds=${encodeURIComponent(ids.join(','))}`, {
            cache: 'no-store',
          })
          const json = (await r.json()) as {
            success?: boolean
            stats?: Array<{ client_id: string; total: number; approved: number; last_activity: string | null }>
          }
          if (json.success && Array.isArray(json.stats)) {
            for (const s of json.stats) {
              stats.set(s.client_id, {
                total: s.total,
                approved: s.approved,
                lastActivity: s.last_activity,
              })
            }
          }
        } catch (err) {
          console.warn('[planner index] slot-stats fetch failed; cards will show "No plan yet"', err)
        }
      }

      const enriched: ClientWithStats[] = list.map((c) => {
        const s = stats.get(c.id)
        return {
          ...c,
          totalSlots: s?.total ?? 0,
          approvedSlots: s?.approved ?? 0,
          lastActivity: s?.lastActivity ?? null,
        }
      })

      // Active planner clients first (any slots), then ordered by lastActivity.
      enriched.sort((a, b) => {
        if (a.totalSlots > 0 && b.totalSlots === 0) return -1
        if (a.totalSlots === 0 && b.totalSlots > 0) return 1
        const aTime = a.lastActivity ?? a.created_at ?? ''
        const bTime = b.lastActivity ?? b.created_at ?? ''
        return bTime.localeCompare(aTime)
      })

      setRows(enriched)
      setLoading(false)
    })()
  }, [supabase, role, userId])

  return (
    <>
      <Header title="Planner" subtitle="Pick a client to open their content calendar" />
      <div className="p-4 md:p-6 space-y-4">
        {loading ? (
          <Card>
            <CardContent className="py-10 flex items-center justify-center text-[var(--text-tertiary)]">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading clients...
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-[var(--text-tertiary)]">
              No active clients yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((c) => (
              <Link
                key={c.id}
                href={`/clients/${c.id}/planner`}
                className="group block"
              >
                <Card hover className="h-full">
                  <CardContent className="flex items-start gap-3">
                    <div className="shrink-0">
                      {c.profile_picture_url ? (
                        <Image
                          src={c.profile_picture_url}
                          alt={c.name || ''}
                          width={48}
                          height={48}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-brand-gradient flex items-center justify-center text-white font-bold">
                          {(c.business_name || c.name || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {c.business_name || c.name || 'Unnamed'}
                      </h3>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        {c.package_tier && (
                          <StatusPill tone={TIER_TONE[c.package_tier]}>{c.package_tier}</StatusPill>
                        )}
                        <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
                          {c.totalSlots === 0
                            ? 'No plan yet'
                            : `${c.totalSlots} slots, ${c.approvedSlots} approved`}
                        </span>
                      </div>
                    </div>
                    <CalendarRange className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[#2B79F7] mt-0.5" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <div className="text-xs text-[var(--text-tertiary)] flex items-center gap-1.5 px-1">
          <Sparkles className="h-3.5 w-3.5" />
          The planner generates per-client content calendars from typed topic answers. Open a client to generate or review their plan.
        </div>
      </div>
    </>
  )
}
