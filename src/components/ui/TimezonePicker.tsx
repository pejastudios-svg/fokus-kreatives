'use client'

// IANA timezone picker with live current-time display + search.
//
// Uses `Intl.supportedValuesOf('timeZone')` (built into modern
// browsers - Chrome 99+, Safari 15.4+, Firefox 93+) to get the
// complete list of IANA names. For each, we compute the current
// local time using Intl.DateTimeFormat and the short tz abbreviation
// (e.g. "PDT", "EST", "WAT") so users see a friendly label.
//
// Search filters both the IANA name (e.g. "america/los_angeles")
// and the abbreviation, so typing "PDT" or "los_angeles" both work.
//
// No external API required - everything runs in the browser.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Check, Globe, ChevronDown } from 'lucide-react'

interface TimezonePickerProps {
  value: string
  onChange: (timezone: string) => void
  /** If provided, shown as a button below the search that one-click
   *  selects the user's browser timezone. */
  suggestBrowser?: boolean
  disabled?: boolean
}

interface TzMeta {
  /** IANA name, e.g. "America/Los_Angeles". */
  name: string
  /** Friendly city portion, e.g. "Los Angeles". */
  city: string
  /** Region portion, e.g. "America". */
  region: string
  /** Short abbreviation right now, e.g. "PDT". May be a numeric
   *  offset like "GMT-7" for timezones without a named abbrev. */
  abbrev: string
  /** Current local time formatted as "9:42 AM". */
  nowLabel: string
  /** Numeric offset from UTC in minutes, for sorting. */
  offsetMinutes: number
  /** Lowercased searchable haystack. */
  search: string
}

// User-friendly aliases for common timezones. The `abbrev` returned
// by Intl reflects whatever's CURRENT (e.g. EDT in summer, EST in
// winter for US Eastern), so a user searching for "EST" in June
// wouldn't find New York. The aliases below let both the standard
// and daylight short names match, plus region words like "Eastern"
// or "Pacific" that people actually type.
const TZ_ALIASES: Record<string, string[]> = {
  'America/New_York': ['EST', 'EDT', 'ET', 'Eastern', 'Eastern Time'],
  'America/Detroit': ['EST', 'EDT', 'ET', 'Eastern'],
  'America/Toronto': ['EST', 'EDT', 'ET', 'Eastern'],
  'America/Chicago': ['CST', 'CDT', 'CT', 'Central', 'Central Time'],
  'America/Winnipeg': ['CST', 'CDT', 'CT', 'Central'],
  'America/Denver': ['MST', 'MDT', 'MT', 'Mountain', 'Mountain Time'],
  'America/Phoenix': ['MST', 'Mountain', 'Arizona'],
  'America/Edmonton': ['MST', 'MDT', 'Mountain'],
  'America/Los_Angeles': ['PST', 'PDT', 'PT', 'Pacific', 'Pacific Time'],
  'America/Vancouver': ['PST', 'PDT', 'PT', 'Pacific'],
  'America/Anchorage': ['AKST', 'AKDT', 'Alaska'],
  'Pacific/Honolulu': ['HST', 'Hawaii'],
  'America/Halifax': ['AST', 'ADT', 'Atlantic'],
  'America/St_Johns': ['NST', 'NDT', 'Newfoundland'],
  'Europe/London': ['GMT', 'BST', 'UK', 'Britain', 'British'],
  'Europe/Dublin': ['GMT', 'IST', 'Ireland', 'Irish'],
  'Europe/Paris': ['CET', 'CEST', 'Central European'],
  'Europe/Berlin': ['CET', 'CEST', 'Central European', 'Germany'],
  'Europe/Madrid': ['CET', 'CEST', 'Spain'],
  'Europe/Rome': ['CET', 'CEST', 'Italy'],
  'Europe/Amsterdam': ['CET', 'CEST', 'Netherlands'],
  'Europe/Brussels': ['CET', 'CEST', 'Belgium'],
  'Europe/Stockholm': ['CET', 'CEST', 'Sweden'],
  'Europe/Helsinki': ['EET', 'EEST', 'Eastern European', 'Finland'],
  'Europe/Athens': ['EET', 'EEST', 'Greece'],
  'Europe/Istanbul': ['TRT', 'Turkey'],
  'Europe/Moscow': ['MSK', 'Moscow', 'Russia'],
  'Africa/Lagos': ['WAT', 'West Africa', 'Nigeria'],
  'Africa/Cairo': ['EET', 'EEST', 'Egypt'],
  'Africa/Johannesburg': ['SAST', 'South Africa'],
  'Africa/Nairobi': ['EAT', 'East Africa', 'Kenya'],
  'Asia/Dubai': ['GST', 'UAE', 'Dubai', 'Gulf'],
  'Asia/Riyadh': ['AST', 'Saudi Arabia'],
  'Asia/Tehran': ['IRST', 'IRDT', 'Iran'],
  'Asia/Karachi': ['PKT', 'Pakistan'],
  'Asia/Kolkata': ['IST', 'India'],
  'Asia/Dhaka': ['BST', 'Bangladesh'],
  'Asia/Bangkok': ['ICT', 'Thailand'],
  'Asia/Singapore': ['SGT', 'Singapore'],
  'Asia/Hong_Kong': ['HKT', 'Hong Kong'],
  'Asia/Shanghai': ['CST', 'China', 'Beijing'],
  'Asia/Tokyo': ['JST', 'Japan'],
  'Asia/Seoul': ['KST', 'Korea'],
  'Australia/Perth': ['AWST', 'Western Australia'],
  'Australia/Adelaide': ['ACST', 'ACDT', 'Central Australia'],
  'Australia/Sydney': ['AEST', 'AEDT', 'Eastern Australia', 'Sydney', 'Melbourne'],
  'Australia/Brisbane': ['AEST', 'Queensland', 'Brisbane'],
  'Pacific/Auckland': ['NZST', 'NZDT', 'New Zealand'],
  'America/Mexico_City': ['CST', 'CDT', 'Mexico'],
  'America/Sao_Paulo': ['BRT', 'BRST', 'Brazil', 'Sao Paulo'],
  'America/Argentina/Buenos_Aires': ['ART', 'Argentina', 'Buenos Aires'],
  'America/Bogota': ['COT', 'Colombia'],
  'America/Lima': ['PET', 'Peru'],
  'America/Santiago': ['CLT', 'CLST', 'Chile'],
}

