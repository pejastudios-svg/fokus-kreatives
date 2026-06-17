import { admin } from '@/lib/emailOutbox'
import { parseGroupFilters, type GroupFilters } from './types'

/**
 * Resolve a group to actual recipients at send time: leads matching the
 * property rules, plus hand-picked lead_ids, minus suppressions, deduped by
 * email. No group on a campaign = every lead with an email address.
 */

export interface Recipient {
  leadId: string
  email: string
  name: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function leadMatches(data: Record<string, unknown>, filters: GroupFilters): boolean {
  if (filters.statuses.length > 0) {
    const status = String(data.status ?? '')
    if (!filters.statuses.includes(status)) return false
  }
  for (const rule of filters.rules) {
    const value = String(data[rule.field] ?? '').trim().toLowerCase()
    const target = rule.value.trim().toLowerCase()
    switch (rule.op) {
      case 'neq':
        if (value === target) return false
        break
      case 'contains':
        if (!value.includes(target)) return false
        break
      case 'not_contains':
        if (value.includes(target)) return false
        break
      case 'empty':
        if (value) return false
        break
      case 'not_empty':
        if (!value) return false
        break
      default: // eq
        if (value !== target) return false
    }
  }
  return true
}

export async function loadSuppressedEmails(clientId: string): Promise<Set<string>> {
  const { data } = await admin()
    .from('email_suppressions')
    .select('email')
    .eq('client_id', clientId)
  return new Set((data || []).map((r) => String(r.email).toLowerCase()))
}

export async function resolveAudience(
  clientId: string,
  groupId: string | null,
): Promise<Recipient[]> {
  const db = admin()

  let filters: GroupFilters = { statuses: [], rules: [] }
  let pickedIds: string[] = []
  let hasGroup = false
  if (groupId) {
    const { data: group } = await db
      .from('email_groups')
      .select('filters, lead_ids')
      .eq('id', groupId)
      .eq('client_id', clientId)
      .maybeSingle()
    if (group) {
      hasGroup = true
      filters = parseGroupFilters(group.filters)
      pickedIds = Array.isArray(group.lead_ids) ? (group.lead_ids as string[]) : []
    }
  }

  const { data: leads } = await db
    .from('leads')
    .select('id, data')
    .eq('client_id', clientId)
  if (!leads || leads.length === 0) return []

  const suppressed = await loadSuppressedEmails(clientId)
  const picked = new Set(pickedIds)
  const hasRules = filters.statuses.length > 0 || filters.rules.length > 0

  const seen = new Set<string>()
  const out: Recipient[] = []
  for (const row of leads) {
    const data = (row.data as Record<string, unknown> | null) || {}
    const email = String(data.email ?? '').trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) continue
    if (suppressed.has(email)) continue

    // Group semantics: rules OR hand-picked. A group with neither matches
    // nothing (it's an empty list, not "everyone"); no group = everyone.
    if (hasGroup) {
      const byRules = hasRules && leadMatches(data, filters)
      const byPick = picked.has(row.id as string)
      if (!byRules && !byPick) continue
    }

    if (seen.has(email)) continue
    seen.add(email)
    out.push({
      leadId: row.id as string,
      email,
      name: String(data.name ?? '').trim(),
    })
  }
  return out
}
