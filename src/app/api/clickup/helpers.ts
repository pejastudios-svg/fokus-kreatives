// src/app/api/clickup/helpers.ts
import 'server-only'

const CLICKUP_API_BASE_URL = 'https://api.clickup.com/api/v2'

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN
const CLICKUP_STATUS_WAITING = process.env.CLICKUP_STATUS_WAITING || '⏳ WAITING FOR FEEDBACK'
const CLICKUP_STATUS_APPROVED = process.env.CLICKUP_STATUS_APPROVED || '✅ APPROVED'
// Space ID where every client folder lives. Set this once in env vars to
// the ClickUp space you want client folders to be created under.
const CLICKUP_SPACE_ID = process.env.CLICKUP_SPACE_ID

if (!CLICKUP_API_TOKEN) {
  console.warn('CLICKUP_API_TOKEN is not set - ClickUp integration will be disabled.')
}

export function clickupConfigured(): boolean {
  return !!CLICKUP_API_TOKEN && !!CLICKUP_SPACE_ID
}

async function clickupFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  if (!CLICKUP_API_TOKEN) {
    return { ok: false, error: 'CLICKUP_API_TOKEN missing' }
  }
  try {
    const res = await fetch(`${CLICKUP_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: CLICKUP_API_TOKEN,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) {
      console.error('ClickUp', init?.method || 'GET', path, res.status, text.slice(0, 500))
      return { ok: false, error: text }
    }
    try {
      return { ok: true, data: JSON.parse(text) as T }
    } catch {
      return { ok: true, data: undefined }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('ClickUp fetch exception', path, msg)
    return { ok: false, error: msg }
  }
}

export async function fetchClickUpTaskName(taskId: string): Promise<string | null> {
  if (!CLICKUP_API_TOKEN || !taskId) return null

  try {
    const res = await fetch(`${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        'Authorization': CLICKUP_API_TOKEN,
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      console.error('ClickUp fetch task failed', taskId, await res.text())
      return null
    }

    const data = await res.json()
    return (data?.name as string) || null
  } catch (err) {
    console.error('ClickUp fetchTaskName error', err)
    return null
  }
}

export async function updateClickUpStatus(taskId: string, waitingOrApproved: 'waiting' | 'approved') {
  if (!CLICKUP_API_TOKEN || !taskId) {
    return { success: false, error: 'Missing token or taskId' }
  }

  const statusName =
    waitingOrApproved === 'approved' ? CLICKUP_STATUS_APPROVED : CLICKUP_STATUS_WAITING

  try {
    const res = await fetch(`${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      headers: {
        'Authorization': CLICKUP_API_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: statusName,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('ClickUp update status failed', taskId, text)
      return { success: false, error: text }
    }

    return { success: true }
    } catch (err: unknown) {
    console.error('ClickUp updateStatus error', err)
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: errorMessage }
  }
}

// ============================================================================
// Campaign-creation helpers.
//
// ClickUp hierarchy: Workspace -> Space -> Folder -> List -> Task.
// We create one folder per client (named after the client's business or
// display name) inside the configured CLICKUP_SPACE_ID. Each folder gets one
// default list ("Campaigns") that all the client's campaigns land in.
// Folder + list IDs are stamped on `clients` so subsequent campaigns reuse
// them rather than creating duplicates.
// ============================================================================

export async function createClickUpFolder(name: string): Promise<{ folderId?: string; error?: string }> {
  if (!CLICKUP_SPACE_ID) return { error: 'CLICKUP_SPACE_ID missing' }
  const res = await clickupFetch<{ id: string }>(
    `/space/${CLICKUP_SPACE_ID}/folder`,
    { method: 'POST', body: JSON.stringify({ name }) },
  )
  if (!res.ok || !res.data?.id) return { error: res.error || 'no folder id returned' }
  return { folderId: res.data.id }
}

export async function createClickUpList(
  folderId: string,
  name: string,
): Promise<{ listId?: string; error?: string }> {
  const res = await clickupFetch<{ id: string }>(
    `/folder/${encodeURIComponent(folderId)}/list`,
    { method: 'POST', body: JSON.stringify({ name }) },
  )
  if (!res.ok || !res.data?.id) return { error: res.error || 'no list id returned' }
  return { listId: res.data.id }
}

export interface CreateClickUpTaskArgs {
  listId: string
  name: string
  /** Markdown-flavored description. ClickUp renders markdown in task bodies. */
  description?: string
  /** Optional - sets the initial status if it matches one of the list's
   * statuses. Falls back to the list default when omitted. */
  status?: string
}

export async function createClickUpTask(
  args: CreateClickUpTaskArgs,
): Promise<{ taskId?: string; error?: string }> {
  const body: Record<string, unknown> = { name: args.name }
  if (args.description) body.description = args.description
  if (args.status) body.status = args.status

  const res = await clickupFetch<{ id: string }>(
    `/list/${encodeURIComponent(args.listId)}/task`,
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!res.ok || !res.data?.id) return { error: res.error || 'no task id returned' }
  return { taskId: res.data.id }
}

/**
 * Create a subtask under an existing ClickUp task. ClickUp's create-task
 * endpoint accepts a `parent` field that turns the new task into a subtask
 * of `parentTaskId` while still living in the same list.
 */
export interface CreateSubtaskArgs {
  listId: string
  parentTaskId: string
  name: string
  description?: string
}

export async function createClickUpSubtask(
  args: CreateSubtaskArgs,
): Promise<{ taskId?: string; error?: string }> {
  const body: Record<string, unknown> = {
    name: args.name,
    parent: args.parentTaskId,
  }
  if (args.description) body.description = args.description
  const res = await clickupFetch<{ id: string }>(
    `/list/${encodeURIComponent(args.listId)}/task`,
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!res.ok || !res.data?.id) return { error: res.error || 'no subtask id returned' }
  return { taskId: res.data.id }
}

/**
 * Delete a ClickUp task. Used when the user picks "Delete from app + ClickUp"
 * on the campaigns page. Subtasks are deleted automatically by ClickUp when
 * the parent goes.
 */
export async function deleteClickUpTask(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await clickupFetch(
    `/task/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  )
  return { ok: res.ok, error: res.error }
}

/**
 * Fetch a task's current status string for the sync layer. Returns the raw
 * `status.status` field from ClickUp; the campaigns route maps that to our
 * snake_case enum before storing.
 */
export async function fetchClickUpTaskStatus(
  taskId: string,
): Promise<{ status?: string; error?: string }> {
  if (!taskId) return { error: 'taskId missing' }
  const res = await clickupFetch<{ status?: { status?: string } }>(
    `/task/${encodeURIComponent(taskId)}`,
    { method: 'GET' },
  )
  if (!res.ok) return { error: res.error }
  return { status: res.data?.status?.status }
}