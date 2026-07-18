'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import {
  FileText,
  Film,
  LayoutGrid,
  MessageCircle,
  Zap,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Trash2,
  X,
  History,
  Save,
  BookOpen,
  Search,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { BrandProfile, defaultBrandProfile } from '../clients/brandProfile'
import { Skeleton } from '@/components/ui/Loading'
import { ScriptReviewer, type ScriptKind } from '@/components/ui/ScriptReviewer'
import { ClientPicker } from './ClientPicker'
import { readStashedClientId, useApplyClientPreselect } from '@/hooks/useClientPreselect'
import { useFormPersistence } from '@/hooks/useFormPersistence'
import {
  buildExternalPrompt,
  type ExternalFormat,
} from '@/lib/prompt/external'

interface Client {
  id: string
  name: string
  business_name: string
  profile_picture_url?: string | null
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand_profile?: any
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

type SavedScript = {
  id: string
  title: string | null
  script: string
  created_at: string
  content_pillar: string
  content_type: string
  idea_input: string
}

const contentTypes = [
  { id: 'Long-form Script', name: 'Long-form', icon: FileText, description: '10–12 min videos' },
  { id: 'Short-form Script', name: 'Short-form', icon: Film, description: '45–60 sec videos' },
  { id: 'Carousel', name: 'Carousel', icon: LayoutGrid, description: '10-slide posts' },
  { id: 'Story Post', name: 'Story Post', icon: MessageCircle, description: '3-part stories' },
  { id: 'Engagement Reel', name: 'Engagement', icon: Zap, description: 'Viral reels' },
]

function typeIdToScriptKind(id: string): ScriptKind {
  switch (id) {
    case 'Long-form Script':
      return 'longform'
    case 'Short-form Script':
      return 'short'
    case 'Carousel':
      return 'carousel'
    case 'Story Post':
      return 'story'
    case 'Engagement Reel':
      return 'engagement'
    default:
      return 'short'
  }
}

function typeIdToExternalFormat(id: string): ExternalFormat {
  switch (id) {
    case 'Long-form Script':
      return 'longform'
    case 'Short-form Script':
      return 'short'
    case 'Carousel':
      return 'carousel'
    case 'Story Post':
      return 'story'
    case 'Engagement Reel':
      return 'engagement'
    default:
      return 'short'
  }
}


const contentPillars = [
  { id: 'educational', name: 'Educational', description: 'Tips, tutorials, mistakes' },
  { id: 'storytelling', name: 'Storytelling', description: 'Journey, challenges, wins' },
  { id: 'authority', name: 'Authority', description: 'Case studies, transformations' },
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
  if (kw) {
    out = out.replaceAll('{KEYWORD}', kw)
    const token = new RegExp(`\\{\\s*${kw}\\s*\\}`, 'gi')
    out = out.replace(token, kw)
  }
  return out
}

function extractRecommendedTitle(script: string, fallback: string): string {
  const m = script.match(/\[TITLE\]\s*\n+\s*(.+)/i)
  if (m && m[1]) {
    return m[1].replace(/^[#*"']+|[#*"']+$/g, '').trim().slice(0, 120)
  }
  const firstLine = script.split('\n').map((l) => l.trim()).find(Boolean) || ''
  if (firstLine && firstLine.length < 140) return firstLine.replace(/^[#*"']+|[#*"']+$/g, '').trim()
  const words = (fallback || '').split(/\s+/).filter(Boolean).slice(0, 10).join(' ')
  return words || 'Untitled'
}

export function ContentCreationEngine() {
  const supabase = useMemo(() => createClient(), [])

  const [isLoading, setIsLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState(readStashedClientId)
  useApplyClientPreselect(selectedClientId, setSelectedClientId, clients)
  const [selectedClientProfile, setSelectedClientProfile] = useState<BrandProfile | null>(null)

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  )

  const [selectedType, setSelectedType] = useFormPersistence('content:type', 'Short-form Script')
  const [selectedPillar, setSelectedPillar] = useFormPersistence('content:pillar', 'educational')
  const [recommendedPillars, setRecommendedPillars] = useState<string[]>([])

  const [ideaInput, setIdeaInput] = useFormPersistence('content:idea', '')

  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useFormPersistence('content:generated', '')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  // Title state
  const [recommendedTitle, setRecommendedTitle] = useFormPersistence('content:recTitle', '')
  const [customTitle, setCustomTitle] = useFormPersistence('content:customTitle', '')
  const [useCustomTitle, setUseCustomTitle] = useFormPersistence('content:useCustomTitle', false)
  const [isSaving, setIsSaving] = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)

  // CTA library
  const [ctas, setCtas] = useState<ClientCTA[]>([])
  const [includeCta, setIncludeCta] = useFormPersistence('content:includeCta', true)
  const [selectedCtaId, setSelectedCtaId] = useFormPersistence('content:ctaId', '')

  // Custom CTA
  const [customKeyword, setCustomKeyword] = useFormPersistence('content:customKw', '')
  const [customCtaText, setCustomCtaText] = useFormPersistence('content:customCtaText', '')

  // Modal States
  const [showCtaModal, setShowCtaModal] = useState(false)
  const [ctaName, setCtaName] = useState('')
  const [ctaKeyword, setCtaKeyword] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [ctaSaving, setCtaSaving] = useState(false)
  const [ctaDeletingId, setCtaDeletingId] = useState<string | null>(null)

  // Reference Script State
  const [showRefModal, setShowRefModal] = useState(false)
  const [referenceScript, setReferenceScript] = useFormPersistence<SavedScript | null>(
    'content:ref',
    null,
  )
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([])
  const [bankSearch, setBankSearch] = useState('')
  const [deletingScriptId, setDeletingScriptId] = useState<string | null>(null)
  const [pendingScriptDeleteId, setPendingScriptDeleteId] = useState<string | null>(null)
  const [pendingCtaDeleteId, setPendingCtaDeleteId] = useState<string | null>(null)

  const [includeMeta, setIncludeMeta] = useFormPersistence('content:includeMeta', true)

  // Double-Down external-prompt flow (Series moved to its own dashboard tab)
  const [externalPrompt, setExternalPrompt, clearExternalPrompt] = useFormPersistence(
    'content:externalPrompt',
    '',
  )
  const [externalCopied, setExternalCopied] = useState(false)

  // 'series' is intentionally absent here - it has its own dashboard tab
  // (Series Form) that runs the per-entry intake flow. Double Down stays.
  const isExternalPillar = selectedPillar === 'doubledown'
  const needsReference = selectedPillar === 'doubledown'

  // Old sessions may have 'series' stashed as the selected pillar - reset once
  // on mount so the user doesn't land on a pillar with no matching button.
  const didCheckLegacyPillarRef = useRef(false)
  useEffect(() => {
    if (didCheckLegacyPillarRef.current) return
    didCheckLegacyPillarRef.current = true
    if (selectedPillar === 'series') setSelectedPillar('educational')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-derive includeMeta from selectedType, but skip on initial mount so a
  // restored value isn't immediately overwritten.
  const didMountTypeRef = useRef(false)
  useEffect(() => {
    if (!didMountTypeRef.current) {
      didMountTypeRef.current = true
      return
    }
    if (selectedType === 'Story Post') setIncludeMeta(false)
    else setIncludeMeta(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType])

  // Drop the external prompt when the user switches off series/doubledown so we
  // don't leave a stale prompt visible. Skip on initial mount so a restored
  // prompt isn't wiped just because the pillar was already non-external.
  const didMountPillarRef = useRef(false)
  useEffect(() => {
    if (!didMountPillarRef.current) {
      didMountPillarRef.current = true
      return
    }
    if (selectedPillar !== 'series' && selectedPillar !== 'doubledown') {
      setExternalPrompt('')
      clearExternalPrompt()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPillar])

  const fetchClients = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('clients').select('*').order('name')
      if (error) console.error('fetchClients error:', error)
      if (data) setClients(data as Client[])
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  const loadClientCtas = useCallback(
    async (clientId: string) => {
      const { data } = await supabase
        .from('client_ctas')
        .select('*')
        .eq('client_id', clientId)
        .eq('active', true)
        .order('created_at', { ascending: false })
      setCtas((data || []) as ClientCTA[])
    },
    [supabase],
  )

  const loadSavedScripts = useCallback(
    async (clientId: string) => {
      const { data } = await supabase
        .from('content')
        .select('id, title, script, created_at, content_pillar, content_type, idea_input')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (data) setSavedScripts(data as SavedScript[])
    },
    [supabase],
  )

  const didInitClientRef = useRef(false)
  useEffect(() => {
    const isFirstRun = !didInitClientRef.current
    didInitClientRef.current = true

    if (!selectedClient) {
      setCtas([])
      // Only clear CTA selection on real client transitions, not on the very first
      // render where clients are still loading and we'd wipe a restored selection.
      if (!isFirstRun) {
        setSelectedCtaId('')
        setExternalPrompt('')
        clearExternalPrompt()
      }
      setRecommendedPillars([])
      setSavedScripts([])
      return
    }

    // Real client change: drop any prompt baked with the previous client's info.
    if (!isFirstRun) {
      setExternalPrompt('')
      clearExternalPrompt()
    }

    const baseProfile = defaultBrandProfile()
    const profile: BrandProfile = selectedClient.brand_profile || {
      ...baseProfile,
      business: {
        ...baseProfile.business,
        problem_solved: selectedClient.brand_doc_text || '',
      },
      audience: {
        ...baseProfile.audience,
        work_roles: selectedClient.target_audience || 'Professionals',
        pain_points: [selectedClient.target_audience || '', '', '', '', ''],
      },
      voice: {
        ...baseProfile.voice,
        traits: selectedClient.dos_and_donts || 'Professional',
      },
      final: {
        ...baseProfile.final,
        anything_else: `
          Topics Library: ${selectedClient.topics_library || ''}
          Key Stories: ${selectedClient.key_stories || ''}
          Unique Mechanisms: ${selectedClient.unique_mechanisms || ''}
          Social Proof: ${selectedClient.social_proof || ''}
          Competitor Insights: ${selectedClient.competitor_insights || ''}
        `,
      },
    }
    setSelectedClientProfile(profile)

    const tier = selectedClient.content_tier || 'beginner'
    const tierToPillars: Record<typeof tier, string[]> = {
      beginner: ['educational', 'storytelling'],
      mid: ['educational', 'storytelling', 'doubledown'],
      advanced: ['educational', 'storytelling', 'authority', 'doubledown'],
    }
    const rec = tierToPillars[tier] || ['educational', 'storytelling']
    setRecommendedPillars(rec)

    loadClientCtas(selectedClient.id)
    loadSavedScripts(selectedClient.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, selectedClient, loadClientCtas, loadSavedScripts])

  const selectedCta = ctas.find((c) => c.id === selectedCtaId) || null

  const computedCtaText = useMemo(() => {
    if (selectedCta) return renderCtaText(selectedCta.keyword, selectedCta.cta_text)
    if (customCtaText.trim()) return renderCtaText(customKeyword, customCtaText)
    return ''
  }, [selectedCta, customKeyword, customCtaText])

  const finalCtaText = includeCta ? computedCtaText.trim() : ''

  const handleGenerate = async () => {
    if (!selectedClient || !selectedClientProfile) return setError('Please select a client first')
    if (!selectedType) return setError('Please select a content type')
    if (!selectedPillar) return setError('Please select a content pillar')
    if (needsReference && !referenceScript) return setError('Please select a reference script for this strategy.')

    setIsGenerating(true)
    setError('')
    setGeneratedContent('')
    setSavedOnce(false)

    try {
      const response = await fetch('/api/scripts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          clientProfile: selectedClientProfile,
          includeMeta,
          contentType: contentTypes.find((t) => t.id === selectedType)?.name || selectedType,
          contentPillar: contentPillars.find((p) => p.id === selectedPillar)?.id || selectedPillar,
          ideaInput,
          referenceScript: referenceScript?.script || null,
          tier: selectedClient.content_tier || 'beginner',
          ctaText: finalCtaText || null,
        }),
      })

      const data = await readJsonSafe(response)

      if (data.success) {
        setGeneratedContent(data.content)
        const rec = extractRecommendedTitle(data.content, ideaInput)
        setRecommendedTitle(rec)
        setCustomTitle(rec)
        setUseCustomTitle(false)
      } else {
        setError(data.error || 'Failed to generate content')
      }
    } catch (err) {
      console.error('Generation error:', err)
      setError('Failed to connect to AI service.')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleBuildPrompt = () => {
    if (!selectedClient || !selectedClientProfile) {
      setError('Please select a client first')
      return
    }
    if (!referenceScript) {
      setError('Please pick a reference script to mimic.')
      return
    }
    if (!isExternalPillar) return

    setError('')

    const prompt = buildExternalPrompt({
      clientProfile: selectedClientProfile,
      clientName: selectedClient.name,
      businessName: selectedClient.business_name,
      industry: selectedClient.industry,
      format: typeIdToExternalFormat(selectedType),
      pillar: 'doubledown',
      ctaText: finalCtaText || null,
      ideaInput: ideaInput || null,
      referenceScript: referenceScript.script,
    })

    setExternalPrompt(prompt)
  }

  const handleCopyExternalPrompt = async () => {
    if (!externalPrompt) return
    await navigator.clipboard.writeText(externalPrompt)
    setExternalCopied(true)
    setTimeout(() => setExternalCopied(false), 2000)
  }

  const handleSaveScript = async () => {
    if (!selectedClient || !generatedContent) return
    setIsSaving(true)
    try {
      const title = (useCustomTitle ? customTitle : recommendedTitle).trim() || 'Untitled'
      const publishingPack = extractPublishingPack(generatedContent)

      const { error } = await supabase.from('content').insert({
        client_id: selectedClient.id,
        title,
        content_type: selectedType,
        content_pillar: selectedPillar,
        content_type_label: contentTypes.find((t) => t.id === selectedType)?.name || selectedType,
        content_pillar_label: contentPillars.find((p) => p.id === selectedPillar)?.name || selectedPillar,
        tier: selectedClient.content_tier || 'beginner',
        include_meta: includeMeta,
        cta_text: finalCtaText || null,
        cta_keyword: selectedCta?.keyword || customKeyword || null,
        script: generatedContent,
        idea_input: ideaInput,
        publishing_pack: publishingPack,
      })

      if (error) {
        console.error('save script error:', error)
        setError('Failed to save script')
      } else {
        setSavedOnce(true)
        await loadSavedScripts(selectedClient.id)
        setTimeout(() => setSavedOnce(false), 2500)
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteScript = async (id: string) => {
    if (!selectedClient) return
    setDeletingScriptId(id)
    try {
      const { error } = await supabase.from('content').delete().eq('id', id)
      if (!error) {
        setSavedScripts((prev) => prev.filter((s) => s.id !== id))
        if (referenceScript?.id === id) setReferenceScript(null)
      }
    } finally {
      setDeletingScriptId(null)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openSaveCtaModal = () => {
    setCtaName('')
    setCtaKeyword(normalizeKeyword(customKeyword))
    setCtaText(customCtaText)
    setShowCtaModal(true)
  }

  const saveCtaToLibrary = async () => {
    if (!selectedClient) return
    const kw = normalizeKeyword(ctaKeyword)
    const txt = (ctaText || '').trim()
    if (!kw || !txt) return alert('Keyword and CTA text required.')

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

      if (error) throw error
      setShowCtaModal(false)
      setCtaName('')
      setCtaKeyword('')
      setCtaText('')
      await loadClientCtas(selectedClient.id)
      if (data?.id) setSelectedCtaId(data.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(msg)
    } finally {
      setCtaSaving(false)
    }
  }

  const deleteCta = async (id: string) => {
    if (!selectedClient) return
    setCtaDeletingId(id)
    try {
      await supabase.from('client_ctas').delete().eq('id', id)
      if (selectedCtaId === id) setSelectedCtaId('')
      await loadClientCtas(selectedClient.id)
    } finally {
      setCtaDeletingId(null)
    }
  }

  const filteredBankScripts = useMemo(() => {
    const q = bankSearch.trim().toLowerCase()
    if (!q) return savedScripts
    return savedScripts.filter(
      (s) =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.idea_input || '').toLowerCase().includes(q) ||
        (s.content_pillar || '').toLowerCase().includes(q),
    )
  }, [bankSearch, savedScripts])

  if (isLoading) {
    return <EngineSkeleton />
  }

  return (
    <div className="space-y-6 animate-in fade-in-up">
      {/* Client Selection. `relative z-30` here lifts the entire
          card (and the ClientPicker dropdown inside it) above the
          sibling Content Type card. Without this, both cards have
          equal stacking contexts created by their fade-in animation
          transform, and the later sibling (Content Type) wins by
          source order - which made the dropdown render BEHIND the
          Content Type tiles. */}
      <Card className="animate-in fade-in-up relative z-30">
        <CardHeader>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Select Client</h3>
        </CardHeader>
        <CardContent>
          <ClientPicker
            clients={clients.map((c) => ({
              id: c.id,
              name: c.name,
              business_name: c.business_name,
              profile_picture_url: c.profile_picture_url,
            }))}
            value={selectedClientId}
            onChange={setSelectedClientId}
            loading={isLoading}
            placeholder="Choose a client…"
          />

          {selectedClient && (
            <div className="mt-4 p-3 rounded-lg bg-[#E8F1FF] dark:bg-[#1E3A6F] animate-in fade-in">
              <p className="text-sm text-[#2B79F7] dark:text-[#93C5FD]">
                <strong className="capitalize">{selectedClient.content_tier || 'beginner'}</strong> tier
                {selectedClient.industry && <> · {selectedClient.industry}</>}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content Type - explicit z-10 so it sits BELOW the picker
          card above. */}
      <Card className="animate-in fade-in-up relative z-10">
        <CardHeader>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Content Type</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {contentTypes.map((type) => {
              const isSelected = selectedType === type.id
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setSelectedType(type.id)}
                  className={`group flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-center transition-all duration-200 active:scale-[0.97] ${
                    isSelected
                      ? 'border-[#2B79F7] bg-white dark:bg-[#1E2A41] text-[#2B79F7] dark:text-white shadow-premium'
                      : 'border-[var(--border-primary)] hover:border-[#5A9AFF] text-[var(--text-secondary)] dark:text-white hover:shadow-sm'
                  }`}
                >
                  <type.icon className={`h-6 w-6 transition-transform duration-200 ${isSelected ? 'scale-110' : 'group-hover:scale-105'}`} />
                  <span className="text-sm font-semibold">{type.name}</span>
                  <span className="text-xs text-[var(--text-tertiary)]">{type.description}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Content Pillar */}
      <Card className="animate-in fade-in-up">
        <CardHeader>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Content Pillar</h3>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">Recommended pillars are highlighted based on client tier.</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {contentPillars.map((pillar) => {
              const isRecommended = recommendedPillars.includes(pillar.id)
              const isSelected = selectedPillar === pillar.id
              return (
                <button
                  key={pillar.id}
                  type="button"
                  onClick={() => setSelectedPillar(pillar.id)}
                  className={`flex flex-col items-start text-left p-4 rounded-xl border-2 transition-all duration-200 active:scale-[0.97] ${
                    isSelected
                      ? 'border-[#2B79F7] bg-white dark:bg-[#1E2A41] shadow-premium'
                      : isRecommended
                        ? 'border-[#5A9AFF] bg-[#E8F1FF]/40 dark:bg-transparent hover:shadow-sm'
                        : 'border-[var(--border-primary)] hover:border-[#5A9AFF] hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className={`text-sm font-semibold ${isSelected ? 'text-[#2B79F7] dark:text-white' : 'text-[var(--text-primary)]'}`}>
                      {pillar.name}
                    </span>
                    {isRecommended && !isSelected && (
                      <span className="ml-auto text-[10px] font-medium text-[#2B79F7] bg-[var(--bg-card)] px-1.5 py-0.5 rounded-full">
                        rec
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-[var(--text-tertiary)] mt-0.5">{pillar.description}</span>
                </button>
              )
            })}
          </div>

          {needsReference && (
            <div className="mt-4 p-4 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-xl animate-in fade-in-up">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Select script to mimic</span>
                <Button size="sm" variant="outline" onClick={() => setShowRefModal(true)}>
                  <History className="h-4 w-4 mr-2" />
                  Browse Content Bank
                </Button>
              </div>

              {referenceScript ? (
                <div className="text-sm bg-[var(--bg-card)] p-3 border border-[var(--border-primary)] rounded-lg flex items-center justify-between gap-3 animate-in fade-in">
                  <span className="truncate">{referenceScript.title || referenceScript.idea_input.slice(0, 60)}</span>
                  <button
                    type="button"
                    onClick={() => setReferenceScript(null)}
                    className="p-1 hover:bg-red-500/10 rounded text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <p className="text-xs text-red-500">Please pick a reference script to continue.</p>
              )}
            </div>
          )}

        </CardContent>
      </Card>

      {/* Topic */}
      <Card className="animate-in fade-in-up">
        <CardHeader>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Topic / Idea</h3>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">Optional - type an angle or paste a draft to polish.</p>
        </CardHeader>
        <CardContent>
          <textarea
            value={ideaInput}
            onChange={(e) => setIdeaInput(e.target.value)}
            placeholder="Type the exact topic/angle you want... (Paste draft here to polish)"
            rows={4}
            className="w-full px-4 py-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
          />
        </CardContent>
      </Card>

      {/* CTA */}
      <Card className="animate-in fade-in-up">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Call to Action</h3>
            <Toggle checked={includeCta} onChange={setIncludeCta} label="Include CTA" />
          </div>
        </CardHeader>
        {includeCta && (
          <CardContent className="space-y-4 animate-in fade-in">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Saved CTA (keyword-controlled)</label>
              <select
                value={selectedCtaId}
                onChange={(e) => setSelectedCtaId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              >
                <option value="">No saved CTA</option>
                {ctas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.keyword} - {normalizeKeyword(c.keyword)}
                  </option>
                ))}
              </select>

              {selectedCta && (
                <div className="mt-2 p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-primary)] animate-in fade-in">
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">
                    Keyword: <span className="font-semibold text-[var(--text-secondary)]">{normalizeKeyword(selectedCta.keyword)}</span>
                  </p>
                  <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                    {renderCtaText(selectedCta.keyword, selectedCta.cta_text)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => setPendingCtaDeleteId(selectedCta.id)}
                    isLoading={ctaDeletingId === selectedCta.id}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
              <p className="text-sm font-medium text-[var(--text-secondary)]">Or type a custom CTA (one-off)</p>

              <Input
                label="Keyword"
                value={customKeyword}
                onChange={(e) => setCustomKeyword(normalizeKeyword(e.target.value))}
                placeholder="LOOP, GUIDE, AUDIT..."
              />

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">CTA text</label>
                <textarea
                  value={customCtaText}
                  onChange={(e) => setCustomCtaText(e.target.value)}
                  rows={3}
                  placeholder='Example: Comment "{KEYWORD}" and I&rsquo;ll send you 10 open-loop scripts.'
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                />
                <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                  Use <code>{'{KEYWORD}'}</code> to guarantee the keyword appears in the CTA.
                </p>
              </div>

              <Button variant="outline" size="sm" onClick={openSaveCtaModal} disabled={!selectedClientId}>
                <Plus className="h-4 w-4 mr-1" /> Save to CTA Library
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Generate Button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-center gap-3 pt-2 sticky bottom-4 z-10">
        {isExternalPillar ? (
          <Button
            size="lg"
            onClick={handleBuildPrompt}
            disabled={!selectedClientId || !selectedType || !selectedPillar}
            className="px-12 w-full sm:w-auto"
          >
            {externalPrompt ? 'Rebuild Prompt' : 'Build Prompt'}
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={!selectedClientId || !selectedType || !selectedPillar}
            className="px-12 w-full sm:w-auto"
          >
            {isGenerating ? 'Generating...' : 'Generate Content'}
          </Button>
        )}
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 animate-in fade-in-up">
          <CardContent className="py-4">
            <p className="text-red-600 text-center text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* External Prompt result (series + doubledown) */}
      {isExternalPillar && externalPrompt && (
        <Card className="animate-in fade-in-up">
          <CardHeader>
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">External Prompt</h3>
                <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                  Paste this whole block into ChatGPT, Claude, or Gemini. The full client profile, voice rules, format structure, and reference script are baked in - one copy, one paste.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleBuildPrompt}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Rebuild
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopyExternalPrompt}>
                  {externalCopied ? (
                    <>
                      <Check className="h-4 w-4 mr-2" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" /> Copy prompt
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <textarea
              value={externalPrompt}
              readOnly
              rows={20}
              className="w-full px-4 py-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-mono text-xs leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            />
            <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
              The reference script is embedded in full. The external AI will mirror its structure and rhythm on a fresh angle.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Generated Content + Save Panel */}
      {generatedContent && !isExternalPillar && (
        <Card className="animate-in fade-in-up">
          <CardHeader>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Generated Content</h3>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isGenerating}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
                  Regenerate
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-2" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" /> Copy
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Title + Save */}
            <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Save to content bank</p>
                  <p className="text-xs text-[var(--text-tertiary)]">Pick a title - use our recommendation or write your own.</p>
                </div>
                <Toggle
                  checked={useCustomTitle}
                  onChange={setUseCustomTitle}
                  size="sm"
                  label="Custom title"
                />
              </div>

              {useCustomTitle ? (
                <Input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Enter a custom title"
                />
              ) : (
                <div className="px-3 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] animate-in fade-in">
                  <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mr-2">Recommended</span>
                  {recommendedTitle || 'Untitled'}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-[var(--text-tertiary)]">{new Date().toLocaleDateString()}</p>
                <Button onClick={handleSaveScript} isLoading={isSaving} size="sm">
                  {savedOnce ? (
                    <>
                      <Check className="h-4 w-4 mr-2" /> Saved
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" /> Save Script
                    </>
                  )}
                </Button>
              </div>
            </div>

            <ScriptReviewer
              value={generatedContent}
              onChange={setGeneratedContent}
              kind={typeIdToScriptKind(selectedType)}
            />
          </CardContent>
        </Card>
      )}

      {/* Content Bank */}
      {selectedClient && (
        <Card className="animate-in fade-in-up">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#2B79F7]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Content Bank</h3>
                <span className="text-xs text-[var(--text-tertiary)]">({savedScripts.length})</span>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  value={bankSearch}
                  onChange={(e) => setBankSearch(e.target.value)}
                  placeholder="Search scripts..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredBankScripts.length === 0 ? (
              <div className="py-10 text-center">
                <BookOpen className="h-10 w-10 text-[var(--text-tertiary)] mx-auto mb-3" />
                <p className="text-sm text-[var(--text-tertiary)]">
                  {savedScripts.length === 0
                    ? 'No scripts saved yet. Generate and save one above.'
                    : 'No scripts match your search.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredBankScripts.map((s) => (
                  <div
                    key={s.id}
                    className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-[var(--border-primary)] hover:border-[#5A9AFF] hover:bg-[#E8F1FF]/30 transition-all duration-200 animate-in fade-in"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[var(--text-primary)] truncate">
                        {s.title || s.idea_input?.slice(0, 60) || 'Untitled'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--text-tertiary)]">
                        <span>
                          {new Date(s.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                        {s.content_pillar && (
                          <span className="bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] px-2 py-0.5 rounded-full capitalize">
                            {s.content_pillar}
                          </span>
                        )}
                        {s.content_type && (
                          <span className="bg-[var(--bg-tertiary)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full">
                            {s.content_type}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setReferenceScript(s)
                          setSelectedPillar('doubledown')
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        Use
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingScriptDeleteId(s.id)}
                        isLoading={deletingScriptId === s.id}
                        className="text-red-500 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Save CTA Modal */}
      {showCtaModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-none animate-in zoom-in">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Save CTA to Library</h3>
                <button
                  onClick={() => setShowCtaModal(false)}
                  className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                >
                  <X className="h-5 w-5 text-[var(--text-tertiary)]" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Name (optional)"
                value={ctaName}
                onChange={(e) => setCtaName(e.target.value)}
                placeholder="e.g. Free scripts CTA"
              />
              <Input
                label="Keyword (required)"
                value={ctaKeyword}
                onChange={(e) => setCtaKeyword(normalizeKeyword(e.target.value))}
                placeholder="LOOP"
              />
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">CTA Text (required)</label>
                <textarea
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                  placeholder='Comment "{KEYWORD}" and I&rsquo;ll send you...'
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowCtaModal(false)}>
                  Cancel
                </Button>
                <Button onClick={saveCtaToLibrary} isLoading={ctaSaving}>
                  Save CTA
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Reference Modal */}
      {showRefModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col animate-in zoom-in">
            <CardHeader className="flex justify-between flex-row items-center border-b">
              <h3 className="font-bold text-[var(--text-primary)]">Select Reference Script</h3>
              <button
                onClick={() => setShowRefModal(false)}
                className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-[var(--text-tertiary)]" />
              </button>
            </CardHeader>
            <div className="overflow-y-auto p-4 space-y-2">
              {savedScripts.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)] text-center py-8">
                  No saved scripts yet. Generate and save one first.
                </p>
              ) : (
                savedScripts.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setReferenceScript(s)
                      setShowRefModal(false)
                    }}
                    className="w-full text-left p-3 hover:bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg transition-all duration-200 group hover:border-[#5A9AFF]"
                  >
                    <div className="font-medium text-[var(--text-primary)] group-hover:text-[#2B79F7] truncate">
                      {s.title || s.idea_input?.slice(0, 60) || 'Untitled'}
                    </div>
                    <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5 flex gap-2 flex-wrap">
                      <span>{new Date(s.created_at).toLocaleDateString()}</span>
                      {s.content_pillar && (
                        <span className="bg-[var(--bg-tertiary)] px-1.5 rounded capitalize">{s.content_pillar}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      <ConfirmModal
        open={!!pendingScriptDeleteId}
        title="Delete this script?"
        message="The script will be removed from this client's content bank."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (!pendingScriptDeleteId) return
          await handleDeleteScript(pendingScriptDeleteId)
          setPendingScriptDeleteId(null)
        }}
        onClose={() => setPendingScriptDeleteId(null)}
      />
      <ConfirmModal
        open={!!pendingCtaDeleteId}
        title="Delete this CTA?"
        message="The CTA will be removed from the library."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (!pendingCtaDeleteId) return
          await deleteCta(pendingCtaDeleteId)
          setPendingCtaDeleteId(null)
        }}
        onClose={() => setPendingCtaDeleteId(null)}
      />
    </div>
  )
}

function EngineSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-11 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-64 mb-3" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-center pt-2">
        <Skeleton className="h-12 w-48 rounded-lg" />
      </div>
    </div>
  )
}
