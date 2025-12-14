'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { CRMLayout } from '@/components/crm/CRMLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FileUpload } from '@/components/ui/FileUpload'
import { createClient } from '@/lib/supabase/client'
import {
  User,
  Lock,
  Bell,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react'

type NotificationSettings = {
  meetings?: boolean
  capture_submissions?: boolean
  leads?: boolean
}

export default function CRMSettingsPage() {
  const params = useParams()
  const clientId = params.clientId as string
  const supabase = createClient()

  // Workspace notification toggles
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [notifications, setNotifications] = useState<NotificationSettings>({
    meetings: true,
    capture_submissions: true,
    leads: true,
  })
  const [savingWorkspace, setSavingWorkspace] = useState(false)

  // User profile
  const [profileLoading, setProfileLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profileEmail, setProfileEmail] = useState('')
  const [profilePicture, setProfilePicture] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  // Notifications
  const [alert, setAlert] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  useEffect(() => {
    if (clientId) {
      loadWorkspaceSettings()
    }
    loadUserProfile()
  }, [clientId])

  const showAlert = (type: 'success' | 'error', message: string) => {
    setAlert({ type, message })
    setTimeout(() => setAlert(null), 3000)
  }

  // Load workspace settings (per client)
  const loadWorkspaceSettings = async () => {
    setWorkspaceLoading(true)
    const { data, error } = await supabase
      .from('clients')
      .select('notification_settings')
      .eq('id', clientId)
      .single()

    if (error) {
      console.error('Load workspace settings error:', error)
    } else {
      const ns = (data?.notification_settings || {}) as NotificationSettings
      setNotifications({
        meetings: ns.meetings ?? true,
        capture_submissions: ns.capture_submissions ?? true,
        leads: ns.leads ?? true,
      })
    }

    setWorkspaceLoading(false)
  }

  // Load user profile (current user)
  const loadUserProfile = async () => {
    setProfileLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setProfileLoading(false)
      return
    }

    setUserId(user.id)
    setProfileEmail(user.email || '')

    const { data, error } = await supabase
      .from('users')
      .select('name, profile_picture_url')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Load user profile error:', error)
    } else if (data) {
      setProfileName(data.name || '')
      setProfilePicture(data.profile_picture_url || '')
    }

    setProfileLoading(false)
  }

  const saveWorkspaceSettings = async () => {
    setSavingWorkspace(true)
    const payload: NotificationSettings = {
      meetings: notifications.meetings ?? true,
      capture_submissions: notifications.capture_submissions ?? true,
      leads: notifications.leads ?? true,
    }

    const { error } = await supabase
      .from('clients')
      .update({ notification_settings: payload })
      .eq('id', clientId)

    if (error) {
      console.error('Save workspace settings error:', error)
      showAlert('error', 'Failed to save workspace settings')
    } else {
      showAlert('success', 'Workspace settings saved')
    }

    setSavingWorkspace(false)
  }

  const saveProfile = async () => {
    if (!userId) return
    setSavingProfile(true)

    const { error } = await supabase
      .from('users')
      .update({
        name: profileName,
        profile_picture_url: profilePicture || null,
      })
      .eq('id', userId)

    if (error) {
      console.error('Save profile error:', error)
      showAlert('error', 'Failed to save profile')
    } else {
      showAlert('success', 'Profile updated')
    }

    setSavingProfile(false)
  }

  const changePassword = async () => {
    if (!newPassword || !confirmPassword) {
      showAlert('error', 'Please fill the new password fields')
      return
    }
    if (newPassword !== confirmPassword) {
      showAlert('error', 'New passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      showAlert('error', 'Password must be at least 6 characters')
      return
    }

    setSavingPassword(true)

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (error) {
      console.error('Change password error:', error)
      showAlert('error', error.message || 'Failed to change password')
    } else {
      showAlert('success', 'Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }

    setSavingPassword(false)
  }

  return (
    <CRMLayout>
      <div className="p-6 lg:p-8 min-h-full">
        {/* Alerts */}
        {alert && (
          <div
            className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
              alert.type === 'success'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {alert.type === 'success' ? (
              <CheckCircle className="h-5 w-5" />
            ) : (
              <AlertCircle className="h-5 w-5" />
            )}
            <span className="text-sm">{alert.message}</span>
          </div>
        )}

        <h1 className="text-2xl font-bold text-white mb-6">Workspace Settings</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Workspace Notifications */}
          <Card className="bg-[#1E293B] border-[#334155]">
            <CardHeader className="flex flex-row items-center gap-2">
              <Bell className="h-5 w-5 text-[#2B79F7]" />
              <h3 className="text-lg font-semibold text-white">
                Notification Preferences
              </h3>
            </CardHeader>
            <CardContent className="space-y-4">
              {workspaceLoading ? (
                <p className="text-sm text-gray-400">Loading...</p>
              ) : (
                <>
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="font-medium text-gray-100">
                        Meeting notifications
                      </p>
                      <p className="text-xs text-gray-400">
                        Emails / alerts when meetings are scheduled
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifications.meetings ?? true}
                      onChange={e =>
                        setNotifications(prev => ({
                          ...prev,
                          meetings: e.target.checked,
                        }))
                      }
                      className="h-5 w-5 rounded border-gray-500 text-[#2B79F7] focus:ring-[#2B79F7]"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="font-medium text-gray-100">
                        Form submit notifications
                      </p>
                      <p className="text-xs text-gray-400">
                        When someone submits a capture page
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifications.capture_submissions ?? true}
                      onChange={e =>
                        setNotifications(prev => ({
                          ...prev,
                          capture_submissions: e.target.checked,
                        }))
                      }
                      className="h-5 w-5 rounded border-gray-500 text-[#2B79F7] focus:ring-[#2B79F7]"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="font-medium text-gray-100">
                        Lead notifications
                      </p>
                      <p className="text-xs text-gray-400">
                        When new leads are added or updated
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifications.leads ?? true}
                      onChange={e =>
                        setNotifications(prev => ({
                          ...prev,
                          leads: e.target.checked,
                        }))
                      }
                      className="h-5 w-5 rounded border-gray-500 text-[#2B79F7] focus:ring-[#2B79F7]"
                    />
                  </label>

                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={saveWorkspaceSettings}
                      isLoading={savingWorkspace}
                    >
                      Save Preferences
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Profile & Password */}
          <div className="space-y-6">
            {/* Profile */}
            <Card className="bg-[#1E293B] border-[#334155]">
              <CardHeader className="flex flex-row items-center gap-2">
                <User className="h-5 w-5 text-[#2B79F7]" />
                <h3 className="text-lg font-semibold text-white">
                  Your Profile
                </h3>
              </CardHeader>
              <CardContent className="space-y-4">
                {profileLoading ? (
                  <p className="text-sm text-gray-400">Loading profile...</p>
                ) : (
                  <>
                    <div className="flex items-center gap-4">
                      {profilePicture ? (
                        <img
                          src={profilePicture}
                          alt={profileName}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-brand-gradient flex items-center justify-center text-white font-semibold">
                          {(profileName || profileEmail || 'U')
                            .charAt(0)
                            .toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1">
                        <FileUpload
                          label="Upload profile picture"
                          folder="user-profile-pictures"
                          accept="image/*"
                          onUpload={url => setProfilePicture(url)}
                        />
                      </div>
                    </div>

                    <Input
                      label="Name"
                      value={profileName}
                      onChange={e => setProfileName(e.target.value)}
                    />
                    <Input
                      label="Email"
                      value={profileEmail}
                      disabled
                    />

                    <div className="flex justify-end">
                      <Button
                        onClick={saveProfile}
                        isLoading={savingProfile}
                      >
                        Save Profile
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Password */}
            <Card className="bg-[#1E293B] border-[#334155]">
              <CardHeader className="flex flex-row items-center gap-2">
                <Lock className="h-5 w-5 text-[#2B79F7]" />
                <h3 className="text-lg font-semibold text-white">
                  Change Password
                </h3>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Input
                    label="New Password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(prev => !prev)}
                    className="absolute right-3 top-9 text-gray-400"
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <div className="relative">
                  <Input
                    label="Confirm New Password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(prev => !prev)}
                    className="absolute right-3 top-9 text-gray-400"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={changePassword}
                    isLoading={savingPassword}
                  >
                    Update Password
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </CRMLayout>
  )
}