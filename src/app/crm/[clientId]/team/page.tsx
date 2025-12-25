'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
import { createClient } from '@/lib/supabase/client'
import { Plus, Users, Trash2, Shield, Search, X, CheckCircle, AlertCircle, Copy, Mail } from 'lucide-react'

type CRMRole = 'admin' | 'manager'
type AppRole = 'admin' | 'manager' | 'employee' | 'client'

type MemberRow = {
  id: string
  email: string
  name: string | null
  profile_picture_url: string | null
  invitation_token: string | null
  invitation_accepted: boolean
  created_at: string
  crm_role: CRMRole
}

export default function CRMTeamPage() {
  const params = useParams()
  const clientId = ((params as any).clientid || (params as any).clientId) as string
  const supabase = createClient()

  const [isLoading, setIsLoading] = useState(true)
  const [members, setMembers] = useState<MemberRow[]>([])

  const [currentAppRole, setCurrentAppRole] = useState<AppRole>('employee')
  const [currentCrmRole, setCurrentCrmRole] = useState<CRMRole>('manager')

  const [currentUserName, setCurrentUserName] = useState<string>('')
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null)
  const [clientDisplayName, setClientDisplayName] = useState<string>('Client workspace')

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<CRMRole>('manager')
  const [isInviting, setIsInviting] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string; link?: string } | null>(null)

  const canInvite = currentCrmRole === 'admin'
  const canRemove = currentCrmRole === 'admin'

  useEffect(() => {
    if (!clientId) return

    const load = async () => {
      setIsLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // current user profile (for email template)
        const { data: userRow } = await supabase
          .from('users')
          .select('name, profile_picture_url, role, is_agency_user, client_id')
          .eq('id', user.id)
          .single()

        const appRole = (userRow?.role as AppRole) || 'employee'
        setCurrentAppRole(appRole)

        setCurrentUserName(userRow?.name || user.email || '')
        setCurrentUserAvatar(userRow?.profile_picture_url || null)

        // client display name
        const { data: client } = await supabase
          .from('clients')
          .select('name, business_name')
          .eq('id', clientId)
          .single()

        if (client) setClientDisplayName(client.business_name || client.name || 'Client workspace')

        // determine CRM role for this user
        if (appRole === 'client') {
          setCurrentCrmRole('admin')
        } else if (appRole === 'admin' && userRow?.is_agency_user) {
          // agency admins are crm admins everywhere
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
            // no membership: treat as manager visually, but they won’t see invite/remove buttons
            setCurrentCrmRole('manager')
          }
        }

        await loadMembers()
      } finally {
        setIsLoading(false)
      }
    }

    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const loadMembers = async () => {
    // Show only CRM members via membership table
    const { data, error } = await supabase
      .from('client_memberships')
      .select('role, created_at, users:users(id, email, name, profile_picture_url, invitation_token, invitation_accepted, created_at)')
      .eq('client_id', clientId)

    if (error) {
      console.error('CRM loadMembers error:', error)
      setMembers([])
      return
    }

    const rows: MemberRow[] = (data || [])
      .map((m: any) => {
        const u = Array.isArray(m.users) ? m.users[0] : m.users
        if (!u?.id) return null
        const r = m.role as string
        const crmRole: CRMRole = r === 'admin' ? 'admin' : 'manager'
        return {
          id: u.id,
          email: u.email,
          name: u.name || null,
          profile_picture_url: u.profile_picture_url || null,
          invitation_token: u.invitation_token || null,
          invitation_accepted: !!u.invitation_accepted,
          created_at: u.created_at,
          crm_role: crmRole,
        }
      })
      .filter(Boolean)

    // sort newest first
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setMembers(rows)
  }

  const getRoleBadgeColor = (role: CRMRole) => {
    return role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
  }

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q))
  }, [members, searchQuery])

  const copyLink = async (link: string) => {
    await navigator.clipboard.writeText(link)
    setNotification({ type: 'success', message: 'Link copied to clipboard!' })
    setTimeout(() => setNotification(null), 2500)
  }

  const handleInvite = async () => {
    if (!canInvite) return
    if (!inviteEmail || !inviteName || !clientId) return

    setIsInviting(true)

    const emailLower = inviteEmail.trim().toLowerCase()
    const origin = window.location.origin
    const crmLoginUrl = `${origin}/login?next=${encodeURIComponent(`/crm/${clientId}/dashboard`)}`

    try {
      // Find user globally by email
      const { data: existingUser, error: findErr } = await supabase
        .from('users')
        .select('id, email, invitation_accepted, invitation_token, is_agency_user, role')
        .eq('email', emailLower)
        .maybeSingle()

      if (findErr) console.error('CRM invite lookup error:', findErr)

      // If user exists → grant membership + send proper email
      if (existingUser?.id) {
        const { error: memErr } = await supabase
          .from('client_memberships')
          .upsert({
            client_id: clientId,
            user_id: existingUser.id,
            role: inviteRole,
          })

        if (memErr) {
          console.error('CRM membership upsert error:', memErr)
          setNotification({ type: 'error', message: memErr.message || 'Failed to grant CRM access' })
          return
        }

        let acceptUrl = crmLoginUrl

        // If they haven't activated yet, keep invite link
        if (!existingUser.invitation_accepted) {
          let tok = existingUser.invitation_token
          if (!tok) {
            tok = crypto.randomUUID()
            await supabase.from('users').update({ invitation_token: tok }).eq('id', existingUser.id)
          }
          acceptUrl = `${origin}/invite/${tok}`
        }

        // Email
        const res = await fetch('/api/notify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'crm_invite',
            payload: {
              to: emailLower,
              inviteeName: inviteName,
              inviterName: currentUserName || 'Someone',
              inviterAvatarUrl: currentUserAvatar || '',
              role: inviteRole,
              workspaceName: clientDisplayName,
              acceptUrl,
            },
          }),
        })

        if (!res.ok) console.error('crm_invite email failed:', await res.text())

        setNotification({
          type: 'success',
          message: existingUser.invitation_accepted ? 'CRM access granted. Login link emailed.' : 'User not activated yet. Invite link emailed.',
          link: acceptUrl,
        })

        setShowInviteModal(false)
        setInviteEmail('')
        setInviteName('')
        setInviteRole('manager')
        await loadMembers()
        return
      }

      // New user (CRM-only): create user without agency access
      const token = crypto.randomUUID()

      const { data: created, error: insertErr } = await supabase
        .from('users')
        .insert({
          email: emailLower,
          name: inviteName,
          role: 'employee', // app placeholder
          is_agency_user: false, // ✅ critical: NO agency access
          invitation_token: token,
          invitation_accepted: false,
          client_id: null,
        })
        .select()
        .single()

      if (insertErr || !created) {
        console.error('CRM invite insert error:', insertErr)
        setNotification({ type: 'error', message: insertErr?.message || 'Failed to create invite user' })
        return
      }

      // membership
      const { error: memErr2 } = await supabase
        .from('client_memberships')
        .insert({ client_id: clientId, user_id: created.id, role: inviteRole })

      if (memErr2) console.error('CRM membership insert error:', memErr2)

      const inviteLink = `${origin}/invite/${token}`

      const res = await fetch('/api/notify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'crm_invite',
          payload: {
            to: emailLower,
            inviteeName: inviteName,
            inviterName: currentUserName || 'Someone',
            inviterAvatarUrl: currentUserAvatar || '',
            role: inviteRole,
            workspaceName: clientDisplayName,
            acceptUrl: inviteLink,
          },
        }),
      })

      if (!res.ok) console.error('crm_invite email failed:', await res.text())

      setNotification({ type: 'success', message: 'Invite created and emailed!', link: inviteLink })
      setShowInviteModal(false)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('manager')
      await loadMembers()
    } finally {
      setIsInviting(false)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!canRemove) return

    const confirmed = window.confirm('Remove this member from THIS client CRM?')
    if (!confirmed) return

    // Optimistic remove
    const prev = members
    setMembers((p) => p.filter((m) => m.id !== userId))

    const { error } = await supabase
      .from('client_memberships')
      .delete()
      .eq('client_id', clientId)
      .eq('user_id', userId)

    if (error) {
      console.error('Remove CRM member error:', error)
      setMembers(prev)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loading size="lg" text="Loading team..." />
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 min-h-full">
      {notification && (
        <div className={`mb-6 p-4 rounded-lg ${notification.type === 'success' ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className="flex items-start gap-3">
            {notification.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            )}
            <div className="flex-1">
              <p className={notification.type === 'success' ? 'text-green-700' : 'text-red-700'}>{notification.message}</p>
              {notification.link && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={notification.link}
                    readOnly
                    className="flex-1 px-3 py-1.5 bg-white border border-green-200 rounded text-sm text-gray-700"
                  />
                  <Button size="sm" onClick={() => copyLink(notification.link!)}>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy
                  </Button>
                </div>
              )}
            </div>
            <button onClick={() => setNotification(null)}>
              <X className="h-4 w-4 text-gray-400" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">CRM Team</h1>
          <p className="text-gray-400 mt-1">Members who can access this client CRM</p>
          <p className="text-gray-500 text-xs mt-1">
            Your CRM role here: <span className="font-semibold">{currentCrmRole}</span>
            {' · '}
            Your agency role: <span className="font-semibold">{currentAppRole}</span>
          </p>
        </div>

        {canInvite && (
          <Button onClick={() => setShowInviteModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        )}
      </div>

      <div className="mb-4">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
        </div>
      </div>

      <div className="bg-[#1E293B] rounded-2xl border border-[#334155] overflow-hidden">
        {filteredMembers.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <Users className="h-10 w-10 mx-auto mb-3 text-gray-500" />
            <p>No team members yet.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#334155] bg-[#0F172A]">
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">Member</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">CRM Role</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">Status</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">Joined</th>
                <th className="text-right px-6 py-4 text-xs font-semibold text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#334155]">
              {filteredMembers.map((member) => {
                const avatarLetter = (member.name || member.email || 'U').charAt(0).toUpperCase()

                return (
                  <tr key={member.id} className="hover:bg-[#24324A]">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {member.profile_picture_url ? (
                          <img src={member.profile_picture_url} alt={member.name || member.email} className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="h-9 w-9 rounded-full bg-brand-gradient flex items-center justify-center text-white text-sm font-medium">
                            {avatarLetter}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-white">{member.name || member.email}</p>
                          <p className="text-xs text-gray-400">{member.email}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getRoleBadgeColor(member.crm_role)}`}>
                        <Shield className="h-3 w-3 mr-1" />
                        {member.crm_role.charAt(0).toUpperCase() + member.crm_role.slice(1)}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      {member.invitation_accepted ? (
                        <span className="text-green-500 text-xs inline-flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Active
                        </span>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-yellow-400">
                          <span>Pending</span>
                          {member.invitation_token && (
                            <button onClick={() => copyLink(`${window.location.origin}/invite/${member.invitation_token}`)} className="text-[#2B79F7] hover:underline">
                              Copy invite
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4 text-xs text-gray-400">{new Date(member.created_at).toLocaleDateString()}</td>

                    <td className="px-6 py-4 text-right">
                      {canRemove && (
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Remove from this CRM"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showInviteModal && canInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
              <h3 className="text-lg font-semibold text-white">Invite CRM Member</h3>
              <button onClick={() => setShowInviteModal(false)} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155] transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Name</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="John Smith"
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="person@example.com"
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">CRM Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as CRMRole)}
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#334155]">
              <Button variant="outline" onClick={() => setShowInviteModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleInvite} isLoading={isInviting} disabled={!inviteEmail || !inviteName}>
                <Mail className="h-4 w-4 mr-2" />
                Create Invite
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}