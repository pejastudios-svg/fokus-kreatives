'use client'

import { useState, type KeyboardEvent } from 'react'
import { X, Plus } from 'lucide-react'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  /** Currently selected emails (lowercased). */
  value: string[]
  onChange: (emails: string[]) => void
  /** Previously-used emails to offer as one-tap suggestions. */
  recent?: string[]
}

/** Tag-style email entry: type an address and press Enter (or comma) to
 *  add it as a chip; click the × to remove. Recently-used addresses show
 *  below as tap-to-add pills so common recipients don't get retyped. */
export function EmailChipsInput({ value, onChange, recent = [] }: Props) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const addEmail = (raw: string) => {
    const email = raw.trim().toLowerCase()
    if (!email) return
    if (!EMAIL_RE.test(email)) {
      setError(`"${raw.trim()}" is not a valid email`)
      return
    }
    if (!value.includes(email)) onChange([...value, email])
    setDraft('')
    setError(null)
  }

  const removeEmail = (email: string) => onChange(value.filter((e) => e !== email))

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addEmail(draft)
    } else if (e.key === 'Backspace' && !draft && value.length) {
      // Empty input + Backspace removes the last chip, like real tag inputs.
      removeEmail(value[value.length - 1])
    }
  }

  const suggestions = recent.filter((e) => !value.includes(e))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl focus-within:ring-2 focus-within:ring-[#2B79F7]">
        {value.map((email) => (
          <span
            key={email}
            title={email}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-[#2B79F7]/15 pl-2.5 pr-1.5 py-1 text-sm text-[#2B79F7]"
          >
            <span className="truncate">{email}</span>
            <button
              type="button"
              onClick={() => removeEmail(email)}
              title="Remove"
              className="shrink-0 rounded-md p-0.5 hover:bg-[#2B79F7]/25"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          autoComplete="off"
          // Tell password managers to leave this field alone - they inject a
          // white fill highlight / icon onto recognized email fields.
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          name="attendee-email-entry"
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            const e = draft.trim().toLowerCase()
            if (e && EMAIL_RE.test(e)) addEmail(draft)
          }}
          placeholder={value.length ? 'Add another…' : 'Type an email, press Enter'}
          className="email-chip-input flex-1 min-w-[140px] bg-transparent text-sm text-[var(--text-primary)] placeholder-gray-500 focus:outline-none py-0.5"
        />
      </div>

      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}

      {suggestions.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] text-[var(--text-tertiary)] mb-1">Recently added, tap to add</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((email) => (
              <button
                key={email}
                type="button"
                onClick={() => addEmail(email)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--border-primary)] text-[var(--text-secondary)] text-xs hover:border-[#2B79F7] hover:text-[#2B79F7] transition-colors"
              >
                <Plus className="h-3 w-3" />
                {email}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
