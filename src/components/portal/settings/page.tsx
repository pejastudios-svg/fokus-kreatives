'use client'

import { useState } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { User, Lock, Bell, CheckCircle } from 'lucide-react'

export default function PortalSettings() {
  const [name, setName] = useState('Client Name')
  const [email, setEmail] = useState('client@example.com')
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setIsSaving(true)
    setTimeout(() => {
      setIsSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }, 1000)
  }

  return (
    <PortalLayout>
      <div className="p-8 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 mt-1">Manage your account settings</p>
        </div>

        {saved && (
          <div className="mb-6 p-4 rounded-lg bg-green-50 text-green-700 flex items-center gap-3">
            <CheckCircle className="h-5 w-5" />
            Settings saved successfully!
          </div>
        )}

        {/* Profile */}
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center gap-2">
            <User className="h-5 w-5 text-[#2B79F7]" />
            <h3 className="text-lg font-semibold text-gray-900">Profile</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-6">
              <div className="h-20 w-20 rounded-full bg-brand-gradient flex items-center justify-center text-white text-2xl font-bold">
                {name.charAt(0).toUpperCase()}
              </div>
              <Button variant="outline" size="sm">Change Photo</Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Full Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* Password */}
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center gap-2">
            <Lock className="h-5 w-5 text-[#2B79F7]" />
            <h3 className="text-lg font-semibold text-gray-900">Password</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input label="Current Password" type="password" placeholder="Enter current password" />
            <div className="grid grid-cols-2 gap-4">
              <Input label="New Password" type="password" placeholder="Enter new password" />
              <Input label="Confirm Password" type="password" placeholder="Confirm new password" />
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center gap-2">
            <Bell className="h-5 w-5 text-[#2B79F7]" />
            <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-medium text-gray-900">New Lead Notifications</p>
                <p className="text-sm text-gray-500">Get notified when you receive new leads</p>
              </div>
              <input type="checkbox" defaultChecked className="h-5 w-5 rounded border-gray-300 text-[#2B79F7]" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-medium text-gray-900">Content Updates</p>
                <p className="text-sm text-gray-500">Get notified when new content is ready</p>
              </div>
              <input type="checkbox" defaultChecked className="h-5 w-5 rounded border-gray-300 text-[#2B79F7]" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-medium text-gray-900">Weekly Reports</p>
                <p className="text-sm text-gray-500">Receive weekly performance summaries</p>
              </div>
              <input type="checkbox" className="h-5 w-5 rounded border-gray-300 text-[#2B79F7]" />
            </label>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} isLoading={isSaving}>Save Changes</Button>
        </div>
      </div>
    </PortalLayout>
  )
}