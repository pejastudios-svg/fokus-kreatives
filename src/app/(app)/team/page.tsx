'use client'

import { useEffect, useMemo, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loading' 
import { Input } from '@/components/ui/Input'
import { Plus, Mail, Shield, Trash2, X, CheckCircle, AlertCircle, Copy, Search, RefreshCw, LayoutGrid, List as ListIcon, MoreVertical } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

type AgencyRole = 'admin' | 'manager' | 'employee'

interface TeamMember {
  id: string
  email: string
  name: string | null
  role: AgencyRole
  is_agency_user: boolean
  profile_picture_url: string | null
  invitation_accepted: boolean
  invitation_token: string | null
  invitation_expires_at: string | null
  created_at: string
}

export default function TeamPage() {
  const supabase = createClient()

  const [team, setTeam] = useState<TeamMember[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [currentUserRole, setCurrentUserRole] = useState<AgencyRole>('employee')
  const [currentUserName, setCurrentUserName] = useState<string>('')
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null)

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<AgencyRole>('employee')
  const [isInviting, setIsInviting] = useState(false)

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string; link?: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null)
  const [roleChangeTarget, setRoleChangeTarget] = useState<TeamMember | null>(null)
  const [pendingNewRole, setPendingNewRole] = useState<AgencyRole>('employee')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  useEffect(() => {
    if (!openMenuId) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-row-menu]')) setOpenMenuId(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenuId])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('fk:team:view')
      if (stored === 'grid' || stored === 'list') setViewMode(stored)
    } catch {
      // ignore
    }
  }, [])

  const setView = (mode: 'grid' | 'list') => {
    setViewMode(mode)
    try {
      window.localStorage.setItem('fk:team:view', mode)
    } catch {
      // ignore
    }
  }

  const canInvite = currentUserRole === 'admin' || currentUserRole === 'manager'
  const canRemove = currentUserRole === 'admin'
  useEffect(() => {
    const init = async () => {
      setIsLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setIsLoading(false)
          return
        }

        const { data: me } = await supabase
          .from('users')
          .select('role, name, profile_picture_url')
          .eq('id', user.id)
          .single()

        const role = (me?.role as AgencyRole) || 'employee'
        setCurrentUserRole(role)
        setCurrentUserName(me?.name || user.email || '')
        // Fall back to the OAuth-provided avatar (Google) when the public users
        // row has no custom pic set - matches what the sidebar does so the
        // invite email matches what the inviter sees in-app.
        setCurrentUserAvatar(
          me?.profile_picture_url || user.user_metadata?.avatar_url || null,
        )

        await fetchTeam()
      } finally {
        setIsLoading(false)
      }
    }

    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchTeam = async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, role, is_agency_user, profile_picture_url, invitation_token, invitation_accepted, invitation_expires_at, created_at')
      .eq('is_agency_user', true)
      .is('client_id', null)
      .in('role', ['admin','manager','employee'])
      .order('created_at', { ascending: false })

    if (error) console.error('Team fetch error:', error)
    setTeam((data || []) as TeamMember[])
  }

  const getRoleBadgeColor = (role: AgencyRole) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-700'
      case 'manager': return 'bg-blue-100 text-blue-700'
      case 'employee': return 'bg-green-100 text-green-700'
      default: return 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
    }
  }

  const filteredTeam = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return team
    return team.filter((m) => (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q))
  }, [team, searchQuery])

  const copyLink = async (link: string) => {
    await navigator.clipboard.writeText(link)
    setNotification({ type: 'success', message: 'Link copied to clipboard!' })
    setTimeout(() => setNotification(null), 2500)
  }

  const handleInvite = async () => {
    if (!canInvite) return
    if (!inviteEmail || !inviteName) return

    setIsInviting(true)

    const emailLower = inviteEmail.trim().toLowerCase()
    const origin = window.location.origin

    try {
      const { data: existingUser, error: findErr } = await supabase
        .from('users')
        .select('id, invitation_accepted, invitation_token, role')
        .eq('email', emailLower)
        .maybeSingle()

      if (findErr) console.error('Agency invite lookup error:', findErr)

      // Managers cannot create admins
      const finalRole: AgencyRole = (currentUserRole === 'admin') ? inviteRole : (inviteRole === 'admin' ? 'employee' : inviteRole)

      let token = existingUser?.invitation_token || null
      // Stamp every fresh agency invite with a 7-day expiration so the
      // accept route can reject stale links. Without this, invites
      // never time out and admins can't tell which are still valid.
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString()

      if (existingUser?.id) {
        // Existing user: make them agency user
        if (!existingUser.invitation_accepted) {
          token = crypto.randomUUID()
        }

        const { error: updErr } = await supabase
          .from('users')
          .update({
            name: inviteName,
            role: finalRole,
            is_agency_user: true,
            invitation_token: token,
            invitation_expires_at: expiresAt,
          })
          .eq('id', existingUser.id)

        if (updErr) {
          console.error('Agency invite update error:', updErr)
          setNotification({ type: 'error', message: updErr.message || 'Failed to update user' })
          return
        }
      } else {
        token = crypto.randomUUID()
        const { error: insErr } = await supabase
          .from('users')
          .insert({
            email: emailLower,
            name: inviteName,
            role: finalRole,
            is_agency_user: true,
            invitation_token: token,
            invitation_accepted: false,
            invitation_expires_at: expiresAt,
            client_id: null,
          })

        if (insErr) {
          console.error('Agency invite insert error:', insErr)
          setNotification({ type: 'error', message: insErr.message || 'Failed to create invite' })
          return
        }
      }

      const inviteLink = `${origin}/invite/${token}`

      // send email
      const res = await fetch('/api/notify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'workspace_invite',
          payload: {
            to: emailLower,
            inviteeName: inviteName,
            inviterName: currentUserName || 'Someone',
            inviterAvatarUrl: currentUserAvatar || '',
            role: finalRole,
            workspaceName: 'Fokus Kreatives workspace',
            acceptUrl: inviteLink,
          },
        }),
      })

      if (!res.ok) console.error('workspace_invite email failed:', await res.text())

      setNotification({ type: 'success', message: 'Invitation created and emailed!', link: inviteLink })
      setShowInviteModal(false)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('employee')
      await fetchTeam()
    } finally {
      setIsInviting(false)
    }
  }

  const handleRemoveFromAgency = async (member: TeamMember, password?: string) => {
    if (!canRemove) return

    const res = await fetch('/api/team/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: member.id, password: password ?? '' }),
    })
    const data = await res.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to remove user')
    }

    setTeam((t) => t.filter((x) => x.id !== member.id))
  }

  const handleResendInvite = async (member: TeamMember) => {
    if (resendingId) return
    setNotification(null)
    setResendingId(member.id)
    try {
      const origin = window.location.origin
      const res = await fetch('/api/team/resend-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.id, origin }),
      })
      const data = await res.json()
      if (!data.success) {
        setNotification({ type: 'error', message: data.error || 'Failed to resend invite' })
        return
      }
      setNotification({ type: 'success', message: 'Invite refreshed and emailed', link: data.inviteLink })
      await fetchTeam()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to resend invite'
      setNotification({ type: 'error', message: msg })
    } finally {
      setResendingId(null)
    }
  }

  const handleChangeRole = async (member: TeamMember, role: AgencyRole, password: string) => {
    const res = await fetch('/api/team/change-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: member.id, role, password }),
    })
    const data = await res.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to change role')
    }
    setTeam((t) => t.map((x) => (x.id === member.id ? { ...x, role } : x)))
  }

