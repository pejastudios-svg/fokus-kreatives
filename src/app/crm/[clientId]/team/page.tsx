'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { CRMLayout } from '@/components/crm/CRMLayout'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
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
} from 'lucide-react'

type Role = 'admin' | 'manager' | 'employee' | 'guest' | 'client'

interface UserMember {
  id: string
  email: string
  name: string | null
  role: Role
  profile_picture_url: string | null
  client_id: string | null
  invitation_token: string | null
  invitation_accepted: boolean
  created_at: string
}

export default function CRMTeamPage() {
  const params = useParams()
  const clientId = params.clientId as string
  const supabase = createClient()

    const [currentUserName, setCurrentUserName] = useState<string>('')
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null)
  const [clientDisplayName, setClientDisplayName] = useState<string>('Client workspace')

  useEffect(() => {
    const loadCurrentUserAndClient = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userRow } = await supabase
          .from('users')
          .select('name, profile_picture_url')
          .eq('id', user.id)
          .single()

        if (userRow) {
          setCurrentUserName(userRow.name || (user.email || ''))
          setCurrentUserAvatar(userRow.profile_picture_url || null)
        }
      }

      const { data: client } = await supabase
        .from('clients')
        .select('name, business_name')
        .eq('id', clientId)
        .single()

      if (client) {
        setClientDisplayName(client.business_name || client.name || 'Client workspace')
      }
    }

    loadCurrentUserAndClient()
  }, [supabase, clientId])

  const [isLoading, setIsLoading] = useState(true)
  const [members, setMembers] = useState<UserMember[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<Role>('employee')
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('employee')
  const [isInviting, setIsInviting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string; link?: string } | null>(null)

  const SUPER_ADMINS = [
    'jedidiahbenenoch@gmail.com',
    'fokuskreatives@gmail.com',
  ]

  useEffect(() => {
    if (clientId) {
      fetchCurrentUserRole()
    }
  }, [clientId])

  useEffect(() => {
    if (currentUserRole && clientId) {
      loadMembers()
    }
  }, [currentUserRole, clientId])

  const fetchCurrentUserRole = async () => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      setCurrentUserRole('employee')
      setIsLoading(false)
      return
    }

    setCurrentUserEmail(user.email || null)

    // Super admins: always admin
    if (user.email && SUPER_ADMINS.includes(user.email.toLowerCase())) {
      setCurrentUserRole('admin')
      return
    }

    // Look up user row for role and client_id
    const { data: userRow } = await supabase
      .from('users')
      .select('role, client_id')
      .eq('id', user.id)
      .single()

    // Clients are admins on their CRM
    if (userRow?.role === 'client') {
      setCurrentUserRole('admin')
      return
    }

    // Otherwise, use their role as-is
    setCurrentUserRole((userRow?.role as Role) || 'employee')
  }

  const loadMembers = async () => {
    setIsLoading(true)

    // Load users scoped to this client_id
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, role, profile_picture_url, client_id, invitation_token, invitation_accepted, created_at')
      .eq('client_id', clientId)
      .neq('role', 'client') // client (owner) is handled separately
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to load CRM members:', error)
      setIsLoading(false)
      return
    }

    // Also add client owner(s) and super-admins as virtual members if needed later – for now we focus on client_id matches.
    setMembers((data || []) as UserMember[])
    setIsLoading(false)
  }

  const getRoleBadgeColor = (role: Role) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-700'
      case 'manager': return 'bg-blue-100 text-blue-700'
      case 'employee': return 'bg-green-100 text-green-700'
      case 'guest': return 'bg-gray-100 text-gray-700'
      case 'client': return 'bg-purple-100 text-purple-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const canManage = currentUserRole === 'admin' || currentUserRole === 'manager'

  const handleInvite = async () => {
  if (!inviteEmail || !inviteName || !clientId) return
  setIsInviting(true)

  try {
    // 1) Check if this email is already a member of this CRM
    const { data: existing, error: existingError } = await supabase
      .from('users')
      .select('id')
      .eq('client_id', clientId)
      .eq('email', inviteEmail.toLowerCase())
      .maybeSingle()

    if (existing) {
      setNotification({
        type: 'error',
        message: 'This email is already a member of this workspace.',
      })
      setIsInviting(false)
      return
    }

    if (existingError) {
      console.error('CRM existing user check error:', existingError)
    }

    // 2) Create invite token and insert new user
    const token =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)

    const { data, error } = await supabase
      .from('users')
      .insert({
        email: inviteEmail.toLowerCase(),
        name: inviteName,
        role: inviteRole,
        client_id: clientId,
        invitation_token: token,
        invitation_accepted: false,
      })
      .select()
      .single()

    if (error || !data) {
      console.error('CRM Invite error:', JSON.stringify(error, null, 2))
      setNotification({ type: 'error', message: 'Failed to create invite' })
      setIsInviting(false)
      return
    }

    const inviteLink = `${window.location.origin}/invite/${data.invitation_token}`

    setNotification({
      type: 'success',
      message: `Invite created for ${inviteName}. Copy the link below or let the email handle it.`,
      link: inviteLink,
    })

    // Reset form & close modal
    setInviteEmail('')
    setInviteName('')
    setInviteRole('employee')
    setShowInviteModal(false)

    // 3) Reload members cleanly from Supabase (no manual push)
    await loadMembers()

    // 4) Send CRM invite email via Apps Script
    try {
      await fetch('/api/notify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'crm_invite',
          payload: {
            to: inviteEmail.toLowerCase(),
            inviteeName: inviteName,
            inviterName: currentUserName || 'Someone',
            inviterAvatarUrl: currentUserAvatar || '',
            role: inviteRole,
            workspaceName: clientDisplayName,
            acceptUrl: inviteLink,
          },
        }),
      })
    } catch (err) {
      console.error('Failed to send CRM invite email', err)
    }
  } catch (err) {
    console.error('CRM Invite exception:', err)
    setNotification({ type: 'error', message: 'Failed to create invite' })
  } finally {
    setIsInviting(false)
  }
}

  const handleRemoveMember = async (userId: string) => {
    if (!canManage) return

    const confirmed = window.confirm('Remove this member from the CRM? This revokes access.')
    if (!confirmed) return

    const prev = members
    setMembers(prev => prev.filter(m => m.id !== userId))

    const { error } = await supabase
  .from('users')
  .delete()
  .eq('id', userId)

    if (error) {
      console.error('Failed to remove CRM member:', error)
      setMembers(prev) // rollback
    }
  }

  const copyLink = async (link: string) => {
    await navigator.clipboard.writeText(link)
    setNotification({ type: 'success', message: 'Link copied to clipboard!' })
    setTimeout(() => setNotification(null), 3000)
  }

  const copyInviteLink = async (token: string | null) => {
    if (!token) return
    const link = `${window.location.origin}/invite/${token}`
    await navigator.clipboard.writeText(link)
    setNotification({ type: 'success', message: 'Invite link copied!' })
    setTimeout(() => setNotification(null), 3000)
  }

  const filteredMembers = members.filter((m) => {
    const q = searchQuery.toLowerCase()
    return (
      (m.name || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q)
    )
  })

  if (isLoading) {
    return (
      <CRMLayout>
        <div className="flex items-center justify-center h-full">
          <Loading size="lg" text="Loading team..." />
        </div>
      </CRMLayout>
    )
  }

  return (
    <CRMLayout>
      <div className="p-6 lg:p-8 min-h-full">
        {/* Notification */}
        {notification && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              notification.type === 'success' ? 'bg-green-50' : 'bg-red-50'
            }`}
          >
            <div className="flex items-start gap-3">
              {notification.type === 'success' ? (
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              )}
              <div className="flex-1">
                <p
                  className={
                    notification.type === 'success'
                      ? 'text-green-700'
                      : 'text-red-700'
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

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Workspace Team</h1>
            <p className="text-gray-400 mt-1">
              Manage members who have access to your CRM
            </p>
          </div>
          {canManage && (
            <Button onClick={() => setShowInviteModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Invite Member
            </Button>
          )}
        </div>

        {/* Search */}
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

        {/* Members List */}
        <div className="bg-[#1E293B] rounded-2xl border border-[#334155] overflow-hidden">
          {filteredMembers.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              <Users className="h-10 w-10 mx-auto mb-3 text-gray-500" />
              <p>No team members found for this CRM.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#334155] bg-[#0F172A]">
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                    Member
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                    Role
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                    Status
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                    Joined
                  </th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                    Actions
                  </th>
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
                            <img
                              src={member.profile_picture_url}
                              alt={member.name || member.email}
                              className="h-9 w-9 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-full bg-brand-gradient flex items-center justify-center text-white text-sm font-medium">
                              {avatarLetter}
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium text-white">
                              {member.name || member.email}
                            </p>
                            <p className="text-xs text-gray-400">
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getRoleBadgeColor(
                            member.role
                          )}`}
                        >
                          <Shield className="h-3 w-3 mr-1" />
                          {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
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
                              <button
                                onClick={() => copyInviteLink(member.invitation_token)}
                                className="text-[#2B79F7] hover:underline"
                              >
                                Copy link
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-400">
                        {new Date(member.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {canManage && (
                          <button
                            onClick={() => handleRemoveMember(member.id)}
                            className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
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

        {/* Invite Modal */}
        {showInviteModal && canManage && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
                <h3 className="text-lg font-semibold text-white">
                  Invite Workspace Member
                </h3>
                <button
                  onClick={() => setShowInviteModal(false)}
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155] transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="John Smith"
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="person@example.com"
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) =>
                      setInviteRole(e.target.value as Role)
                    }
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  >
                    <option value="employee">
                      Employee – Limited access
                    </option>
                    <option value="manager">
                      Manager – Can manage leads & content
                    </option>
                    <option value="admin">
                      Admin – Full access for this workspace
                    </option>
                    <option value="guest">
                      Guest – Mostly read-only
                    </option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#334155]">
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
                  Create Invite
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CRMLayout>
  )
}