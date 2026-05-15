// Normalized activity event shape + the queries that build it.
//
// The admin feed unions rows from several source tables (ai_usage_log,
// content_plan_slots, approvals, approval_items, tasks, competitors)
// into one chronological list. Each source produces zero or more
// AdminEvent rows. Sorting and limiting happens in code after the
// parallel queries return.
//
// Why not a database VIEW? Two reasons:
//   - The shape evolves; tweaking it in TS is easier than versioning a
//     postgres view.
//   - We need humanized failure reasons + the linkTarget computation,
//     which are both code-side concerns.

import { adminDb } from './db'
import { humanizeFailure } from './failureReasons'

export type EventCategory =
  | 'ai'
  | 'slot'
  | 'plan'
  | 'approval'
  | 'task'
  | 'campaign'
  | 'competitor'
  | 'comment'
  | 'client'
  | 'team'

export type EventStatus = 'ok' | 'failed' | 'pending'

export interface AdminEvent {
  /** Stable id used as React key. Source-prefixed so cross-table ids
   *  don't collide. */
  id: string
  /** ISO timestamp. */
  ts: string
  category: EventCategory
  status: EventStatus
  /** Short imperative verb. e.g. "generated script", "approved", "created plan". */
  action: string
  /** Display detail - one line, e.g. "long_form 2026-05-13 · 12.3s · $0.18". */
  detail: string
  /** Humanized failure reason. Only present when status==='failed'. */
  failureReason?: string
  /** Display name of the user who triggered the event. Null if not tracked. */
  actorName: string | null
  /** Internal user id of the actor (used for links / search). */
  actorUserId: string | null
  /** Display name of the client this event is for. Null when global. */
  clientName: string | null
  /** Internal client id (used for links / search). */
  clientId: string | null
  /** Where clicking the row should take the user. Relative path. */
  linkTarget: string | null
  /** Source-specific raw row + cost/duration where applicable. Surfaced in
   *  the drawer for ops debugging. Keep it small. */
  meta: Record<string, unknown>
}

export interface ActivityQueryOpts {
  /** UTC ISO time, lower bound inclusive. */
  since: string
  /** UTC ISO time, upper bound exclusive. Defaults to now. */
  until?: string
  /** Cap on rows returned per source. Final merged set may be lower. */
  perSourceLimit?: number
  /** Filter to a single client id. Optional. */
  clientId?: string | null
  /** Filter to a single actor (user_id). Optional. */
  actorId?: string | null
  /** Filter categories. Optional - empty = all. */
  categories?: EventCategory[]
  /** Filter status. Optional. */
  status?: EventStatus | 'all'
}

/** Load lookup maps (users.id→name, clients.id→name) used to enrich the
 *  raw events. We pull them in a single roundtrip rather than joining at
 *  query time since the events join across many tables. */
async function loadDisplayMaps(): Promise<{
  users: Map<string, string>
  clients: Map<string, string>
}> {
  const supabase = adminDb()
  const [usersRes, clientsRes] = await Promise.all([
    supabase.from('users').select('id, name, email'),
    supabase.from('clients').select('id, business_name, name'),
  ])
  const users = new Map<string, string>()
  for (const u of usersRes.data ?? []) {
    const id = (u as { id: string }).id
    const name = (u as { name?: string | null; email?: string | null }).name
      || (u as { email?: string | null }).email
      || id.slice(0, 6)
    users.set(id, name)
  }
  const clients = new Map<string, string>()
  for (const c of clientsRes.data ?? []) {
    const id = (c as { id: string }).id
    const name = (c as { business_name?: string | null; name?: string | null }).business_name
      || (c as { name?: string | null }).name
      || id.slice(0, 6)
    clients.set(id, name)
  }
  return { users, clients }
}

function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return ''
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// Route → human action label. The admin doesn't care that the route is
// 'planner.script.generate' - they want "generated script".
function aiActionLabel(route: string): { action: string; detail_prefix: string } {
  if (route.startsWith('planner.script')) return { action: 'generated script', detail_prefix: 'script' }
  if (route.startsWith('story_brief') || route.startsWith('story.queue')) return { action: 'generated story', detail_prefix: 'story' }
  if (route.startsWith('checklist')) return { action: 'ran checklist', detail_prefix: 'checklist' }
  if (route.startsWith('hook_preview') || route.startsWith('planner.hook')) return { action: 'generated hook preview', detail_prefix: 'hook' }
  if (route.startsWith('topic')) return { action: 'topic batch', detail_prefix: 'topics' }
  if (route.startsWith('competitor')) return { action: 'competitor analysis', detail_prefix: 'competitor' }
  if (route.includes('package')) return { action: 'generated package', detail_prefix: 'package' }
  return { action: route, detail_prefix: route }
}

