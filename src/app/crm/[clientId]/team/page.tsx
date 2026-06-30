'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loading'
import { createClient } from '@/lib/supabase/client'
import {
  Plus,
  Users,
  Trash2,
  Shield,
  Search,
  X,
  CheckCircle,
  AlertCircle,
  Copy,
  Mail,
  Clock,
  RotateCw,
  FileDown,
} from 'lucide-react'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { useCrmRole } from '@/components/crm/CrmRoleContext'
import type {
  TeamReportMember,
  TeamReportInvite,
} from '@/components/reports/TeamReport'

// CRM team management page. Reads/writes go through three server routes
// that own the auth + RLS gymnastics:
//   /api/crm/members            -> active member list
//   /api/crm/team/invites*      -> pending invites (create / list / patch / delete / resend)
//   /api/crm/team/members/[id]  -> active member role change + password-gated remove
//
// Two sections render: Active Members + Pending Invites. Both update
// optimistically and reload on every state-changing action.

type CRMRole = 'admin' | 'manager' | 'employee'
type AppRole = 'admin' | 'manager' | 'employee' | 'client'

interface MemberRow {
  id: string
  email: string
  name: string | null
  profile_picture_url: string | null
  invitation_accepted: boolean
  created_at: string
  crm_role: CRMRole
}

interface InviteRow {
  id: string
  email: string
  name: string | null
  role: CRMRole
  token: string
  expires_at: string
  created_at: string
}

