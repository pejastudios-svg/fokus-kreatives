'use client'

import { useState, useEffect } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FileUpload } from '@/components/ui/FileUpload'
import { User, Lock, Bell, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
  const supabase = createClient()

  useEffect(() => {
    loadUserData()
  }, [])

  const loadUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      setEmail(user.email || '')
      
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single()
      
      if (userData) {
        setName(userData.name || '')
        setProfilePicture(userData.profile_picture_url || '')
      }
    }
  }

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
    if (newPassword !== confirmPassword) {
      setNotification({ type: 'error', message: 'Passwords do not match' })
      return
    }

    if (newPassword.length < 6) {
      setNotification({ type: 'error', message: 'Password must be at least 6 characters' })
      return
    }

    setIsChangingPassword(true)

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    })

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

  return (
    <DashboardLayout>
      <Header 
        title="Settings" 
        subtitle="Manage your account and preferences"
      />
      <div className="p-8 max-w-4xl">
        {notification && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            notification.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {notification.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            {notification.message}
          </div>
        )}

        {/* Profile Settings */}
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center gap-2">
            <User className="h-5 w-5 text-[#2B79F7]" />
            <h3 className="text-lg font-semibold text-gray-900">Profile</h3>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-6">
              {profilePicture ? (
                <img 
                  src={profilePicture} 
                  alt="Profile"
                  className="h-20 w-20 rounded-full object-cover"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-brand-gradient flex items-center justify-center text-white text-2xl font-bold">
                  {name.charAt(0)?.toUpperCase() || 'U'}
                </div>
              )}
              <div className="flex-1 space-y-2">
  <FileUpload
    label="Upload Profile Picture"
    folder="profile-pictures"
    accept="image/*"
    onUpload={(url) => setProfilePicture(url)}
  />
  <Input
    label="Or use URL"
    value={profilePicture}
    onChange={(e) => setProfilePicture(e.target.value)}
    placeholder="https://example.com/photo.jpg"
  />
</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
            <h3 className="text-lg font-semibold text-gray-900">Change Password</h3>
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
                className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              >
                {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
                  className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
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
                  className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                >
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button 
                onClick={handleChangePassword} 
                isLoading={isChangingPassword}
                disabled={!newPassword || !confirmPassword}
              >
                Change Password
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Bell className="h-5 w-5 text-[#2B79F7]" />
            <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-medium text-gray-900">Email Notifications</p>
                <p className="text-sm text-gray-500">Receive updates about your content</p>
              </div>
              <input
                type="checkbox"
                defaultChecked
                className="h-5 w-5 rounded border-gray-300 text-[#2B79F7] focus:ring-[#2B79F7]"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-medium text-gray-900">New Lead Alerts</p>
                <p className="text-sm text-gray-500">Get notified when new leads come in</p>
              </div>
              <input
                type="checkbox"
                defaultChecked
                className="h-5 w-5 rounded border-gray-300 text-[#2B79F7] focus:ring-[#2B79F7]"
              />
            </label>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}