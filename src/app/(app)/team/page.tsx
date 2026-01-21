'use client'

import { useEffect, useMemo, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loading' 
import { Input } from '@/components/ui/Input'
import { Plus, Mail, Shield, Trash2, X, CheckCircle, AlertCircle, Copy, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
        setCurrentUserAvatar(me?.profile_picture_url || null)

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
      .select('id, email, name, role, is_agency_user, profile_picture_url, invitation_token, invitation_accepted, created_at')
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
      default: return 'bg-gray-100 text-gray-700'
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

    const handleRemoveFromAgency = async (member: TeamMember) => {
    if (!canRemove) return

    const confirmed = window.confirm(`Remove ${member.email} from the agency team? (They may still have CRM access.)`)
    if (!confirmed) return

    const prev = team
    setTeam((t) => t.filter((x) => x.id !== member.id))

    const { error } = await supabase
      .from('users')
      .update({ is_agency_user: false })
      .eq('id', member.id)

    if (error) {
      console.error('Remove from agency error:', error)
      setTeam(prev)
    }
  }

function TeamSkeleton() {
  return (
    <div className="animate-in fade-in space-y-6">
      <div className="flex justify-between">
        <Skeleton className="h-10 w-80 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="border-b px-6 py-4 bg-gray-50 flex gap-4">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/4" />
          </div>
          <div className="divide-y">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-8 rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

  if (isLoading) {
    return (
      <div className="p-8">
        <Header title="Team" subtitle="Manage agency team members and permissions" />
        <TeamSkeleton />
      </div>
    )
  }

  return (
    <>
      <Header title="Team" subtitle="Manage agency team members and permissions" />
      <div className="p-8">
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
                    <input type="text" value={notification.link} readOnly className="flex-1 px-3 py-1.5 bg-white border border-green-200 rounded text-sm text-gray-700" />
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
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search team members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            />
          </div>

          {canInvite && (
            <Button onClick={() => setShowInviteModal(true)}>
              <Plus className="h-5 w-5 mr-2" />
              Invite Member
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {filteredTeam.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No team members found</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Member</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Role</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Status</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Joined</th>
                    <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredTeam.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {member.profile_picture_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={member.profile_picture_url} alt={member.name || member.email} className="h-10 w-10 rounded-full object-cover" />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-brand-gradient flex items-center justify-center text-white font-medium">
                              {(member.name || member.email || 'U').charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-gray-900">{member.name || 'Unnamed'}</p>
                            <p className="text-sm text-gray-500">{member.email}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(member.role)}`}>
                          <Shield className="h-3 w-3 mr-1" />
                          {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        {member.invitation_accepted ? (
                          <span className="text-green-600 text-sm flex items-center gap-1">
                            <CheckCircle className="h-4 w-4" />
                            Active
                          </span>
                        ) : (
                          <span className="text-yellow-600 text-sm">Pending</span>
                        )}
                      </td>

                      <td className="px-6 py-4 text-sm text-gray-500">{new Date(member.created_at).toLocaleDateString()}</td>

                      <td className="px-6 py-4 text-right">
                        {canRemove && (
                          <button
                            onClick={() => handleRemoveFromAgency(member)}
                            className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                            title="Remove from agency"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {showInviteModal && canInvite && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Invite Team Member</h3>
                <button onClick={() => setShowInviteModal(false)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="h-5 w-5 text-gray-400" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-4">
                <Input label="Name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="John Smith" />
                <Input label="Email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="john@example.com" />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as AgencyRole)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    {currentUserRole === 'admin' && <option value="admin">Admin</option>}
                  </select>
                  {currentUserRole !== 'admin' && (
                    <p className="text-xs text-gray-400 mt-1">Only admins can invite admins.</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
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
    </>
  )
}