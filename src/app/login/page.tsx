'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { Loader2 } from 'lucide-react'

// 1. Separation: Logic moved to this inner component
function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [error, setError] = useState('')
  
  const searchParams = useSearchParams()
  const nextUrl = searchParams.get('next')
  
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        router.push('/dashboard')
        return
      }
      setIsChecking(false)
    }
    checkAuth()
  }, [router, supabase.auth])

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

    // Determine role and redirect accordingly
    const {
      data: { user },
    } = await supabase.auth.getUser()
    
    if (user) {
      const { data: userRow } = await supabase
        .from('users')
        .select('role, client_id')
        .eq('id', user.id)
        .single()
        
      if (userRow?.role === 'client') {
        // Client: go to portal approvals
        router.push('/portal/approvals')
      } else {
        // Agency team: go to main dashboard
        router.push('/dashboard')
      }
    } else {
      router.push('/dashboard')
    }
  }

  if (isChecking) {
    return (
      <div className="min-h-screen bg-brand-gradient flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-gradient flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <div className="flex justify-center mb-8">
            <Image
              src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
              alt="Fokus Kreatives"
              width={160}
              height={48}
              className="object-contain w-auto h-auto"
            />
          </div>

          <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">
            Welcome Back
          </h2>
          <p className="text-center text-gray-500 mb-8">
            Sign in to your account
          </p>

          <form onSubmit={handleLogin} className="space-y-6">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Input
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
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// 2. Export: Wrap the form in Suspense boundary
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