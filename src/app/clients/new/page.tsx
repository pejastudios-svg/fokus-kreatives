'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function NewClientPage() {
  const router = useRouter()
  const supabase = createClient()

  const [isLoading, setIsLoading] = useState(false)
  const [roleLoading, setRoleLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    business_name: '',
    industry: '',
    target_audience: '',
    brand_doc_text: '',
    dos_and_donts: '',
    topics_library: '',
    key_stories: '',
    unique_mechanisms: '',
    social_proof: '',
    website_url: '',
   content_tier: 'beginner',
  })

  // Only admins can create clients (per your current rule)
  const canCreateClient = userRole === 'admin'

  // ✅ Load current user's role ONCE, correctly
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          if (!cancelled) setUserRole(null)
          return
        }

        const { data, error } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()

        if (error) {
          console.error('Role lookup failed:', error.code, error.message, error)
          if (!cancelled) setUserRole(null)
          return
        }

        if (!cancelled) setUserRole(data?.role || null)
      } finally {
        if (!cancelled) setRoleLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [supabase])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setNotification(null)

    // ✅ Permission checks BEFORE starting the loading spinner
    if (roleLoading) {
      setNotification({ type: 'error', message: 'Loading permissions… try again in a second.' })
      return
    }

    if (!canCreateClient) {
      setNotification({ type: 'error', message: 'You do not have permission to create clients.' })
      return
    }

    setIsLoading(true)

    try {
      // Step 1: Create client
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .insert({
          name: formData.name,
          business_name: formData.business_name,
          industry: formData.industry,
          target_audience: formData.target_audience,
          brand_doc_text: formData.brand_doc_text,
          dos_and_donts: formData.dos_and_donts,
          topics_library: formData.topics_library,
          key_stories: formData.key_stories,
          unique_mechanisms: formData.unique_mechanisms,
          social_proof: formData.social_proof,
          website_url: formData.website_url || null,
          content_tier: formData.content_tier || 'beginner',
        })
        .select()
        .single()

      if (clientError) {
        console.error('Client creation error:', clientError)
        setNotification({
          type: 'error',
          message: `Failed to create client: ${clientError.message || 'Unknown error'}`,
        })
        return
      }

      if (!clientData) {
        setNotification({ type: 'error', message: 'Client created but no data returned' })
        return
      }

      // Step 2: Create default CRM custom fields
      const defaultFields = [
        { client_id: clientData.id, field_name: 'Name', field_key: 'name', field_type: 'text', position: 0, is_default: true, is_required: true },
        { client_id: clientData.id, field_name: 'Email', field_key: 'email', field_type: 'email', position: 1, is_default: true, is_required: false },
        { client_id: clientData.id, field_name: 'Phone', field_key: 'phone', field_type: 'phone', position: 2, is_default: true, is_required: false },
        {
          client_id: clientData.id,
          field_name: 'Status',
          field_key: 'status',
          field_type: 'status',
          options: [
            { value: 'new', label: 'New', color: '#3B82F6' },
            { value: 'contacted', label: 'Contacted', color: '#F59E0B' },
            { value: 'qualified', label: 'Qualified', color: '#8B5CF6' },
            { value: 'proposal', label: 'Proposal', color: '#EC4899' },
            { value: 'negotiation', label: 'Negotiation', color: '#F97316' },
            { value: 'closed', label: 'Closed', color: '#10B981' },
            { value: 'lost', label: 'Lost', color: '#EF4444' },
          ],
          position: 3,
          is_default: true,
          is_required: false,
        },
        { client_id: clientData.id, field_name: 'Date Added', field_key: 'date_added', field_type: 'date', position: 4, is_default: true, is_required: false },
      ]

      const { error: fieldsError } = await supabase.from('custom_fields').insert(defaultFields)
      if (fieldsError) console.warn('Failed to create default fields:', fieldsError)

      // Step 3/4/5: Channels (keep your existing behavior, but don’t fail the whole flow)
      try {
        const { data: masterUser } = await supabase
          .from('users')
          .select('id')
          .eq('email', 'fokuskreatives@gmail.com')
          .maybeSingle()

        if (masterUser?.id) {
          const { data: masterClient } = await supabase
            .from('clients')
            .select('id')
            .ilike('name', '%fokus%')
            .maybeSingle()

          if (masterClient?.id) {
            const { error: channelError } = await supabase.from('channels').insert({
              client_id: masterClient.id,
              name: `client-${formData.name.toLowerCase().replace(/\s+/g, '-')}`,
              description: `Communication with ${formData.name} - ${formData.business_name}`,
              is_private: true,
              is_dm: false,
              created_by: masterUser.id,
            })
            if (channelError) console.warn('Failed to create master inbox channel:', channelError)
          }
        }
      } catch (e) {
        console.warn('Master inbox channel step failed:', e)
      }

      // Default CRM channels
      const { error: clientChannelError } = await supabase.from('channels').insert({
        client_id: clientData.id,
        name: 'general',
        description: 'General discussion',
        is_private: false,
        is_dm: false,
      })
      if (clientChannelError) console.warn('Failed to create default channel:', clientChannelError)

      const { error: supportChannelError } = await supabase.from('channels').insert({
        client_id: clientData.id,
        name: 'fokus-kreatives-support',
        description: 'Direct communication with Fokus Kreatives team',
        is_private: false,
        is_dm: false,
      })
      if (supportChannelError) console.warn('Failed to create support channel:', supportChannelError)

      // Step 6: Portal user invite (optional)
      if (formData.email) {
        const emailLower = formData.email.trim().toLowerCase()
        const token = crypto.randomUUID()

        const { data: existing, error: existingErr } = await supabase
          .from('users')
          .select('id, role')
          .eq('email', emailLower)
          .maybeSingle()

        if (existingErr) console.error('Portal user lookup error:', existingErr)

        if (!existing) {
          const { error: userError } = await supabase.from('users').insert({
            email: emailLower,
            name: formData.name,
            role: 'client',
            client_id: clientData.id,
            invitation_token: token,
            invitation_accepted: false,
            is_agency_user: false,
          })

          if (userError) {
            console.warn('Failed to create portal user:', userError)
            setNotification({ type: 'success', message: `Client created! (Portal invite failed: ${userError.message})` })
          } else {
            setNotification({ type: 'success', message: `Client created! Portal invite link: ${window.location.origin}/invite/${token}` })
          }
        } else {
          // If email exists as team user, don’t overwrite
          if (existing.role !== 'client') {
            setNotification({
              type: 'success',
              message: `Client created! Portal invite NOT created because ${emailLower} already exists as a team user.`,
            })
          } else {
            const { error: updateErr } = await supabase
              .from('users')
              .update({
                client_id: clientData.id,
                invitation_token: token,
                invitation_accepted: false,
                name: formData.name,
                is_agency_user: false,
              })
              .eq('id', existing.id)

            if (updateErr) {
              console.warn('Failed to update portal user:', updateErr)
              setNotification({ type: 'success', message: `Client created! (Portal invite failed: ${updateErr.message})` })
            } else {
              setNotification({ type: 'success', message: `Client created! Portal invite link: ${window.location.origin}/invite/${token}` })
            }
          }
        }
      } else {
        setNotification({ type: 'success', message: 'Client created successfully!' })
      }

      setTimeout(() => router.push('/clients'), 1500)
    } catch (err: any) {
      console.error('Unexpected error:', err)
      setNotification({ type: 'error', message: `Unexpected error: ${err?.message || 'Unknown error'}` })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <DashboardLayout>
      <Header title="Add New Client" subtitle="Create a new client profile" />

      <div className="p-8 max-w-4xl">
        <Link href="/clients" className="inline-flex items-center text-[#2B79F7] hover:underline mb-6">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Clients
        </Link>

        {notification && (
          <div
            className={`mb-6 p-4 rounded-lg flex items-start gap-3 ${
              notification.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {notification.type === 'success' ? <CheckCircle className="h-5 w-5 mt-0.5" /> : <AlertCircle className="h-5 w-5 mt-0.5" />}
            <span className="break-all">{notification.message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Basic Information</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input label="Client Name" name="name" value={formData.name} onChange={handleChange} placeholder="John Smith" required />
                <Input label="Business Name" name="business_name" value={formData.business_name} onChange={handleChange} placeholder="Smith Consulting" required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input label="Client Email (for portal access)" name="email" type="email" value={formData.email} onChange={handleChange} placeholder="john@example.com" />
                <Input label="Industry/Niche" name="industry" value={formData.industry} onChange={handleChange} placeholder="Business Coaching, Real Estate, Fitness..." />
              </div>

              <div className="w-full">
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
                <textarea
                  name="target_audience"
                  value={formData.target_audience}
                  onChange={handleChange}
                  placeholder="Who is their ideal client? Age, profession, pain points, desires..."
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none"
                />
              </div>
              <Input
  label="Website URL (optional)"
  name="website_url"
  value={(formData as any).website_url || ''}
  onChange={handleChange}
  placeholder="https://example.com"
/>

<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">
    Client Tier
  </label>
  <select
    name="content_tier"
    value={(formData as any).content_tier || 'beginner'}
    onChange={(e) =>
      setFormData((prev: any) => ({ ...prev, content_tier: e.target.value }))
    }
    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
  >
    <option value="beginner">Beginner</option>
    <option value="mid">Mid</option>
    <option value="advanced">Advanced</option>
  </select>
  <p className="mt-1 text-xs text-gray-500">
    Controls how soft vs direct your hooks/CTAs are and how much authority content we use.
  </p>
</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Brand Document</h3>
              <p className="text-sm text-gray-500 mt-1">Paste the full brand guidelines, voice, tone, and messaging here.</p>
            </CardHeader>
            <CardContent>
              <textarea
                name="brand_doc_text"
                value={formData.brand_doc_text}
                onChange={handleChange}
                placeholder="Paste the entire brand document here..."
                rows={12}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none font-mono text-sm"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Content Guidelines</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="w-full">
                <label className="block text-sm font-medium text-gray-700 mb-1">Do&apos;s and Don&apos;ts</label>
                <textarea
                  name="dos_and_donts"
                  value={formData.dos_and_donts}
                  onChange={handleChange}
                  placeholder="DO: Use casual, confident tone. Use specific numbers. Tell stories.
DON'T: Mention competitors by name. Use corporate jargon. Be generic."
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none"
                />
              </div>

              <div className="w-full">
                <label className="block text-sm font-medium text-gray-700 mb-1">Topics Library</label>
                <textarea
                  name="topics_library"
                  value={formData.topics_library}
                  onChange={handleChange}
                  placeholder="List topics this client should cover. One per line."
                  rows={6}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Stories & Social Proof</h3>
              <p className="text-sm text-gray-500 mt-1">Used as inspiration (never copied word-for-word).</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="w-full">
                <label className="block text-sm font-medium text-gray-700 mb-1">Key Stories</label>
                <textarea
                  name="key_stories"
                  value={formData.key_stories}
                  onChange={handleChange}
                  rows={6}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none"
                />
              </div>

              <div className="w-full">
                <label className="block text-sm font-medium text-gray-700 mb-1">Unique Mechanisms / Frameworks</label>
                <textarea
                  name="unique_mechanisms"
                  value={formData.unique_mechanisms}
                  onChange={handleChange}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none"
                />
              </div>

              <div className="w-full">
                <label className="block text-sm font-medium text-gray-700 mb-1">Social Proof & Results</label>
                <textarea
                  name="social_proof"
                  value={formData.social_proof}
                  onChange={handleChange}
                  rows={5}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Link href="/clients">
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </Link>

            <Button type="submit" isLoading={isLoading} disabled={roleLoading || !canCreateClient}>
              Create Client
            </Button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  )
}