import type { ScheduleRules } from './types'

/**
 * Scheduling math for recurring campaigns. Dates are plain YYYY-MM-DD
 * strings compared lexically (safe for ISO dates); "today" comes from the
 * caller so cron and previews agree.
 */

function ymd(d: Date): string {
  return d.toISOString().split('T')[0]
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return ymd(d)
}

function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay()
}

/** Monday-anchored ISO week key, used by the 'weekly' cadence. */
export function weekKey(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  const day = d.getUTCDay() || 7 // Sunday -> 7
  d.setUTCDate(d.getUTCDate() - (day - 1))
  return ymd(d)
}

export function isEligibleDate(rules: ScheduleRules, date: string): boolean {
  if (rules.date_from && date < rules.date_from) return false
  if (rules.date_to && date > rules.date_to) return false
  if (rules.specific_dates?.includes(date)) return true
  return rules.weekdays.includes(weekdayOf(date))
}

/**
 * Next eligible send dates from `fromDate` (inclusive), up to `horizonDays`
 * out. For the weekly cadence only the first eligible day of each ISO week
 * is returned. The cron asks for a small horizon (draft-ahead window); the
 * UI can ask for more to preview the upcoming calendar.
 */
export function upcomingSendDates(
  rules: ScheduleRules,
  fromDate: string,
  horizonDays: number,
): string[] {
  if (rules.weekdays.length === 0 && (rules.specific_dates?.length ?? 0) === 0) return []
  const out: string[] = []
  const seenWeeks = new Set<string>()
  let cursor = fromDate
  for (let i = 0; i < horizonDays; i++) {
    if (isEligibleDate(rules, cursor)) {
      if (rules.cadence === 'weekly') {
        const wk = weekKey(cursor)
        if (!seenWeeks.has(wk)) {
          seenWeeks.add(wk)
          out.push(cursor)
        }
      } else {
        out.push(cursor)
      }
    }
    cursor = addDays(cursor, 1)
  }
  return out
}

/**
 * Current date + clock in a campaign's timezone. Serverless runs in UTC, so
 * "send at 09:00" must be evaluated where the audience lives. Resolution
 * order: the campaign's own schedule_rules.timezone, then the
 * EMAIL_CAMPAIGN_TIMEZONE env default, then UTC.
 */
export function zonedNow(
  campaignTz?: string | null,
  now: Date = new Date(),
): { ymd: string; hh: number; mm: number } {
  const timeZone = campaignTz || process.env.EMAIL_CAMPAIGN_TIMEZONE || 'UTC'
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00'
    return {
      ymd: `${get('year')}-${get('month')}-${get('day')}`,
      hh: Number(get('hour')) % 24,
      mm: Number(get('minute')),
    }
  } catch {
    return {
      ymd: now.toISOString().split('T')[0],
      hh: now.getUTCHours(),
      mm: now.getUTCMinutes(),
    }
  }
}

/** 'HH:MM' has passed (or is now) in the campaign's timezone. */
export function sendTimeReached(
  sendTime: string,
  now: Date,
  campaignTz?: string | null,
): boolean {
  const [h, m] = sendTime.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return true
  const { hh, mm } = zonedNow(campaignTz, now)
  return hh > h || (hh === h && mm >= m)
}
