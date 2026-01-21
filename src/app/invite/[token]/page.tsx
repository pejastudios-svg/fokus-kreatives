'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { CheckCircle, AlertCircle } from 'lucide-react'

type InvitedUser = {
  id: string
  email: string
  name: string | null
  role: string
  client_id?: string | null
  invitation_accepted: boolean
}

export default function InvitePage() {
  const params = useParams()
  const router = useRouter()
  const token = (params.token as string) || ''
  const supabase = createClient()

  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [userData, setUserData] = useState<InvitedUser | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [crmInviteInfo, setCrmInviteInfo] = useState<{ role: string; clientName: string; clientId: string } | null>(null)

  useEffect(() => {
    const run = async () => {
      setIsLoading(true)
      setError('')
      try {
        const tokenClean = token.trim()
        if (!tokenClean) {
          setError('Invalid or expired invitation link')
          return
        }

        const { data, error: invErr } = await supabase
          .from('users')
          .select('id, email, name, role, client_id, invitation_accepted')
          .eq('invitation_token', tokenClean)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (invErr) console.error('Invite lookup error:', invErr)

        if (!data) {
          setError('Invalid or expired invitation link')
          return
        }

        if (data.invitation_accepted) {
          setError('This invitation has already been used')
          return
        }

        setUserData(data as InvitedUser)

        // Load CRM invite info if exists (membership-based role)
        try {
          const { data: mem, error: memErr } = await supabase
            .from('client_memberships')
            .select('role, client_id, clients:clients(name, business_name)')
            .eq('user_id', data.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (memErr) {
            console.error('crm invite info error:', memErr)
            setCrmInviteInfo(null)
          } else if (mem?.role && mem?.client_id) {
            // Define the structure of the client data to satisfy TypeScript
            type ClientRef = { name: string | null; business_name: string | null }
            
            // Cast mem to a specific type containing the clients relationship
            const membershipWithClients = mem as unknown as { 
              clients: ClientRef | ClientRef[] | null 
            }
            
            const c = membershipWithClients.clients

            const clientName =
              (Array.isArray(c) ? c[0]?.business_name || c[0]?.name : c?.business_name || c?.name) || ''
            setCrmInviteInfo({ role: mem.role, clientId: mem.client_id, clientName })
          } else {
            setCrmInviteInfo(null)
          }
        } catch (e) {
          console.error('crm invite info exception:', e)
          setCrmInviteInfo(null)
        }
      } finally {
        setIsLoading(false)
      }
    }

    run()
  }, [token, supabase])

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userData) return

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

    try {
      let authUserId: string | null = null

      const signUpRes = await supabase.auth.signUp({
        email: userData.email,
        password,
      })

      if (signUpRes.error) {
        const msg = (signUpRes.error.message || '').toLowerCase()
        if (msg.includes('already registered')) {
          const signInRes = await supabase.auth.signInWithPassword({
            email: userData.email,
            password,
          })
          if (signInRes.error) {
            setError(signInRes.error.message)
            return
          }
          authUserId = signInRes.data.user?.id || null
        } else {
          setError(signUpRes.error.message)
          return
        }
      } else {
        authUserId = signUpRes.data.user?.id || null
      }

      if (!authUserId) {
        setError('Account created but session could not start. Please go to login.')
        return
      }

      // Mark invitation accepted + clear token.
      // IMPORTANT: your system changes the public.users PK to auth uid.
      const { error: updateErr } = await supabase
        .from('users')
        .update({
          id: authUserId,
          invitation_accepted: true,
          invitation_token: null,
        })
        .eq('invitation_token', token)

      if (updateErr) {
        console.error('Invite accept update error:', updateErr)
        setError('Failed to activate account')
        return
      }

      setSuccess(true)

      // Redirect logic:
      // - client portal users go to portal approvals
      // - CRM invites go to that CRM
      // - otherwise agency dashboard
      if (userData.role === 'client') {
        router.push('/portal/approvals')
        return
      }

      // If crmInviteInfo exists, go to that CRM
      if (crmInviteInfo?.clientId) {
        router.push(`/crm/${crmInviteInfo.clientId}/dashboard`)
        return
      }

      // Otherwise go to agency dashboard
      router.push('/dashboard')
    } finally {
      setIsSubmitting(false)
    }
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
            <p className="text-gray-500">Redirecting...</p>
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
            Welcome, {userData?.name || userData?.email}!
          </h2>
          <p className="text-center text-gray-500 mb-6">Set your password to activate your account</p>

          <div className="bg-[#E8F1FF] text-[#2B79F7] px-4 py-2 rounded-lg text-center text-sm mb-6">
            {crmInviteInfo ? (
              <>
                You’re joining <strong>{crmInviteInfo.clientName || 'a client CRM'}</strong> as <strong>{crmInviteInfo.role}</strong>
              </>
            ) : (
              <>
                You’re joining as <strong>{userData?.role}</strong>
              </>
            )}
          </div>

          <form onSubmit={handleSetPassword} className="space-y-4">
            <Input label="Email" type="email" value={userData?.email || ''} disabled />
            <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" required />
            <Input label="Confirm Password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm your password" required />

            {error && <p className="text-sm text-red-500 text-center">{error}</p>}

            <Button type="submit" className="w-full" size="lg" isLoading={isSubmitting}>
              Activate Account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}