'use client'

// Compact email entry, Google-share style: added emails render as avatars
// (Gravatar profile picture when the address has one, colored initial
// otherwise), a round plus button expands into the typing field, and
// previously used addresses surface as type-ahead suggestions and behind
// a "Saved emails" browser with search.
//
// All panels render IN FLOW (they push the card taller) rather than as
// absolute overlays - absolute popovers get clipped inside the sidebar's
// scroll container.

import { useEffect, useRef, useState } from 'react'
import { Plus, X, Search } from 'lucide-react'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Stable, pleasant avatar color derived from the address. */
function colorFor(email: string): string {
  let h = 0
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % 360
  return `hsl(${h} 55% 45%)`
}

/** Avatar that shows a REAL uploaded profile picture when we have one for
 *  this address (workspace members / staff, via our users table). Public
 *  resolvers can't access arbitrary people's photos and return a generic
 *  silhouette, which looks worse than a clean colored initial - so for
 *  unknown addresses we just render the initial. */
function EmailAvatar({
  email,
  sizeCls,
  knownUrl,
}: {
  email: string
  sizeCls: string
  /** Profile picture from OUR users table - the only reliable source. */
  knownUrl?: string
}) {
  const [failed, setFailed] = useState(false)
  const normalized = email.trim().toLowerCase()
  // Reset the broken-image flag if the known URL changes (it loads async
  // after the modal opens) - React's "adjust state on prop change" pattern.
  const [lastUrl, setLastUrl] = useState(knownUrl)
  if (knownUrl !== lastUrl) {
    setLastUrl(knownUrl)
    setFailed(false)
  }
  const showImg = Boolean(knownUrl) && !failed
  return (
    <span
      className={`relative flex ${sizeCls} shrink-0 items-center justify-center overflow-hidden rounded-full text-white font-bold`}
      style={{ backgroundColor: colorFor(normalized) }}
    >
      {normalized[0]?.toUpperCase()}
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={knownUrl}
          onError={() => setFailed(true)}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  )
}

interface Props {
  value: string[]
  onChange: (emails: string[]) => void
  /** Previously used addresses for suggestions + the saved-emails browser. */
  saved?: string[]
  /** email -> profile picture URL for people known to the workspace. */
  knownAvatars?: Record<string, string>
}

export function EmailAvatarsInput({ value, onChange, saved = [], knownAvatars = {} }: Props) {
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [openChip, setOpenChip] = useState<string | null>(null)
  const [showSaved, setShowSaved] = useState(false)
  const [savedQuery, setSavedQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenChip(null)
        setShowSaved(false)
        if (!draft.trim()) setTyping(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [draft])

  const add = (raw: string) => {
    const email = raw.trim().toLowerCase()
    if (!email) return
    if (!EMAIL_RE.test(email)) {
      setError(`"${raw.trim()}" is not a valid email`)
      return
    }
    if (!value.includes(email)) onChange([...value, email])
    setDraft('')
    setError('')
  }

  const remove = (email: string) => {
    onChange(value.filter((e) => e !== email))
    setOpenChip(null)
  }

  const q = draft.trim().toLowerCase()
  const suggestions =
    q.length >= 2
      ? saved.filter((s) => s.includes(q) && !value.includes(s)).slice(0, 5)
      : []

  const savedList = saved.filter(
    (s) =>
      !value.includes(s) &&
      (!savedQuery.trim() || s.includes(savedQuery.trim().toLowerCase())),
  )

  return (
    <div ref={rootRef}>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((email) => (
          <button
            key={email}
            type="button"
            title={email}
            onClick={() => setOpenChip(openChip === email ? null : email)}
            className={`rounded-full ring-2 transition-shadow ${
              openChip === email ? 'ring-[#2B79F7]' : 'ring-transparent hover:ring-[#2B79F7]/40'
            }`}
          >
            <EmailAvatar email={email} sizeCls="h-8 w-8 text-xs" knownUrl={knownAvatars[email.trim().toLowerCase()]} />
          </button>
        ))}

        {typing ? (
          <div className="flex items-center gap-1.5 rounded-full bg-[var(--bg-tertiary)] pl-2.5 pr-2 py-1">
            <Plus className="h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0" />
            <input
              autoFocus
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  add(draft)
                }
                if (e.key === 'Escape') {
                  setDraft('')
                  setTyping(false)
                }
              }}
              onBlur={() => {
                // Let suggestion clicks land first (they preventDefault).
                if (draft.trim()) add(draft)
                else setTyping(false)
              }}
              placeholder="Enter an email address"
              className="w-40 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            />
          </div>
        ) : (
          <button
            type="button"
            title="Add email"
            onClick={() => setTyping(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[#2B79F7]/15 hover:text-[#2B79F7] transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Selected avatar details: in flow so nothing clips it. */}
      {openChip && value.includes(openChip) && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5">
          <span className="min-w-0 truncate text-xs text-[var(--text-primary)]">{openChip}</span>
          <button
            type="button"
            title="Remove"
            onClick={() => remove(openChip)}
            className="shrink-0 rounded-full p-1 text-red-500 hover:bg-red-500/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Type-ahead suggestions from saved emails. */}
      {typing && suggestions.length > 0 && (
        <div className="mt-1.5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] py-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              <EmailAvatar email={s} sizeCls="h-5 w-5 text-[9px]" knownUrl={knownAvatars[s.trim().toLowerCase()]} />
              <span className="truncate">{s}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-1.5 text-[11px] text-red-500">{error}</p>}

      {saved.length > 0 && (
        <button
          type="button"
          onClick={() => setShowSaved((s) => !s)}
          className="mt-2 text-[11px] font-semibold text-[#2B79F7] hover:underline"
        >
          Saved emails
        </button>
      )}
      {showSaved && (
        <div className="mt-1.5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2">
          <div className="relative mb-1.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <input
              value={savedQuery}
              onChange={(e) => setSavedQuery(e.target.value)}
              placeholder="Search saved emails"
              className="w-full rounded-full bg-[var(--bg-tertiary)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            />
          </div>
          <div className="max-h-36 overflow-y-auto">
            {savedList.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-[var(--text-tertiary)]">No matches.</p>
            ) : (
              savedList.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => add(s)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  <EmailAvatar email={s} sizeCls="h-5 w-5 text-[9px]" knownUrl={knownAvatars[s.trim().toLowerCase()]} />
                  <span className="truncate">{s}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
