'use client'

// /admin - the activity + observability dashboard. Linear-style density
// with the CRM dashboard's color palette and chart aesthetic.
//
// Sections (in order):
//   1. OVERVIEW STRIP   - counts + total monthly spend
//   2. BIG CHART PANEL  - tabbed Area chart (Events / Cost / Success)
//   3. RUNNING NOW      - in-flight slot generations (real-time)
//   4. CLIENTS + TEAM   - per-client tier/spend + per-user actions
//   5. ACTIVITY         - tabbed kind filter + dense table + drawer
//
// Real-time: Supabase channel on ai_usage_log triggers silent refetch.
// 30s poll fallback for the long-tail event sources.

import { useState, useEffect, useMemo, useCallback } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
  Search,
  Download,
  FileText,
  ShieldCheck,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AdminChartPanel } from '@/components/admin/AdminChartPanel'
import { EventDrawer } from '@/components/admin/EventDrawer'
import { RowMenu, RowMenuIcons } from '@/components/admin/RowMenu'
import type { AdminEvent, EventCategory, EventStatus } from '@/lib/admin/events'

interface OverviewResponse {
  counts: {
    clients: number
    team: number
    activePlans: number
    eventsToday: number
    errorsToday: number
  }
  spendThisMonth: number
  sparklines: {
    eventsPerHour: number[]
    costPerDay: number[]
    successRate: number[]
  }
  clients: Array<{
    id: string
    name: string
    tier: 'top' | 'middle' | 'lower' | 'custom' | null
    slotsActive: number
    spendThisMonth: number
  }>
  team: Array<{
    id: string
    name: string
    email: string | null
    role: string
    actionsToday: number
  }>
}

interface RunningResponse {
  running: Array<{
    slotId: string
    clientId: string
    clientName: string
    stream: string
    scheduledDate: string
    startedAt: string
    elapsedMs: number
    linkTarget: string
  }>
}

interface ActivityResponse {
  events: AdminEvent[]
  counts: {
    total: number
    failed: number
    by_category: Record<EventCategory, number>
  }
}

type TimeRange = '1h' | '24h' | '7d' | '30d'

const TIME_RANGE_MS: Record<TimeRange, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
}

function rangeToSince(range: TimeRange): string {
  return new Date(Date.now() - TIME_RANGE_MS[range]).toISOString()
}

function fmtCurrency(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

const CATEGORY_DOT: Record<EventCategory, string> = {
  ai: 'bg-blue-500',
  slot: 'bg-emerald-500',
  plan: 'bg-emerald-500',
  approval: 'bg-purple-500',
  task: 'bg-amber-500',
  campaign: 'bg-indigo-500',
  competitor: 'bg-pink-500',
  comment: 'bg-sky-500',
  client: 'bg-teal-500',
  team: 'bg-rose-500',
}

const TIER_LABEL: Record<'top' | 'middle' | 'lower' | 'custom', string> = {
  top: 'top',
  middle: 'mid',
  lower: 'low',
  custom: 'custom',
}

// Tabs for the activity feed - "All" is the implicit unfiltered view,
// the rest are single-category quick filters. Tab switching is
// instant: we fetch the full set on range change and apply the kind
// filter client-side. No server roundtrip per tab click.
type KindTab =
  | 'all'
  | 'ai'
  | 'slot'
  | 'approval'
  | 'campaign'
  | 'task'
  | 'competitor'
  | 'client'
  | 'team'
  | 'errors'

const KIND_TABS: Array<{ key: KindTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'ai', label: 'AI calls' },
  { key: 'slot', label: 'Slots' },
  { key: 'approval', label: 'Approvals' },
  { key: 'campaign', label: 'Campaigns' },
  { key: 'task', label: 'Tasks' },
  { key: 'competitor', label: 'Competitor' },
  { key: 'client', label: 'Clients' },
  { key: 'team', label: 'Team' },
  { key: 'errors', label: 'Errors only' },
]

