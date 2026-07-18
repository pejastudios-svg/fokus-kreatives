'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Search,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/Loading'
import type { CompetitorAnalysis } from '@/app/api/analyze-competitor/route'
import { useFormPersistence } from '@/hooks/useFormPersistence'
import { ClientPicker } from '@/components/dashboard/ClientPicker'

interface Client {
  id: string
  name: string
  business_name: string
  industry: string
  profile_picture_url: string | null
}

export default function CompetitorsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useFormPersistence<string>('competitors:clientId', '')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [competitorHandle, setCompetitorHandle, clearHandle] = useFormPersistence<string>('competitors:handle', '')
  const [platform, setPlatform] = useFormPersistence<string>('competitors:platform', 'instagram')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [analysis, setAnalysis] = useState<CompetitorAnalysis | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const supabase = useMemo(() => createClient(), [])
  const [transcript, setTranscript, clearTranscript] = useFormPersistence<string>('competitors:transcript', '')
  const [isLoading, setIsLoading] = useState(true)

  const fetchClients = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('clients')
        .select('id, name, business_name, industry, profile_picture_url')
        .order('name')
      if (data) setClients(data as Client[])
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  useEffect(() => {
    if (selectedClientId) {
      const client = clients.find((c) => c.id === selectedClientId)
      setSelectedClient(client || null)
    }
  }, [selectedClientId, clients])

  const handleAnalyze = async () => {
    if (!selectedClient || !transcript.trim()) return

    setIsAnalyzing(true)
    setAnalysis(null)
    setSaved(false)
    setError('')

    try {
      const response = await fetch('/api/analyze-competitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitorHandle,
          platform,
          clientNiche: selectedClient.industry || selectedClient.business_name,
          videoTranscript: transcript,
        }),
      })

      const data = await readJsonSafe(response)

      if (data.success) {
        setAnalysis(data.analysis as CompetitorAnalysis)
      } else {
        setError(data.error || 'Failed to analyze. Please try again.')
      }
    } catch (err) {
      console.error('Analysis error:', err)
      setError('Failed to connect to AI service. Check your GROQ_API_KEY in .env.local')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const analysisToText = (a: CompetitorAnalysis): string => {
    const lines: string[] = []
    lines.push(`SUMMARY\n${a.summary}\n`)
    lines.push(`HOOK (${a.hook.rating}/10)\n"${a.hook.text}"`)
    if (a.hook.why_it_works.length) lines.push(`Why it works:\n- ${a.hook.why_it_works.join('\n- ')}`)
    if (a.hook.weaknesses.length) lines.push(`Weaknesses:\n- ${a.hook.weaknesses.join('\n- ')}`)
    lines.push(`\nSTRUCTURE\nPillar: ${a.structure.pillar}\nPacing: ${a.structure.pacing}`)
    a.structure.beats.forEach((b) => lines.push(`- [${b.label}] ${b.text}`))
    lines.push(`\nCTA (${a.cta.rating}/10)\n"${a.cta.text}"`)
    if (a.cta.why_it_works.length) lines.push(`Why it works:\n- ${a.cta.why_it_works.join('\n- ')}`)
    if (a.cta.weaknesses.length) lines.push(`Weaknesses:\n- ${a.cta.weaknesses.join('\n- ')}`)
    lines.push(`\nVOICE\nTone: ${a.voice.tone}`)
    if (a.voice.notable_patterns.length)
      lines.push(`Notable patterns:\n- ${a.voice.notable_patterns.join('\n- ')}`)
    if (a.what_works.length) lines.push(`\nWHAT WORKS\n- ${a.what_works.join('\n- ')}`)
    if (a.what_doesnt_work.length)
      lines.push(`\nWHAT DOESN'T WORK\n- ${a.what_doesnt_work.join('\n- ')}`)
    lines.push(`\nTAKEAWAYS FOR CLIENT`)
    if (a.takeaways_for_client.hook_formulas.length)
      lines.push(`Hook formulas:\n- ${a.takeaways_for_client.hook_formulas.join('\n- ')}`)
    if (a.takeaways_for_client.cta_formulas.length)
      lines.push(`CTA formulas:\n- ${a.takeaways_for_client.cta_formulas.join('\n- ')}`)
    if (a.takeaways_for_client.structural_moves.length)
      lines.push(`Structural moves:\n- ${a.takeaways_for_client.structural_moves.join('\n- ')}`)
    if (a.takeaways_for_client.new_angles.length)
      lines.push(`New angles:\n- ${a.takeaways_for_client.new_angles.join('\n- ')}`)
    return lines.join('\n')
  }

  const handleSaveToClient = async () => {
    if (!selectedClientId || !analysis) return

    setIsSaving(true)
    try {
      await supabase.from('competitors').insert({
        client_id: selectedClientId,
        platform,
        url: competitorHandle,
        analysis: { structured: analysis, analyzed_at: new Date().toISOString() },
      })

      const { data: clientData } = await supabase
        .from('clients')
        .select('competitor_insights')
        .eq('id', selectedClientId)
        .single()

      const existingInsights = clientData?.competitor_insights || ''
      const newInsights = `\n\n--- ${competitorHandle || 'transcript'} (${platform}) - ${new Date().toLocaleDateString()} ---\n${analysisToText(analysis)}`

      await supabase
        .from('clients')
        .update({ competitor_insights: existingInsights + newInsights })
        .eq('id', selectedClientId)

      setSaved(true)
      clearHandle()
      clearTranscript()
      setAnalysis(null)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Save error:', err)
      setError('Failed to save insights')
    } finally {
      setIsSaving(false)
    }
  }

  function CompetitorSkeleton() {
    return (
      <Card className="mb-6 animate-in fade-in">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-48" />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Header
        title="Competitor Breakdown"
        subtitle="Paste a competitor script. Get a full breakdown + plug-in formulas for your client."
      />
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        {error && (
          <Card className="border-red-200 bg-red-50 animate-in fade-in">
            <CardContent className="py-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <CompetitorSkeleton />
        ) : (
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Analyze a Script</h3>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">
                Paste the full transcript of a high-performing video. We break it down line by line
                and pull out what your client can plug into their own content today.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Client</label>
                  <ClientPicker
                    clients={clients}
                    value={selectedClientId}
                    onChange={(id) => setSelectedClientId(id)}
                    placeholder="Choose client…"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Platform</label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  >
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                    <option value="youtube">YouTube</option>
                    <option value="linkedin">LinkedIn</option>
                  </select>
                </div>
                <Input
                  label="Competitor Handle (optional)"
                  value={competitorHandle}
                  onChange={(e) => setCompetitorHandle(e.target.value)}
                  placeholder="@competitor or URL"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  Script / Transcript
                </label>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={10}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] placeholder:text-[var(--text-tertiary)] text-sm resize-y"
                  placeholder="Paste the full transcript or script here…"
                />
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Used as inspiration only - we never copy sentences into your client&apos;s content.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={handleAnalyze}
                  isLoading={isAnalyzing}
                  disabled={!selectedClientId || !transcript.trim()}
                >
                  <Search className="h-5 w-5 mr-2" />
                  Break Down Script
                </Button>
                {analysis && (
                  <Button variant="outline" onClick={handleSaveToClient} isLoading={isSaving}>
                    {saved ? (
                      <>
                        <CheckCircle className="h-5 w-5 mr-2" />
                        Saved!
                      </>
                    ) : (
                      <>
                        <Save className="h-5 w-5 mr-2" />
                        Save to Client Profile
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {isAnalyzing && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#2B79F7] mx-auto mb-4" />
              <p className="text-[var(--text-secondary)]">Breaking down the script…</p>
              <p className="text-sm text-[var(--text-tertiary)] mt-2">This usually takes 10-30 seconds.</p>
            </CardContent>
          </Card>
        )}

        {analysis && !isAnalyzing && <AnalysisView a={analysis} />}

        {!analysis && !isAnalyzing && !isLoading && (
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">How It Works</h3>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { n: 1, title: 'Paste the script', sub: "Full transcript from a competitor's best video" },
                  { n: 2, title: 'Get a full breakdown', sub: 'Hook, structure, CTA, good/bad - scored' },
                  { n: 3, title: 'Steal what works', sub: "Plug-in formulas and new angles for your client's scripts" },
                ].map((s) => (
                  <div key={s.n} className="text-center">
                    <div className="h-12 w-12 rounded-full bg-[#E8F1FF] flex items-center justify-center mx-auto mb-3">
                      <span className="text-[#2B79F7] font-bold">{s.n}</span>
                    </div>
                    <h4 className="font-medium text-[var(--text-primary)]">{s.title}</h4>
                    <p className="text-sm text-[var(--text-tertiary)] mt-1">{s.sub}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

function Rating({ value }: { value: number }) {
  const color =
    value >= 8 ? 'bg-green-100 text-green-700' : value >= 5 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {value}/10
    </span>
  )
}

function BulletList({ items, variant = 'default' }: { items: string[]; variant?: 'good' | 'bad' | 'default' }) {
  if (!items.length) return null
  const dot =
    variant === 'good' ? 'bg-green-500' : variant === 'bad' ? 'bg-red-500' : 'bg-gray-400'
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-[var(--text-secondary)]">
          <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function AnalysisView({ a }: { a: CompetitorAnalysis }) {
  return (
    <div className="space-y-6 animate-in fade-in-up duration-300">
      {a.summary && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Summary</h3>
          </CardHeader>
          <CardContent>
            <p className="text-[var(--text-secondary)] leading-relaxed">{a.summary}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Hook</h3>
              {a.hook.rating > 0 && <Rating value={a.hook.rating} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {a.hook.text && (
              <blockquote className="border-l-4 border-[#2B79F7] bg-[#F5F9FF] p-3 text-sm italic text-[var(--text-primary)]">
                &ldquo;{a.hook.text}&rdquo;
              </blockquote>
            )}
            {a.hook.why_it_works.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-green-700 mb-2">
                  <ThumbsUp className="h-4 w-4" /> Why it works
                </div>
                <BulletList items={a.hook.why_it_works} variant="good" />
              </div>
            )}
            {a.hook.weaknesses.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-red-700 mb-2">
                  <ThumbsDown className="h-4 w-4" /> Weaknesses
                </div>
                <BulletList items={a.hook.weaknesses} variant="bad" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">CTA</h3>
              {a.cta.rating > 0 && <Rating value={a.cta.rating} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {a.cta.text && (
              <blockquote className="border-l-4 border-[#2B79F7] bg-[#F5F9FF] p-3 text-sm italic text-[var(--text-primary)]">
                &ldquo;{a.cta.text}&rdquo;
              </blockquote>
            )}
            {a.cta.why_it_works.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-green-700 mb-2">
                  <ThumbsUp className="h-4 w-4" /> Why it works
                </div>
                <BulletList items={a.cta.why_it_works} variant="good" />
              </div>
            )}
            {a.cta.weaknesses.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-red-700 mb-2">
                  <ThumbsDown className="h-4 w-4" /> Weaknesses
                </div>
                <BulletList items={a.cta.weaknesses} variant="bad" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Structure</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            {a.structure.pillar && (
              <span className="px-3 py-1 rounded-full bg-[#E8F1FF] text-[#2B79F7] font-medium">
                {a.structure.pillar}
              </span>
            )}
            {a.structure.pacing && (
              <span className="px-3 py-1 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                {a.structure.pacing}
              </span>
            )}
          </div>
          {a.structure.beats.length > 0 && (
            <ol className="space-y-3">
              {a.structure.beats.map((b, i) => (
                <li key={i} className="flex gap-3">
                  <div className="h-7 w-7 rounded-full bg-[#2B79F7] text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{b.label}</div>
                    <div className="text-sm text-[var(--text-secondary)]">{b.text}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {(a.voice.tone || a.voice.notable_patterns.length > 0) && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Voice</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            {a.voice.tone && <p className="text-sm text-[var(--text-secondary)]">{a.voice.tone}</p>}
            {a.voice.notable_patterns.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)] mb-2">Notable patterns</div>
                <BulletList items={a.voice.notable_patterns} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-green-50 border-green-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ThumbsUp className="h-5 w-5 text-green-600" />
              <h3 className="text-lg font-semibold text-green-900">What Works</h3>
            </div>
          </CardHeader>
          <CardContent>
            <BulletList items={a.what_works} variant="good" />
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ThumbsDown className="h-5 w-5 text-red-600" />
              <h3 className="text-lg font-semibold text-red-900">What Doesn&apos;t Work</h3>
            </div>
          </CardHeader>
          <CardContent>
            <BulletList items={a.what_doesnt_work} variant="bad" />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#F5F9FF] border-[#B3D1FF]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Takeaways for Your Client</h3>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Plug these into your client&apos;s next scripts.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <TakeawayBlock title="Hook Formulas" items={a.takeaways_for_client.hook_formulas} />
          <TakeawayBlock title="CTA Formulas" items={a.takeaways_for_client.cta_formulas} />
          <TakeawayBlock title="Structural Moves" items={a.takeaways_for_client.structural_moves} />
          <TakeawayBlock title="New Angles" items={a.takeaways_for_client.new_angles} />
        </CardContent>
      </Card>
    </div>
  )
}

function TakeawayBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] mb-2">
        <Lightbulb className="h-4 w-4 text-[#2B79F7]" />
        {title}
      </div>
      <ul className="space-y-1.5 pl-2">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-[var(--text-secondary)] leading-relaxed">
            <span className="text-[#2B79F7] font-semibold mr-2">•</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
