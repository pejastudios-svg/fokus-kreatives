import { admin } from '@/lib/emailOutbox'

/**
 * A client's email sending plan, inferred from how they send:
 *
 *  - 'workspace'  : connected a Google Workspace account (custom-domain
 *                   address). High daily limit, professional sender.
 *  - 'gmail_free' : connected a free @gmail.com account. Low daily limit,
 *                   shows the upgrade nudge.
 *  - 'shared'     : no SMTP connected; sends through the agency's shared
 *                   Apps Script account. Also low, and shared across clients.
 *
 * The plan is detected, not stored: it follows whatever account is actually
 * connected, so connecting Workspace lifts the cap automatically with no
 * extra toggle to flip.
 */

export type SendingPlan = 'gmail_free' | 'workspace' | 'shared'

// Conservative daily ceilings per plan. The user's configured daily_send_cap
// is clamped DOWN to these at send time, so a high setting can never push a
// free account past what Gmail tolerates.
export const PLAN_DAILY_MAX: Record<SendingPlan, number> = {
  workspace: 1800, // Workspace allows ~2,000/day; leave headroom.
  gmail_free: 120, // Free Gmail via SMTP is ~100-150/day.
  shared: 120, // Agency Apps Script account, shared across clients.
}

export interface PlanInfo {
  plan: SendingPlan
  address: string | null
  dailyMax: number
}

export function isFreeGmailAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase()
  return a.endsWith('@gmail.com') || a.endsWith('@googlemail.com')
}

export async function getSendingPlan(clientId: string): Promise<PlanInfo> {
  try {
    const { data } = await admin()
      .from('user_integrations')
      .select('metadata, status')
      .eq('client_id', clientId)
      .eq('provider', 'gmail_smtp')
      .maybeSingle()
    if (data && data.status === 'connected') {
      const addr = (data.metadata as { gmail_address?: string } | null)?.gmail_address || ''
      if (addr && !isFreeGmailAddress(addr)) {
        return { plan: 'workspace', address: addr, dailyMax: PLAN_DAILY_MAX.workspace }
      }
      if (addr) {
        return { plan: 'gmail_free', address: addr, dailyMax: PLAN_DAILY_MAX.gmail_free }
      }
    }
  } catch (e) {
    console.error('[emailMarketing] plan detection failed:', e)
  }
  return { plan: 'shared', address: null, dailyMax: PLAN_DAILY_MAX.shared }
}
