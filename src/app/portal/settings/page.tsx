'use client'

import { useState, useEffect } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { User, Lock, CheckCircle, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function PortalSettings() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [notification, setNotification] = useState('')
  const supabase = createClient()

  useEffect(() => {
    loadUser()
  }, [])

  const loadUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      setEmail(user.email || '')
      const { data } = await supabase
        .from('users')
        .select('name')
        .eq('id', user.id)
        .single()
      if (data) setName(data.name || '')
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('users').update({ name }).eq('id', user.id)
      if (newPassword) {
        await supabase.auth.updateUser({ password: newPassword })
        setNewPassword('')
      }
      setNotification('Settings saved!')
      setTimeout(() => setNotification(''), 3000)
    }
    setIsSaving(false)
  }

  return (
    <PortalLayout>
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

        {notification && (
          <div className="mb-6 p-4 rounded-lg bg-green-50 text-green-700 flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            {notification}
          </div>
        )}

        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center gap-2">
            <User className="h-5 w-5 text-[#2B79F7]" />
            <h3 className="text-lg font-semibold">Profile</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Email" value={email} disabled />
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center gap-2">
            <Lock className="h-5 w-5 text-[#2B79F7]" />
            <h3 className="text-lg font-semibold">Change Password</h3>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Input
                label="New Password"
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-9 text-gray-400"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave} isLoading={isSaving}>Save Settings</Button>
      </div>
    </PortalLayout>
  )
}