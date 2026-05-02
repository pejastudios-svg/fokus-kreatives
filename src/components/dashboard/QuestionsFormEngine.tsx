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
} from 'lucide-react'
import { defaultBrandProfile, type BrandProfile } from '../clients/brandProfile'
import type { FormQuestion, QuestionForm } from '@/lib/types/questionForm'
import type { TopicPillar } from '@/lib/types/topics'
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
}

const PILLARS: { id: TopicPillar; label: string }[] = [
  { id: 'educational', label: 'Educational' },
  { id: 'storytelling', label: 'Storytelling' },
  { id: 'authority', label: 'Authority' },
  { id: 'series', label: 'Series' },
  { id: 'doubledown', label: 'Double Down' },
]

const DEFAULT_PILLARS: TopicPillar[] = ['educational', 'storytelling', 'authority']

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

export function QuestionsFormEngine() {
  const supabase = useMemo(() => createClient(), [])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [selectedClientId, setSelectedClientId] = useState(readStashedClientId)
  useApplyClientPreselect(selectedClientId, setSelectedClientId, clients)

  const [pillars, setPillars] = useState<TopicPillar[]>(DEFAULT_PILLARS)
  const [count, setCount] = useState(12)
  const [title, setTitle] = useState('')

  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<FormQuestion[]>([])
  const [error, setError] = useState('')

  const [pastForms, setPastForms] = useState<QuestionForm[]>([])
  const [loadingForms, setLoadingForms] = useState(false)

  const [copiedUrl, setCopiedUrl] = useState('')

  // Inline answers viewer: when the agency clicks the Eye icon on a
  // submitted form, we fetch the question/answer pairs and expand the
  // row to show them. Cached per-form so toggling closed/open is free.
  const [expandedFormId, setExpandedFormId] = useState<string | null>(null)
  const [answersByForm, setAnswersByForm] = useState<
    Record<string, { text: string; pillar: string | null; answer: string | null }[]>
  >({})
  const [loadingAnswersFor, setLoadingAnswersFor] = useState<string | null>(null)

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  )

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
    setDraft([])
    setError('')
    if (selectedClientId) fetchPastForms(selectedClientId)
    else setPastForms([])
  }, [selectedClientId, fetchPastForms])

  const togglePillar = (id: TopicPillar) => {
    setPillars((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    )
  }

  const handleGenerate = async () => {
    if (!selectedClient) {
      setError('Pick a client first.')
      return
    }
    if (!pillars.length) {
      setError('Select at least one pillar.')
      return
    }
    setError('')
    setGenerating(true)
    try {
      const res = await fetch('/api/question-form/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientProfile: buildProfileForClient(selectedClient),
          clientName: selectedClient.name,
          businessName: selectedClient.business_name,
          industry: selectedClient.industry,
          pillars,
          count,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Generation failed')
      setDraft(data.questions as FormQuestion[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  const updateQuestion = (id: string, patch: Partial<FormQuestion>) => {
    setDraft((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const removeQuestion = (id: string) => {
    setDraft((prev) => prev.filter((q) => q.id !== id))
  }

  const addBlankQuestion = () => {
    setDraft((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text: '',
        pillar: pillars[0] || 'educational',
        placeholder: '',
      },
    ])
  }

  const handleSaveAndShare = async () => {
    if (!selectedClient) return
    const cleaned = draft.filter((q) => q.text.trim())
    if (!cleaned.length) {
      setError('Add at least one question with text.')
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
          questions: cleaned,
          pillars,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Save failed')
      setDraft([])
      setTitle('')
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
        setAnswersByForm((prev) => ({ ...prev, [form.id]: data.answers }))
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
            <h3 className="text-sm font-semibold text-theme-primary">Question Form Generator</h3>
          </div>
          <p className="text-[11px] text-theme-tertiary mt-0.5">
            Generate a braindump form tailored to this client. Answers drop straight into their
            Topics Bank.
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

          <div>
            <label className="block text-sm font-medium text-theme-primary mb-2">
              Pillars to cover
            </label>
            <div className="flex flex-wrap gap-2">
              {PILLARS.map((p) => {
                const active = pillars.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePillar(p.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-[#2B79F7] dark:bg-[#1E2A41] text-white border-[#2B79F7] hover:bg-[#5A9AFF] dark:hover:bg-[#243352]'
                        : 'bg-theme-card text-theme-secondary dark:text-white border-theme-primary hover:border-[#5A9AFF] hover:bg-[var(--bg-card-hover)]'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                # of questions
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 12)))}
                className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Form title (optional)
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q2 Content Braindump"
                className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleGenerate}
              isLoading={generating}
              disabled={!selectedClient || !pillars.length}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {draft.length ? 'Regenerate Questions' : 'Generate Questions'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {draft.length > 0 && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold text-theme-primary">Review Questions</h3>
                <p className="text-xs text-theme-secondary">
                  Edit, reorder, or remove anything before you share the link.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={addBlankQuestion}>
                <Plus className="h-4 w-4 mr-1" />
                Add question
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {draft.map((q, idx) => (
              <div
                key={q.id}
                className="rounded-xl border border-theme-primary bg-theme-tertiary/30 p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 h-6 w-6 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-semibold flex items-center justify-center mt-1">
                    {idx + 1}
                  </span>
                  <textarea
                    value={q.text}
                    onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                    rows={2}
                    placeholder="Question text…"
                    className="flex-1 px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary resize-none focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                  <button
                    type="button"
                    onClick={() => removeQuestion(q.id)}
                    className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg shrink-0"
                    aria-label="Remove question"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap pl-8">
                  <select
                    value={q.pillar}
                    onChange={(e) => updateQuestion(q.id, { pillar: e.target.value as TopicPillar })}
                    className="px-2 py-1 rounded-lg border border-theme-primary bg-theme-card text-xs text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  >
                    {PILLARS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={q.placeholder || ''}
                    onChange={(e) => updateQuestion(q.id, { placeholder: e.target.value })}
                    placeholder="Placeholder hint (optional)"
                    className="flex-1 min-w-[200px] px-2 py-1 rounded-lg border border-theme-primary bg-theme-card text-xs text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDraft([])}>
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
                No forms yet. Generate and share the first one above.
              </p>
            ) : (
              <ul className="divide-y divide-theme-primary rounded-xl border border-theme-primary overflow-hidden">
                {pastForms.map((f) => {
                  const url = `${appOrigin}/questions/${f.token}`
                  const qCount = Array.isArray(f.questions) ? f.questions.length : 0
                  const submitted = !!f.submitted_at
                  const expanded = expandedFormId === f.id
                  const answers = answersByForm[f.id]
                  return (
                    <li key={f.id} className="bg-theme-card">
                      <div className="p-3 flex flex-col md:flex-row md:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-theme-primary truncate">
                            {f.title || 'Untitled form'}
                          </p>
                          <p className="text-xs text-theme-secondary">
                            {qCount} questions ·{' '}
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
                          {loadingAnswersFor === f.id && !answers && (
                            <p className="text-xs text-theme-tertiary">Loading answers…</p>
                          )}
                          {answers && answers.length === 0 && (
                            <p className="text-xs text-theme-tertiary">No answers found.</p>
                          )}
                          {answers && answers.length > 0 && (
                            <ol className="space-y-3 list-decimal list-inside">
                              {answers.map((a, i) => (
                                <li key={i} className="text-xs">
                                  <span className="text-theme-primary font-medium">{a.text}</span>
                                  <p className="mt-1 ml-5 text-theme-secondary whitespace-pre-wrap">
                                    {a.answer || (
                                      <span className="text-theme-tertiary italic">No answer</span>
                                    )}
                                  </p>
                                </li>
                              ))}
                            </ol>
                          )}
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
