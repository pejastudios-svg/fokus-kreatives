'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import {
  Sparkles,
  Copy,
  Check,
  Link as LinkIcon,
  Plus,
  Trash2,
  ExternalLink,
  RefreshCw,
  ClipboardList,
  Eye,
  AlertTriangle,
  X,
} from 'lucide-react'
import { defaultBrandProfile, type BrandProfile } from '../clients/brandProfile'
import type {
  FormTopic,
  FormTopicQuestion,
  QuestionForm,
  TopicInputType,
} from '@/lib/types/questionForm'
import type { TopicPillar } from '@/lib/types/topics'
import { defaultTopicCount, TIER_KEY_LABEL, type CustomConfig, type TierKey } from '@/lib/campaignTiers'
import { ClientPicker } from './ClientPicker'
import { readStashedClientId, useApplyClientPreselect } from '@/hooks/useClientPreselect'

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
  brand_profile: BrandProfile | null
  package_tier: TierKey | null
  custom_config: CustomConfig | null
}

const PILLARS: { id: TopicPillar; label: string }[] = [
  { id: 'educational', label: 'Educational' },
  { id: 'storytelling', label: 'Storytelling' },
  { id: 'authority', label: 'Authority' },
  { id: 'series', label: 'Series' },
  { id: 'doubledown', label: 'Double Down' },
]

const INPUT_TYPE_ORDER: TopicInputType[] = [
  'scene',
  'failed_attempt',
  'turning_point',
  'framework',
  'proof',
  'opinion',
]

const INPUT_TYPE_LABEL: Record<TopicInputType, string> = {
  scene: 'Scene',
  failed_attempt: 'Failed Attempt',
  turning_point: 'Turning Point',
  framework: 'Framework',
  proof: 'Proof',
  opinion: 'Opinion',
  named_mentor: 'Mentor',
  win_moment: 'Win',
}

// Default topic count = one topic per campaign (campaignsPerMonth), resolved
// the same way for fixed and custom tiers.
function defaultTopicCountForTier(client: ClientRow | null | undefined): number {
  if (!client) return 2
  return defaultTopicCount(client)
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
  }
}

function tierLabel(tier: TierKey | null | undefined): string {
  return tier ? TIER_KEY_LABEL[tier] : 'Untiered'
}

