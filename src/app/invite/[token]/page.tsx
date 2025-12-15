'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { CheckCircle, AlertCircle } from 'lucide-react'

export default function InvitePage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string
  const supabase = createClient()

const [isLoading, setIsLoading] = useState(true)
const [isSubmitting, setIsSubmitting] = useState(false)
const [error, setError] = useState('')
const [success, setSuccess] = useState(false)
type InvitedUser = {
  id: string
  email: string
  name: string
  role: string
  client_id?: string | null
}

const [userData, setUserData] = useState<InvitedUser | null>(null)
const [password, setPassword] = useState('')
const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    checkInvitation()
  }, [token])

  const checkInvitation = async () => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('invitation_token', token)
      .single()

    if (error || !data) {
      setError('Invalid or expired invitation link')
      setIsLoading(false)
      return
    }

    if (data.invitation_accepted) {
      setError('This invitation has already been used')
      setIsLoading(false)
      return
    }

    setUserData(data)
    setIsLoading(false)
  }

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setIsSubmitting(true)
    setError('')

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: userData!.email,
      password: password,
    })

    if (authError) {
      setError(authError.message)
      setIsSubmitting(false)
      return
    }

    // Update user record
    const { error: updateError } = await supabase
      .from('users')
      .update({
        id: authData.user?.id,
        invitation_accepted: true,
        invitation_token: null,
      })
      .eq('invitation_token', token)

    if (updateError) {
      setError('Failed to activate account')
      setIsSubmitting(false)
      return
    }

    setTimeout(() => {
  if (userData?.client_id) {
    router.push(`/crm/${userData.client_id}/dashboard`)
  } else if (userData?.role === 'client') {
    router.push('/portal/dashboard')
  } else {
    router.push('/dashboard')
  }
}, 2000)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-brand-gradient flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  if (error && !userData) {
    return (
      <div className="min-h-screen bg-brand-gradient flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid Invitation</h2>
            <p className="text-gray-500">{error}</p>
            <Button className="mt-6" onClick={() => router.push('/login')}>
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-brand-gradient flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Account Activated!</h2>
            <p className="text-gray-500">Redirecting you to the dashboard...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-gradient flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <div className="flex justify-center mb-6">
            <Image
              src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
              alt="Fokus Kreatives"
              width={120}
              height={36}
              className="object-contain w-auto h-auto max-h-10"
            />
          </div>

          <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">
            Welcome, {userData?.name}!
          </h2>
          <p className="text-center text-gray-500 mb-6">
            Set your password to activate your account
          </p>

          <div className="bg-[#E8F1FF] text-[#2B79F7] px-4 py-2 rounded-lg text-center text-sm mb-6">
            You're joining as <strong>{userData?.role}</strong>
          </div>

          <form onSubmit={handleSetPassword} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={userData?.email || ''}
              disabled
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              required
            />
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
            />

            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              isLoading={isSubmitting}
            >
              Activate Account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}