function TeamSkeleton() {
  return (
    <div className="animate-in fade-in space-y-6">
      {/* Search + view-toggle + invite row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <Skeleton className="h-10 w-full md:w-80 rounded-lg" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-20 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>

      {/* List rows: avatar + name/email + kebab */}
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-[var(--border-primary)]">
            {[1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-3 px-4 sm:px-6 py-4">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-8 w-8 rounded-md shrink-0" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

  if (isLoading) {
    return (
      <div className="p-4 md:p-8">
        <Header title="Team" subtitle="Manage agency team members and permissions" />
        <TeamSkeleton />
      </div>
    )
  }

  return (
    <>
      <Header title="Team" subtitle="Manage agency team members and permissions" />
      <div className="p-4 md:p-8">
        {notification && (
          <div
            className={`mb-6 p-4 rounded-lg border ${
              notification.type === 'success'
                ? 'bg-[#2B79F7]/10 border-[#2B79F7]/30 dark:bg-[#1E3A6F]/40'
                : 'bg-red-500/10 border-red-500/30'
            }`}
          >
            <div className="flex items-start gap-3">
              {notification.type === 'success' ? (
                <CheckCircle className="h-5 w-5 text-[#2B79F7] mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
              )}
              <div className="flex-1">
                <p
                  className={
                    notification.type === 'success'
                      ? 'text-[#2B79F7] dark:text-[#93C5FD]'
                      : 'text-red-500'
                  }
                >
                  {notification.message}
                </p>
                {notification.link && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={notification.link}
                      readOnly
                      className="flex-1 px-3 py-1.5 bg-[var(--bg-card)] border border-[#2B79F7]/30 rounded text-sm text-[var(--text-secondary)]"
                    />
                    <Button size="sm" onClick={() => copyLink(notification.link!)}>
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </Button>
                  </div>
                )}
              </div>
              <button onClick={() => setNotification(null)}>
                <X className="h-4 w-4 text-[var(--text-tertiary)]" />
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
          <div className="relative md:w-80 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Search team members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex items-center bg-[var(--bg-card)] rounded-xl p-1 border border-[var(--border-primary)]">
              <button
                type="button"
                onClick={() => setView('grid')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-[#E8F1FF] text-[#2B79F7] shadow-sm'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
                aria-label="Grid view"
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[#E8F1FF] text-[#2B79F7] shadow-sm'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
                aria-label="List view"
                title="List view"
              >
                <ListIcon className="h-4 w-4" />
              </button>
            </div>

            {canInvite && (
              <Button onClick={() => setShowInviteModal(true)}>
                <Plus className="h-5 w-5 mr-2" />
                Invite Member
              </Button>
            )}
          </div>
        </div>

        {filteredTeam.length === 0 ? (
          <Card>
            <CardContent>
              <div className="p-8 text-center text-[var(--text-tertiary)]">No team members found</div>
            </CardContent>
          </Card>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in duration-200">
            {filteredTeam.map((member) => {
              const expiresAt = member.invitation_expires_at
                ? new Date(member.invitation_expires_at)
                : null
              const expired = expiresAt ? expiresAt.getTime() < Date.now() : false
              return (
                <Card key={member.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-5 flex flex-col">
                    <div className="flex items-start justify-between mb-3">
                      {currentUserRole === 'admin' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPendingNewRole(member.role)
                            setRoleChangeTarget(member)
                          }}
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium hover:ring-2 hover:ring-[#2B79F7] transition ${getRoleBadgeColor(member.role)}`}
                          title="Click to change role"
                        >
                          <Shield className="h-3 w-3 mr-1" />
                          {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                        </button>
                      ) : (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(member.role)}`}>
                          <Shield className="h-3 w-3 mr-1" />
                          {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                        </span>
                      )}
                      <div className="flex items-center gap-1">
                        {canInvite && !member.invitation_accepted && (
                          <button
                            onClick={() => handleResendInvite(member)}
                            disabled={resendingId === member.id}
                            className="p-1.5 hover:bg-[#E8F1FF] rounded-lg text-[var(--text-tertiary)] hover:text-[#2B79F7] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            title={resendingId === member.id ? 'Resending invite…' : 'Resend invite'}
                          >
                            <RefreshCw
                              className={`h-4 w-4 ${resendingId === member.id ? 'animate-spin' : ''}`}
                            />
                          </button>
                        )}
                        {canRemove && (
                          <button
                            onClick={() => setRemoveTarget(member)}
                            className="p-1.5 hover:bg-red-500/10 rounded-lg text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                            title="Remove from agency"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-center text-center pt-2 pb-4">
                      {member.profile_picture_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={member.profile_picture_url}
                          alt={member.name || member.email}
                          className="h-16 w-16 rounded-full object-cover mb-3"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-full bg-brand-gradient flex items-center justify-center text-white text-xl font-medium mb-3">
                          {(member.name || member.email || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <p className="font-medium text-[var(--text-primary)] truncate w-full">{member.name || 'Unnamed'}</p>
                      <p className="text-xs text-[var(--text-tertiary)] truncate w-full">{member.email}</p>
                    </div>

                    <div className="mt-auto pt-3 border-t border-[var(--border-primary)] flex items-center justify-between text-xs">
                      {member.invitation_accepted ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <CheckCircle className="h-3.5 w-3.5" />
                          Active
                        </span>
                      ) : (
                        <span className={expired ? 'text-red-600' : 'text-yellow-600'}>
                          {expired ? 'Expired' : 'Pending'}
                          {expiresAt && (
                            <span className="text-[var(--text-tertiary)] ml-1">
                              · {expiresAt.toLocaleDateString()}
                            </span>
                          )}
                        </span>
                      )}
                      <span className="text-[var(--text-tertiary)]">
                        Joined {new Date(member.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-[var(--border-primary)]">
                {filteredTeam.map((member) => {
                  const expiresAt = member.invitation_expires_at
                    ? new Date(member.invitation_expires_at)
                    : null
                  const expired = expiresAt ? expiresAt.getTime() < Date.now() : false
                  const isMenuOpen = openMenuId === member.id
                  return (
                    <li
                      key={member.id}
                      className="flex items-center gap-3 px-4 sm:px-6 py-4 hover:bg-[var(--bg-tertiary)]"
                    >
                      {member.profile_picture_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={member.profile_picture_url}
                          alt={member.name || member.email}
                          className="h-10 w-10 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-brand-gradient flex items-center justify-center text-white font-medium shrink-0">
                          {(member.name || member.email || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-[var(--text-primary)] truncate">{member.name || 'Unnamed'}</p>
                        <p className="text-sm text-[var(--text-tertiary)] truncate">{member.email}</p>
                      </div>

                      <div className="relative shrink-0" data-row-menu>
                        <button
                          type="button"
                          onClick={() => setOpenMenuId(isMenuOpen ? null : member.id)}
                          className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                          aria-label="Open member menu"
                          aria-expanded={isMenuOpen}
                        >
                          <MoreVertical className="h-5 w-5" />
                        </button>

                        {isMenuOpen && (
                          <div className="absolute right-0 mt-2 w-64 bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-xl shadow-lg z-20 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                            <div className="px-4 py-3 space-y-2 border-b border-[var(--border-primary)]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-[var(--text-tertiary)]">Role</span>
                                {currentUserRole === 'admin' ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPendingNewRole(member.role)
                                      setRoleChangeTarget(member)
                                      setOpenMenuId(null)
                                    }}
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium hover:ring-2 hover:ring-[#2B79F7] transition ${getRoleBadgeColor(member.role)}`}
                                    title="Click to change role"
                                  >
                                    <Shield className="h-3 w-3 mr-1" />
                                    {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                                  </button>
                                ) : (
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(member.role)}`}>
                                    <Shield className="h-3 w-3 mr-1" />
                                    {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-[var(--text-tertiary)]">Status</span>
                                {member.invitation_accepted ? (
                                  <span className="text-green-600 text-xs flex items-center gap-1">
                                    <CheckCircle className="h-3.5 w-3.5" />
                                    Active
                                  </span>
                                ) : (
                                  <div className="text-right">
                                    <div className={`text-xs ${expired ? 'text-red-600' : 'text-yellow-600'}`}>
                                      {expired ? 'Expired' : 'Pending'}
                                    </div>
                                    {expiresAt && (
                                      <div className="text-[10px] text-[var(--text-tertiary)]">
                                        {expired ? 'Expired ' : 'Expires '}
                                        {expiresAt.toLocaleDateString()}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-[var(--text-tertiary)]">Joined</span>
                                <span className="text-xs text-[var(--text-secondary)]">
                                  {new Date(member.created_at).toLocaleDateString()}
                                </span>
                              </div>
                            </div>

                            <div className="py-1">
                              {canInvite && !member.invitation_accepted && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleResendInvite(member)
                                    setOpenMenuId(null)
                                  }}
                                  disabled={resendingId === member.id}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[#E8F1FF] hover:text-[#2B79F7] disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  <RefreshCw
                                    className={`h-4 w-4 ${resendingId === member.id ? 'animate-spin' : ''}`}
                                  />
                                  {resendingId === member.id ? 'Resending…' : 'Resend invite'}
                                </button>
                              )}
                              {canRemove && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRemoveTarget(member)
                                    setOpenMenuId(null)
                                  }}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-500/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Remove from agency
                                </button>
                              )}
                              {!canInvite && !canRemove && (
                                <p className="px-4 py-2 text-xs text-[var(--text-tertiary)]">No actions available</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {showInviteModal && canInvite && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Invite Team Member</h3>
                <button onClick={() => setShowInviteModal(false)} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
                  <X className="h-5 w-5 text-[var(--text-tertiary)]" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-4">
                <Input label="Name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="John Smith" />
                <Input label="Email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="john@example.com" />

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as AgencyRole)}
                    className="w-full pl-4 pr-10 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    {currentUserRole === 'admin' && <option value="admin">Admin</option>}
                  </select>
                  {currentUserRole !== 'admin' && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">Only admins can invite admins.</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-primary)]">
                <Button variant="outline" onClick={() => setShowInviteModal(false)}>
                  Cancel
                </Button>
                <Button onClick={handleInvite} isLoading={isInviting} disabled={!inviteName || !inviteEmail}>
                  <Mail className="h-4 w-4 mr-2" />
                  Create Invite
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!removeTarget}
        title="Remove from agency?"
        message={
          removeTarget
            ? `${removeTarget.email} will be permanently removed and their account deleted. They will need a fresh invite to rejoin.`
            : ''
        }
        confirmLabel="Remove"
        tone="danger"
        requirePassword
        onConfirm={async (password) => {
          if (!removeTarget) return
          await handleRemoveFromAgency(removeTarget, password)
          setRemoveTarget(null)
        }}
        onClose={() => setRemoveTarget(null)}
      />

      <ConfirmModal
        open={!!roleChangeTarget}
        title="Change role?"
        message={
          roleChangeTarget ? (
            <div className="space-y-3">
              <p>
                Set role for <span className="font-medium">{roleChangeTarget.email}</span>:
              </p>
              <select
                value={pendingNewRole}
                onChange={(e) => setPendingNewRole(e.target.value as AgencyRole)}
                className="w-full pl-4 pr-10 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              >
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          ) : (
            ''
          )
        }
        confirmLabel="Update role"
        requirePassword
        onConfirm={async (password) => {
          if (!roleChangeTarget) return
          await handleChangeRole(roleChangeTarget, pendingNewRole, password ?? '')
          setRoleChangeTarget(null)
        }}
        onClose={() => setRoleChangeTarget(null)}
      />
    </>
  )
}