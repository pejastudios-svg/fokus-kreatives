'use client'

import { useEffect, useMemo, useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Users, Check, X, Loader2, Search } from 'lucide-react'

type AgencyRole = 'admin' | 'manager' | 'employee'

interface AgencyMember {
  id: string
  email: string
  name: string | null
  role: AgencyRole
  profile_picture_url: string | null
}

interface Props {
  clientId: string
}

export function ClientAssignees({ clientId }: Props) {
  const supabase = useMemo(() => createClient(), [])

  const [team, setTeam] = useState<AgencyMember[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initialSelected, setInitialSelected] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!clientId) return
    const load = async () => {
      setIsLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single()
        const role = me?.role as AgencyRole | undefined
        setCanEdit(role === 'admin' || role === 'manager')

        const { data: members } = await supabase
          .from('users')
          .select('id, email, name, role, profile_picture_url')
          .eq('is_agency_user', true)
          .is('client_id', null)
          .in('role', ['admin', 'manager', 'employee'])
          .order('name', { ascending: true })

        setTeam((members || []) as AgencyMember[])

        const res = await fetch(`/api/clients/${clientId}/assignees`)
        const data = await readJsonSafe(res)
        if (data.success) {
          const ids = new Set<string>(
            (data.assignees || []).map((a: { id: string }) => a.id),
          )
          setSelected(ids)
          setInitialSelected(new Set(ids))
        }
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [clientId, supabase])

  const isDirty = useMemo(() => {
    if (selected.size !== initialSelected.size) return true
    for (const id of selected) if (!initialSelected.has(id)) return true
    return false
  }, [selected, initialSelected])

  const trimmedQuery = query.trim().toLowerCase()
  const isSearching = trimmedQuery.length > 0

  const filteredTeam = useMemo(() => {
    if (!isSearching) return team
    return team.filter((m) => {
      const name = (m.name || '').toLowerCase()
      const email = (m.email || '').toLowerCase()
      return name.includes(trimmedQuery) || email.includes(trimmedQuery)
    })
  }, [team, isSearching, trimmedQuery])

  const visibleTeam = useMemo(() => {
    if (isSearching) return filteredTeam
    const selectedFirst = [...team].sort((a, b) => {
      const aSel = selected.has(a.id) ? 0 : 1
      const bSel = selected.has(b.id) ? 0 : 1
      if (aSel !== bSel) return aSel - bSel
      return (a.name || a.email).localeCompare(b.name || b.email)
    })
    return expanded ? selectedFirst : selectedFirst.slice(0, 5)
  }, [filteredTeam, isSearching, team, selected, expanded])

  const hiddenCount = isSearching || expanded ? 0 : Math.max(0, team.length - visibleTeam.length)

  const toggle = (id: string) => {
    if (!canEdit) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    setIsSaving(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/assignees`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: Array.from(selected) }),
      })
      const data = await readJsonSafe(res)
      if (!data.success) {
        setNotice({ type: 'error', message: data.error || 'Failed to save assignees' })
        return
      }
      setInitialSelected(new Set(selected))
      setNotice({ type: 'success', message: 'Assignees updated' })
      setTimeout(() => setNotice(null), 2500)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Users className="h-5 w-5 text-[#2B79F7]" />
            Assignees
          </h3>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {canEdit
              ? 'Pick the team members responsible for this client. They’ll receive notifications for intake submissions, approvals, and form replies. If left empty, all admins and managers are notified.'
              : 'Team members responsible for this client.'}
          </p>
        </div>
        {canEdit && isDirty && (
          <Button onClick={save} isLoading={isSaving}>
            <Check className="h-4 w-4 mr-1" /> Save
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {notice && (
          <div
            className={`mb-3 p-2 rounded-md text-sm ${
              notice.type === 'success'
                ? 'bg-[#2B79F7]/10 text-[#2B79F7] dark:text-[#93C5FD]'
                : 'bg-red-500/10 text-red-500'
            }`}
          >
            {notice.message}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading team…
          </div>
        ) : team.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">No agency team members found.</p>
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)] pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search team by name or email…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>

            {isSearching && filteredTeam.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">No matches for &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {visibleTeam.map((m) => {
              const isSelected = selected.has(m.id)
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => toggle(m.id)}
                    disabled={!canEdit}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition text-left ${
                      isSelected
                        ? // Light = pale blue tint with blue border.
                          // Dark = subtle 15% blue tint - readable text
                          // instead of the near-white wash that made the
                          // selected rows unreadable on dark surfaces.
                          'border-[#2B79F7] bg-[#E8F1FF] dark:bg-[#2B79F7]/15'
                        : 'border-[var(--border-primary)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)]'
                    } ${canEdit ? '' : 'cursor-default opacity-90'}`}
                  >
                    {m.profile_picture_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={m.profile_picture_url}
                        alt={m.name || m.email}
                        className="h-9 w-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-brand-gradient text-white flex items-center justify-center text-sm font-medium shrink-0">
                        {(m.name || m.email || 'U').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {m.name || 'Unnamed'}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)] truncate">
                        {m.email} · {m.role}
                      </p>
                    </div>
                    {isSelected ? (
                      <span className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#2B79F7] text-white">
                        <Check className="h-4 w-4" />
                      </span>
                    ) : (
                      canEdit && (
                        <span className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full border border-[var(--border-secondary)] text-[var(--text-tertiary)]">
                          <X className="h-4 w-4 opacity-0" />
                        </span>
                      )
                    )}
                  </button>
                </li>
              )
            })}
              </ul>
            )}

            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="mt-3 text-xs text-[#2B79F7] hover:underline"
              >
                Show {hiddenCount} more
              </button>
            )}
            {expanded && !isSearching && team.length > 5 && (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="mt-3 text-xs text-[var(--text-tertiary)] hover:underline"
              >
                Show less
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
