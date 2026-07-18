'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loading'
import {
  FileText,
  LayoutGrid,
  Zap,
  MessageCircle,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  Lightbulb,
  Save,
} from 'lucide-react'
import { defaultBrandProfile, type BrandProfile } from '../clients/brandProfile'
import type { Topic } from '@/lib/types/topics'
import { ClientPicker } from './ClientPicker'
import { copyToClipboard } from '@/lib/util/clipboard'
import { ScriptReviewer, type ScriptKind } from '@/components/ui/ScriptReviewer'
import { readStashedClientId, useApplyClientPreselect } from '@/hooks/useClientPreselect'
import { useFormPersistence } from '@/hooks/useFormPersistence'

interface ClientRow {
  id: string
  name: string
  business_name: string
  industry: string | null
  profile_picture_url: string | null
  target_audience: string | null
  brand_doc_text: string | null
  dos_and_donts: string | null
  topics_library: string | null
  key_stories: string | null
  unique_mechanisms: string | null
  social_proof: string | null
  competitor_insights: string | null
  content_tier: 'beginner' | 'mid' | 'advanced' | null
  brand_profile: BrandProfile | null
}

type CardKind = 'longform' | 'carousel' | 'reel' | 'story'
type CardStatus = 'pending' | 'loading' | 'ready' | 'error'

function cardKindToScriptKind(kind: CardKind): ScriptKind {
  if (kind === 'reel') return 'engagement'
  return kind
}

interface PackageCard {
  id: string
  kind: CardKind
  index: number
  total: number
  status: CardStatus
  content: string
  error?: string
}

function buildProfileForClient(c: ClientRow): BrandProfile {
  if (c.brand_profile) return c.brand_profile
  const base = defaultBrandProfile()
  return {
    ...base,
    business: { ...base.business, problem_solved: c.brand_doc_text || '' },
    audience: {
      ...base.audience,
      work_roles: c.target_audience || 'Professionals',
      pain_points: [c.target_audience || '', '', '', '', ''],
    },
    voice: { ...base.voice, traits: c.dos_and_donts || 'Professional' },
    final: {
      ...base.final,
      anything_else: [
        c.topics_library && `Topics: ${c.topics_library}`,
        c.key_stories && `Stories: ${c.key_stories}`,
        c.unique_mechanisms && `Unique mechanisms: ${c.unique_mechanisms}`,
        c.social_proof && `Social proof: ${c.social_proof}`,
        c.competitor_insights && `Competitors: ${c.competitor_insights}`,
      ].filter(Boolean).join('\n'),
    },
  }
}

function extractAngle(content: string): string {
  const m = content.match(/\[ANGLE\]\s*[--]?\s*(.+)/i)
  return m?.[1]?.trim().slice(0, 140) || ''
}

