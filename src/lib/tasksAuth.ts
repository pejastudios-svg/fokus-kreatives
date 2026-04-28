import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const taskAdmin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type TaskAuthOk = {
  ok: true
  user: { id: string; email: string | null }
  role: 'admin' | 'manager' | 'employee'
  /** Set of client IDs this user is assigned to. Empty for admin/manager (they see all). */
  clientIds: Set<string>
  isAdminOrManager: boolean
}

export type TaskAuthErr = { ok: false; status: number; error: string }

/**
 * Verifies the current session and resolves the role + accessible client IDs.
 * Use this at the top of every /api/tasks/* route — it returns either an
 * authorized context to use with `taskAdmin`, or an error to return directly.
 */
export async function authorizeTaskRequest(): Promise<TaskAuthOk | TaskAuthErr> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Not authenticated' }

  const { data: me, error: meErr } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (meErr || !me) return { ok: false, status: 403, error: 'No user profile' }

  const role = me.role as 'admin' | 'manager' | 'employee' | 'client'
  if (role === 'client') {
    return { ok: false, status: 403, error: 'Clients cannot access tasks' }
  }

  const isAdminOrManager = role === 'admin' || role === 'manager'

  let clientIds = new Set<string>()
  if (!isAdminOrManager) {
    const { data: assignments } = await taskAdmin
      .from('client_assignees')
      .select('client_id')
      .eq('user_id', user.id)
    clientIds = new Set((assignments || []).map((a: { client_id: string }) => a.client_id))
  }

  return {
    ok: true,
    user: { id: user.id, email: user.email ?? null },
    role,
    clientIds,
    isAdminOrManager,
  }
}

export function canAccessClient(auth: TaskAuthOk, clientId: string): boolean {
  if (auth.isAdminOrManager) return true
  return auth.clientIds.has(clientId)
}

/**
 * Common pattern: authorize the request, then verify the caller can access
 * the given task's client. Returns either an OK envelope with the auth +
 * resolved task or an error envelope to JSON-return directly.
 */
export async function assertTaskAccess(taskId: string): Promise<
  | { ok: true; auth: TaskAuthOk; task: { id: string; client_id: string } }
  | { ok: false; status: number; error: string }
> {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error }

  if (!taskId) return { ok: false, status: 400, error: 'Missing task id' }

  const { data: task } = await taskAdmin
    .from('tasks')
    .select('id, client_id')
    .eq('id', taskId)
    .maybeSingle()

  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  if (!canAccessClient(auth, task.client_id)) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  return { ok: true, auth, task }
}
