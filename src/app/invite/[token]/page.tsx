'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { CheckCircle, AlertCircle } from 'lucide-react'
import { LegalFooter } from '@/components/legal/LegalFooter'

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

        // Lookup goes through a server route that uses the service role,
        // because both crm_invites and users are RLS-protected for an
        // anonymous visitor.
        const res = await fetch(
          `/api/invite/lookup?token=${encodeURIComponent(tokenClean)}`,
        )
        const json = (await res.json()) as {
          success: boolean
          error?: string
          // Two response shapes: 'crm' = new crm_invites table,
          // 'legacy' = users.invitation_token (portal client invites).
          kind?: 'crm' | 'legacy'
          invite?: {
            email: string
            name: string | null
            role: string
            clientId?: string | null
            clientName?: string
            expiresAt?: string
          }
        }

        if (!res.ok || !json.success || !json.invite) {
          setError(json.error || 'Invalid or expired invitation link')
          return
        }

        // Adapt both response kinds into the existing local state shape
        // so the rest of the page renders the same way.
        const inv = json.invite
        setUserData({
          // No id is needed here - server route does the auth provisioning
          // by token, not by id.
          id: '',
          email: inv.email,
          name: inv.name,
          role: inv.role,
          client_id: inv.clientId || null,
          invitation_accepted: false,
        })
        if (json.kind === 'crm' && inv.clientId) {
          setCrmInviteInfo({
            role: inv.role,
            clientId: inv.clientId,
            clientName: inv.clientName || 'a client CRM',
          })
        } else {
          setCrmInviteInfo(null)
        }
      } catch (err) {
        console.error('invite lookup exception:', err)
        setError('Could not load invitation. Try the link again.')
      } finally {
        setIsLoading(false)
      }
    }

    run()
  }, [token])

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
      // Activation runs server-side: it provisions the auth user (or
      // resets the password on a pre-existing one), aligns the public.users
      // row id to the new auth uid, and clears the invitation token.
      // We then sign in client-side to establish a browser session.
      const acceptRes = await fetch('/api/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const acceptJson = (await acceptRes.json()) as {
        success: boolean
        error?: string
        email?: string
        redirectTo?: string
      }

      if (!acceptRes.ok || !acceptJson.success || !acceptJson.email) {
        setError(acceptJson.error || 'Failed to activate account')
        return
      }

      const signInRes = await supabase.auth.signInWithPassword({
        email: acceptJson.email,
        password,
      })
      if (signInRes.error) {
        // Server activation succeeded; user just needs to log in manually.
        setError(
          `Account activated, but auto sign-in failed: ${signInRes.error.message}. Go to /login to sign in.`,
        )
        return
      }

      setSuccess(true)
      router.push(acceptJson.redirectTo || '/dashboard')
    } catch (err) {
      console.error('invite accept exception:', err)
      setError(err instanceof Error ? err.message : 'Failed to activate account')
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
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Invalid Invitation</h2>
            <p className="text-[var(--text-tertiary)]">{error}</p>
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
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Account Activated!</h2>
            <p className="text-[var(--text-tertiary)]">Redirecting...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-gradient flex flex-col items-center justify-center p-4 gap-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <div className="flex justify-center mb-6">
            <Image
              src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
              alt="Fokus Kreatives"
              width={160}
              height={48}
              className="object-contain w-auto h-auto max-h-12"
            />
          </div>

          <h2 className="text-2xl font-bold text-center text-[var(--text-primary)] mb-2">
            Welcome, {userData?.name || userData?.email}!
          </h2>
          <p className="text-center text-[var(--text-tertiary)] mb-6">Set your password to activate your account</p>

          <div className="bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] px-4 py-2 rounded-lg text-center text-sm mb-6 capitalize">
            {crmInviteInfo ? (
              <>
                You&rsquo;re joining{' '}
                <strong>{crmInviteInfo.clientName || 'a client CRM'}</strong> as{' '}
                <strong>{crmInviteInfo.role}</strong>
              </>
            ) : (
              <>
                You&rsquo;re joining as <strong>{userData?.role}</strong>
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
      <LegalFooter className="text-white/70" />
    </div>
  )
}