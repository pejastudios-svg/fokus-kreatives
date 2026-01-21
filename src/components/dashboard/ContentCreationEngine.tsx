'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Sparkles, FileText, Film, LayoutGrid, MessageCircle, Zap, Copy, Check, RefreshCw, Plus, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface Client {
  id: string
  name: string
  business_name: string
  industry: string
  target_audience: string
  brand_doc_text: string
  dos_and_donts: string
  topics_library: string
  key_stories: string
  unique_mechanisms: string
  social_proof: string
  competitor_insights: string
  content_tier: 'beginner' | 'mid' | 'advanced'
}

type ClientCTA = {
  id: string
  client_id: string
  name: string
  keyword: string
  cta_text: string
  active: boolean
  created_at: string
}

const contentTypes = [
  { id: 'longform', name: 'Long-form Script', icon: FileText, description: '10-12 min videos' },
  { id: 'shortform', name: 'Short-form Script', icon: Film, description: '45-60 sec videos' },
  { id: 'carousel', name: 'Carousel', icon: LayoutGrid, description: '10-slide posts' },
  { id: 'story', name: 'Story Post', icon: MessageCircle, description: '3-part stories' },
  { id: 'engagement', name: 'Engagement Reel', icon: Zap, description: 'Viral reels' },
]

const contentPillars = [
  { id: 'educational', name: 'Educational', description: 'Tips, tutorials, mistakes' },
  { id: 'storytelling', name: 'Storytelling', description: 'Journey, challenges, wins' },
  { id: 'authority', name: 'Authority', description: 'Case studies, transformations' },
  { id: 'series', name: 'Series', description: 'Multi-part content' },
  { id: 'doubledown', name: 'Double Down', description: 'Expand proven content' },
]

