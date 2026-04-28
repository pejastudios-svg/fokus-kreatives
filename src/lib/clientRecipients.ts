import type { SupabaseClient } from '@supabase/supabase-js'

export interface AgencyRecipient {
  id: string
  email: string | null
}

/**
 * Resolve which agency team members should receive notifications about a client.
 *
 * If the client has explicit assignees in `client_assignees`, return those users.
 * Otherwise, fall back to all admins + managers so notifications never silently drop.
 */
export async function getAgencyRecipientsForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AgencyRecipient[]> {
  if (!clientId) return []

  const { data: assignees } = await supabase
    .from('client_assignees')
    .select('user_id, users:user_id (id, email)')
    .eq('client_id', clientId)

  const fromAssignees: AgencyRecipient[] = []
  for (const row of assignees || []) {
    const usersField = (row as unknown as { users: unknown }).users
    const u = Array.isArray(usersField) ? usersField[0] : usersField
    const typed = u as { id?: string; email?: string | null } | null | undefined
    if (typed?.id) fromAssignees.push({ id: typed.id, email: typed.email ?? null })
  }

  if (fromAssignees.length > 0) {
    return dedupe(fromAssignees)
  }

  const { data: fallback } = await supabase
    .from('users')
    .select('id, email')
    .in('role', ['admin', 'manager'])
    .is('client_id', null)

  const list: AgencyRecipient[] = (fallback || [])
    .map((u: { id: string | null; email: string | null }) => ({
      id: u.id || '',
      email: u.email,
    }))
    .filter((u: AgencyRecipient) => Boolean(u.id))

  return dedupe(list)
}

export async function getAgencyRecipientIdsForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<string[]> {
  const recipients = await getAgencyRecipientsForClient(supabase, clientId)
  return recipients.map((r) => r.id)
}

function dedupe(list: AgencyRecipient[]): AgencyRecipient[] {
  const seen = new Set<string>()
  const out: AgencyRecipient[] = []
  for (const r of list) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out
}
