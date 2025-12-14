'use client'

import { useState, useEffect } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
import { Input } from '@/components/ui/Input'
import {
  Plus,
  Mail,
  Shield,
  Trash2,
  X,
  CheckCircle,
  AlertCircle,
  Copy,
  Search,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface TeamMember {
  id: string
  email: string
  name: string
  role: 'admin' | 'manager' | 'employee' | 'guest' | 'client'
  profile_picture_url: string | null
  invitation_accepted: boolean
  invitation_token: string | null
  created_at: string
}

export default function TeamPage() {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager' | 'employee' | 'guest'>('employee')
  const [isInviting, setIsInviting] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string; link?: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'manager' | 'employee' | 'guest'>('employee')

  const supabase = createClient()
    const [currentUserName, setCurrentUserName] = useState<string>('')
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null)

  useEffect(() => {
    const loadCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

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

    loadCurrentUser()
  }, [supabase])

  useEffect(() => {
    fetchCurrentUser()
  }, [])

  useEffect(() => {
    if (currentUserRole) {
      fetchTeam()
    }
  }, [currentUserRole])

  const fetchCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setCurrentUserRole('employee')
      setIsLoading(false)
      return
    }

    const { data } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = (data?.role as any) || 'employee'
    setCurrentUserRole(role)
  }

  const fetchTeam = async () => {
    const { data, error } = await supabase
  .from('users')
  .select('*')
  .neq('role', 'client')
  .is('client_id', null)
  .order('created_at', { ascending: false })

    if (error) {
      console.error('Team fetch error:', error)
    }
    if (data) {
      setTeam(data as TeamMember[])
    }
    setIsLoading(false)
  }

  const handleInvite = async () => {
    if (!inviteEmail || !inviteName) return

    setIsInviting(true)

    // Generate a random invite token
    const token =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)

    const { error: dbError } = await supabase
      .from('users')
      .insert([{
        email: inviteEmail,
        name: inviteName,
        role: inviteRole,
        invitation_token: token,
        invitation_accepted: false,
      }])

    if (dbError) {
      console.error('Invite create error:', dbError)
      setNotification({ type: 'error', message: 'Failed to create invitation' })
      setIsInviting(false)
      return
    }

            const inviteLink = `${window.location.origin}/invite/${token}`

      setNotification({
        type: 'success',
        message: 'Invitation created! You can copy the invite link below.',
        link: inviteLink,
      })

      setShowInviteModal(false)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('employee')
      fetchTeam()
      setIsInviting(false)

      // Send workspace invite email via Apps Script
      try {
        await fetch('/api/notify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'workspace_invite',
            payload: {
              to: inviteEmail,
              inviteeName: inviteName,
              inviterName: currentUserName || 'Someone',
              inviterAvatarUrl: currentUserAvatar || '',
              role: inviteRole,
              workspaceName: 'Fokus Kreatives workspace',
              acceptUrl: inviteLink,
            },
          }),
        })
      } catch (err) {
        console.error('Failed to send workspace invite email', err)
      }

    setNotification({
      type: 'success',
      message: 'Invitation created! You can copy the invite link below.',
      link: inviteLink,
    })

    setShowInviteModal(false)
    setInviteEmail('')
    setInviteName('')
    setInviteRole('employee')
    fetchTeam()
    setIsInviting(false)
  }

  const handleDelete = async (id: string) => {
    if (currentUserRole !== 'admin') return

    const confirmed = window.confirm('Remove this team member?')
    if (!confirmed) return

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete team member error:', error)
      return
    }

    setTeam(prev => prev.filter(m => m.id !== id))
  }

  const copyLink = async (link: string) => {
    await navigator.clipboard.writeText(link)
    setNotification({ type: 'success', message: 'Link copied to clipboard!' })
    setTimeout(() => setNotification(null), 3000)
  }

  const copyInviteLink = async (token: string) => {
    const link = `${window.location.origin}/invite/${token}`
    await navigator.clipboard.writeText(link)
    setNotification({ type: 'success', message: 'Invite link copied!' })
    setTimeout(() => setNotification(null), 3000)
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-700'
      case 'manager': return 'bg-blue-100 text-blue-700'
      case 'employee': return 'bg-green-100 text-green-700'
      case 'guest': return 'bg-gray-100 text-gray-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const filteredTeam = team.filter(member =>
    (member.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (member.email || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const canManage = currentUserRole === 'admin'

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <Header title="Team" subtitle="Manage team members and permissions" />
          <div className="flex items-center justify-center mt-10">
            <Loading size="lg" text="Loading team..." />
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <Header
        title="Team"
        subtitle="Manage team members and permissions"
      />
      <div className="p-8">
        {/* Notification */}
        {notification && (
          <div className={`mb-6 p-4 rounded-lg ${
            notification.type === 'success' ? 'bg-green-50' : 'bg-red-50'
          }`}>
            <div className="flex items-start gap-3">
              {notification.type === 'success' ? (
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              )}
              <div className="flex-1">
                <p className={notification.type === 'success' ? 'text-green-700' : 'text-red-700'}>
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

        {/* Actions Bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search team members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent"
            />
          </div>
          {canManage && (
            <Button onClick={() => setShowInviteModal(true)}>
              <Plus className="h-5 w-5 mr-2" />
              Invite Member
            </Button>
          )}
        </div>

        {/* Team List */}
        <Card>
          <CardContent className="p-0">
            {filteredTeam.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {searchQuery ? 'No team members match your search' : 'No team members found'}
              </div>
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
                            <img
                              src={member.profile_picture_url}
                              alt={member.name}
                              className="h-10 w-10 rounded-full object-cover"
                            />
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
                          <div className="flex items-center gap-2">
                            <span className="text-yellow-600 text-sm">Pending</span>
                            {member.invitation_token && (
                              <button
                                onClick={() => copyInviteLink(member.invitation_token!)}
                                className="text-[#2B79F7] hover:underline text-xs"
                              >
                                Copy link
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(member.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {canManage && (
                          <button
                            onClick={() => handleDelete(member.id)}
                            className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
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

        {/* Invite Modal */}
{showInviteModal && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Invite Team Member</h3>
        <button 
          onClick={() => setShowInviteModal(false)}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <X className="h-5 w-5 text-gray-400" />
        </button>
      </div>

      <div className="px-6 py-4 space-y-4">
        <Input
          label="Name"
          value={inviteName}
          onChange={(e) => setInviteName(e.target.value)}
          placeholder="John Smith"
        />
        <Input
          label="Email"
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="john@example.com"
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as any)}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent"
          >
            <option value="employee">Employee - Limited access</option>
            <option value="manager">Manager - Can manage content</option>
            <option value="admin">Admin - Full access</option>
            <option value="guest">Guest - View only</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
        <Button variant="outline" onClick={() => setShowInviteModal(false)}>
          Cancel
        </Button>
        <Button
          onClick={handleInvite}
          isLoading={isInviting}
          disabled={!inviteName || !inviteEmail}
        >
          <Mail className="h-4 w-4 mr-2" />
          Create Invite
        </Button>
      </div>
    </div>
  </div>
)}
      </div>
    </DashboardLayout>
  )
}