export function QuestionsFormEngine() {
  const supabase = useMemo(() => createClient(), [])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [selectedClientId, setSelectedClientId] = useState(readStashedClientId)
  useApplyClientPreselect(selectedClientId, setSelectedClientId, clients)

  const [topicCount, setTopicCount] = useState(2)
  const [title, setTitle] = useState('')
  // Manual seed topic titles. Each non-empty string becomes a topic with
  // its title pre-set; the AI just generates the 6 questions for it. Lets
  // staff drop in topics the brand profile doesn't capture (e.g. a recent
  // client win or pivot the AI couldn't have known about).
  const [seedTopics, setSeedTopics] = useState<string[]>([])
  // Saturation report from the last generation. Surfaces a warning when
  // newly-generated titles are largely recycled vs the brand's history.
  const [saturation, setSaturation] = useState<{
    score: number
    saturated: boolean
    examples: Array<{ newTitle: string; pastTitle: string; overlap: number }>
  } | null>(null)

  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftTopics, setDraftTopics] = useState<FormTopic[]>([])
  const [error, setError] = useState('')

  const [pastForms, setPastForms] = useState<QuestionForm[]>([])
  const [loadingForms, setLoadingForms] = useState(false)

  const [copiedUrl, setCopiedUrl] = useState('')

  const [expandedFormId, setExpandedFormId] = useState<string | null>(null)
  const [answersByForm, setAnswersByForm] = useState<
    Record<string, AnswerSummary>
  >({})
  const [loadingAnswersFor, setLoadingAnswersFor] = useState<string | null>(null)

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  )

  // Sync default topic count when the selected client's tier changes.
  useEffect(() => {
    if (selectedClient) {
      setTopicCount(defaultTopicCountForTier(selectedClient))
    }
  }, [selectedClient])

  const fetchClients = useCallback(async () => {
    setLoadingClients(true)
    const { data } = await supabase.from('clients').select('*').is('archived_at', null).order('name')
    setClients((data || []) as ClientRow[])
    setLoadingClients(false)
  }, [supabase])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  const fetchPastForms = useCallback(
    async (clientId: string) => {
      setLoadingForms(true)
      const { data } = await supabase
        .from('question_forms')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      setPastForms((data || []) as QuestionForm[])
      setLoadingForms(false)
    },
    [supabase],
  )

  useEffect(() => {
    setDraftTopics([])
    setError('')
    if (selectedClientId) fetchPastForms(selectedClientId)
    else setPastForms([])
  }, [selectedClientId, fetchPastForms])

  const handleGenerate = async () => {
    if (!selectedClient) {
      setError('Pick a client first.')
      return
    }
    setError('')
    setGenerating(true)
    try {
      // Drop empty seed rows before sending. The server uses each non-empty
      // seed as a fixed topic title; the AI fills in the questions. Any
      // remaining quota (topicCount - seeds.length) gets AI-generated
      // titles + questions as before.
      const cleanedSeeds = seedTopics.map((s) => s.trim()).filter(Boolean)

      const res = await fetch('/api/question-form/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          clientProfile: buildProfileForClient(selectedClient),
          clientName: selectedClient.name,
          businessName: selectedClient.business_name,
          industry: selectedClient.industry,
          topicCount: Math.max(topicCount, cleanedSeeds.length),
          seedTopics: cleanedSeeds.length ? cleanedSeeds : undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Generation failed')
      setDraftTopics(data.topics as FormTopic[])
      setSaturation(data.saturation ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  const updateTopic = (topicId: string, patch: Partial<FormTopic>) => {
    setDraftTopics((prev) => prev.map((t) => (t.id === topicId ? { ...t, ...patch } : t)))
  }

  const updateTopicQuestion = (
    topicId: string,
    qid: string,
    patch: Partial<FormTopicQuestion>,
  ) => {
    setDraftTopics((prev) =>
      prev.map((t) =>
        t.id === topicId
          ? { ...t, questions: t.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)) }
          : t,
      ),
    )
  }

  const removeTopic = (topicId: string) => {
    setDraftTopics((prev) => prev.filter((t) => t.id !== topicId))
  }

  const addBlankTopic = () => {
    const newQuestions: FormTopicQuestion[] = INPUT_TYPE_ORDER.map((it) => ({
      id: crypto.randomUUID(),
      input_type: it,
      text: '',
      placeholder: '',
    }))
    setDraftTopics((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: '',
        pillar_hint: 'storytelling',
        questions: newQuestions,
      },
    ])
  }

  const handleSaveAndShare = async () => {
    if (!selectedClient) return
    const cleaned = draftTopics
      .map((t) => ({
        ...t,
        title: t.title.trim(),
        questions: t.questions
          .map((q) => ({ ...q, text: q.text.trim(), placeholder: q.placeholder?.trim() }))
          .filter((q) => q.text),
      }))
      .filter((t) => t.title && t.questions.length === INPUT_TYPE_ORDER.length)

    if (!cleaned.length) {
      setError(`Each topic needs a title and all ${INPUT_TYPE_ORDER.length} questions filled in.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/question-form/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          title: title.trim() || null,
          topics: cleaned,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Save failed')
      setDraftTopics([])
      setTitle('')
      // Clear seeds so they don't carry over to the next batch generation
      // (the next batch is for new material, not a re-run of the same seeds).
      setSeedTopics([])
      // Same for saturation - it referred to the just-saved batch.
      setSaturation(null)
      await fetchPastForms(selectedClient.id)
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(data.url).catch(() => {})
      }
      setCopiedUrl(data.url)
      setTimeout(() => setCopiedUrl(''), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const copyUrl = (url: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(url).catch(() => {})
    setCopiedUrl(url)
    setTimeout(() => setCopiedUrl(''), 2000)
  }

  const toggleAnswers = async (form: { id: string; token: string }) => {
    if (expandedFormId === form.id) {
      setExpandedFormId(null)
      return
    }
    setExpandedFormId(form.id)
    if (answersByForm[form.id]) return
    setLoadingAnswersFor(form.id)
    try {
      const res = await fetch(
        `/api/question-form/answers?token=${encodeURIComponent(form.token)}`,
      )
      const data = await res.json()
      if (data.success && data.submitted) {
        setAnswersByForm((prev) => ({
          ...prev,
          [form.id]: {
            isTopicForm: !!data.isTopicForm,
            topics: data.topics ?? [],
            answers: data.answers ?? [],
          },
        }))
      }
    } finally {
      setLoadingAnswersFor(null)
    }
  }

  const [pendingDeleteFormId, setPendingDeleteFormId] = useState<string | null>(null)

  const deleteForm = async (id: string) => {
    setPastForms((prev) => prev.filter((f) => f.id !== id))
    await supabase.from('question_forms').delete().eq('id', id)
  }

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="space-y-6">
      <Card className="card-premium">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#2B79F7]" />
            <h3 className="text-sm font-semibold text-theme-primary">Topic Batch Generator</h3>
          </div>
          <p className="text-[11px] text-theme-tertiary mt-0.5">
            Each topic becomes 5 questions in Hero&apos;s Journey order
            (scene, failed attempt, turning point, framework, proof). Counts default
            to the client&apos;s package tier.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-primary mb-1">Client</label>
            <ClientPicker
              clients={clients.map((c) => ({
                id: c.id,
                name: c.name,
                business_name: c.business_name,
                profile_picture_url: c.profile_picture_url,
              }))}
              value={selectedClientId}
              onChange={setSelectedClientId}
              loading={loadingClients}
              placeholder="Pick a client…"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">Topics</label>
              <input
                type="number"
                min={1}
                max={20}
                value={topicCount}
                onChange={(e) =>
                  setTopicCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                }
                className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
              {selectedClient && (
                <p className="text-[11px] text-theme-tertiary mt-1">
                  Tier: {tierLabel(selectedClient.package_tier)} · default{' '}
                  {defaultTopicCountForTier(selectedClient)}
                </p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Form title (optional)
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Week of Jun 3 - Topic Batch"
                className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-theme-primary">
                Seed topics (optional)
              </label>
              <button
                type="button"
                onClick={() => setSeedTopics((prev) => [...prev, ''])}
                className="inline-flex items-center gap-1 text-xs text-[#2B79F7] hover:underline"
              >
                <Plus className="h-3 w-3" />
                Add seed
              </button>
            </div>
            <p className="text-[11px] text-theme-tertiary mb-2">
              Drop in specific topic titles you want covered. The AI generates the 6 questions for each. Leftover quota is filled with AI-generated topics.
            </p>
            {seedTopics.length === 0 ? (
              <div className="text-[11px] text-theme-tertiary italic px-3 py-2 rounded-lg border border-dashed border-theme-primary">
                No seed topics. The AI will generate all {topicCount} on its own.
              </div>
            ) : (
              <div className="space-y-2">
                {seedTopics.map((seed, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      value={seed}
                      onChange={(e) =>
                        setSeedTopics((prev) =>
                          prev.map((s, i) => (i === idx ? e.target.value : s)),
                        )
                      }
                      placeholder="e.g. The $400K contract you just landed"
                      className="flex-1 px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setSeedTopics((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="p-2 rounded-md text-theme-tertiary hover:text-red-500 hover:bg-red-500/10"
                      aria-label="Remove seed"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {seedTopics.filter((s) => s.trim()).length > topicCount && (
                  <p className="text-[11px] text-amber-500">
                    More seeds than topic count. Topic count will be bumped up to fit all seeds.
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleGenerate}
              isLoading={generating}
              disabled={!selectedClient}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {draftTopics.length ? 'Regenerate Batch' : 'Generate Batch'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {saturation?.saturated && (
        <Card className="card-premium border border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <p className="text-sm font-semibold text-theme-primary">
                  Material is saturating
                </p>
                <p className="text-xs text-theme-secondary">
                  This batch overlaps heavily with past topics ({Math.round(saturation.score * 100)}% average word overlap). The brand's documented material may be running thin. To get fresh angles: add seed topics manually, wait until new client work accumulates, or extend the brand profile with new wins / stories.
                </p>
                {saturation.examples.length > 0 && (
                  <ul className="text-[11px] text-theme-tertiary space-y-0.5 mt-1">
                    {saturation.examples.map((ex, i) => (
                      <li key={i}>
                        <span className="text-theme-secondary">"{ex.newTitle}"</span>
                        <span className="opacity-60"> overlaps </span>
                        <span className="text-theme-secondary">"{ex.pastTitle}"</span>
                        <span className="opacity-60"> ({Math.round(ex.overlap * 100)}%)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {draftTopics.length > 0 && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold text-theme-primary">Review Topics</h3>
                <p className="text-xs text-theme-secondary">
                  Edit titles, swap a question, or remove a topic before sharing.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={addBlankTopic}>
                <Plus className="h-4 w-4 mr-1" />
                Add topic
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {draftTopics.map((topic, tIdx) => (
              <div
                key={topic.id}
                className="rounded-xl border border-theme-primary bg-theme-tertiary/30 p-3 space-y-3"
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 h-6 w-6 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-semibold flex items-center justify-center mt-1">
                    {tIdx + 1}
                  </span>
                  <input
                    value={topic.title}
                    onChange={(e) => updateTopic(topic.id, { title: e.target.value })}
                    placeholder="Topic title (4-10 words)"
                    className="flex-1 px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm font-medium text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                  <select
                    value={topic.pillar_hint}
                    onChange={(e) =>
                      updateTopic(topic.id, { pillar_hint: e.target.value as TopicPillar })
                    }
                    className="px-2 py-2 rounded-lg border border-theme-primary bg-theme-card text-xs text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    aria-label="Pillar hint"
                  >
                    {PILLARS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeTopic(topic.id)}
                    className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg shrink-0"
                    aria-label="Remove topic"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-2 pl-8">
                  {topic.questions.map((q) => (
                    <div key={q.id} className="flex items-start gap-2">
                      <span className="shrink-0 text-[10px] px-2 py-1 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] capitalize whitespace-nowrap">
                        {INPUT_TYPE_LABEL[q.input_type] || q.input_type}
                      </span>
                      <textarea
                        value={q.text}
                        onChange={(e) => updateTopicQuestion(topic.id, q.id, { text: e.target.value })}
                        placeholder={`${INPUT_TYPE_LABEL[q.input_type]} question…`}
                        rows={2}
                        className="flex-1 px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary resize-none focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDraftTopics([])}>
                Discard
              </Button>
              <Button onClick={handleSaveAndShare} isLoading={saving}>
                <LinkIcon className="h-4 w-4 mr-2" />
                Save & Copy Share Link
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedClient && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-theme-primary">Past Forms</h3>
                <p className="text-xs text-theme-secondary">
                  Forms you&apos;ve shared with {selectedClient.name}.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchPastForms(selectedClient.id)}
                disabled={loadingForms}
              >
                <RefreshCw className={`h-4 w-4 ${loadingForms ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingForms ? (
              <p className="text-sm text-theme-secondary text-center py-4">Loading…</p>
            ) : pastForms.length === 0 ? (
              <p className="text-sm text-theme-secondary text-center py-4">
                No forms yet. Generate and share the first batch above.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-primary)] rounded-xl border border-theme-primary overflow-hidden">
                {pastForms.map((f) => {
                  const url = `${appOrigin}/questions/${f.token}`
                  const topicCountFor = Array.isArray(f.topics) ? f.topics.length : 0
                  const flatCountFor = Array.isArray(f.questions) ? f.questions.length : 0
                  const isTopicForm = topicCountFor > 0
                  const submitted = !!f.submitted_at
                  const expanded = expandedFormId === f.id
                  const summary = answersByForm[f.id]
                  return (
                    <li key={f.id} className="bg-theme-card">
                      <div className="p-3 flex flex-col md:flex-row md:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-theme-primary truncate">
                            {f.title || 'Untitled form'}
                          </p>
                          <p className="text-xs text-theme-secondary">
                            {isTopicForm
                              ? `${topicCountFor} topics`
                              : `${flatCountFor} questions`}{' '}
                            ·{' '}
                            {submitted
                              ? `Submitted ${new Date(f.submitted_at!).toLocaleDateString()}`
                              : 'Awaiting submission'}{' '}
                            · Created {new Date(f.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <IconButton
                            title={copiedUrl === url ? 'Copied' : 'Copy link'}
                            onClick={() => copyUrl(url)}
                          >
                            {copiedUrl === url ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </IconButton>
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            <IconButton title="Open link">
                              <ExternalLink className="h-4 w-4" />
                            </IconButton>
                          </a>
                          {submitted && (
                            <>
                              <IconButton
                                title={expanded ? 'Hide answers' : 'View answers'}
                                onClick={() => toggleAnswers({ id: f.id, token: f.token })}
                                active={expanded}
                              >
                                <Eye className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                title={
                                  copiedUrl === `${appOrigin}/questions/${f.token}/answers`
                                    ? 'Copied'
                                    : 'Copy answers link'
                                }
                                onClick={() =>
                                  copyUrl(`${appOrigin}/questions/${f.token}/answers`)
                                }
                              >
                                {copiedUrl === `${appOrigin}/questions/${f.token}/answers` ? (
                                  <Check className="h-4 w-4 text-green-500" />
                                ) : (
                                  <ClipboardList className="h-4 w-4" />
                                )}
                              </IconButton>
                            </>
                          )}
                          <IconButton
                            title="Delete"
                            danger
                            onClick={() => setPendingDeleteFormId(f.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </div>
                      </div>
                      {expanded && (
                        <div className="border-t border-theme-primary px-3 py-3 space-y-3">
                          {loadingAnswersFor === f.id && !summary && (
                            <p className="text-xs text-theme-tertiary">Loading answers…</p>
                          )}
                          {summary && <AnswerInlineView summary={summary} />}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmModal
        open={!!pendingDeleteFormId}
        title="Delete this form?"
        message="The share link will stop working immediately."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (!pendingDeleteFormId) return
          await deleteForm(pendingDeleteFormId)
          setPendingDeleteFormId(null)
        }}
        onClose={() => setPendingDeleteFormId(null)}
      />
    </div>
  )
}

interface AnswerSummary {
  isTopicForm: boolean
  topics: Array<{
    id: string
    title: string
    pillar_hint: string
    thin_count: number
    questions: Array<{
      id: string
      input_type: TopicInputType
      text: string
      answer: string | null
      thin_flag: boolean
      audio_url?: string | null
    }>
  }>
  answers: Array<{
    id?: string
    text: string
    pillar: string | null
    answer: string | null
    thin_flag?: boolean
    audio_url?: string | null
  }>
}

function AnswerInlineView({ summary }: { summary: AnswerSummary }) {
  if (summary.isTopicForm) {
    if (!summary.topics.length) {
      return <p className="text-xs text-theme-tertiary">No answers found.</p>
    }
    return (
      <div className="space-y-3">
        {summary.topics.map((t) => (
          <div key={t.id} className="rounded-lg bg-[var(--bg-tertiary)]/50 p-2">
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-xs font-semibold text-theme-primary">{t.title}</p>
              {t.thin_count > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 inline-flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {t.thin_count} thin
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {t.questions.map((q) => (
                <div key={q.id} className="text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-card-hover)] text-theme-secondary capitalize">
                      {INPUT_TYPE_LABEL[q.input_type] || q.input_type}
                    </span>
                    {q.thin_flag && (
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                    )}
                  </div>
                  <p className="text-theme-secondary mt-0.5 ml-1 whitespace-pre-wrap">
                    {q.answer || (
                      <span className="text-theme-tertiary italic">No answer</span>
                    )}
                  </p>
                  {q.audio_url && (
                    <audio controls src={q.audio_url} className="mt-1.5 ml-1 h-8 w-full max-w-xs" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (!summary.answers.length) {
    return <p className="text-xs text-theme-tertiary">No answers found.</p>
  }
  return (
    <ol className="space-y-3 list-decimal list-inside">
      {summary.answers.map((a, i) => (
        <li key={i} className="text-xs">
          <span className="text-theme-primary font-medium">{a.text}</span>
          {a.thin_flag && (
            <AlertTriangle className="inline h-3 w-3 text-amber-500 ml-1" />
          )}
          <p className="mt-1 ml-5 text-theme-secondary whitespace-pre-wrap">
            {a.answer || <span className="text-theme-tertiary italic">No answer</span>}
          </p>
          {a.audio_url && (
            <audio controls src={a.audio_url} className="mt-1.5 ml-5 h-8 w-full max-w-xs" />
          )}
        </li>
      ))}
    </ol>
  )
}

function IconButton({
  children,
  onClick,
  title,
  danger,
  active,
}: {
  children: React.ReactNode
  onClick?: () => void
  title?: string
  danger?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`h-8 w-8 inline-flex items-center justify-center rounded-lg transition-colors ${
        danger
          ? 'text-red-500 hover:bg-red-500/10'
          : active
            ? 'text-[#2B79F7] bg-[#2B79F7]/10'
            : 'text-theme-secondary hover:text-theme-primary hover:bg-theme-card-hover'
      }`}
    >
      {children}
    </button>
  )
}
