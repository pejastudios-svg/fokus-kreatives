'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ClientPicker } from '@/components/dashboard/ClientPicker'
import { toast } from '@/components/ui/Toast'
import { createClient } from '@/lib/supabase/client'
import { normalizeBrandProfile } from '@/components/clients/brandProfile'
import { topicGroupIdFor } from '@/lib/questionForm/topicGroupId'
import {
  buildPrompt,
  PROMPT_CARDS,
  DEFAULT_SEED_COUNT,
  type PromptCardMeta,
} from '@/lib/prompts/templates'
import { resolveTierConfig, TIER_KEY_LABEL, type CustomConfig, type TierKey } from '@/lib/campaignTiers'
import {
  Lightbulb,
  Magnet,
  Telescope,
  Copy,
  Check,
  X,
  Loader2,
  Globe,
} from 'lucide-react'

interface Client {
  id: string
  name: string
  business_name: string
  profile_picture_url: string | null
}

interface FormAnswer {
  input_type?: string
  question?: string
  answer: string
}

/** One of the client's question forms, offered as a Lead Magnet source. */
interface FormOption {
  id: string
  label: string
  submitted: boolean
  /** The form's topics ({id, title}) - a magnet can be scoped to one of them. */
  topics: { id: string; title: string }[]
}

interface ClientData {
  brandProfileText: string
  existingTitles: string[]
  existingAnswers: string[]
  formAnswers: FormAnswer[]
  forms: FormOption[]
  competitorInsights: string
  packageTier: TierKey | null
  /** Resolved monthly campaign count (fixed or custom tier). */
  campaignsPerMonth: number
}

const ICONS: Record<PromptCardMeta['icon'], typeof Lightbulb> = {
  Lightbulb,
  Magnet,
  Telescope,
}

