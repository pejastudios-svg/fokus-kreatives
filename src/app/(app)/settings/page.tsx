'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ProfilePictureUpload } from '@/components/ui/ProfilePictureUpload'
import { User, Lock, CheckCircle, AlertCircle, Eye, EyeOff, Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/Loading'
import { BrowserNotificationsToggle } from '@/components/notifications/BrowserNotificationsToggle'
import { LegalFooter } from '@/components/legal/LegalFooter'

export default function SettingsPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [profilePicture, setProfilePicture] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true) // Add this
  const supabase = useMemo(() => createClient(), [])



  const loadUserData = useCallback(async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setEmail(user.email || '')

  const { data: userData, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('Failed to load user data:', error)
    return
  }

  if (userData) {
    setName(userData.name || '')
    setProfilePicture(userData.profile_picture_url || '')
  }
} finally {
    setIsLoading(false)
  }
}, [supabase])


useEffect(() => {
  void loadUserData()
}, [loadUserData])

  const handleSaveProfile = async () => {
    setIsSaving(true)
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setNotification({ type: 'error', message: 'Not authenticated' })
      setIsSaving(false)
      return
    }

    const { error } = await supabase
  .from('users')
  .update({ 
    name, 
    profile_picture_url: profilePicture || null 
  })
  .eq('id', user.id)

    if (error) {
      setNotification({ type: 'error', message: 'Failed to save profile' })
    } else {
      setNotification({ type: 'success', message: 'Profile updated successfully!' })
    }

    setIsSaving(false)
    setTimeout(() => setNotification(null), 3000)
  }

  const handleChangePassword = async () => {
    if (!currentPassword) {
      setNotification({ type: 'error', message: 'Enter your current password' })
      return
    }

    if (newPassword !== confirmPassword) {
      setNotification({ type: 'error', message: 'Passwords do not match' })
      return
    }

    if (newPassword.length < 8) {
      setNotification({ type: 'error', message: 'Password must be at least 8 characters' })
      return
    }

    if (newPassword === currentPassword) {
      setNotification({ type: 'error', message: 'New password must be different from current password' })
      return
    }

    setIsChangingPassword(true)

    if (!email) {
      setNotification({ type: 'error', message: 'No email on session' })
      setIsChangingPassword(false)
      return
    }

    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    })
    if (verifyErr) {
      setNotification({ type: 'error', message: 'Current password is incorrect' })
      setIsChangingPassword(false)
      return
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) {
      setNotification({ type: 'error', message: error.message })
    } else {
      setNotification({ type: 'success', message: 'Password changed successfully!' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }

    setIsChangingPassword(false)
    setTimeout(() => setNotification(null), 3000)
  }

function SettingsSkeleton() {
  return (
    <div className="animate-in fade-in">
      <Card className="mb-6">
        <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
        <CardContent className="space-y-6">
          {/* Profile picture (centered, large) */}
          <div className="flex justify-center">
            <Skeleton className="h-36 w-36 rounded-full" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-10 w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-10 w-full" /></div>
          </div>
          <div className="flex justify-end"><Skeleton className="h-10 w-32" /></div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="flex justify-end"><Skeleton className="h-10 w-40" /></div>
        </CardContent>
      </Card>
    </div>
  )
}

  return (
    <>
      <Header 
        title="Settings" 
        subtitle="Manage your account and preferences"
      />
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        {notification && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] ${
            notification.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {notification.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            {notification.message}
          </div>
        )}

        {isLoading ? (
          <SettingsSkeleton />
        ) : (
          <>
            {/* Profile Settings */}
            <Card className="mb-6">
              <CardHeader className="flex flex-row items-center gap-2">
                <User className="h-5 w-5 text-[#2B79F7]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Profile</h3>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex justify-center">
                  <ProfilePictureUpload
                    value={profilePicture}
                    onChange={(url) => setProfilePicture(url)}
                    folder="profile-pictures"
                    fallback={name ? 'initial' : 'user'}
                    initialChar={name.charAt(0) || 'U'}
                    ariaLabel="Your profile picture"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Full Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Input
                    label="Email"
                    type="email"
                    value={email}
                    disabled
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleSaveProfile} isLoading={isSaving}>
                    Save Profile
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Password */}
            <Card className="mb-6">
              <CardHeader className="flex flex-row items-center gap-2">
                <Lock className="h-5 w-5 text-[#2B79F7]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Change Password</h3>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Input
                    label="Current Password"
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-9 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <Input
                      label="New Password"
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-9 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    >
                      {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      label="Confirm New Password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-9 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleChangePassword}
                    isLoading={isChangingPassword}
                    disabled={!currentPassword || !newPassword || !confirmPassword}
                  >
                    Change Password
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Browser/desktop push notifications (per-device).
                Workspace-side so the agency owner can enable pushes
                for approvals + tasks + intake without needing to
                drill into a specific CRM. */}
            <Card className="mb-6">
              <CardHeader className="flex flex-row items-center gap-2">
                <Bell className="h-5 w-5 text-[#2B79F7]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Desktop &amp; mobile push</h3>
              </CardHeader>
              <CardContent>
                <BrowserNotificationsToggle />
              </CardContent>
            </Card>

            <LegalFooter className="text-[var(--text-tertiary)] pb-2" />
          </>
        )}
      </div>
    </>
  )
}