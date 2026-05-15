'use client'

// /admin-unlock - the password prompt that gates /admin/*.
//
// Lives OUTSIDE the /admin route segment so the admin layout's gate
// doesn't redirect this page to itself (which would loop forever when
// the reauth cookie is missing). Once the password is verified, we
// route to /admin (or the `?next=` target).
//
// Reachable in two ways:
//   1. Click "Admin" in the sidebar profile dropdown when no fresh
//      admin_reauth cookie exists (redirected here by the layout).
//   2. Direct URL.
//
// The /api/admin/reauth handler does the actual role + password check,
// so this page is fine to live at an unprotected URL - non-admins
// reaching it can't get past the API.

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Loader2 } from 'lucide-react'

export default function AdminUnlockPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Read the ?next= query param via window (not useSearchParams) so
  // there's no Suspense-boundary requirement and no double-render
  // hook-count mismatch. Falls back to /admin when missing or SSR.
  const getNextPath = (): string => {
    if (typeof window === 'undefined') return '/admin'
    const sp = new URLSearchParams(window.location.search)
    return sp.get('next') || '/admin'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || busy) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/admin/reauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Incorrect password')
        setPassword('')
        inputRef.current?.focus()
        return
      }
      router.replace(getNextPath())
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm border border-[var(--border-primary)] bg-[var(--bg-card)] rounded-md p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="text-[10px] uppercase tracking-wider">Admin access</span>
        </div>
        <div>
          <h1 className="text-lg font-medium text-[var(--text-primary)]">
            Re-enter your password
          </h1>
          <p className="mt-1 text-xs text-[var(--text-tertiary)] leading-relaxed">
            For admin pages we ask for your password each time. You stay
            unlocked for 15 minutes of activity, same as the rest of the app.
          </p>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="admin-password"
            className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]"
          >
            Password
          </label>
          <input
            ref={inputRef}
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
            className="w-full text-sm rounded border border-[var(--border-primary)] bg-[var(--bg-input)] px-2.5 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#2B79F7] disabled:opacity-50"
          />
        </div>

        {error && (
          <p className="text-[11px] text-red-500">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => router.replace('/dashboard')}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!password || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[#2B79F7] text-white hover:bg-[#1f5fcc] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Unlock
          </button>
        </div>
      </form>
    </div>
  )
}
