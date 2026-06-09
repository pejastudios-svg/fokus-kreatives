'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { ProfilePictureUpload } from '@/components/ui/ProfilePictureUpload'
import { Skeleton } from '@/components/ui/Loading'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/components/providers/ThemeProvider'
import { IntegrationsCard } from '@/components/integrations/IntegrationsCard'
import { EmailBrandingCard } from '@/components/integrations/EmailBrandingCard'
import { AvailabilityCard } from '@/components/integrations/AvailabilityCard'
import { BrowserNotificationsToggle } from '@/components/notifications/BrowserNotificationsToggle'
import { useCrmRole } from '@/components/crm/CrmRoleContext'
import {
  User,
  Lock,
  Bell,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Palette,
  Sun,
  Moon,
} from 'lucide-react'

type NavMode = 'fixed' | 'hover'

interface MyPreferences {
  theme: 'light' | 'dark'
  nav_mode: NavMode
  notify_new_lead: boolean
  notify_new_meeting: boolean
  notify_payment_reminder: boolean
}

export default function CRMSettingsPage() {
  const params = useParams()
  // Fix: safely cast params to avoid 'any' error
  const routeParams = params as Record<string, string>
  const clientId = routeParams.clientid || routeParams.clientId
  const supabase = createClient()
  // Manager+ can connect/disconnect integrations. Employees see the
  // card in read-only mode (so they can see what's connected).
  const { canEditWorkspace } = useCrmRole()

  const [isLoading, setIsLoading] = useState(true)

  // User-level preferences (theme, nav-mode, per-user notification toggles).
  // Distinct from `notifications` above which are workspace-level. Loaded
  // from /api/me/preferences on mount; persisted on every toggle change.
  const { setTheme } = useTheme()
  const [prefs, setPrefs] = useState<MyPreferences>({
    theme: 'dark',
    nav_mode: 'fixed',
    notify_new_lead: true,
    notify_new_meeting: true,
    notify_payment_reminder: true,
  })
  const [prefsLoaded, setPrefsLoaded] = useState(false)

  // User profile
  const [profileLoading, setProfileLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profileEmail, setProfileEmail] = useState('')
  const [profilePicture, setProfilePicture] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Password
  // Fix: Removed unused 'currentPassword' variable
  const [, setCurrentPassword] = useState('')
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

  // Load user-level preferences once on mount. The endpoint auto-creates
  // the row with defaults on first GET so we never have a missing-row path.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/me/preferences', { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (!cancelled && data?.success && data.preferences) {
          setPrefs({
            theme: data.preferences.theme,
            nav_mode: data.preferences.nav_mode,
            notify_new_lead: data.preferences.notify_new_lead,
            notify_new_meeting: data.preferences.notify_new_meeting,
            notify_payment_reminder: data.preferences.notify_payment_reminder,
          })
        }
      } finally {
        if (!cancelled) setPrefsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist on every change. We optimistically update local state via
  // setPrefs() before the network call so the UI feels instant; if the
  // PATCH fails we just leave the local state alone (the next mount will
  // pull the server's truth).
  const updatePrefs = async (patch: Partial<MyPreferences>) => {
    setPrefs((p) => ({ ...p, ...patch }))
    try {
      await fetch('/api/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
    } catch (err) {
      console.error('preferences save error:', err)
    }
  }

  useEffect(() => {
    let mounted = true

    const loadUserProfile = async () => {
      setProfileLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        if (mounted) setProfileLoading(false)
        return
      }

      if (mounted) {
        setUserId(user.id)
        setProfileEmail(user.email || '')
      }

      const { data, error } = await supabase
        .from('users')
        .select('name, profile_picture_url')
        .eq('id', user.id)
        .single()

      if (mounted) {
        if (error) {
          console.error('Load user profile error:', error)
        } else if (data) {
          setProfileName(data.name || '')
          setProfilePicture(data.profile_picture_url || '')
        }
        setProfileLoading(false)
      }
    }

    const init = async () => {
        await loadUserProfile()
        setIsLoading(false)
    }
    init()

    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const showAlert = (type: 'success' | 'error', message: string) => {
    setAlert({ type, message })
    setTimeout(() => setAlert(null), 3000)
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

function SettingsSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6 animate-in fade-in">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="bg-[var(--bg-card)] border-[var(--border-primary)]">
          <CardHeader>
            <Skeleton className="h-4 w-40 sm:w-48 bg-[var(--border-primary)]" />
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4">
            <Skeleton className="h-10 sm:h-12 w-full bg-[var(--border-primary)]" />
            <Skeleton className="h-10 sm:h-12 w-full bg-[var(--border-primary)]" />
            <div className="flex justify-end">
              <Skeleton className="h-9 sm:h-10 w-28 sm:w-32 rounded-lg bg-[var(--border-primary)]" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

  return <div className="p-3 sm:p-4 lg:p-6 min-h-full">
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

      {isLoading ? (
        <SettingsSkeleton />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
          {/* Appearance - theme + nav-mode preferences. User-level. */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Palette className="h-4 w-4 text-[#2B79F7]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Appearance</h3>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Theme picker - radio cards */}
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)] mb-2">Theme</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { value: 'light', label: 'Light', icon: Sun },
                    { value: 'dark', label: 'Dark', icon: Moon },
                  ] as const).map((opt) => {
                    const active = prefs.theme === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={!prefsLoaded}
                        onClick={() => {
                          void updatePrefs({ theme: opt.value })
                          setTheme(opt.value)
                        }}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all duration-150 ${
                          active
                            ? 'border-[#2B79F7] bg-[#2B79F7]/10 text-[var(--text-primary)]'
                            : 'border-[var(--border-primary)] hover:border-[#2B79F7]/50 text-[var(--text-secondary)]'
                        }`}
                      >
                        <opt.icon className="h-5 w-5 shrink-0" />
                        <span className="font-medium text-sm">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Meeting integrations - Calendly today, Google Meet + Zoom
              wired later. Bookings made via any connected provider
              auto-log into the meetings table. */}
          <IntegrationsCard clientId={clientId} canManage={canEditWorkspace} />

          {/* White-label email: sender display name + reply-to for emails
              that go to this client's leads/customers. */}
          <EmailBrandingCard clientId={clientId} canManage={canEditWorkspace} />

          <AvailabilityCard clientId={clientId} canManage={canEditWorkspace} />

          {/* Browser / desktop push notifications. Per-device toggle:
              when on, the OS shows a push for every CRM event even
              when the tab is closed. Sits before the per-type My
              notifications card because flipping it off zeroes out
              the rest of the notifications system regardless. */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Bell className="h-4 w-4 text-[#2B79F7]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Desktop &amp; mobile push</h3>
            </CardHeader>
            <CardContent>
              <BrowserNotificationsToggle />
            </CardContent>
          </Card>

          {/* Personal notifications - one toggle per CRM event type. The
              actual gating of notification firing is wired in Phase D; for
              now these just persist the preference. */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Bell className="h-4 w-4 text-[#2B79F7]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">My notifications</h3>
            </CardHeader>
            <CardContent className="space-y-1 divide-y divide-[var(--border-primary)]">
              <Toggle
                checked={prefs.notify_new_lead}
                onChange={(v) => void updatePrefs({ notify_new_lead: v })}
                disabled={!prefsLoaded}
                label="New lead"
                description="Ping me whenever a new lead comes in via a capture page or import."
              />
              <Toggle
                checked={prefs.notify_new_meeting}
                onChange={(v) => void updatePrefs({ notify_new_meeting: v })}
                disabled={!prefsLoaded}
                label="New meeting"
                description="Notify me when a new meeting is scheduled in this CRM."
              />
              <Toggle
                checked={prefs.notify_payment_reminder}
                onChange={(v) => void updatePrefs({ notify_payment_reminder: v })}
                disabled={!prefsLoaded}
                label="Payment reminder"
                description="Remind me about due or overdue invoices."
              />
            </CardContent>
          </Card>

          {/* Profile & Password */}
          <div className="space-y-6">
            {/* Profile */}
            <Card className="bg-[var(--bg-card)] border-[var(--border-primary)]">
              <CardHeader className="flex flex-row items-center gap-2">
                <User className="h-5 w-5 text-[#2B79F7]" />
                <h3 className="text-lg font-semibold text-white">
                  Your Profile
                </h3>
              </CardHeader>
              <CardContent className="space-y-4">
                {profileLoading ? (
                  <p className="text-sm text-[var(--text-tertiary)]">Loading profile...</p>
                ) : (
                  <>
                    <div className="flex justify-center">
                      <ProfilePictureUpload
                        value={profilePicture}
                        onChange={(url) => setProfilePicture(url)}
                        folder="user-profile-pictures"
                        fallback={profileName || profileEmail ? 'initial' : 'user'}
                        initialChar={(profileName || profileEmail || 'U').charAt(0)}
                        ariaLabel="Your profile picture"
                      />
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
            <Card className="bg-[var(--bg-card)] border-[var(--border-primary)]">
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
                    className="absolute right-3 top-9 text-[var(--text-tertiary)]"
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
                    className="absolute right-3 top-9 text-[var(--text-tertiary)]"
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
        )}
      </div>
}
