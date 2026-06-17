/**
 * Email marketing (CRM "Emails" tab) shared types.
 *
 * Settings live in clients.email_marketing_settings (jsonb). Campaign
 * scheduling is a small ruleset evaluated by the cron - eligible weekdays
 * plus optional date window plus explicit dates - rather than a precomputed
 * calendar, so editing rules takes effect immediately.
 */

export interface EmailCta {
  id: string
  /** Short internal label shown in pickers ("Business owners"). */
  label: string
  /** The sentence shown in the email ("If you run a business and..."). */
  text: string
  url: string
}

export interface EmailSocial {
  /** instagram | tiktok | youtube | facebook | linkedin | x | website */
  platform: string
  url: string
}

export interface EmailMarketingSettings {
  ctas: EmailCta[]
  ps_pool: string[]
  socials: EmailSocial[]
  /** CAN-SPAM footer line (business name + postal address). */
  footer_address: string
  /** Marketing sends per rolling day across all campaigns. Safety breaker. */
  daily_send_cap: number
  /** AI generations per calendar month. Safety breaker. */
  monthly_generation_cap: number
}

export const DEFAULT_DAILY_SEND_CAP = 100
export const DEFAULT_MONTHLY_GENERATION_CAP = 60

/** Parse the jsonb column tolerantly - missing keys get safe defaults. */
export function parseSettings(raw: unknown): EmailMarketingSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ctas = Array.isArray(obj.ctas)
    ? (obj.ctas as EmailCta[]).filter((c) => c && c.id && (c.text || c.url))
    : []
  const psPool = Array.isArray(obj.ps_pool)
    ? (obj.ps_pool as string[]).filter((p) => typeof p === 'string' && p.trim())
    : []
  const socials = Array.isArray(obj.socials)
    ? (obj.socials as EmailSocial[]).filter((s) => s && s.platform && s.url)
    : []
  const cap = Number(obj.daily_send_cap)
  const genCap = Number(obj.monthly_generation_cap)
  return {
    ctas,
    ps_pool: psPool,
    socials,
    footer_address: typeof obj.footer_address === 'string' ? obj.footer_address : '',
    // Upper bound is generous (Workspace headroom); the real per-send guard
    // is the plan-based clamp in dispatch, which keeps free accounts safe.
    daily_send_cap: Number.isFinite(cap) && cap > 0 ? Math.min(cap, 2500) : DEFAULT_DAILY_SEND_CAP,
    monthly_generation_cap:
      Number.isFinite(genCap) && genCap > 0 ? Math.min(genCap, 300) : DEFAULT_MONTHLY_GENERATION_CAP,
  }
}

// ===== Schedule rules =====

export interface ScheduleRules {
  /** Eligible weekdays, 0=Sunday..6=Saturday. */
  weekdays: number[]
  /** 'HH:MM' 24h, interpreted in `timezone`. */
  send_time: string
  /**
   * IANA timezone the campaign's dates and send time are evaluated in
   * (e.g. 'America/New_York'). Null = EMAIL_CAMPAIGN_TIMEZONE env, then UTC.
   */
  timezone?: string | null
  /** Optional window. */
  date_from?: string | null
  date_to?: string | null
  /** Explicit extra dates (YYYY-MM-DD), eligible regardless of weekday. */
  specific_dates?: string[]
  /** weekly = first eligible day each week; every_eligible_day = all of them. */
  cadence: 'weekly' | 'every_eligible_day'
}

/** True when the string is a timezone the runtime can actually resolve. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function parseScheduleRules(raw: unknown): ScheduleRules {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const weekdays = Array.isArray(obj.weekdays)
    ? (obj.weekdays as number[]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : []
  return {
    weekdays,
    send_time: typeof obj.send_time === 'string' && /^\d{2}:\d{2}$/.test(obj.send_time)
      ? obj.send_time
      : '09:00',
    timezone:
      typeof obj.timezone === 'string' && obj.timezone && isValidTimezone(obj.timezone)
        ? obj.timezone
        : null,
    date_from: typeof obj.date_from === 'string' ? obj.date_from : null,
    date_to: typeof obj.date_to === 'string' ? obj.date_to : null,
    specific_dates: Array.isArray(obj.specific_dates)
      ? (obj.specific_dates as string[]).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      : [],
    cadence: obj.cadence === 'every_eligible_day' ? 'every_eligible_day' : 'weekly',
  }
}

// ===== Content blocks =====

export type EmailBlock =
  | { id: string; type: 'text'; content: string }
  /** Highlighted box - the "quoted aside" treatment newsletters use. */
  | { id: string; type: 'callout'; content: string }
  | { id: string; type: 'image'; url: string; alt?: string }
  | { id: string; type: 'embed'; url: string; title?: string }
  | { id: string; type: 'button'; label: string; url: string }

export function parseBlocks(raw: unknown): EmailBlock[] {
  if (!Array.isArray(raw)) return []
  return (raw as EmailBlock[]).filter((b) => b && b.id && b.type)
}

// ===== Group filters =====

export type GroupRuleOp = 'eq' | 'neq' | 'contains' | 'not_contains' | 'empty' | 'not_empty'

/** Operators that don't take a value. */
export const VALUELESS_OPS: GroupRuleOp[] = ['empty', 'not_empty']

export interface GroupRule {
  /** leads.data key ('status', 'source', any custom field key). */
  field: string
  op: GroupRuleOp
  value: string
}

export interface GroupFilters {
  statuses: string[]
  rules: GroupRule[]
}

export function parseGroupFilters(raw: unknown): GroupFilters {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    statuses: Array.isArray(obj.statuses)
      ? (obj.statuses as string[]).filter((s) => typeof s === 'string' && s)
      : [],
    rules: Array.isArray(obj.rules)
      ? (obj.rules as GroupRule[]).filter(
          (r) => r && r.field && (r.value || VALUELESS_OPS.includes(r.op)),
        )
      : [],
  }
}

export const GROUP_RULE_OP_LABELS: Record<GroupRuleOp, string> = {
  eq: 'is',
  neq: "isn't",
  contains: 'contains',
  not_contains: "doesn't contain",
  empty: 'is empty',
  not_empty: 'is not empty',
}