interface AIUsageRow {
  id: string
  client_id: string | null
  user_id: string | null
  route: string
  model: string
  cost_usd: number | null
  duration_ms: number | null
  success: boolean
  error_code: string | null
  created_at: string
  meta: Record<string, unknown> | null
  input_tokens: number | null
  output_tokens: number | null
}

async function fetchAIEvents(opts: ActivityQueryOpts): Promise<AIUsageRow[]> {
  const supabase = adminDb()
  let q = supabase
    .from('ai_usage_log')
    .select(
      'id, client_id, user_id, route, model, cost_usd, duration_ms, success, error_code, created_at, meta, input_tokens, output_tokens',
    )
    .gte('created_at', opts.since)
    .order('created_at', { ascending: false })
    .limit(opts.perSourceLimit ?? 500)

  if (opts.until) q = q.lt('created_at', opts.until)
  if (opts.clientId) q = q.eq('client_id', opts.clientId)
  if (opts.actorId) q = q.eq('user_id', opts.actorId)
  if (opts.status === 'failed') q = q.eq('success', false)
  if (opts.status === 'ok') q = q.eq('success', true)

  const { data, error } = await q
  if (error) {
    console.error('[admin/events] ai_usage_log error:', error)
    return []
  }
  return (data ?? []) as AIUsageRow[]
}

interface SlotRow {
  id: string
  client_id: string
  stream: string
  format_id: string | null
  scheduled_date: string
  status: string
  updated_at: string
  approved_by: string | null
  approved_at: string | null
}

async function fetchSlotEvents(opts: ActivityQueryOpts): Promise<SlotRow[]> {
  const supabase = adminDb()
  let q = supabase
    .from('content_plan_slots')
    .select('id, client_id, stream, format_id, scheduled_date, status, updated_at, approved_by, approved_at')
    .gte('updated_at', opts.since)
    .order('updated_at', { ascending: false })
    .limit(opts.perSourceLimit ?? 300)

  if (opts.until) q = q.lt('updated_at', opts.until)
  if (opts.clientId) q = q.eq('client_id', opts.clientId)

  const { data, error } = await q
  if (error) {
    console.error('[admin/events] content_plan_slots error:', error)
    return []
  }
  return (data ?? []) as SlotRow[]
}

interface ApprovalRow {
  id: string
  client_id: string | null
  created_at: string
  updated_at: string
  status: string | null
  created_by: string | null
  approved_at: string | null
}

async function fetchApprovalEvents(opts: ActivityQueryOpts): Promise<ApprovalRow[]> {
  const supabase = adminDb()
  let q = supabase
    .from('approvals')
    .select('id, client_id, created_at, updated_at, status, created_by, approved_at')
    .gte('updated_at', opts.since)
    .order('updated_at', { ascending: false })
    .limit(opts.perSourceLimit ?? 200)

  if (opts.until) q = q.lt('updated_at', opts.until)
  if (opts.clientId) q = q.eq('client_id', opts.clientId)

  const { data, error } = await q
  if (error) {
    console.error('[admin/events] approvals error:', error)
    return []
  }
  return (data ?? []) as ApprovalRow[]
}

