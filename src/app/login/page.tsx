'use client'

import { useState, useEffect, Suspense } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { Loader2, ArrowLeft, CheckCircle } from 'lucide-react'
import { LegalFooter } from '@/components/legal/LegalFooter'

type Mode = 'login' | 'forgot-email' | 'forgot-verify' | 'forgot-success'

function LoginForm() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetEmail, setResetEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const searchParams = useSearchParams()
  const nextUrl = searchParams.get('next')
  const reason = searchParams.get('reason')

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      // Already-signed-in users skip the form and go to wherever they
      // belong. Routing goes through /api/me/landing so CRM team
      // members (whose memberships are RLS-hidden from a browser
      // query) actually reach their CRM instead of looping back here.
      const res = await fetch('/api/me/landing', { cache: 'no-store' })
      if (res.status === 401) {
        setIsChecking(false)
        return
      }
      const json = (await readJsonSafe(res)) as
        | { authed: true; signOut: true }
        | { authed: true; destination: string }
        | { authed: false }
      if ('signOut' in json && json.signOut) {
        await supabase.auth.signOut()
        setIsChecking(false)
        return
      }
      if ('destination' in json) {
        router.push(json.destination)
        return
      }
      setIsChecking(false)
    }
    checkAuth()
  }, [router, supabase])

  const switchMode = (next: Mode) => {
    setError('')
    setInfo('')
    setMode(next)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setIsLoading(false)
      return
    }

    if (nextUrl) {
      router.push(nextUrl)
      return
    }

    // Same service-role-backed lookup as the auto-redirect above.
    const res = await fetch('/api/me/landing', { cache: 'no-store' })
    const json = (await readJsonSafe(res).catch(() => null)) as
      | { authed: true; destination: string }
      | { authed: true; signOut: true }
      | { authed: false }
      | null
    if (json && 'destination' in json) {
      router.push(json.destination)
    } else {
      router.push('/dashboard')
    }
  }

  const handleSendResetCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setInfo('')

    const trimmed = resetEmail.trim().toLowerCase()
    if (!trimmed) {
      setError('Enter your email')
      setIsLoading(false)
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(trimmed)

    if (error) {
      setError(error.message)
      setIsLoading(false)
      return
    }

    setInfo('We sent a 6-digit code to your email. Check your inbox.')
    setIsLoading(false)
    setMode('forgot-verify')
  }

  const handleVerifyAndReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setInfo('')

    const code = resetCode.trim()
    if (code.length < 6) {
      setError('Enter the 6-digit code from your email')
      setIsLoading(false)
      return
    }
    if (resetNewPassword.length < 8) {
      setError('Password must be at least 8 characters')
      setIsLoading(false)
      return
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: resetEmail.trim().toLowerCase(),
      token: code,
      type: 'recovery',
    })

    if (verifyErr) {
      setError(verifyErr.message || 'Invalid or expired code')
      setIsLoading(false)
      return
    }

    const { error: updErr } = await supabase.auth.updateUser({
      password: resetNewPassword,
    })

    if (updErr) {
      setError(updErr.message)
      setIsLoading(false)
      return
    }

    await supabase.auth.signOut()
    setMode('forgot-success')
    setIsLoading(false)
  }

  const handleResendCode = async () => {
    setError('')
    setInfo('')
    const trimmed = resetEmail.trim().toLowerCase()
    if (!trimmed) {
      setError('Enter your email first')
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed)
    if (error) {
      setError(error.message)
      return
    }
    setInfo('A new code has been sent.')
  }

  if (isChecking) {
    return (
      <div className="min-h-screen bg-brand-gradient flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-gradient flex flex-col items-center justify-center p-4 gap-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <div className="flex justify-center mb-8">
            <Image
              src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
              alt="Fokus Kreativez"
              width={160}
              height={48}
              className="object-contain w-auto h-auto"
            />
          </div>

          {mode === 'login' && (
            <>
              <h2 className="text-2xl font-bold text-center text-[var(--text-primary)] mb-2">
                Welcome Back
              </h2>
              <p className="text-center text-[var(--text-tertiary)] mb-8">
                Sign in to your account
              </p>

              {reason === 'idle' && (
                <div className="mb-6 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 dark:bg-[#1E3A6F] dark:border-transparent dark:text-[#93C5FD] text-sm text-center">
                  You were signed out due to inactivity. Please sign in again.
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-6">
                <Input
                  className="glass-field"
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />

                <Input
                  className="glass-field"
                  label="Password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />

                {error && (
                  <p className="text-sm text-red-500 text-center">{error}</p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  isLoading={isLoading}
                >
                  Sign In
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setResetEmail(email)
                    switchMode('forgot-email')
                  }}
                  className="block mx-auto text-sm text-[#2B79F7] hover:underline"
                >
                  Forgot password?
                </button>
              </form>
            </>
          )}

          {mode === 'forgot-email' && (
            <>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="mx-auto flex items-center gap-1 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mb-4"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </button>
              <h2 className="text-2xl font-bold text-center text-[var(--text-primary)] mb-2">
                Reset password
              </h2>
              <p className="text-center text-[var(--text-tertiary)] mb-8">
                We&apos;ll email you a 6-digit code to reset your password.
              </p>

              <form onSubmit={handleSendResetCode} className="space-y-6">
                <Input
                  className="glass-field"
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  autoFocus
                />

                {error && <p className="text-sm text-red-500 text-center">{error}</p>}

                <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                  Send code
                </Button>
              </form>
            </>
          )}

          {mode === 'forgot-verify' && (
            <>
              <button
                type="button"
                onClick={() => switchMode('forgot-email')}
                className="mx-auto flex items-center gap-1 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mb-4"
              >
                <ArrowLeft className="h-4 w-4" />
                Use a different email
              </button>
              <h2 className="text-2xl font-bold text-center text-[var(--text-primary)] mb-2">
                Enter the code
              </h2>
              <p className="text-center text-[var(--text-tertiary)] mb-8">
                We sent a 6-digit code to <span className="font-medium">{resetEmail}</span>.
              </p>

              <form onSubmit={handleVerifyAndReset} className="space-y-5">
                <Input
                  className="glass-field"
                  label="6-digit code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                />

                <Input
                  className="glass-field"
                  label="New password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  required
                />

                <Input
                  className="glass-field"
                  label="Confirm new password"
                  type="password"
                  placeholder="Re-enter password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  required
                />

                {info && <p className="text-sm text-green-600 text-center">{info}</p>}
                {error && <p className="text-sm text-red-500 text-center">{error}</p>}

                <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                  Reset password
                </Button>

                <button
                  type="button"
                  onClick={handleResendCode}
                  className="block mx-auto text-sm text-[#2B79F7] hover:underline"
                  disabled={isLoading}
                >
                  Didn&apos;t get a code? Resend
                </button>
              </form>
            </>
          )}

          {mode === 'forgot-success' && (
            <div className="text-center space-y-6 py-4">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Password reset</h2>
                <p className="text-[var(--text-tertiary)]">
                  Your password has been updated. Sign in with your new password.
                </p>
              </div>
              <Button
                onClick={() => {
                  setEmail(resetEmail)
                  setPassword('')
                  setResetCode('')
                  setResetNewPassword('')
                  setResetConfirmPassword('')
                  switchMode('login')
                }}
                className="w-full"
                size="lg"
              >
                Sign in
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <LegalFooter className="text-white/70" />
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-brand-gradient flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
