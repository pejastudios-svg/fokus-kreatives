// Time-bucketing helpers for chart data. Pages emit one event per
// row (lead created, payment paid, etc.) and ask `bucketize` to
// aggregate them by day / week / month / auto across a window.
//
// "All time" picks a sensible bucket size based on the actual data
// span so we don't render 700 daily bars or 3 monthly ones.

export type BucketMode = 'day' | 'week' | 'month' | 'all'

export interface ChartEvent {
  date: Date
  // Per-series numeric contribution. Caller decides which series this
  // event lands in (e.g. status === 'paid' -> { collected: amount }).
  values: Record<string, number>
}

export interface BucketRow {
  // ISO key for the bucket (yyyy-mm-dd for day, yyyy-Www for week,
  // yyyy-mm for month). Only used as a stable React key.
  date: string
  // Human-readable axis label.
  label: string
  // Aggregated values per series.
  [seriesKey: string]: string | number
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function startOfWeek(d: Date): Date {
  // ISO week starts on Monday.
  const day = d.getDay() // 0=Sun..6=Sat
  const diff = (day + 6) % 7
  const out = startOfDay(d)
  out.setDate(out.getDate() - diff)
  return out
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function weekKey(d: Date): string {
  // Approximation - good enough for grouping. Uses ISO week start.
  const sow = startOfWeek(d)
  return `W${dayKey(sow)}`
}

function weekLabel(d: Date): string {
  const sow = startOfWeek(d)
  return sow.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

function pickAutoMode(events: ChartEvent[]): Exclude<BucketMode, 'all'> {
  if (events.length === 0) return 'day'
  let min = events[0].date.getTime()
  let max = min
  for (const e of events) {
    const t = e.date.getTime()
    if (t < min) min = t
    if (t > max) max = t
  }
  const days = (max - min) / (24 * 60 * 60 * 1000)
  if (days <= 60) return 'day'
  if (days <= 365) return 'week'
  return 'month'
}

interface BucketizeOptions {
  mode: BucketMode
  // Series keys we always want present in every row, even when zero.
  // Without this, a missing series shows as undefined in the chart.
  seriesKeys: string[]
  // For day/week/month modes: anchor the window at "today" and walk
  // back N units. Ignored in 'all' mode (which uses the data span).
  windowDays?: number // for 'day'
  windowWeeks?: number // for 'week'
  windowMonths?: number // for 'month'
}

export function bucketize(
  events: ChartEvent[],
  opts: BucketizeOptions,
): { rows: BucketRow[]; effectiveMode: Exclude<BucketMode, 'all'> } {
  const mode: Exclude<BucketMode, 'all'> =
    opts.mode === 'all' ? pickAutoMode(events) : opts.mode

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const rows: BucketRow[] = []
  const idx = new Map<string, number>()

  function pushBucket(key: string, label: string) {
    const row: BucketRow = { date: key, label }
    for (const k of opts.seriesKeys) row[k] = 0
    idx.set(key, rows.length)
    rows.push(row)
  }

  if (mode === 'day') {
    const n = opts.windowDays ?? 30
    if (opts.mode === 'all' && events.length > 0) {
      // 'all' was downgraded to day - use the data span.
      let min = events[0].date.getTime()
      for (const e of events)
        if (e.date.getTime() < min) min = e.date.getTime()
      const startDay = startOfDay(new Date(min))
      const dayMs = 24 * 60 * 60 * 1000
      const span = Math.ceil(
        (today.getTime() - startDay.getTime()) / dayMs,
      ) + 1
      for (let i = span - 1; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(today.getDate() - i)
        pushBucket(dayKey(d), dayLabel(d))
      }
    } else {
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(today.getDate() - i)
        pushBucket(dayKey(d), dayLabel(d))
      }
    }
  } else if (mode === 'week') {
    const n = opts.windowWeeks ?? 12
    if (opts.mode === 'all' && events.length > 0) {
      let min = events[0].date.getTime()
      for (const e of events)
        if (e.date.getTime() < min) min = e.date.getTime()
      const startWeek = startOfWeek(new Date(min))
      const span =
        Math.ceil(
          (startOfWeek(today).getTime() - startWeek.getTime()) /
            (7 * 24 * 60 * 60 * 1000),
        ) + 1
      for (let i = span - 1; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(today.getDate() - i * 7)
        pushBucket(weekKey(d), weekLabel(d))
      }
    } else {
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(today.getDate() - i * 7)
        pushBucket(weekKey(d), weekLabel(d))
      }
    }
  } else {
    // month
    const n = opts.windowMonths ?? 12
    if (opts.mode === 'all' && events.length > 0) {
      let min = events[0].date.getTime()
      for (const e of events)
        if (e.date.getTime() < min) min = e.date.getTime()
      const startMonth = startOfMonth(new Date(min))
      const totalMonths =
        (today.getFullYear() - startMonth.getFullYear()) * 12 +
        (today.getMonth() - startMonth.getMonth()) +
        1
      for (let i = totalMonths - 1; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
        pushBucket(monthKey(d), monthLabel(d))
      }
    } else {
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
        pushBucket(monthKey(d), monthLabel(d))
      }
    }
  }

  // Bucket each event into the row that matches.
  for (const e of events) {
    let key: string
    if (mode === 'day') key = dayKey(e.date)
    else if (mode === 'week') key = weekKey(e.date)
    else key = monthKey(e.date)
    const i = idx.get(key)
    if (i == null) continue
    for (const [seriesKey, amt] of Object.entries(e.values)) {
      const cur = rows[i][seriesKey]
      rows[i][seriesKey] = (typeof cur === 'number' ? cur : 0) + amt
    }
  }

  return { rows, effectiveMode: mode }
}