function listAllTimezones(): string[] {
  try {
    const intl = Intl as unknown as {
      supportedValuesOf?: (key: 'timeZone') => string[]
    }
    if (typeof intl.supportedValuesOf === 'function') {
      return intl.supportedValuesOf('timeZone')
    }
  } catch {
    // Fall through
  }
  // Fallback list - small, covers the most common cases. Used only
  // if the browser doesn't support Intl.supportedValuesOf.
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'Africa/Lagos',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
  ]
}

function buildMeta(name: string, now: Date): TzMeta {
  let abbrev = ''
  let nowLabel = ''
  let offsetMinutes = 0
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      hour12: true,
    }).formatToParts(now)
    nowLabel =
      parts
        .filter((p) => p.type === 'hour' || p.type === 'literal' || p.type === 'minute' || p.type === 'dayPeriod')
        .map((p) => p.value)
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    abbrev = parts.find((p) => p.type === 'timeZoneName')?.value || ''

    // Compute offset by formatting the same instant in UTC vs the tz
    // and diffing the wall-clock components.
    const tzPartsLong = new Intl.DateTimeFormat('en-GB', {
      timeZone: name,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const get = (type: string) => Number(tzPartsLong.find((p) => p.type === type)?.value || '0')
    const localAsUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') === 24 ? 0 : get('hour'),
      get('minute'),
    )
    offsetMinutes = Math.round((localAsUtc - now.getTime()) / 60_000)
  } catch {
    // ignore - field stays default
  }

  const [region, cityRaw] = name.includes('/') ? name.split('/', 2) : ['', name]
  const city = (cityRaw || name).replace(/_/g, ' ')

  // The Intl-reported `abbrev` is the CURRENT one (e.g. EDT in
  // summer); aliases let users search the standard name too (EST
  // year-round), plus regional words like "Eastern" or "Pacific".
  const aliases = TZ_ALIASES[name] || []

  return {
    name,
    city,
    region,
    abbrev,
    nowLabel,
    offsetMinutes,
    search: `${name} ${abbrev} ${city} ${aliases.join(' ')}`.toLowerCase(),
  }
}

export function TimezonePicker({
  value,
  onChange,
  suggestBrowser = true,
  disabled,
}: TimezonePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Recompute "now" every minute so the displayed times stay live
  // without re-rendering 60x/sec.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Focus search on open.
  useEffect(() => {
    if (open) {
      // Tiny delay so the popover is mounted before focus.
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [open])

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return null
    }
  }, [])

  // All tz metas, sorted by offset then city. Heavy computation but
  // cached across renders for the same `now` minute.
  const all: TzMeta[] = useMemo(() => {
    const names = listAllTimezones()
    return names
      .map((n) => buildMeta(n, now))
      .sort((a, b) => {
        if (a.offsetMinutes !== b.offsetMinutes) return a.offsetMinutes - b.offsetMinutes
        return a.name.localeCompare(b.name)
      })
  }, [now])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((m) => m.search.includes(q))
  }, [all, query])

  const selectedMeta = useMemo(
    () => all.find((m) => m.name === value),
    [all, value],
  )

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] disabled:opacity-50"
      >
        <Globe className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
        <span className="flex-1 min-w-0 truncate text-left">
          {selectedMeta ? (
            <>
              {selectedMeta.name.replace(/_/g, ' ')}
              {selectedMeta.abbrev && (
                <span className="text-[var(--text-tertiary)] ml-1.5">
                  · {selectedMeta.abbrev} · {selectedMeta.nowLabel}
                </span>
              )}
            </>
          ) : (
            <span className="text-[var(--text-tertiary)]">Pick a timezone</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-xl shadow-lg overflow-hidden animate-in fade-in zoom-in duration-150">
          <div className="p-2 border-b border-[var(--border-primary)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="EST, Eastern, Lagos, Tokyo..."
                className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>
            {suggestBrowser && browserTz && value !== browserTz && (
              <button
                type="button"
                onClick={() => {
                  onChange(browserTz)
                  setOpen(false)
                }}
                className="mt-1.5 w-full text-left text-[11px] text-[#2B79F7] hover:underline px-1"
              >
                Use my current timezone ({browserTz})
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-3 text-xs text-[var(--text-tertiary)] text-center">
                No timezones match &quot;{query}&quot;.
              </div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => {
                    onChange(m.name)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--bg-card-hover)] ${
                    m.name === value ? 'bg-[#2B79F7]/10 text-[#2B79F7]' : 'text-[var(--text-primary)]'
                  }`}
                >
                  <span className="flex-1 min-w-0 truncate">
                    {m.name.replace(/_/g, ' ')}
                  </span>
                  {m.abbrev && (
                    <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums shrink-0">
                      {m.abbrev}
                    </span>
                  )}
                  <span className="text-[var(--text-tertiary)] tabular-nums shrink-0 w-16 text-right">
                    {m.nowLabel}
                  </span>
                  {m.name === value && <Check className="h-3.5 w-3.5 text-[#2B79F7] shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