export default function CRMTeamPage() {
  const params = useParams()
  const routeParams = params as Record<string, string>
  const clientId = routeParams.clientid || routeParams.clientId
  const supabase = createClient()

  const [isLoading, setIsLoading] = useState(true)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])

  const [currentAppRole, setCurrentAppRole] = useState<AppRole>('employee')
  const [currentCrmRole, setCurrentCrmRole] = useState<CRMRole>('manager')
  const [currentUserName, setCurrentUserName] = useState('')
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null)
  const [clientDisplayName, setClientDisplayName] = useState('Client workspace')

  const [searchQuery, setSearchQuery] = useState('')
  const [notification, setNotification] = useState<
    | { type: 'success' | 'error'; message: string; link?: string }
    | null
  >(null)

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<CRMRole>('manager')
  const [isInviting, setIsInviting] = useState(false)

  // Per-row pending action ids
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)

  // Member removal modal (password-gated)
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null)
  const [removePassword, setRemovePassword] = useState('')
  const [removing, setRemoving] = useState(false)

  // Cancel-pending-invite modal
  const [cancelTarget, setCancelTarget] = useState<InviteRow | null>(null)

  const canManage = currentCrmRole === 'admin'

  // ---- Data loaders -----------------------------------------------------

  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/crm/members?clientId=${encodeURIComponent(clientId)}`,
        { cache: 'no-store' },
      )
      const json = (await res.json()) as {
        success: boolean
        error?: string
        members?: Array<{
          id: string
          email: string
          name: string | null
          profile_picture_url: string | null
          invitation_accepted: boolean
          created_at: string
          role: string
        }>
      }
      if (!res.ok || !json.success) {
        console.error('CRM loadMembers error:', json.error)
        setMembers([])
        return
      }
      setMembers(
        (json.members || []).map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          profile_picture_url: u.profile_picture_url,
          invitation_accepted: u.invitation_accepted,
          created_at: u.created_at,
          crm_role: (u.role as CRMRole) || 'manager',
        })),
      )
    } catch (err) {
      console.error('CRM loadMembers exception:', err)
      setMembers([])
    }
  }, [clientId])

  const loadInvites = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/crm/team/invites?clientId=${encodeURIComponent(clientId)}`,
        { cache: 'no-store' },
      )
      const json = (await res.json()) as {
        success: boolean
        error?: string
        invites?: InviteRow[]
      }
      if (!res.ok || !json.success) {
        console.error('CRM loadInvites error:', json.error)
        setInvites([])
        return
      }
      setInvites(json.invites || [])
    } catch (err) {
      console.error('CRM loadInvites exception:', err)
      setInvites([])
    }
  }, [clientId])

  // ---- Bootstrap --------------------------------------------------------

  useEffect(() => {
    if (!clientId) return
    const load = async () => {
      setIsLoading(true)
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return

        const { data: userRow } = await supabase
          .from('users')
          .select('name, profile_picture_url, role, is_agency_user, client_id')
          .eq('id', user.id)
          .single()

        const appRole = (userRow?.role as AppRole) || 'employee'
        setCurrentAppRole(appRole)
        setCurrentUserName(userRow?.name || user.email || '')
        setCurrentUserAvatar(
          userRow?.profile_picture_url || user.user_metadata?.avatar_url || null,
        )

        const { data: client } = await supabase
          .from('clients')
          .select('name, business_name')
          .eq('id', clientId)
          .single()
        if (client) {
          setClientDisplayName(
            client.business_name || client.name || 'Client workspace',
          )
        }

        // Resolve our CRM role for this client.
        if (appRole === 'client') {
          setCurrentCrmRole('admin')
        } else if (appRole === 'admin' && userRow?.is_agency_user) {
          setCurrentCrmRole('admin')
        } else {
          const { data: mem } = await supabase
            .from('client_memberships')
            .select('role')
            .eq('client_id', clientId)
            .eq('user_id', user.id)
            .maybeSingle()
          if (mem?.role === 'admin' || mem?.role === 'manager') {
            setCurrentCrmRole(mem.role)
          } else {
            setCurrentCrmRole('manager')
          }
        }

        await Promise.all([loadMembers(), loadInvites()])
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [clientId, supabase, loadMembers, loadInvites])

  // ---- Realtime: pending -> active without a manual refresh ------------
  // When an invitee finishes activation, two database events fire:
  //   - crm_invites: UPDATE (accepted_at gets stamped) - invite removed
  //     from the pending list because we filter on accepted_at IS NULL.
  //   - client_memberships: INSERT (their membership row appears) -
  //     active members list refreshes to include them.
  // We subscribe to both filtered by client_id so we only react to
  // events for the workspace this page is showing. Reload via the
  // existing API routes so the displayed rows match what the server
  // would return for a fresh page load.
  useEffect(() => {
    if (!clientId) return

    const invitesChannel = supabase
      .channel(`crm-invites-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'crm_invites',
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          void loadInvites()
        },
      )
      .subscribe()

    const membersChannel = supabase
      .channel(`crm-memberships-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'client_memberships',
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          void loadMembers()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(invitesChannel)
      supabase.removeChannel(membersChannel)
    }
  }, [clientId, supabase, loadInvites, loadMembers])

  // ---- Helpers ----------------------------------------------------------

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q),
    )
  }, [members, searchQuery])

  const filteredInvites = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return invites
    return invites.filter(
      (i) =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.email || '').toLowerCase().includes(q),
    )
  }, [invites, searchQuery])

  // ---- PDF export -----------------------------------------------------

  const { workspaceName } = useCrmRole()
  const [isExporting, setIsExporting] = useState(false)

  const handleExportPdf = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const [{ pdf }, { TeamReport }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/TeamReport'),
      ])

      const reportMembers: TeamReportMember[] = filteredMembers.map((m) => ({
        name: m.name || m.email,
        email: m.email,
        role: m.crm_role,
        joinedDate: m.created_at,
      }))

      const reportInvites: TeamReportInvite[] = filteredInvites.map((inv) => ({
        name: inv.name || '',
        email: inv.email,
        role: inv.role,
        sentDate: inv.created_at,
        expiresDate: inv.expires_at,
      }))

      const counts = { admins: 0, managers: 0, employees: 0 }
      for (const m of filteredMembers) {
        if (m.crm_role === 'admin') counts.admins++
        else if (m.crm_role === 'manager') counts.managers++
        else if (m.crm_role === 'employee') counts.employees++
      }

      const filters: string[] = []
      if (searchQuery.trim()) filters.push(`Search: "${searchQuery.trim()}"`)

      const blob = await pdf(
        <TeamReport
          workspaceName={workspaceName}
          filters={filters}
          metrics={{
            totalMembers: filteredMembers.length,
            admins: counts.admins,
            managers: counts.managers,
            employees: counts.employees,
            pendingInvites: filteredInvites.length,
          }}
          members={reportMembers}
          invites={reportInvites}
          generatedAtMs={Date.now()}
        />,
      ).toBlob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      a.download = `${workspaceName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-team-${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      console.error('Team PDF export failed:', err)
      alert('Could not generate PDF. Check the console for details.')
    } finally {
      setIsExporting(false)
    }
  }

  const copyLink = async (link: string) => {
    await navigator.clipboard.writeText(link)
    setNotification({ type: 'success', message: 'Link copied to clipboard!' })
    setTimeout(() => setNotification(null), 2500)
  }

  const sendInviteEmail = async (
    to: string,
    inviteeName: string,
    role: CRMRole,
    acceptUrl: string,
  ) => {
    return fetch('/api/notify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'crm_invite',
        payload: {
          to,
          inviteeName,
          inviterName: currentUserName || 'Someone',
          inviterAvatarUrl: currentUserAvatar || '',
          role,
          workspaceName: clientDisplayName,
          acceptUrl,
        },
      }),
    })
  }

  // ---- Actions ----------------------------------------------------------

  const handleInvite = async () => {
    if (!canManage || !inviteEmail || !inviteName || !clientId) return
    setIsInviting(true)
    try {
      const res = await fetch('/api/crm/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          email: inviteEmail.trim().toLowerCase(),
          name: inviteName.trim(),
          role: inviteRole,
        }),
      })
      const json = (await res.json()) as {
        success: boolean
        error?: string
        invite?: { id: string; token: string; expiresAt: string }
      }
      if (!res.ok || !json.success || !json.invite) {
        setNotification({
          type: 'error',
          message: json.error || 'Failed to create invite',
        })
        return
      }

      const acceptUrl = `${window.location.origin}/invite/${json.invite.token}`
      const emailRes = await sendInviteEmail(
        inviteEmail.trim().toLowerCase(),
        inviteName.trim(),
        inviteRole,
        acceptUrl,
      )

      if (!emailRes.ok) {
        setNotification({
          type: 'success',
          message: 'Invite created. Email failed to send - share the link manually.',
          link: acceptUrl,
        })
      } else {
        setNotification({
          type: 'success',
          message: `Invite emailed to ${inviteEmail}.`,
          link: acceptUrl,
        })
      }

      setShowInviteModal(false)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('manager')
      await loadInvites()
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to send invite',
      })
    } finally {
      setIsInviting(false)
    }
  }

  const handleResendInvite = async (invite: InviteRow) => {
    setResendingId(invite.id)
    try {
      const res = await fetch(
        `/api/crm/team/invites/${invite.id}/resend`,
        { method: 'POST' },
      )
      const json = (await res.json()) as {
        success: boolean
        error?: string
        invite?: {
          token: string
          expiresAt: string
          email: string
          name: string | null
          role: CRMRole
        }
      }
      if (!res.ok || !json.success || !json.invite) {
        setNotification({
          type: 'error',
          message: json.error || 'Resend failed',
        })
        return
      }
      const acceptUrl = `${window.location.origin}/invite/${json.invite.token}`
      const emailRes = await sendInviteEmail(
        json.invite.email,
        json.invite.name || json.invite.email,
        json.invite.role,
        acceptUrl,
      )
      if (!emailRes.ok) {
        setNotification({
          type: 'error',
          message: 'New token generated, but email failed. Share the link manually.',
          link: acceptUrl,
        })
      } else {
        setNotification({
          type: 'success',
          message: `Invite resent to ${json.invite.email}.`,
          link: acceptUrl,
        })
      }
      await loadInvites()
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Resend failed',
      })
    } finally {
      setResendingId(null)
    }
  }

  const handleChangeInviteRole = async (invite: InviteRow, role: CRMRole) => {
    if (role === invite.role) return
    setUpdatingRoleId(invite.id)
    // Optimistic update
    setInvites((prev) =>
      prev.map((i) => (i.id === invite.id ? { ...i, role } : i)),
    )
    try {
      const res = await fetch(`/api/crm/team/invites/${invite.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (!res.ok || !json.success) {
        setNotification({
          type: 'error',
          message: json.error || 'Could not change role',
        })
        await loadInvites()
      }
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not change role',
      })
      await loadInvites()
    } finally {
      setUpdatingRoleId(null)
    }
  }

  const handleChangeMemberRole = async (member: MemberRow, role: CRMRole) => {
    if (role === member.crm_role) return
    setUpdatingRoleId(member.id)
    setMembers((prev) =>
      prev.map((m) => (m.id === member.id ? { ...m, crm_role: role } : m)),
    )
    try {
      const res = await fetch(`/api/crm/team/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, role }),
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (!res.ok || !json.success) {
        setNotification({
          type: 'error',
          message: json.error || 'Could not change role',
        })
        await loadMembers()
      }
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not change role',
      })
      await loadMembers()
    } finally {
      setUpdatingRoleId(null)
    }
  }

  const handleCancelInvite = async (invite: InviteRow) => {
    try {
      const res = await fetch(`/api/crm/team/invites/${invite.id}`, {
        method: 'DELETE',
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (!res.ok || !json.success) {
        setNotification({
          type: 'error',
          message: json.error || 'Could not cancel invite',
        })
        return
      }
      setNotification({ type: 'success', message: `Invite to ${invite.email} cancelled.` })
      await loadInvites()
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not cancel invite',
      })
    }
  }

  const handleRemoveMember = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      const res = await fetch(`/api/crm/team/members/${removeTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, password: removePassword }),
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (!res.ok || !json.success) {
        setNotification({
          type: 'error',
          message: json.error || 'Could not remove member',
        })
        return
      }
      setNotification({
        type: 'success',
        message: `${removeTarget.email} removed from this CRM.`,
      })
      setRemoveTarget(null)
      setRemovePassword('')
      await loadMembers()
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not remove member',
      })
    } finally {
      setRemoving(false)
    }
  }

  // ---- Render -----------------------------------------------------------

  if (isLoading) return <TeamSkeleton />

  return (
    <div className="p-3 sm:p-4 lg:p-6 min-h-full">
      {notification && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            notification.type === 'success'
              ? 'bg-green-50 dark:bg-green-500/10'
              : 'bg-red-50 dark:bg-red-500/10'
          }`}
        >
          <div className="flex items-start gap-3">
            {notification.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p
                className={
                  notification.type === 'success'
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-red-700 dark:text-red-400'
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
                    className="flex-1 px-3 py-1.5 bg-[var(--bg-card)] border border-[var(--border-primary)] rounded text-sm text-[var(--text-secondary)] truncate"
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

      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[var(--text-tertiary)] truncate">
            Members who can access this CRM
          </p>
          <p className="text-[var(--text-tertiary)] text-[11px] mt-0.5 truncate">
            CRM:{' '}
            <span className="font-semibold text-[var(--text-secondary)]">
              {currentCrmRole}
            </span>
            {' · '}Agency:{' '}
            <span className="font-semibold text-[var(--text-secondary)]">
              {currentAppRole}
            </span>
          </p>
        </div>
        <KebabMenu
          items={[
            ...(canManage
              ? [
                  {
                    label: 'Invite Member',
                    icon: <Plus className="h-4 w-4" />,
                    onClick: () => setShowInviteModal(true),
                  },
                ]
              : []),
            {
              label: isExporting ? 'Generating PDF…' : 'Export as PDF',
              icon: <FileDown className="h-4 w-4" />,
              disabled: isExporting,
              onClick: handleExportPdf,
            },
          ]}
        />
      </div>

      <div className="mb-4">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder="Search team..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
        </div>
      </div>

      {/* ---------------- ACTIVE MEMBERS ------------------------------ */}
      <SectionHeader
        title="Active members"
        count={filteredMembers.length}
        icon={<Users className="h-4 w-4 text-[#2B79F7]" />}
      />
      <div className="glass-card rounded-2xl overflow-hidden mb-6">
        {filteredMembers.length === 0 ? (
          <div className="p-10 text-center text-[var(--text-tertiary)]">
            <Users className="h-10 w-10 mx-auto mb-3 text-[var(--text-tertiary)]" />
            <p className="text-sm">No active members yet.</p>
            {canManage && (
              <div className="mt-4 flex justify-center">
                <Button onClick={() => setShowInviteModal(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Invite Member
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                  <Th>Member</Th>
                  <Th>CRM Role</Th>
                  <Th>Joined</Th>
                  {canManage && <Th align="right">Actions</Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-primary)]">
                {filteredMembers.map((member) => (
                  <tr key={member.id} className="hover:bg-[var(--bg-card-hover)]/40">
                    <td className="px-4 sm:px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar member={member} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {member.name || member.email}
                          </p>
                          <p className="text-xs text-[var(--text-tertiary)] truncate">
                            {member.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3">
                      {canManage ? (
                        <RoleSelect
                          value={member.crm_role}
                          disabled={updatingRoleId === member.id}
                          onChange={(role) =>
                            handleChangeMemberRole(member, role)
                          }
                        />
                      ) : (
                        <RoleBadge role={member.crm_role} />
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-3 text-xs text-[var(--text-tertiary)] tabular-nums">
                      {new Date(member.created_at).toLocaleDateString()}
                    </td>
                    {canManage && (
                      <td className="px-4 sm:px-6 py-3 text-right">
                        <button
                          onClick={() => setRemoveTarget(member)}
                          className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Remove from this CRM"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------------- PENDING INVITES ----------------------------- */}
      <SectionHeader
        title="Pending invites"
        count={filteredInvites.length}
        icon={<Mail className="h-4 w-4 text-[#2B79F7]" />}
      />
      <div className="glass-card rounded-2xl overflow-hidden">
        {filteredInvites.length === 0 ? (
          <div className="p-10 text-center text-[var(--text-tertiary)]">
            <Mail className="h-10 w-10 mx-auto mb-3 text-[var(--text-tertiary)]" />
            <p className="text-sm">No pending invites.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                  <Th>Invitee</Th>
                  <Th>CRM Role</Th>
                  <Th>Expires</Th>
                  {canManage && <Th align="right">Actions</Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-primary)]">
                {filteredInvites.map((invite) => {
                  const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/invite/${invite.token}`
                  const expiresAt = new Date(invite.expires_at)
                  const isExpired = expiresAt < new Date()
                  const daysLeft = Math.max(
                    0,
                    Math.ceil(
                      (expiresAt.getTime() - Date.now()) /
                        (24 * 60 * 60 * 1000),
                    ),
                  )
                  return (
                    <tr key={invite.id} className="hover:bg-[var(--bg-card-hover)]/40">
                      <td className="px-4 sm:px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm font-semibold flex items-center justify-center shrink-0">
                            {(invite.name || invite.email)
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                              {invite.name || invite.email}
                            </p>
                            <p className="text-xs text-[var(--text-tertiary)] truncate">
                              {invite.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-3">
                        {canManage ? (
                          <RoleSelect
                            value={invite.role}
                            disabled={updatingRoleId === invite.id}
                            onChange={(role) =>
                              handleChangeInviteRole(invite, role)
                            }
                          />
                        ) : (
                          <RoleBadge role={invite.role} />
                        )}
                      </td>
                      <td className="px-4 sm:px-6 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${
                            isExpired
                              ? 'text-red-400'
                              : daysLeft <= 1
                                ? 'text-amber-400'
                                : 'text-[var(--text-tertiary)]'
                          }`}
                        >
                          <Clock className="h-3 w-3" />
                          {isExpired
                            ? 'Expired'
                            : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 sm:px-6 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => copyLink(inviteUrl)}
                              title="Copy invite link"
                              className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-[#2B79F7]/10 transition-colors"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleResendInvite(invite)}
                              disabled={resendingId === invite.id}
                              title="Resend invite"
                              className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-[#2B79F7]/10 transition-colors disabled:opacity-50"
                            >
                              <RotateCw
                                className={`h-4 w-4 ${
                                  resendingId === invite.id ? 'animate-spin' : ''
                                }`}
                              />
                            </button>
                            <button
                              onClick={() => setCancelTarget(invite)}
                              title="Cancel invite"
                              className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Invite modal ------------------------------------------- */}
      {showInviteModal && canManage && (
        <Modal
          title="Invite CRM Member"
          onClose={() => setShowInviteModal(false)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setShowInviteModal(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleInvite}
                isLoading={isInviting}
                disabled={!inviteEmail || !inviteName}
              >
                <Mail className="h-4 w-4 mr-2" />
                Send Invite
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Name">
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Jane Doe"
                className="modal-input"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="person@example.com"
                className="modal-input"
              />
            </Field>
            <Field label="CRM Role">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as CRMRole)}
                className="modal-input"
              >
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
                <option value="employee">Employee</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}

      {/* ---- Cancel pending invite ---------------------------------- */}
      {cancelTarget && (
        <Modal
          title="Cancel pending invite?"
          onClose={() => setCancelTarget(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setCancelTarget(null)}>
                Keep invite
              </Button>
              <Button
                onClick={async () => {
                  await handleCancelInvite(cancelTarget)
                  setCancelTarget(null)
                }}
                className="bg-red-600 hover:bg-red-500"
              >
                Cancel invite
              </Button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-secondary)]">
            The invite link for{' '}
            <span className="font-semibold text-[var(--text-primary)]">
              {cancelTarget.email}
            </span>{' '}
            will be invalidated. They&rsquo;ll need a fresh invite to join.
          </p>
        </Modal>
      )}

      {/* ---- Remove active member (password-gated) ------------------ */}
      {removeTarget && (
        <Modal
          title="Remove member from this CRM?"
          onClose={() => {
            setRemoveTarget(null)
            setRemovePassword('')
          }}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setRemoveTarget(null)
                  setRemovePassword('')
                }}
              >
                Keep member
              </Button>
              <Button
                onClick={handleRemoveMember}
                isLoading={removing}
                disabled={!removePassword}
                className="bg-red-600 hover:bg-red-500"
              >
                Remove
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">
                {removeTarget.email}
              </span>{' '}
              will lose access to this CRM. Their global account stays intact.
            </p>
            <Field label="Confirm with your password">
              <input
                type="password"
                value={removePassword}
                onChange={(e) => setRemovePassword(e.target.value)}
                placeholder="Your password"
                className="modal-input"
                autoFocus
              />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

// =============================================================================
// Local presentational helpers
// =============================================================================

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`px-4 sm:px-6 py-4 text-xs font-semibold text-[var(--text-tertiary)] uppercase ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function SectionHeader({
  title,
  count,
  icon,
}: {
  title: string
  count: number
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">
        {title}
      </h2>
      <span className="text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full tabular-nums">
        {count}
      </span>
    </div>
  )
}

function Avatar({ member }: { member: MemberRow }) {
  const letter = (member.name || member.email || 'U').charAt(0).toUpperCase()
  if (member.profile_picture_url) {
    return (
      <Image
        src={member.profile_picture_url}
        alt={member.name || member.email}
        width={36}
        height={36}
        className="h-9 w-9 rounded-full object-cover shrink-0"
        unoptimized
      />
    )
  }
  return (
    <div className="h-9 w-9 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm font-semibold flex items-center justify-center shrink-0">
      {letter}
    </div>
  )
}

function RoleBadge({ role }: { role: CRMRole }) {
  const cls =
    role === 'admin'
      ? 'bg-red-500/15 text-red-500'
      : role === 'employee'
        ? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
        : 'bg-blue-500/15 text-blue-500'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${cls}`}
    >
      <Shield className="h-3 w-3 mr-1" />
      {role}
    </span>
  )
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: CRMRole
  onChange: (role: CRMRole) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CRMRole)}
      disabled={disabled}
      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] disabled:opacity-50 capitalize"
    >
      <option value="admin">Admin</option>
      <option value="manager">Manager</option>
      <option value="employee">Employee</option>
    </select>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

function Modal({
  title,
  children,
  footer,
  onClose,
}: {
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="glass-pop rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-none shadow-2xl animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-primary)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

function TeamSkeleton() {
  return (
    <div className="p-3 sm:p-4 lg:p-6 min-h-full animate-in fade-in">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="space-y-1.5 min-w-0">
          <Skeleton className="h-3 w-48 bg-[var(--bg-card-hover)]" />
          <Skeleton className="h-3 w-32 bg-[var(--bg-card-hover)]" />
        </div>
        {/* Kebab only - Invite Member now lives inside it. */}
        <Skeleton className="h-8 w-8 rounded-lg bg-[var(--bg-card-hover)]" />
      </div>
      <Skeleton className="h-9 sm:h-10 w-full sm:w-80 mb-4 rounded-xl bg-[var(--bg-card-hover)]" />
      {[1, 2].map((section) => (
        <div key={section} className="mb-6">
          <Skeleton className="h-4 w-32 mb-2 bg-[var(--bg-card-hover)]" />
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="divide-y divide-[var(--border-primary)]">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-4 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Skeleton className="h-9 w-9 rounded-full bg-[var(--bg-card-hover)] shrink-0" />
                    <div className="space-y-1 min-w-0 flex-1">
                      <Skeleton className="h-4 w-24 sm:w-32 bg-[var(--bg-card-hover)]" />
                      <Skeleton className="h-3 w-32 sm:w-48 bg-[var(--bg-card-hover)]" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-16 sm:w-20 rounded-full bg-[var(--bg-card-hover)] shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