function normalizeKeyword(k: string) {
  return (k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function extractPublishingPack(raw: string) {
  const packStart = raw.indexOf('--- PUBLISHING PACK ---')
  if (packStart === -1) return null

  const pack = raw.slice(packStart)

  const tiktokMatch = pack.match(/📱 TIKTOK CAPTION:\s*([\s\S]*?)\n\n📸 INSTAGRAM CAPTION:/)
  const igMatch = pack.match(/📸 INSTAGRAM CAPTION:\s*([\s\S]*?)\n\n#️⃣ HASHTAGS:/)
  const hashMatch = pack.match(/#️⃣ HASHTAGS:\s*([\s\S]*?)(?:\n={5,}|\n-----|\n$)/)

  const tiktok = (tiktokMatch?.[1] || '').trim()
  const instagram = (igMatch?.[1] || '').trim()
  const hashtagsRaw = (hashMatch?.[1] || '').trim()

  const hashtags = hashtagsRaw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('#'))

  return {
    tiktok_caption: tiktok || null,
    instagram_caption: instagram || null,
    hashtags,
  }
}

function renderCtaText(keyword: string, text: string) {
  const kw = normalizeKeyword(keyword)
  const t = (text || '').trim()
  if (!t) return ''

  let out = t

  // Replace {KEYWORD}
  if (kw) out = out.replaceAll('{KEYWORD}', kw)

  // Replace {CONTENT} (or {GUIDE}, etc) i.e. {<keyword>}
  if (kw) {
    const token = new RegExp(`\\{\\s*${kw}\\s*\\}`, 'gi')
    out = out.replace(token, kw)
  }

  return out
}

export function ContentCreationEngine() {
  const supabase = useMemo(() => createClient(), [])

  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const selectedClient = useMemo(
    () => clients.find(c => c.id === selectedClientId) || null,
    [clients, selectedClientId]
  )

  const [selectedType, setSelectedType] = useState('')
  const [selectedPillar, setSelectedPillar] = useState('')
  const [recommendedPillars, setRecommendedPillars] = useState<string[]>([])

  const [ideaInput, setIdeaInput] = useState('')
  const [quantity, setQuantity] = useState(1)

  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  // CTA library
  const [ctas, setCtas] = useState<ClientCTA[]>([])
  const [includeCta, setIncludeCta] = useState(true)
  const [selectedCtaId, setSelectedCtaId] = useState<string>('')
  const selectedCta = useMemo(
    () => ctas.find(c => c.id === selectedCtaId) || null,
    [ctas, selectedCtaId]
  )

  // Custom CTA (one-off)
  const [customKeyword, setCustomKeyword] = useState('')
  const [customCtaText, setCustomCtaText] = useState('')

  // CTA modal (save to library)
  const [showCtaModal, setShowCtaModal] = useState(false)
  const [ctaName, setCtaName] = useState('')
  const [ctaKeyword, setCtaKeyword] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [ctaSaving, setCtaSaving] = useState(false)
  const [ctaDeletingId, setCtaDeletingId] = useState<string | null>(null)
  const [includeMeta, setIncludeMeta] = useState(true)

  useEffect(() => {
  if (selectedType === 'story') setIncludeMeta(false)
  else setIncludeMeta(true)
}, [selectedType])

  useEffect(() => {
    if (!selectedClient) {
      setCtas([])
      setSelectedCtaId('')
      setRecommendedPillars([])
      return
    }

    // Tier -> recommended pillar (auto-select, but user can override)
    const tier = selectedClient.content_tier || 'beginner'
    const tierToPillars: Record<typeof tier, string[]> = {
  beginner: ['educational', 'storytelling'],
  mid: ['educational', 'storytelling'],
  advanced: ['educational', 'storytelling', 'authority'],
}

const rec = tierToPillars[tier] || ['educational', 'storytelling']
setRecommendedPillars(rec)

// auto-select first recommended if user hasn't picked anything yet
if (!selectedPillar) setSelectedPillar(rec[0])

    loadClientCtas(selectedClient.id)
  }, [selectedClientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchClients = useCallback(async () => {
  const { data, error } = await supabase
    .from('clients')
    .select(
      'id,name,business_name,industry,target_audience,brand_doc_text,dos_and_donts,topics_library,key_stories,unique_mechanisms,social_proof,competitor_insights,content_tier'
    )
    .order('name')

  if (error) {
    console.error('fetchClients error:', error)
    return
  }

  const rows = (data || []) as Client[]
  setClients(rows)

  const storedClientId = sessionStorage.getItem('selectedClientId')
  if (storedClientId && rows.some((c) => c.id === storedClientId)) {
    setSelectedClientId(storedClientId)
    sessionStorage.removeItem('selectedClientId')
  }
}, [supabase])

useEffect(() => {
  fetchClients()
}, [fetchClients])

  const loadClientCtas = async (clientId: string) => {
    const { data, error } = await supabase
      .from('client_ctas')
      .select('*')
      .eq('client_id', clientId)
      .eq('active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Load CTAs error:', error)
      setCtas([])
      return
    }

    setCtas((data || []) as ClientCTA[])
  }

  const buildClientContext = (client: Client) => {
    let context = ''

    context += `CLIENT: ${client.name} from ${client.business_name}\n`
    if (client.industry) context += `INDUSTRY: ${client.industry}\n`
    if (client.target_audience) context += `TARGET AUDIENCE: ${client.target_audience}\n\n`

    if (client.brand_doc_text) context += `BRAND GUIDELINES:\n${client.brand_doc_text}\n\n`
    if (client.dos_and_donts) context += `CONTENT RULES (MUST FOLLOW):\n${client.dos_and_donts}\n\n`
    if (client.topics_library) context += `TOPICS LIBRARY:\n${client.topics_library}\n\n`

    // Stories must come from here (no fabricated proof)
    if (client.key_stories) context += `KEY STORIES (USE THESE, DO NOT INVENT RESULTS):\n${client.key_stories}\n\n`

    if (client.unique_mechanisms) context += `UNIQUE METHODS/FRAMEWORKS:\n${client.unique_mechanisms}\n\n`
    if (client.social_proof) context += `PROOF/RESULTS (ONLY IF PRESENT, DO NOT INVENT):\n${client.social_proof}\n\n`
    if (client.competitor_insights) context += `COMPETITOR INSIGHTS:\n${client.competitor_insights}\n\n`

    return context.trim() || 'General business helping clients succeed.'
  }

  const computedCtaText = useMemo(() => {
    // Priority: selected saved CTA > custom CTA
    if (selectedCta) {
      return renderCtaText(selectedCta.keyword, selectedCta.cta_text)
    }
    if (customCtaText.trim()) {
      return renderCtaText(customKeyword, customCtaText)
    }
    return ''
  }, [selectedCta, customKeyword, customCtaText])

  const finalCtaText = includeCta ? computedCtaText.trim() : ''

  const handleGenerate = async () => {
    if (!selectedClient) {
      setError('Please select a client first')
      return
    }
    if (!selectedType) {
      setError('Please select a content type')
      return
    }
    if (!selectedPillar) {
      setError('Please select a content pillar')
      return
    }

    setIsGenerating(true)
    setError('')
    setGeneratedContent('')

    try {
      const clientContext = buildClientContext(selectedClient)

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          includeMeta,
          clientInfo: clientContext,
          contentType: contentTypes.find(t => t.id === selectedType)?.name || selectedType,
          contentPillar: contentPillars.find(p => p.id === selectedPillar)?.name || selectedPillar,
          idea: ideaInput,
          quantity,
          competitorInsights: selectedClient.competitor_insights || '',
          tier: selectedClient.content_tier || 'beginner',
          // IMPORTANT: if empty => API will omit CTA block entirely
          ctaText: finalCtaText ? finalCtaText : null,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setGeneratedContent(data.content)

        const publishingPack = extractPublishingPack(data.content)

await supabase.from('content').insert({
  client_id: selectedClient.id,
  content_type: selectedType,
  content_pillar: selectedPillar,
  content_type_label: contentTypes.find(t => t.id === selectedType)?.name || selectedType,
  content_pillar_label: contentPillars.find(p => p.id === selectedPillar)?.name || selectedPillar,
  tier: selectedClient.content_tier || 'beginner',
  include_meta: includeMeta,
  cta_text: finalCtaText || null,
  cta_keyword: (selectedCta?.keyword || customKeyword || null),
  script: data.content,
  idea_input: ideaInput,
  publishing_pack: publishingPack,
})
      } else {
        setError(data.error || 'Failed to generate content')
      }
    } catch (err) {
      console.error('Generation error:', err)
      setError('Failed to connect to AI service. Check GROQ_API_KEY in .env.local')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openSaveCtaModal = () => {
    // Pre-fill modal with currently typed custom CTA if present
    setCtaName('')
    setCtaKeyword(normalizeKeyword(customKeyword))
    setCtaText(customCtaText)
    setShowCtaModal(true)
  }

  const saveCtaToLibrary = async () => {
    if (!selectedClient) return
    const kw = normalizeKeyword(ctaKeyword)
    const txt = (ctaText || '').trim()
    if (!kw) {
      alert('Keyword is required (A-Z / 0-9, max 8 chars).')
      return
    }
    if (!txt) {
      alert('CTA text is required.')
      return
    }

    setCtaSaving(true)
    try {
      const { data, error } = await supabase
  .from('client_ctas')
  .insert({
    client_id: selectedClient.id,
    name: (ctaName || kw).trim(),
    keyword: kw,
    cta_text: txt,
    active: true,
  })
  .select()
  .single()

      if (error) {
        console.error('Save CTA error:', error)
        alert(error.message || 'Failed to save CTA')
        return
      }

      setShowCtaModal(false)
      setCtaName('')
      setCtaKeyword('')
      setCtaText('')
      await loadClientCtas(selectedClient.id)
      if (data?.id) setSelectedCtaId(data.id)
    } finally {
      setCtaSaving(false)
    }
  }

  const deleteCta = async (id: string) => {
    if (!selectedClient) return
    const ok = confirm('Delete this CTA from the library?')
    if (!ok) return

    setCtaDeletingId(id)
    try {
      const { error } = await supabase.from('client_ctas').delete().eq('id', id)
      if (error) {
        console.error('Delete CTA error:', error)
        alert(error.message || 'Failed to delete')
        return
      }
      if (selectedCtaId === id) setSelectedCtaId('')
      await loadClientCtas(selectedClient.id)
    } finally {
      setCtaDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Client Selection */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Select Client</h3>
        </CardHeader>
        <CardContent>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent"
          >
            <option value="">Choose a client...</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} - {client.business_name}
              </option>
            ))}
          </select>

          {selectedClient && (
            <div className="mt-4 p-4 bg-[#E8F1FF] rounded-lg">
              <p className="text-sm text-[#2B79F7]">
                <strong>Tier:</strong> {selectedClient.content_tier || 'beginner'} ·{' '}
                <strong>Industry:</strong> {selectedClient.industry || 'Not set'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content Type */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Content Type</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {contentTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-200 ${
                  selectedType === type.id
                    ? 'border-[#2B79F7] bg-[#E8F1FF] text-[#2B79F7]'
                    : 'border-gray-200 hover:border-[#5A9AFF] text-gray-600'
                }`}
              >
                <type.icon className="h-6 w-6" />
                <span className="text-sm font-medium text-center">{type.name}</span>
                <span className="text-xs text-gray-400">{type.description}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Content Pillar */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Content Pillar</h3>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-500 mb-3">
            Recommended pillar is highlighted based on client tier. You can still change it.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {contentPillars.map((pillar) => {
              const isRecommended = recommendedPillars.includes(pillar.id)
              const isSelected = selectedPillar === pillar.id
              return (
                <button
                  key={pillar.id}
                  onClick={() => setSelectedPillar(pillar.id)}
                  className={`flex flex-col items-start p-4 rounded-lg border-2 transition-all duration-200 ${
                    isSelected
                      ? 'border-[#2B79F7] bg-[#E8F1FF]'
                      : isRecommended
                        ? 'border-[#5A9AFF] bg-[#E8F1FF]/40'
                        : 'border-gray-200 hover:border-[#5A9AFF]'
                  }`}
                >
                  <span className={`text-sm font-semibold ${isSelected ? 'text-[#2B79F7]' : 'text-gray-900'}`}>
                    {pillar.name}
                    {isRecommended && !isSelected && <span className="ml-2 text-[10px] text-[#2B79F7]">(recommended)</span>}
                  </span>
                  <span className="text-xs text-gray-500 mt-1">{pillar.description}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quantity */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Quantity</h3>
        </CardHeader>
        <CardContent>
          <Input
            label="How many scripts?"
            type="number"
            min={1}
            max={10}
            value={String(quantity)}
            onChange={(e) => setQuantity(Math.max(1, Math.min(10, parseInt(e.target.value || '1', 10))))}
          />
          <p className="text-xs text-gray-500 mt-2">
            Note: very large batches can hit model limits. Start with 1–3.
          </p>
        </CardContent>
      </Card>

      {/* Specific Idea */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Specific Topic / Idea (Optional)</h3>
        </CardHeader>
        <CardContent>
          <textarea
            value={ideaInput}
            onChange={(e) => setIdeaInput(e.target.value)}
            placeholder="Type the exact topic/angle you want..."
            rows={4}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none"
          />
        </CardContent>
      </Card>

      {/* CTA */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">CTA (Optional)</h3>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeCta}
                onChange={(e) => setIncludeCta(e.target.checked)}
              />
              Include CTA
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Use saved CTA (keyword-controlled)
            </label>
            <select
              value={selectedCtaId}
              onChange={(e) => setSelectedCtaId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            >
              <option value="">No saved CTA</option>
              {ctas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.keyword} — {normalizeKeyword(c.keyword)}
                </option>
              ))}
            </select>

            {selectedCta && (
              <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 mb-1">
                  Keyword: <span className="font-semibold text-gray-700">{normalizeKeyword(selectedCta.keyword)}</span>
                </p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {renderCtaText(selectedCta.keyword, selectedCta.cta_text)}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => deleteCta(selectedCta.id)} isLoading={ctaDeletingId === selectedCta.id}>
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Or type a custom CTA (one-off)</p>

            <Input
              label="Keyword (used by ManyChat)"
              value={customKeyword}
              onChange={(e) => setCustomKeyword(normalizeKeyword(e.target.value))}
              placeholder="LOOP, GUIDE, AUDIT..."
            />

            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CTA text (optional)
              </label>
              <textarea
                value={customCtaText}
                onChange={(e) => setCustomCtaText(e.target.value)}
                rows={3}
                placeholder='Example: Comment "{KEYWORD}" and I’ll send you 10 open-loop scripts.'
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Tip: use <code>{'{KEYWORD}'}</code> placeholder to guarantee the exact keyword appears in the CTA.
              </p>
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openSaveCtaModal}
                disabled={!selectedClientId}
              >
                <Plus className="h-4 w-4 mr-1" /> Save to CTA Library
              </Button>
            </div>

            {!finalCtaText && includeCta && (
              <p className="text-xs text-gray-500 mt-2">
                CTA is enabled but empty — the AI will omit the CTA section entirely.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Generate */}
      <div className="flex justify-center pt-2">
        <Button
          size="lg"
          onClick={handleGenerate}
          isLoading={isGenerating}
          disabled={!selectedClientId || !selectedType || !selectedPillar}
          className="px-12"
        >
          <Sparkles className="h-5 w-5 mr-2" />
          {isGenerating ? 'Generating...' : 'Generate Content'}
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <p className="text-red-600 text-center">{error}</p>
          </CardContent>
        </Card>
      )}

      {generatedContent && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Generated Content</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isGenerating}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
                Regenerate
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" /> Copy All
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap bg-gray-50 p-6 rounded-lg text-sm text-gray-800 overflow-auto max-h-[800px] font-sans leading-relaxed">
              {generatedContent}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Save CTA Modal */}
      {showCtaModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Save CTA to Library</h3>
                <button onClick={() => setShowCtaModal(false)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input label="Name (optional)" value={ctaName} onChange={(e) => setCtaName(e.target.value)} placeholder="e.g. Free scripts CTA" />
              <Input label="Keyword (required)" value={ctaKeyword} onChange={(e) => setCtaKeyword(normalizeKeyword(e.target.value))} placeholder="LOOP" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CTA Text (required)</label>
                <textarea
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                  placeholder='Comment "{KEYWORD}" and I’ll send you...'
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowCtaModal(false)}>Cancel</Button>
                <Button onClick={saveCtaToLibrary} isLoading={ctaSaving}>Save CTA</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}