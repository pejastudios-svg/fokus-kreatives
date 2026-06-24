'use client'

// Planner index. The planner is per-client, so this page lists clients with
// quick links into each one's calendar. Sorted by most-recently-active in the
// planner (most recent slot updated_at) so the brands you're working on now
// surface to the top.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { CalendarRange, Loader2, Search, Sparkles, X } from 'lucide-react'
import { TIER_KEY_LABEL, type TierKey } from '@/lib/campaignTiers'
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
  package_tier: TierKey | null
  archived_at: string | null
  created_at: string | null
}

interface ClientWithStats extends ClientRow {
  totalSlots: number
  approvedSlots: number
  lastActivity: string | null
}

const TIER_TONE: Record<TierKey, 'success' | 'info' | 'warning'> = {
  top: 'success',
  middle: 'info',
  lower: 'warning',
  custom: 'info',
}

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

export default function PlannerIndexPage() {
  const supabase = useMemo(() => createClient(), [])
  const { role, id: userId } = useAgencyUser()
  const [rows, setRows] = useState<ClientWithStats[]>([])
  const [loading, setLoading] = useState(true)

  // Cross-client slot search. The input drives a debounced fetch to
  // /api/planner/search; when there's an active query we render results
  // in place of the client grid. Empty query => default client grid.
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

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

  // Debounced cross-client search. Fires 300ms after the user stops
  // typing to avoid a request per keystroke. clientIds = the ids
  // currently in `rows`, which already respect role-based access.
  useEffect(() => {
    const q = search.trim()
    if (!q) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    const allowedIds = rows.map((r) => r.id)
    if (allowedIds.length === 0) {
      setSearchResults([])
      return
    }
    setSearching(true)
    const handle = window.setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/planner/search?q=${encodeURIComponent(q)}&clientIds=${encodeURIComponent(allowedIds.join(','))}`,
          { cache: 'no-store' },
        )
        const json = (await r.json()) as { success?: boolean; results?: SearchResult[] }
        setSearchResults(json.success ? (json.results ?? []) : [])
      } catch (err) {
        console.warn('[planner search] failed:', err)
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => window.clearTimeout(handle)
  }, [search, rows])

  return (
    <>
      <Header title="Planner" subtitle="Pick a client to open their content calendar" />
      <div className="p-4 md:p-6 space-y-4">
        {/* Cross-client search. Searches slot hooks, scheduled dates
            (YYYY-MM-DD format matches exactly), and client names. */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search slots by hook, client, or date (YYYY-MM-DD)…"
            className="w-full pl-9 pr-9 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[#2B79F7]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {searchResults !== null ? (
          <Card>
            <CardContent className="p-0">
              {searching ? (
                <div className="py-8 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching…
                </div>
              ) : searchResults.length === 0 ? (
                <div className="py-8 text-center text-[var(--text-tertiary)] text-sm">
                  No slots matched <span className="text-[var(--text-secondary)]">&ldquo;{search}&rdquo;</span>.
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border-primary)]">
                  {searchResults.map((r) => (
                    <li key={r.slot_id}>
                      <Link
                        href={`/clients/${r.client_id}/planner`}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-tertiary)] transition-colors"
                      >
                        <div className="shrink-0 mt-0.5">
                          <CalendarRange className="h-4 w-4 text-[var(--text-tertiary)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
                            <span className="font-medium text-[var(--text-secondary)] normal-case tracking-normal text-xs">
                              {r.client_name}
                            </span>
                            <span>·</span>
                            <span>{r.stream.replace('_', '-')}</span>
                            {r.format_slug && (
                              <>
                                <span>·</span>
                                <span>{r.format_slug.replace('short_form.', '').replace('long_form.', '').replace(/_/g, ' ')}</span>
                              </>
                            )}
                            <span>·</span>
                            <span className="tabular-nums">{r.scheduled_date}</span>
                          </div>
                          {r.hook_preview && (
                            <div className="mt-1 text-sm text-[var(--text-primary)] line-clamp-2">
                              {r.hook_preview}
                            </div>
                          )}
                        </div>
                        <StatusPill
                          tone={
                            r.status === 'approved'
                              ? 'success'
                              : r.status === 'planned'
                                ? 'info'
                                : 'warning'
                          }
                        >
                          {r.status}
                        </StatusPill>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : loading ? (
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
                          <StatusPill tone={TIER_TONE[c.package_tier]}>{TIER_KEY_LABEL[c.package_tier]}</StatusPill>
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