interface TaskRow {
  id: string
  client_id: string | null
  name: string | null
  status: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

async function fetchTaskEvents(opts: ActivityQueryOpts): Promise<TaskRow[]> {
  const supabase = adminDb()
  let q = supabase
    .from('tasks')
    .select('id, client_id, name, status, created_at, updated_at, created_by')
    .gte('updated_at', opts.since)
    .order('updated_at', { ascending: false })
    .limit(opts.perSourceLimit ?? 200)

  if (opts.until) q = q.lt('updated_at', opts.until)
  if (opts.clientId) q = q.eq('client_id', opts.clientId)
  if (opts.actorId) q = q.eq('created_by', opts.actorId)

  const { data, error } = await q
  if (error) {
    console.error('[admin/events] tasks error:', error)
    return []
  }
  return (data ?? []) as TaskRow[]
}

interface CampaignRow {
  id: string
  client_id: string
  name: string
  status: string | null
  clickup_task_id: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

async function fetchCampaignEvents(opts: ActivityQueryOpts): Promise<CampaignRow[]> {
  const supabase = adminDb()
  let q = supabase
    .from('campaigns')
    .select('id, client_id, name, status, clickup_task_id, created_at, updated_at, created_by')
    .gte('updated_at', opts.since)
    .order('updated_at', { ascending: false })
    .limit(opts.perSourceLimit ?? 200)

  if (opts.until) q = q.lt('updated_at', opts.until)
  if (opts.clientId) q = q.eq('client_id', opts.clientId)
  if (opts.actorId) q = q.eq('created_by', opts.actorId)

  const { data, error } = await q
  if (error) {
    console.error('[admin/events] campaigns error:', error)
    return []
  }
  return (data ?? []) as CampaignRow[]
}

interface ClientRow {
  id: string
  name: string | null
  business_name: string | null
  created_at: string
}

async function fetchClientEvents(opts: ActivityQueryOpts): Promise<ClientRow[]> {
  // Lifecycle: new clients only. No client_id filter inside this source
  // since the event IS the client creation. Filter at the row level when
  // a single client is selected.
  const supabase = adminDb()
  let q = supabase
    .from('clients')
    .select('id, name, business_name, created_at')
    .gte('created_at', opts.since)
    .order('created_at', { ascending: false })
    .limit(opts.perSourceLimit ?? 100)

  if (opts.until) q = q.lt('created_at', opts.until)
  if (opts.clientId) q = q.eq('id', opts.clientId)

  const { data, error } = await q
  if (error) {
    console.error('[admin/events] clients error:', error)
    return []
  }
  return (data ?? []) as ClientRow[]
}

interface TeamUserRow {
  id: string
  name: string | null
  email: string | null
  role: string | null
  created_at: string
}

async function fetchTeamEvents(opts: ActivityQueryOpts): Promise<TeamUserRow[]> {
  // Agency team additions only (mirrors /team page filtering). CRM-team
  // invites also create users rows but with is_agency_user=false - those
  // are per-client memberships, not "team joined" events at the agency
  // level.
  const supabase = adminDb()
  let q = supabase
    .from('users')
    .select('id, name, email, role, created_at')
    .gte('created_at', opts.since)
    .eq('is_agency_user', true)
    .order('created_at', { ascending: false })
    .limit(opts.perSourceLimit ?? 100)

  if (opts.until) q = q.lt('created_at', opts.until)

  const { data, error } = await q
  if (error) {
    console.error('[admin/events] users error:', error)
    return []
  }
  return (data ?? []) as TeamUserRow[]
}

interface CompetitorRow {
  id: string
  client_id: string | null
  platform: string | null
  url: string | null
  created_at: string
}

async function fetchCompetitorEvents(opts: ActivityQueryOpts): Promise<CompetitorRow[]> {
  const supabase = adminDb()
  let q = supabase
    .from('competitors')
    .select('id, client_id, platform, url, created_at')
    .gte('created_at', opts.since)
    .order('created_at', { ascending: false })
    .limit(opts.perSourceLimit ?? 100)

  if (opts.until) q = q.lt('created_at', opts.until)
  if (opts.clientId) q = q.eq('client_id', opts.clientId)

  const { data, error } = await q
  if (error) {
    console.error('[admin/events] competitors error:', error)
    return []
  }
  return (data ?? []) as CompetitorRow[]
}

export interface ActivityResult {
  events: AdminEvent[]
  /** Per-category counts within the requested window. Useful for the
   *  pass/fail summary + sparkline buckets. */
  counts: {
    total: number
    failed: number
    by_category: Record<EventCategory, number>
  }
}

export async function loadActivity(opts: ActivityQueryOpts): Promise<ActivityResult> {
  const categoryFilter = opts.categories && opts.categories.length > 0
    ? new Set(opts.categories)
    : null

  // Fan-out: only query sources that satisfy the active category filter.
  // For a quick "ai only" filter we skip the slot/approval/task queries
  // entirely.
  const want = (c: EventCategory) => !categoryFilter || categoryFilter.has(c)

  const [maps, ai, slots, approvals, tasks, competitors, campaigns, clientRows, teamRows] = await Promise.all([
    loadDisplayMaps(),
    want('ai') ? fetchAIEvents(opts) : Promise.resolve([]),
    want('slot') ? fetchSlotEvents(opts) : Promise.resolve([]),
    want('approval') ? fetchApprovalEvents(opts) : Promise.resolve([]),
    want('task') ? fetchTaskEvents(opts) : Promise.resolve([]),
    want('competitor') ? fetchCompetitorEvents(opts) : Promise.resolve([]),
    want('campaign') ? fetchCampaignEvents(opts) : Promise.resolve([]),
    want('client') ? fetchClientEvents(opts) : Promise.resolve([]),
    want('team') ? fetchTeamEvents(opts) : Promise.resolve([]),
  ])

  const events: AdminEvent[] = []

  // AI events
  for (const r of ai as AIUsageRow[]) {
    const labels = aiActionLabel(r.route)
    const detail_bits = [
      r.model,
      formatDuration(r.duration_ms),
      formatCost(r.cost_usd),
    ].filter(Boolean)
    const status: EventStatus = r.success ? 'ok' : 'failed'
    const meta = r.meta ?? {}
    const slotId = (meta as { slot_id?: string }).slot_id
    const clientId = r.client_id

    events.push({
      id: `ai:${r.id}`,
      ts: r.created_at,
      category: 'ai',
      status,
      action: labels.action,
      detail: detail_bits.join(' · ') || labels.detail_prefix,
      failureReason: r.success
        ? undefined
        : humanizeFailure({
            errorCode: r.error_code,
            message: typeof (meta as { error_message?: string }).error_message === 'string'
              ? (meta as { error_message?: string }).error_message
              : null,
          }).reason,
      actorName: r.user_id ? maps.users.get(r.user_id) ?? null : null,
      actorUserId: r.user_id,
      clientName: clientId ? maps.clients.get(clientId) ?? null : null,
      clientId,
      linkTarget: slotId
        ? `/clients/${clientId}/planner?slot=${slotId}`
        : clientId
          ? `/clients/${clientId}`
          : null,
      meta: {
        route: r.route,
        model: r.model,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cost_usd: r.cost_usd,
        duration_ms: r.duration_ms,
        error_code: r.error_code,
        ...meta,
      },
    })
  }

  // Slot events - only fire on status flips that mean something (we treat
  // any updated_at >= since AS A status flip, since the planner doesn't
  // touch a slot's row for non-status writes).
  for (const r of slots as SlotRow[]) {
    let action = 'updated slot'
    if (r.status === 'drafted') action = 'drafted slot'
    if (r.status === 'approved') action = 'approved slot'
    if (r.status === 'planned') action = 'planned slot'

    const formatLabel = r.stream.replace('_', ' ')
    const detail = `${formatLabel} · ${r.scheduled_date}`
    const isApproval = r.status === 'approved'

    events.push({
      id: `slot:${r.id}:${r.updated_at}`,
      ts: r.updated_at,
      category: 'slot',
      status: 'ok',
      action,
      detail,
      actorName: isApproval && r.approved_by ? maps.users.get(r.approved_by) ?? null : null,
      actorUserId: isApproval ? r.approved_by : null,
      clientName: maps.clients.get(r.client_id) ?? null,
      clientId: r.client_id,
      linkTarget: `/clients/${r.client_id}/planner?slot=${r.id}`,
      meta: {
        slot_id: r.id,
        stream: r.stream,
        scheduled_date: r.scheduled_date,
        status: r.status,
        approved_at: r.approved_at,
      },
    })
  }

  // Approvals
  for (const r of approvals as ApprovalRow[]) {
    const isApproved = r.approved_at != null
    const action = isApproved ? 'approved package' : 'updated approval'
    const detail = r.status ? `status: ${r.status}` : 'pending'

    events.push({
      id: `approval:${r.id}:${r.updated_at}`,
      ts: r.updated_at,
      category: 'approval',
      status: 'ok',
      action,
      detail,
      actorName: r.created_by ? maps.users.get(r.created_by) ?? null : null,
      actorUserId: r.created_by,
      clientName: r.client_id ? maps.clients.get(r.client_id) ?? null : null,
      clientId: r.client_id,
      linkTarget: `/approvals/${r.id}`,
      meta: {
        approval_id: r.id,
        status: r.status,
        approved_at: r.approved_at,
      },
    })
  }

  // Tasks
  for (const r of tasks as TaskRow[]) {
    const isNew = Math.abs(Date.parse(r.created_at) - Date.parse(r.updated_at)) < 2000
    const action = isNew ? 'created task' : `task to ${r.status ?? 'updated'}`
    const detail = r.name ?? r.id.slice(0, 8)

    events.push({
      id: `task:${r.id}:${r.updated_at}`,
      ts: r.updated_at,
      category: 'task',
      status: 'ok',
      action,
      detail,
      actorName: r.created_by ? maps.users.get(r.created_by) ?? null : null,
      actorUserId: r.created_by,
      clientName: r.client_id ? maps.clients.get(r.client_id) ?? null : null,
      clientId: r.client_id,
      linkTarget: `/tasks?id=${r.id}`,
      meta: {
        task_id: r.id,
        status: r.status,
        name: r.name,
      },
    })
  }

  // Campaigns (ClickUp mirror) - the link target jumps straight to the
  // ClickUp task page so admins can hop to the source of truth.
  for (const r of campaigns as CampaignRow[]) {
    const isNew = Math.abs(Date.parse(r.created_at) - Date.parse(r.updated_at)) < 2000
    const action = isNew ? 'created campaign' : `campaign to ${r.status ?? 'updated'}`
    const clickupUrl = r.clickup_task_id
      ? `https://app.clickup.com/t/${r.clickup_task_id}`
      : null

    events.push({
      id: `campaign:${r.id}:${r.updated_at}`,
      ts: r.updated_at,
      category: 'campaign',
      status: 'ok',
      action,
      detail: r.name,
      actorName: r.created_by ? maps.users.get(r.created_by) ?? null : null,
      actorUserId: r.created_by,
      clientName: maps.clients.get(r.client_id) ?? null,
      clientId: r.client_id,
      linkTarget: clickupUrl ?? `/campaigns`,
      meta: {
        campaign_id: r.id,
        name: r.name,
        status: r.status,
        clickup_task_id: r.clickup_task_id,
        clickup_url: clickupUrl,
      },
    })
  }

  // Competitor scans
  for (const r of competitors as CompetitorRow[]) {
    const detail = `${r.platform ?? 'unknown'} · ${r.url ?? '-'}`

    events.push({
      id: `competitor:${r.id}`,
      ts: r.created_at,
      category: 'competitor',
      status: 'ok',
      action: 'competitor scan',
      detail,
      actorName: null,
      actorUserId: null,
      clientName: r.client_id ? maps.clients.get(r.client_id) ?? null : null,
      clientId: r.client_id,
      linkTarget: r.client_id ? `/clients/${r.client_id}` : '/competitors',
      meta: {
        competitor_id: r.id,
        platform: r.platform,
        url: r.url,
      },
    })
  }

  // New clients (lifecycle events)
  for (const r of clientRows as ClientRow[]) {
    const displayName = r.business_name || r.name || r.id.slice(0, 6)
    events.push({
      id: `client:${r.id}`,
      ts: r.created_at,
      category: 'client',
      status: 'ok',
      action: 'client added',
      detail: displayName,
      actorName: null,
      actorUserId: null,
      clientName: displayName,
      clientId: r.id,
      linkTarget: `/clients/${r.id}`,
      meta: {
        client_id: r.id,
        name: r.name,
        business_name: r.business_name,
      },
    })
  }

  // Team additions (new agency users - excludes role='client')
  for (const r of teamRows as TeamUserRow[]) {
    const displayName = r.name || r.email || r.id.slice(0, 6)
    events.push({
      id: `team:${r.id}`,
      ts: r.created_at,
      category: 'team',
      status: 'ok',
      action: 'team member added',
      detail: `${displayName} · ${r.role ?? 'unknown'}`,
      actorName: displayName,
      actorUserId: r.id,
      clientName: null,
      clientId: null,
      linkTarget: '/team',
      meta: {
        user_id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
      },
    })
  }

  // Sort newest-first.
  events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))

  // Compute counts on the unfiltered-by-status set. The status filter
  // already gated AI rows in fetchAIEvents; the other sources don't have
  // status, so filtering them here would just hide them from the failed
  // view (correct behavior - failures only come from AI today).
  const counts = {
    total: events.length,
    failed: events.filter((e) => e.status === 'failed').length,
    by_category: events.reduce(
      (acc, e) => {
        acc[e.category] = (acc[e.category] ?? 0) + 1
        return acc
      },
      {} as Record<EventCategory, number>,
    ),
  }

  return { events, counts }
}
