'use client'

import { useEffect, useMemo, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import { Copy, Check, Sparkles } from 'lucide-react'

type ClientRow = {
  id: string
  name: string
  business_name: string
  industry: string
  target_audience: string
  social_proof: string
  unique_mechanisms: string
  website_url: string | null
  content_tier: 'beginner' | 'mid' | 'advanced'
}

type BioTemplate = {
  title: string
  bio_lines: string[]
  link_line: string
  notes: string
}

export default function BioTemplatesPage() {
  const supabase = createClient()

  const [clients, setClients] = useState<ClientRow[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId]
  )

  const [websiteOverride, setWebsiteOverride] = useState('')
  const [tierOverride, setTierOverride] = useState<'beginner' | 'mid' | 'advanced'>('beginner')

  const [templates, setTemplates] = useState<BioTemplate[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.from('clients').select('id,name,business_name,industry,target_audience,social_proof,unique_mechanisms,website_url,content_tier').order('name')
      setClients((data || []) as any)
    })()
  }, [supabase])

  useEffect(() => {
    if (!selectedClient) return
    setWebsiteOverride(selectedClient.website_url || '')
    setTierOverride(selectedClient.content_tier || 'beginner')
    setTemplates([])
    setError('')
  }, [selectedClient])

  const formatTemplate = (t: BioTemplate) => {
    return [
      ...t.bio_lines,
      t.link_line,
    ].join('\n')
  }

  const copyTemplate = async (idx: number) => {
    const t = templates[idx]
    if (!t) return
    await navigator.clipboard.writeText(formatTemplate(t))
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  const generate = async () => {
    if (!selectedClient) return
    setIsGenerating(true)
    setError('')
    setTemplates([])
    try {
      const res = await fetch('/bio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          websiteUrl: websiteOverride || null,
          tier: tierOverride,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Failed to generate')
        return
      }
      setTemplates(data.templates || [])
    } catch (e) {
      console.error(e)
      setError('Failed to generate bio templates')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <>
      <Header title="Bio Templates" subtitle="Generate high-converting bio options from the saved client profile" />
      <div className="p-8 space-y-6">
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="">Select a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.business_name}
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Website URL (optional)"
                value={websiteOverride}
                onChange={(e) => setWebsiteOverride(e.target.value)}
                placeholder="https://example.com"
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tier</label>
                <select
                  value={tierOverride}
                  onChange={(e) => setTierOverride(e.target.value as any)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="beginner">Beginner</option>
                  <option value="mid">Mid</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
            </div>

            <Button onClick={generate} isLoading={isGenerating} disabled={!selectedClientId}>
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Bio Options
            </Button>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </CardContent>
        </Card>

        {templates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((t, idx) => (
              <Card key={idx}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">{t.title}</h3>
                    <Button variant="outline" size="sm" onClick={() => copyTemplate(idx)}>
                      {copiedIdx === idx ? (
                        <>
                          <Check className="h-4 w-4 mr-1" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-1" /> Copy
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg text-sm text-gray-800">
                    {formatTemplate(t)}
                  </pre>
                  {t.notes && <p className="text-xs text-gray-500 mt-3">{t.notes}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}