export function ScriptPackageEngine() {
  const supabase = useMemo(() => createClient(), [])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [selectedClientId, setSelectedClientId] = useState(readStashedClientId)
  useApplyClientPreselect(selectedClientId, setSelectedClientId, clients)

  const [topics, setTopics] = useState<Topic[]>([])
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [selectedTopicId, setSelectedTopicId, clearTopic] = useFormPersistence('package:topic', '')

  const [ctaText, setCtaText, clearCta] = useFormPersistence('package:cta', '')

  const [longform, setLongform, clearLongform] = useFormPersistence<PackageCard | null>(
    'package:longform',
    null,
  )
  const [carousels, setCarousels, clearCarousels] = useFormPersistence<PackageCard[]>(
    'package:carousels',
    [],
  )
  const [reels, setReels, clearReels] = useFormPersistence<PackageCard[]>('package:reels', [])
  const [stories, setStories, clearStories] = useFormPersistence<PackageCard[]>(
    'package:stories',
    [],
  )

  const [error, setError] = useState('')
  const [savingTopic, setSavingTopic] = useState(false)

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  )
  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === selectedTopicId) || null,
    [topics, selectedTopicId],
  )
  const clientProfile = selectedClient ? buildProfileForClient(selectedClient) : null

  const fetchClients = useCallback(async () => {
    setLoadingClients(true)
    const { data } = await supabase.from('clients').select('*').is('archived_at', null).order('name')
    setClients((data || []) as ClientRow[])
    setLoadingClients(false)
  }, [supabase])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  const fetchTopics = useCallback(
    async (clientId: string) => {
      setLoadingTopics(true)
      const { data } = await supabase
        .from('topics')
        .select('*')
        .eq('client_id', clientId)
        .order('used_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false })
      setTopics((data || []) as Topic[])
      setLoadingTopics(false)
    },
    [supabase],
  )

  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      // Initial mount: keep any state restored from sessionStorage. Just load topics
      // and convert any cards left "loading" by a refresh into recoverable errors.
      if (selectedClientId) fetchTopics(selectedClientId)
      const fix = (c: PackageCard): PackageCard =>
        c.status === 'loading' || c.status === 'pending'
          ? { ...c, status: 'error', error: 'Interrupted - click Redo to retry.' }
          : c
      setLongform((p) => (p ? fix(p) : p))
      setCarousels((prev) => prev.map(fix))
      setReels((prev) => prev.map(fix))
      setStories((prev) => prev.map(fix))
      return
    }
    setSelectedTopicId('')
    setCtaText('')
    setLongform(null)
    setCarousels([])
    setReels([])
    setStories([])
    clearTopic()
    clearCta()
    clearLongform()
    clearCarousels()
    clearReels()
    clearStories()
    if (selectedClientId) fetchTopics(selectedClientId)
    else setTopics([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, fetchTopics])

  const generateLongform = async () => {
    if (!selectedClient || !selectedTopic) {
      setError('Pick a client and a topic first.')
      return
    }
    setError('')
    const cardId = `longform-${Date.now()}`
    setLongform({ id: cardId, kind: 'longform', index: 1, total: 1, status: 'loading', content: '' })
    setCarousels([])
    setReels([])
    setStories([])

    try {
      const res = await fetch('/api/scripts/package/longform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientProfile,
          pillar: selectedTopic.pillar,
          topicAnswer: selectedTopic.answer,
          topicQuestion: selectedTopic.question,
          ctaText: ctaText.trim() || null,
        }),
      })
      const data = await readJsonSafe(res)
      if (!data.success) throw new Error(data.error || 'Generation failed')
      setLongform({ id: cardId, kind: 'longform', index: 1, total: 1, status: 'ready', content: data.content })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLongform({ id: cardId, kind: 'longform', index: 1, total: 1, status: 'error', content: '', error: msg })
    }
  }

  const markTopicUsed = async () => {
    if (!selectedTopic) return
    setSavingTopic(true)
    try {
      await fetch('/api/topics/mark-used', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId: selectedTopic.id, used: true }),
      })
      setTopics((prev) =>
        prev.map((t) => (t.id === selectedTopic.id ? { ...t, used_at: new Date().toISOString() } : t)),
      )
    } finally {
      setSavingTopic(false)
    }
  }

  const runRepurpose = async (
    endpoint: string,
    setter: React.Dispatch<React.SetStateAction<PackageCard[]>>,
    kind: CardKind,
    total: number,
  ) => {
    if (!longform || longform.status !== 'ready') return
    const initial: PackageCard[] = Array.from({ length: total }, (_, i) => ({
      id: `${kind}-${i}-${Date.now()}`,
      kind,
      index: i + 1,
      total,
      status: 'pending',
      content: '',
    }))
    setter(initial)
    const previousAngles: string[] = []

    for (let i = 0; i < total; i++) {
      setter((prev) =>
        prev.map((c, idx) => (idx === i ? { ...c, status: 'loading' } : c)),
      )
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientProfile,
            pillar: selectedTopic?.pillar || 'educational',
            longformScript: longform.content,
            index: i + 1,
            total,
            previousAngles,
            ctaText: ctaText.trim() || null,
          }),
        })
        const data = await readJsonSafe(res)
        if (!data.success) throw new Error(data.error || 'Failed')
        const angle = extractAngle(data.content)
        if (angle) previousAngles.push(angle)
        setter((prev) =>
          prev.map((c, idx) => (idx === i ? { ...c, status: 'ready', content: data.content } : c)),
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setter((prev) =>
          prev.map((c, idx) => (idx === i ? { ...c, status: 'error', error: msg } : c)),
        )
      }
    }
  }

  const regenerateCard = async (
    kind: CardKind,
    cardIndex: number,
    endpoint: string,
    setter: React.Dispatch<React.SetStateAction<PackageCard[]>>,
    allCards: PackageCard[],
  ) => {
    if (!longform || longform.status !== 'ready') return
    const previousAngles = allCards
      .filter((c, idx) => idx !== cardIndex && c.status === 'ready')
      .map((c) => extractAngle(c.content))
      .filter(Boolean)

    setter((prev) =>
      prev.map((c, idx) => (idx === cardIndex ? { ...c, status: 'loading', error: undefined } : c)),
    )
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientProfile,
          pillar: selectedTopic?.pillar || 'educational',
          longformScript: longform.content,
          index: cardIndex + 1,
          total: allCards.length,
          previousAngles,
          ctaText: ctaText.trim() || null,
        }),
      })
      const data = await readJsonSafe(res)
      if (!data.success) throw new Error(data.error || 'Failed')
      setter((prev) =>
        prev.map((c, idx) =>
          idx === cardIndex ? { ...c, status: 'ready', content: data.content } : c,
        ),
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setter((prev) =>
        prev.map((c, idx) => (idx === cardIndex ? { ...c, status: 'error', error: msg } : c)),
      )
    }
    void kind
  }

  return (
    <div className="space-y-6 animate-in fade-in-up">
      <Card className="card-premium">
        <CardHeader>
          <h3 className="text-sm font-semibold text-theme-primary">1. Pick a client</h3>
        </CardHeader>
        <CardContent>
          <ClientPicker
            clients={clients}
            value={selectedClientId}
            onChange={setSelectedClientId}
            loading={loadingClients}
          />
        </CardContent>
      </Card>

      {selectedClient && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-[#2B79F7]" />
              <h3 className="text-sm font-semibold text-theme-primary">2. Pick a topic from their bank</h3>
            </div>
            <p className="text-[11px] text-theme-tertiary mt-0.5">
              Unused topics appear first. Used ones are greyed - you can still pick them manually.
            </p>
          </CardHeader>
          <CardContent>
            {loadingTopics ? (
              <Skeleton className="h-20 w-full" />
            ) : topics.length === 0 ? (
              <p className="text-sm text-theme-secondary">
                No topics in this client&rsquo;s bank yet. Add one from their profile → Topics Bank.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {topics.map((t) => {
                  const selected = selectedTopicId === t.id
                  const used = !!t.used_at
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTopicId(t.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        selected
                          ? 'border-[#2B79F7] bg-white dark:bg-[#1E2A41]'
                          : 'border-theme-primary hover:border-[#5A9AFF] bg-theme-card'
                      } ${used ? 'opacity-60' : ''}`}
                    >
                      {t.question && (
                        <p className={`text-xs mb-1 truncate ${selected ? 'text-theme-secondary dark:text-white/80' : 'text-theme-secondary dark:text-white/70'}`}>Q: {t.question}</p>
                      )}
                      <p className={`text-sm line-clamp-2 ${selected ? 'text-theme-primary dark:text-white' : 'text-theme-primary'}`}>{t.answer}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10px]">
                        <span className="px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] capitalize">
                          {t.pillar}
                        </span>
                        {used && (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--bg-card-hover)] text-[var(--text-secondary)]">Used</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedClient && selectedTopic && (
        <Card className="card-premium">
          <CardHeader>
            <h3 className="text-sm font-semibold text-theme-primary">3. Optional CTA</h3>
          </CardHeader>
          <CardContent>
            <textarea
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              rows={2}
              placeholder="Optional CTA (verbatim) - e.g. Comment LOOP and I'll DM you the full breakdown."
              className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary resize-none focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            />
            <p className="mt-2 text-[11px] text-theme-secondary">
              Pillar comes from the topic itself ({selectedTopic.pillar}). Pick a different
              topic if you want a different framing.
            </p>
          </CardContent>
        </Card>
      )}

      {selectedClient && selectedTopic && (
        <div className="flex justify-center">
          <Button
            size="lg"
            onClick={generateLongform}
            isLoading={longform?.status === 'loading'}
            disabled={!selectedClient || !selectedTopic}
            className="px-12"
          >
            Generate Long-form Script
          </Button>
        </div>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-3">
            <p className="text-sm text-red-600 text-center">{error}</p>
          </CardContent>
        </Card>
      )}

      {longform && (
        <ResultCard
          title="Long-form Script"
          icon={FileText}
          card={longform}
          onRedo={generateLongform}
          onContentChange={(next) =>
            setLongform((prev) => (prev ? { ...prev, content: next } : prev))
          }
          extraActions={
            longform.status === 'ready' && (
              <>
                <Button size="sm" variant="outline" onClick={markTopicUsed} isLoading={savingTopic}>
                  <Save className="h-4 w-4 mr-1" /> Mark topic used
                </Button>
              </>
            )
          }
        />
      )}

      {longform?.status === 'ready' && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-[#2B79F7]" />
                <h3 className="text-sm font-semibold text-theme-primary">Carousel Repurpose (5)</h3>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  runRepurpose('/api/scripts/package/carousel', setCarousels, 'carousel', 5)
                }
                disabled={carousels.some((c) => c.status === 'loading')}
              >
                {carousels.length ? 'Regenerate all' : 'Generate 5 carousels'}
              </Button>
            </div>
          </CardHeader>
          {carousels.length > 0 && (
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {carousels.map((c, idx) => (
                  <ResultCard
                    key={c.id}
                    title={`Carousel ${c.index} of ${c.total}`}
                    card={c}
                    compact
                    onRedo={() =>
                      regenerateCard('carousel', idx, '/api/scripts/package/carousel', setCarousels, carousels)
                    }
                    onContentChange={(next) =>
                      setCarousels((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, content: next } : p)),
                      )
                    }
                  />
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {longform?.status === 'ready' && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[#2B79F7]" />
                <h3 className="text-sm font-semibold text-theme-primary">Engagement Reels (5)</h3>
              </div>
              <Button
                size="sm"
                onClick={() => runRepurpose('/api/scripts/package/reel', setReels, 'reel', 5)}
                disabled={reels.some((c) => c.status === 'loading')}
              >
                {reels.length ? 'Regenerate all' : 'Generate 5 reels'}
              </Button>
            </div>
          </CardHeader>
          {reels.length > 0 && (
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reels.map((c, idx) => (
                  <ResultCard
                    key={c.id}
                    title={`Reel ${c.index} of ${c.total}`}
                    card={c}
                    compact
                    onRedo={() =>
                      regenerateCard('reel', idx, '/api/scripts/package/reel', setReels, reels)
                    }
                    onContentChange={(next) =>
                      setReels((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, content: next } : p)),
                      )
                    }
                  />
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {longform?.status === 'ready' && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-[#2B79F7]" />
                <h3 className="text-sm font-semibold text-theme-primary">Stories (5)</h3>
              </div>
              <Button
                size="sm"
                onClick={() => runRepurpose('/api/scripts/package/story', setStories, 'story', 5)}
                disabled={stories.some((c) => c.status === 'loading')}
              >
                {stories.length ? 'Regenerate all' : 'Generate 5 stories'}
              </Button>
            </div>
          </CardHeader>
          {stories.length > 0 && (
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stories.map((c, idx) => (
                  <ResultCard
                    key={c.id}
                    title={`Story ${c.index} of ${c.total}`}
                    card={c}
                    compact
                    onRedo={() =>
                      regenerateCard('story', idx, '/api/scripts/package/story', setStories, stories)
                    }
                    onContentChange={(next) =>
                      setStories((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, content: next } : p)),
                      )
                    }
                  />
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}

function ResultCard({
  title,
  icon: Icon,
  card,
  onRedo,
  onContentChange,
  compact = false,
  extraActions,
}: {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  card: PackageCard
  onRedo: () => void
  onContentChange?: (next: string) => void
  compact?: boolean
  extraActions?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(!compact)

  const copy = async () => {
    const ok = await copyToClipboard(card.content)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card className="card-premium">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => compact && setOpen((v) => !v)}
            className="flex items-center gap-2 min-w-0 text-left"
            disabled={!compact}
          >
            {Icon && <Icon className="h-4 w-4 text-[#2B79F7] shrink-0" />}
            <h3 className="text-sm md:text-base font-semibold text-theme-primary truncate">{title}</h3>
            {compact && (
              <ChevronDown
                className={`h-4 w-4 text-theme-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
              />
            )}
          </button>
          <div className="flex gap-2">
            {extraActions}
            <Button size="sm" variant="outline" onClick={onRedo} disabled={card.status === 'loading'}>
              <RefreshCw className={`h-4 w-4 mr-1 ${card.status === 'loading' ? 'animate-spin' : ''}`} />
              Redo
            </Button>
            {card.status === 'ready' && (
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent>
          {card.status === 'pending' && (
            <p className="text-xs text-theme-secondary">Queued…</p>
          )}
          {card.status === 'loading' && <Skeleton className="h-32 w-full" />}
          {card.status === 'error' && (
            <p className="text-sm text-red-600">{card.error || 'Failed'}</p>
          )}
          {card.status === 'ready' && (
            onContentChange ? (
              <ScriptReviewer
                value={card.content}
                onChange={onContentChange}
                kind={cardKindToScriptKind(card.kind)}
                minHeight={compact ? 280 : 460}
                hideCopy
              />
            ) : (
              <pre className="whitespace-pre-wrap bg-theme-tertiary/40 p-4 rounded-lg text-sm text-theme-primary font-sans leading-relaxed max-h-[480px] overflow-auto">
                {card.content}
              </pre>
            )
          )}
        </CardContent>
      )}
    </Card>
  )
}