export default function PromptsPage() {
  const supabase = useMemo(() => createClient(), [])

  const [clients, setClients] = useState<Client[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [selectedClientId, setSelectedClientId] = useState('')

  const [clientData, setClientData] = useState<ClientData | null>(null)
  const [loadingData, setLoadingData] = useState(false)

  // Lead-magnet source: '' = all of the client's answered forms (default,
  // legacy behaviour). A form id scopes the magnet's material to just that
  // question form's answers.
  const [selectedFormId, setSelectedFormId] = useState('')
  // '' = all topics in the selected form; a topic id narrows the magnet to that
  // single topic's braindump (per-topic mode).
  const [selectedTopicId, setSelectedTopicId] = useState('')
  const [scopedAnswers, setScopedAnswers] = useState<FormAnswer[] | null>(null)
  const [loadingScoped, setLoadingScoped] = useState(false)

  // Seed-topics controls. Manual count defaults to the full 100 bank; the
  // toggle switches to the client's package monthly count (top 4 / mid 2 / low 1).
  const [seedCount, setSeedCount] = useState(DEFAULT_SEED_COUNT)
  const [autoByTier, setAutoByTier] = useState(false)

  const [generating, setGenerating] = useState<PromptCardMeta['type'] | null>(null)
  const [modal, setModal] = useState<{ title: string; prompt: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const selectedClient = clients.find((c) => c.id === selectedClientId) || null
  const tier = clientData?.packageTier ?? null
  const tierCampaigns = clientData?.campaignsPerMonth ?? 0

  // The count actually sent to the prompt: tier monthly count when the toggle
  // is on and a tier is known, otherwise the manual number.
  const effectiveSeedCount =
    autoByTier && tier ? tierCampaigns : seedCount

  useEffect(() => {
    const fetchClients = async () => {
      try {
        const { data } = await supabase
          .from('clients')
          .select('id, name, business_name, profile_picture_url')
          .order('name')
        if (data) setClients(data as Client[])
      } finally {
        setLoadingClients(false)
      }
    }
    fetchClients()
  }, [supabase])

  // Load brand profile + dedup material (past titles + documented answers) +
  // package tier whenever the client changes. Mirrors the in-app generator's
  // loadRecentMaterial so the seed prompt dedups on the same two layers.
  const loadClientData = useCallback(
    async (clientId: string) => {
      setLoadingData(true)
      setClientData(null)
      try {
        const [{ data: client }, { data: forms }, { data: topics }] = await Promise.all([
          supabase
            .from('clients')
            .select('brand_profile, package_tier, custom_config, competitor_insights')
            .eq('id', clientId)
            .single(),
          supabase
            .from('question_forms')
            .select('id, title, submitted_at, created_at, topics')
            .eq('client_id', clientId)
            .not('topics', 'is', null)
            .order('created_at', { ascending: false })
            .limit(20),
          supabase
            .from('topics')
            .select('answer, input_type, question')
            .eq('client_id', clientId)
            .eq('source', 'form')
            .order('created_at', { ascending: false })
            .limit(80),
        ])

        const profile = normalizeBrandProfile(client?.brand_profile ?? null)
        const brandProfileText = JSON.stringify(profile, null, 2)

        // Build the per-form picker options (topic forms only - their answers
        // carry a topic_group_id we can scope by). Label by title, falling
        // back to the created date.
        const formOptions: FormOption[] = []
        for (const row of forms ?? []) {
          const f = row as {
            id?: string
            title?: string | null
            submitted_at?: string | null
            created_at?: string
            topics?: unknown
          }
          if (!f.id) continue
          const topicList = Array.isArray(f.topics) ? (f.topics as { id?: string; title?: string }[]) : []
          const topics = topicList
            .filter((t): t is { id: string; title?: string } => !!t?.id)
            .map((t, i) => ({ id: t.id, title: t.title?.trim() || `Topic ${i + 1}` }))
          if (topics.length === 0) continue
          const dateLabel = f.created_at
            ? new Date(f.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : ''
          const base = f.title?.trim() || (dateLabel ? `Form from ${dateLabel}` : 'Question form')
          formOptions.push({
            id: f.id,
            label: f.submitted_at ? base : `${base} (not answered yet)`,
            submitted: !!f.submitted_at,
            topics,
          })
        }

        // Past topic titles from question_forms.topics jsonb.
        const seenTitle = new Set<string>()
        const existingTitles: string[] = []
        for (const row of forms ?? []) {
          const list = Array.isArray((row as { topics?: unknown }).topics)
            ? ((row as { topics: unknown[] }).topics)
            : []
          for (const t of list) {
            const title = (t as { title?: string })?.title?.trim()
            if (!title) continue
            const key = title.toLowerCase()
            if (seenTitle.has(key)) continue
            seenTitle.add(key)
            existingTitles.push(title)
            if (existingTitles.length >= 40) break
          }
          if (existingTitles.length >= 40) break
        }

        // Documented answers from the topics table, used two ways: short
        // excerpts for the seed-topics dedup, and fuller typed answers as the
        // lead magnet's source material.
        const seenAns = new Set<string>()
        const existingAnswers: string[] = []
        const formAnswers: ClientData['formAnswers'] = []
        for (const r of topics ?? []) {
          const row = r as { answer?: string; input_type?: string; question?: string }
          const raw = row.answer?.trim()
          if (!raw) continue
          const key = raw.slice(0, 80).toLowerCase().replace(/\s+/g, ' ')
          if (seenAns.has(key)) continue
          seenAns.add(key)
          if (existingAnswers.length < 40) {
            existingAnswers.push(raw.length > 180 ? `${raw.slice(0, 177)}...` : raw)
          }
          if (formAnswers.length < 50) {
            formAnswers.push({
              input_type: typeof row.input_type === 'string' ? row.input_type : undefined,
              question: typeof row.question === 'string' ? row.question : undefined,
              answer: raw.length > 600 ? `${raw.slice(0, 597)}...` : raw,
            })
          }
        }

        const packageTier = (client?.package_tier as TierKey | null) ?? null
        const campaignsPerMonth = resolveTierConfig({
          package_tier: packageTier,
          custom_config: (client?.custom_config as CustomConfig | null) ?? null,
        }).campaignsPerMonth
        const competitorInsights =
          typeof (client as { competitor_insights?: string })?.competitor_insights === 'string'
            ? ((client as { competitor_insights?: string }).competitor_insights as string)
            : ''
        setClientData({
          brandProfileText,
          existingTitles,
          existingAnswers,
          formAnswers,
          forms: formOptions,
          competitorInsights,
          packageTier,
          campaignsPerMonth,
        })
      } catch {
        toast.error('Could not load that client. Try again.')
        setClientData(null)
      } finally {
        setLoadingData(false)
      }
    },
    [supabase],
  )

  useEffect(() => {
    // Reset the per-form + per-topic choice whenever the client changes.
    setSelectedFormId('')
    setSelectedTopicId('')
    setScopedAnswers(null)
    if (selectedClientId) loadClientData(selectedClientId)
    else setClientData(null)
  }, [selectedClientId, loadClientData])

  // Reset the topic choice whenever the form changes (topics are form-specific).
  useEffect(() => {
    setSelectedTopicId('')
  }, [selectedFormId])

  // Load the chosen form's answers (scoped by topic_group_id) when a specific
  // form is picked. '' falls back to the all-forms material already loaded.
  useEffect(() => {
    if (!selectedClientId || !selectedFormId || !clientData) {
      setScopedAnswers(null)
      return
    }
    const form = clientData.forms.find((f) => f.id === selectedFormId)
    if (!form) {
      setScopedAnswers(null)
      return
    }
    let cancelled = false
    setLoadingScoped(true)
    ;(async () => {
      try {
        // Per-topic mode: scope to just the selected topic's group id.
        // Otherwise scope to every topic in the form.
        const topicIds = selectedTopicId
          ? [selectedTopicId]
          : form.topics.map((t) => t.id)
        const groupIds = await Promise.all(
          topicIds.map((tid) => topicGroupIdFor(selectedFormId, tid)),
        )
        const { data } = await supabase
          .from('topics')
          .select('answer, input_type, question, group_position')
          .eq('client_id', selectedClientId)
          .eq('source', 'form')
          .in('topic_group_id', groupIds)
          .order('topic_group_id', { ascending: true })
          .order('group_position', { ascending: true })
          .limit(120)

        const seen = new Set<string>()
        const out: FormAnswer[] = []
        for (const r of data ?? []) {
          const row = r as { answer?: string; input_type?: string; question?: string }
          const raw = row.answer?.trim()
          if (!raw) continue
          const key = raw.slice(0, 80).toLowerCase().replace(/\s+/g, ' ')
          if (seen.has(key)) continue
          seen.add(key)
          out.push({
            input_type: typeof row.input_type === 'string' ? row.input_type : undefined,
            question: typeof row.question === 'string' ? row.question : undefined,
            answer: raw.length > 600 ? `${raw.slice(0, 597)}...` : raw,
          })
          if (out.length >= 50) break
        }
        if (!cancelled) setScopedAnswers(out)
      } catch {
        if (!cancelled) setScopedAnswers([])
      } finally {
        if (!cancelled) setLoadingScoped(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedClientId, selectedFormId, selectedTopicId, clientData, supabase])

  const handleGenerate = (card: PromptCardMeta) => {
    if (!clientData || !selectedClient) return
    setGenerating(card.type)
    try {
      // The lead magnet's source material: scoped to one question form when
      // chosen, otherwise all of the client's answered forms.
      const leadMagnetAnswers =
        selectedFormId ? scopedAnswers ?? [] : clientData.formAnswers

      const prompt = buildPrompt({
        type: card.type,
        brandProfileText: clientData.brandProfileText,
        count: effectiveSeedCount,
        existingTitles: clientData.existingTitles,
        existingAnswers: clientData.existingAnswers,
        formAnswers: leadMagnetAnswers,
        competitorInsights: clientData.competitorInsights,
        // Per-topic mode when a single topic is picked - narrows the prompt to
        // build one qualified magnet (+ a keyword) from that topic's braindump.
        leadMagnetScope: selectedTopicId ? 'topic' : selectedFormId ? 'form' : 'all',
      })
      const label = selectedClient.name || selectedClient.business_name || 'this client'
      const suffix = card.type === 'seed-topics' ? ` (${effectiveSeedCount})` : ''
      setModal({ title: `${card.title}${suffix} for ${label}`, prompt })
      setCopied(false)
    } finally {
      setGenerating(null)
    }
  }

  const handleCopy = async () => {
    if (!modal) return
    try {
      await navigator.clipboard.writeText(modal.prompt)
      setCopied(true)
      toast.success('Prompt copied. Paste it into Claude.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed. Select the text and copy manually.')
    }
  }

  const ready = !!clientData && !loadingData
  const selectedForm = clientData?.forms.find((f) => f.id === selectedFormId) ?? null

  return (
    <>
      <Header
        title="Prompts"
        subtitle="Pick a client, generate a ready-to-paste Claude prompt, then run it in Claude.ai."
      />

      <div className="p-4 md:p-8 space-y-6">
        {/* Client selector */}
        <Card>
          <CardContent className="space-y-2">
            <label className="text-sm font-medium text-[var(--text-primary)]">Client</label>
            <p className="text-xs text-[var(--text-tertiary)]">
              Choose a client first. We fill each prompt with their brand profile.
            </p>
            <div className="max-w-md pt-1">
              <ClientPicker
                clients={clients}
                value={selectedClientId}
                onChange={setSelectedClientId}
                loading={loadingClients}
                placeholder="Search and select a client…"
              />
            </div>
            {selectedClientId && (
              <p className="text-xs pt-1 flex items-center gap-1.5">
                {loadingData ? (
                  <span className="text-[var(--text-tertiary)] flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading profile…
                  </span>
                ) : clientData ? (
                  <span className="text-emerald-500 flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5" /> Profile loaded
                    {clientData.existingTitles.length > 0 &&
                      ` · ${clientData.existingTitles.length} past titles for dedup`}
                  </span>
                ) : null}
              </p>
            )}

            {/* Lead Magnet source picker. Scopes the magnet's material to one
                question form, or uses every answered form (default). */}
            {ready && clientData && clientData.forms.length > 0 && (
              <div className="max-w-md pt-3">
                <div className="flex items-center gap-1.5">
                  <Magnet className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                  <label className="text-xs font-medium text-[var(--text-secondary)]">
                    Lead Magnet source
                  </label>
                </div>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5 mb-1.5">
                  Build the Lead Magnet from one question form, or use every answered form.
                </p>
                <select
                  value={selectedFormId}
                  onChange={(e) => setSelectedFormId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="">All answered forms</option>
                  {clientData.forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>

                {/* Per-topic scope. Once a form is picked, narrow the magnet to
                    a single topic (build one focused, qualified magnet + its own
                    keyword) or keep the whole form. */}
                {selectedForm && selectedForm.topics.length > 0 && (
                  <div className="mt-2.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">
                      Topic (optional)
                    </label>
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5 mb-1.5">
                      Pick one topic to build a single focused magnet from it, or use the whole form.
                    </p>
                    <select
                      value={selectedTopicId}
                      onChange={(e) => setSelectedTopicId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    >
                      <option value="">All topics in this form</option>
                      {selectedForm.topics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {selectedFormId && (
                  <p className="text-xs pt-1 flex items-center gap-1.5">
                    {loadingScoped ? (
                      <span className="text-[var(--text-tertiary)] flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading answers…
                      </span>
                    ) : (
                      <span
                        className={
                          (scopedAnswers?.length ?? 0) > 0
                            ? 'text-emerald-500 flex items-center gap-1.5'
                            : 'text-amber-500 flex items-center gap-1.5'
                        }
                      >
                        <Check className="h-3.5 w-3.5" />
                        {(scopedAnswers?.length ?? 0) > 0
                          ? `${scopedAnswers?.length} answers from this ${selectedTopicId ? 'topic' : 'form'}`
                          : `No answers on this ${selectedTopicId ? 'topic' : 'form'} yet`}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Prompt gallery */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {PROMPT_CARDS.map((card) => {
            const Icon = ICONS[card.icon]
            const isGenerating = generating === card.type
            const isSeed = card.type === 'seed-topics'
            return (
              <Card key={card.type} className="flex flex-col">
                <CardContent className="flex flex-col flex-1 gap-4">
                  <div className="flex items-start justify-between">
                    <div className="h-11 w-11 rounded-xl bg-brand-gradient text-white flex items-center justify-center shadow-premium">
                      <Icon className="h-5 w-5" />
                    </div>
                    {card.webSearch && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] rounded-full px-2 py-1">
                        <Globe className="h-3 w-3" /> Web search
                      </span>
                    )}
                  </div>

                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-[var(--text-primary)]">
                      {card.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-[var(--text-secondary)] leading-relaxed">
                      {card.description}
                    </p>
                  </div>

                  {/* Seed-topics: count + auto-by-tier toggle */}
                  {isSeed && (
                    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-[var(--text-secondary)]">
                          How many titles
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={autoByTier && tier ? tierCampaigns : seedCount}
                          disabled={autoByTier}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10)
                            setSeedCount(Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : 1)
                          }}
                          className="w-20 px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm text-right disabled:opacity-50"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoByTier((v) => !v)}
                        className="flex items-center justify-between w-full text-xs text-[var(--text-secondary)]"
                      >
                        <span>Auto by package tier</span>
                        <span
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            autoByTier ? 'bg-[#2B79F7]' : 'bg-[var(--bg-tertiary)]'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              autoByTier ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </span>
                      </button>
                      {autoByTier && (
                        <p className="text-[11px] text-[var(--text-tertiary)]">
                          {tier
                            ? `Using ${TIER_KEY_LABEL[tier]} → ${tierCampaigns} this month.`
                            : 'No package tier set on this client. Set one in Edit client, or turn this off.'}
                        </p>
                      )}
                    </div>
                  )}

                  <Button
                    onClick={() => handleGenerate(card)}
                    disabled={!ready || isGenerating || (isSeed && autoByTier && !tier)}
                    isLoading={isGenerating}
                    className="w-full"
                  >
                    {ready ? 'Generate' : 'Select a client'}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Generated-prompt modal */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="glass-pop w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-primary)]">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  {modal.title}
                </h2>
                <p className="text-xs text-[var(--text-tertiary)]">
                  Copy this and paste it into Claude.ai with web search on.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors shrink-0"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-secondary)] font-mono">
                {modal.prompt}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
              <Button variant="outline" onClick={() => setModal(null)}>
                Close
              </Button>
              <Button onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" /> Copy prompt
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