export default function AdminPage() {
  const [range, setRange] = useState<TimeRange>('24h')
  const [searchText, setSearchText] = useState('')
  const [kindTab, setKindTab] = useState<KindTab>('all')
  const [clientFilter, setClientFilter] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<AdminEvent | null>(null)
  const [live, setLive] = useState(true)
  const [exportingPdf, setExportingPdf] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  // Activity query key is stable - we always fetch the full 30d window
  // and filter client-side. Anchor `since` to the start of the current
  // minute so the URL doesn't change every render (which would defeat
  // SWR's cache).
  const activityKey = useMemo(() => {
    const minuteStart = Math.floor(Date.now() / 60000) * 60000
    const since = new Date(minuteStart - TIME_RANGE_MS['30d']).toISOString()
    const params = new URLSearchParams({ since, status: 'all', limit: '500' })
    return `/api/admin/activity?${params.toString()}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SWR fetches. Cached across mounts - clicking away and back renders
  // the previous data instantly and revalidates in the background.
  const { data: overview, isLoading: overviewLoading, mutate: mutateOverview } =
    useSWR<OverviewResponse & { success: boolean }>('/api/admin/overview')
  const { data: running } =
    useSWR<RunningResponse & { success: boolean }>('/api/admin/running', {
      // Running generations change second-to-second when something is
      // actually generating - refresh every 5s while the page is open.
      refreshInterval: 5_000,
    })
  const { data: activity, isLoading: activityLoading, mutate: mutateActivity } =
    useSWR<ActivityResponse & { success: boolean }>(activityKey)

  const refreshing = overviewLoading || activityLoading

  // Real-time: a new ai_usage_log row triggers a silent revalidation
  // of activity + overview. Running is on its own 5s interval.
  useEffect(() => {
    if (!live) return
    const channel = supabase
      .channel('admin-activity')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ai_usage_log' },
        () => {
          void mutateActivity()
          void mutateOverview()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, live, mutateActivity, mutateOverview])

  // Background poll fallback for the long-tail event sources (approvals,
  // tasks, clients, team) that don't have realtime wired up.
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => {
      void mutateActivity()
      void mutateOverview()
    }, 30_000)
    return () => clearInterval(id)
  }, [live, mutateActivity, mutateOverview])

  // ALL filters run client-side over the already-loaded set (we fetched
  // the full 30d window once). Tabs, time chips, client selection,
  // search, errors-only - everything is a pure state update + re-render.
  // No network roundtrip ever, except the periodic background refresh.
  const filteredEvents = useMemo(() => {
    if (!activity) return [] as AdminEvent[]
    const q = searchText.trim().toLowerCase()
    const sinceMs = Date.now() - TIME_RANGE_MS[range]
    return activity.events.filter((e) => {
      if (Date.parse(e.ts) < sinceMs) return false
      if (clientFilter && e.clientId !== clientFilter) return false
      if (kindTab === 'errors' && e.status !== 'failed') return false
      if (kindTab !== 'all' && kindTab !== 'errors' && e.category !== kindTab) return false
      if (!q) return true
      return (
        (e.actorName ?? '').toLowerCase().includes(q)
        || (e.clientName ?? '').toLowerCase().includes(q)
        || e.action.toLowerCase().includes(q)
        || e.detail.toLowerCase().includes(q)
      )
    })
  }, [activity, searchText, kindTab, clientFilter, range])

  // Counts for the kind tab pills - reflect the SAME time range + client
  // filter as the table so the pill number always matches what the user
  // will see on click.
  const tabCounts = useMemo(() => {
    const counts: Record<KindTab, number> = {
      all: 0, ai: 0, slot: 0, approval: 0, campaign: 0, task: 0,
      competitor: 0, client: 0, team: 0, errors: 0,
    }
    if (!activity) return counts
    const sinceMs = Date.now() - TIME_RANGE_MS[range]
    for (const e of activity.events) {
      if (Date.parse(e.ts) < sinceMs) continue
      if (clientFilter && e.clientId !== clientFilter) continue
      counts.all += 1
      if (e.status === 'failed') counts.errors += 1
      if (e.category in counts) {
        counts[e.category as KindTab] += 1
      }
    }
    return counts
  }, [activity, clientFilter, range])

  const handleExportCSV = () => {
    if (!filteredEvents.length) return
    const headers = [
      'time', 'category', 'status', 'action', 'actor', 'client',
      'detail', 'failure_reason', 'link',
    ]
    const rows = filteredEvents.map((e) => [
      e.ts,
      e.category,
      e.status,
      e.action,
      e.actorName ?? '',
      e.clientName ?? '',
      e.detail.replaceAll('"', '""'),
      e.failureReason ?? '',
      e.linkTarget ?? '',
    ])
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c)}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `admin-activity-${range}-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportPDF = async () => {
    if (!filteredEvents.length || !activity || exportingPdf) return
    setExportingPdf(true)
    try {
      // Lazy-load the heavy PDF deps only on actual export click.
      const [{ pdf }, { AdminActivityReport }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AdminActivityReport'),
      ])

      const filters: string[] = []
      if (kindTab !== 'all') {
        filters.push(KIND_TABS.find((t) => t.key === kindTab)?.label ?? kindTab)
      }
      if (clientFilter) {
        const c = overview?.clients.find((x) => x.id === clientFilter)
        if (c) filters.push(`client: ${c.name}`)
      }
      if (searchText.trim()) filters.push(`search: "${searchText.trim()}"`)

      const doc = (
        <AdminActivityReport
          workspaceName="Fokus Kreatives · Admin"
          rangeLabel={TIME_RANGE_LABEL[range]}
          filtersLabel={filters}
          totalCount={activity.counts.total}
          failedCount={activity.counts.failed}
          categoryCounts={activity.counts.by_category}
          events={filteredEvents}
        />
      )
      const blob = await pdf(doc).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `admin-activity-${range}-${Date.now()}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <div className="form-canvas min-h-screen bg-[var(--bg-secondary)] dark:bg-black text-[var(--text-primary)] overflow-x-hidden">
      {/* Header */}
      <div className="border-b border-[var(--glass-border)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--text-tertiary)]" />
          <h1 className="text-sm font-medium tracking-wide uppercase text-[var(--text-tertiary)]">
            Admin
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLive((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] uppercase tracking-wider"
            title={live ? 'Live updates on' : 'Live updates off'}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-[var(--text-tertiary)]'}`} />
            {live ? 'Live' : 'Paused'}
          </button>
          {refreshing && <Loader2 className="h-3 w-3 animate-spin text-[var(--text-tertiary)]" />}
        </div>
      </div>

      {/* OVERVIEW STRIP */}
      <div className="px-6 py-4 border-b border-[var(--glass-border)]">
        <div className="flex items-center flex-wrap gap-x-6 gap-y-2 text-xs">
          <Stat label="Clients" value={overview?.counts.clients ?? '-'} />
          <Sep />
          <Stat label="Team" value={overview?.counts.team ?? '-'} />
          <Sep />
          <Stat label="Active plans" value={overview?.counts.activePlans ?? '-'} />
          <Sep />
          <Stat
            label="Spent this month"
            value={overview ? fmtCurrency(overview.spendThisMonth) : '-'}
          />
          <a
            href="https://aistudio.google.com/app/billing"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] uppercase tracking-wider"
          >
            balance on AI Studio
            <ExternalLink className="h-3 w-3" />
          </a>
          <Sep />
          <Stat label="Events today" value={overview?.counts.eventsToday ?? '-'} />
          <Sep />
          <Stat
            label="Errors today"
            value={overview?.counts.errorsToday ?? '-'}
            tone={overview && overview.counts.errorsToday > 0 ? 'warning' : undefined}
          />
        </div>
      </div>

      {/* BIG CHART */}
      <div className="px-6 py-4 border-b border-[var(--glass-border)]">
        <AdminChartPanel data={overview?.sparklines ?? null} />
      </div>

      {/* RUNNING NOW */}
      {running && running.running.length > 0 && (
        <div className="px-6 py-3 border-b border-[var(--glass-border)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
            Running now · {running.running.length}
          </div>
          <div className="space-y-0.5">
            {running.running.map((r) => (
              <Link
                key={r.slotId}
                href={r.linkTarget}
                className="flex items-center gap-3 text-xs py-1 hover:bg-white/5 transition-colors -mx-2 px-2 rounded min-w-0"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="text-[var(--text-primary)] tabular-nums truncate min-w-0">{r.clientName}</span>
                <span className="hidden sm:inline-block text-[var(--text-secondary)] shrink-0">{r.stream.replace('_', ' ')}</span>
                <span className="hidden sm:inline-block font-mono text-[var(--text-tertiary)] shrink-0">{r.scheduledDate}</span>
                <span className="font-mono text-[var(--text-tertiary)] ml-auto tabular-nums shrink-0">
                  {fmtElapsed(r.elapsedMs)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* CLIENTS + TEAM side-by-side on md+, stacked on mobile.
          Row contents collapse on narrow screens (tier + spend hide
          first, then slots) so the client name always stays readable. */}
      <div className="grid grid-cols-1 md:grid-cols-2 border-b border-[var(--glass-border)]">
        <div className="px-6 py-3 md:border-r border-[var(--glass-border)] min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
            Clients · {overview?.clients.length ?? 0}
          </div>
          <div className="space-y-0">
            {(overview?.clients ?? []).map((c) => {
              const isFiltered = clientFilter === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setClientFilter(isFiltered ? null : c.id)}
                  className={`w-full flex items-center gap-2 text-xs py-1.5 px-2 -mx-2 rounded transition-colors text-left ${
                    isFiltered
                      ? 'bg-white/5'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <span className="text-[var(--text-primary)] truncate flex-1 min-w-0">{c.name}</span>
                  {c.tier && (
                    <span className="hidden sm:inline-block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums w-8 shrink-0">
                      {TIER_LABEL[c.tier]}
                    </span>
                  )}
                  <span className="hidden md:inline-block text-[var(--text-tertiary)] tabular-nums w-16 text-right shrink-0">
                    {c.slotsActive} slot{c.slotsActive === 1 ? '' : 's'}
                  </span>
                  <span className="hidden sm:inline-block font-mono text-[var(--text-secondary)] tabular-nums w-16 text-right shrink-0">
                    {fmtCurrency(c.spendThisMonth)}
                  </span>
                  <Link
                    href={`/clients/${c.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </button>
              )
            })}
          </div>
        </div>

        <div className="px-6 py-3 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
            Team · {overview?.team.length ?? 0}
          </div>
          <div className="space-y-0">
            {(overview?.team ?? []).map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 text-xs py-1.5 px-2 -mx-2 rounded hover:bg-white/5 transition-colors"
              >
                <span className="text-[var(--text-primary)] truncate flex-1 min-w-0">{t.name}</span>
                <span className="hidden sm:inline-block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] w-14 shrink-0">
                  {t.role}
                </span>
                <span className="hidden md:inline-block text-[var(--text-tertiary)] tabular-nums w-20 text-right shrink-0">
                  {t.actionsToday} action{t.actionsToday === 1 ? '' : 's'}
                </span>
                <Link
                  href="/team"
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0"
                >
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ACTIVITY FEED */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Activity
          </div>
          <div className="flex items-center gap-1">
            {(['1h', '24h', '7d', '30d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                  range === r
                    ? 'border-[#2B79F7] text-[#2B79F7] bg-[#2B79F7]/10'
                    : 'border-[var(--glass-border)] text-[var(--text-tertiary)] hover:bg-white/5'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Kind tabs (instant, client-side filtering). Wrap to multiple
            rows on narrow screens instead of horizontal-scroll so the
            tab strip never shows a scrollbar. */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 mb-3 border-b border-[var(--glass-border)]">
          {KIND_TABS.map((t) => {
            const active = kindTab === t.key
            const count = tabCounts[t.key] ?? 0
            return (
              <button
                key={t.key}
                onClick={() => setKindTab(t.key)}
                className={`relative px-3 py-1.5 text-xs transition-colors whitespace-nowrap ${
                  active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {t.label}
                  {count > 0 && (
                    <span className={`text-[10px] tabular-nums px-1 rounded ${
                      active
                        ? 'bg-[#2B79F7]/15 text-[#2B79F7]'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
                    }`}>
                      {count}
                    </span>
                  )}
                </span>
                {active && (
                  <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#2B79F7]" />
                )}
              </button>
            )
          })}
        </div>

        {/* Search + actions row */}
        <div className="flex items-center gap-2 mb-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search actor / client / detail"
              className="pl-6 pr-2 py-1 text-[11px] rounded border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#2B79F7] w-72"
            />
          </div>
          {clientFilter && (
            <button
              onClick={() => setClientFilter(null)}
              className="text-[11px] text-[#2B79F7] hover:underline"
            >
              clear client filter
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={handleExportCSV}
              disabled={!filteredEvents.length}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border border-[var(--glass-border)] text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-40"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
            <button
              onClick={handleExportPDF}
              disabled={!filteredEvents.length || exportingPdf}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border border-[var(--glass-border)] text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-40"
            >
              {exportingPdf ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FileText className="h-3 w-3" />
              )}
              PDF
            </button>
          </div>
        </div>

        {/* Table - wrapped in an x-overflow container so the dense grid
            scrolls inside its own box on narrow screens instead of
            pushing the whole page wide. min-w on the inner grid
            preserves column alignment between header and rows. */}
        <div className="glass-card rounded-md overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[80px_24px_minmax(140px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(160px,2fr)_60px_28px] gap-2 px-3 py-1.5 border-b border-[var(--glass-border)] bg-white/[0.03] text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              <span>Time</span>
              <span></span>
              <span>Action</span>
              <span>Actor</span>
              <span>Client</span>
              <span>Detail</span>
              <span className="text-right">Status</span>
              <span></span>
            </div>
            {filteredEvents.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--text-tertiary)]">
                No events in this window.
              </div>
            ) : (
              filteredEvents.map((e) => (
                <ActivityRow
                  key={e.id}
                  event={e}
                  onClick={() => setSelectedEvent(e)}
                />
              ))
            )}
          </div>
        </div>

        <div className="mt-2 text-[11px] text-[var(--text-tertiary)] flex items-center gap-3">
          <span>{filteredEvents.length} events</span>
          {activity && (
            <>
              <span>·</span>
              <span>{activity.counts.failed} failed</span>
            </>
          )}
        </div>
      </div>

      <EventDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  )
}

function ActivityRow({ event: e, onClick }: { event: AdminEvent; onClick: () => void }) {
  return (
    <div
      className="grid grid-cols-[80px_24px_minmax(140px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(160px,2fr)_60px_28px] gap-2 px-3 py-1.5 border-b border-[var(--glass-border)] hover:bg-white/5 transition-colors text-xs items-center last:border-b-0 cursor-pointer"
      onClick={onClick}
    >
      <span className="font-mono text-[10px] text-[var(--text-tertiary)] tabular-nums">
        {fmtTime(e.ts)}
      </span>
      <span className="flex items-center justify-center">
        {e.status === 'failed' ? (
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" title={e.failureReason} />
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_DOT[e.category]}`} />
        )}
      </span>
      <span className="truncate text-[var(--text-primary)]">{e.action}</span>
      <span className="truncate text-[var(--text-secondary)]">{e.actorName ?? '-'}</span>
      <span className="truncate text-[var(--text-secondary)]">{e.clientName ?? '-'}</span>
      <span className="truncate text-[var(--text-tertiary)]">
        {e.status === 'failed' && e.failureReason ? (
          <span className="text-red-500/80">{e.failureReason}</span>
        ) : (
          e.detail
        )}
      </span>
      <span className="text-right tabular-nums text-[10px] uppercase tracking-wider">
        {e.status === 'failed' ? (
          <span className="text-red-500">failed</span>
        ) : (
          <span className="text-[var(--text-tertiary)]">ok</span>
        )}
      </span>
      <div onClick={(ev) => ev.stopPropagation()}>
        <RowMenu
          actions={[
            ...(e.linkTarget
              ? [{
                  label: 'Open destination',
                  icon: RowMenuIcons.external,
                  onClick: () => {
                    if (e.linkTarget) window.location.href = e.linkTarget
                  },
                }]
              : []),
            {
              label: 'View raw meta',
              icon: RowMenuIcons.meta,
              onClick: onClick,
            },
            {
              label: 'Copy event ID',
              icon: RowMenuIcons.copy,
              onClick: () => {
                void navigator.clipboard?.writeText(e.id)
              },
            },
            ...(e.linkTarget
              ? [{
                  label: 'Copy link',
                  icon: RowMenuIcons.link,
                  onClick: () => {
                    if (!e.linkTarget) return
                    const href = typeof window !== 'undefined'
                      ? `${window.location.origin}${e.linkTarget}`
                      : e.linkTarget
                    void navigator.clipboard?.writeText(href)
                  },
                }]
              : []),
          ]}
        />
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'warning'
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</span>
      <span
        className={`font-mono tabular-nums ${
          tone === 'warning' && typeof value === 'number' && value > 0
            ? 'text-red-500'
            : 'text-[var(--text-primary)]'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function Sep() {
  return <span className="text-[var(--text-tertiary)]">·</span>
}
