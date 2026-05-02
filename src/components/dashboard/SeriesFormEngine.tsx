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
  Layers,
  Clock,
} from 'lucide-react'
import { defaultBrandProfile, normalizeBrandProfile, type BrandProfile } from '../clients/brandProfile'
import {
  SERIES_LABELS,
  SERIES_FORMATS,
  SERIES_FRAMINGS,
  type SeriesFormat,
  type SeriesFraming,
  type SeriesLabel,
  type SeriesQuestion,
  type SeriesBeatType,
} from '@/lib/types/seriesForm'
import { ClientPicker } from './ClientPicker'
import { copyToClipboard } from '@/lib/util/clipboard'
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

interface PastForm {
  id: string
  client_id: string
  token: string
  title: string
  series_label: SeriesLabel
  series_length: number
  format: SeriesFormat
  framing: SeriesFraming | null
  submitted_at: string | null
  created_at: string
  answer_count: number
}

const BEAT_TYPES: SeriesBeatType[] = [
  'lesson',
  'story',
  'progress',
  'tip',
  'mistake',
  'win',
  'belief',
]

function buildProfileForClient(c: ClientRow): BrandProfile {
  if (c.brand_profile) return normalizeBrandProfile(c.brand_profile)
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

export function SeriesFormEngine() {
  const supabase = useMemo(() => createClient(), [])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [selectedClientId, setSelectedClientId] = useState(readStashedClientId)
  useApplyClientPreselect(selectedClientId, setSelectedClientId, clients)

  // Series setup
  const [title, setTitle] = useState('')
  const [framing, setFraming] = useState<SeriesFraming>('lessons')
  const [seriesLabel, setSeriesLabel] = useState<SeriesLabel>('Day')
  const [seriesLength, setSeriesLength] = useState(30)
  const [format, setFormat] = useState<SeriesFormat>('short')
  const [brandLine, setBrandLine] = useState('')
  const [ctaText, setCtaText] = useState('')

  // Drafted questions before save
  const [draft, setDraft] = useState<SeriesQuestion[]>([])
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [shortfall, setShortfall] = useState(0)

  // Past forms
  const [pastForms, setPastForms] = useState<PastForm[]>([])
  const [loadingForms, setLoadingForms] = useState(false)

  // Copy state
  const [copiedUrl, setCopiedUrl] = useState('')

  // Build-prompt state
  const [buildingPromptId, setBuildingPromptId] = useState<string | null>(null)
  const [builtPromptForId, setBuiltPromptForId] = useState<string | null>(null)
  const [builtPrompt, setBuiltPrompt] = useState('')
  const [promptCopied, setPromptCopied] = useState(false)

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  )

  const fetchClients = useCallback(async () => {
    setLoadingClients(true)
    const { data } = await supabase
      .from('clients')
      .select('*')
      .is('archived_at', null)
      .order('name')
    setClients((data || []) as ClientRow[])
    setLoadingClients(false)
  }, [supabase])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  const fetchPastForms = useCallback(async (clientId: string) => {
    setLoadingForms(true)
    try {
      const res = await fetch(`/api/series-form/list?clientId=${encodeURIComponent(clientId)}`)
      const data = await res.json()
      if (data.success) setPastForms(data.forms as PastForm[])
    } finally {
      setLoadingForms(false)
    }
  }, [])

  useEffect(() => {
    setDraft([])
    setError('')
    setShortfall(0)
    setBuiltPromptForId(null)
    setBuiltPrompt('')
    if (selectedClientId) fetchPastForms(selectedClientId)
    else setPastForms([])
  }, [selectedClientId, fetchPastForms])

  const handleGenerate = async () => {
    if (!selectedClient) {
      setError('Pick a client first.')
      return
    }
    if (!title.trim()) {
      setError('Give the series a title (e.g. "30 lessons by 30").')
      return
    }
    setError('')
    setShortfall(0)
    setGenerating(true)
    try {
      const res = await fetch('/api/series-form/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientProfile: buildProfileForClient(selectedClient),
          clientName: selectedClient.name,
          businessName: selectedClient.business_name,
          industry: selectedClient.industry,
          title: title.trim(),
          framing,
          seriesLabel,
          seriesLength,
          format,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Generation failed')
      setDraft(data.questions as SeriesQuestion[])
      setShortfall(data.shortfall || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  const updateQuestion = (id: string, patch: Partial<SeriesQuestion>) => {
    setDraft((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const removeQuestion = (id: string) => {
    setDraft((prev) =>
      prev.filter((q) => q.id !== id).map((q, idx) => ({ ...q, entry_index: idx + 1 })),
    )
  }

  const addBlankQuestion = () => {
    setDraft((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text: '',
        entry_index: prev.length + 1,
        beat_type: 'story',
      },
    ])
  }

  const handleSaveAndShare = async () => {
    if (!selectedClient) return
    const cleaned = draft
      .filter((q) => q.text.trim())
      .map((q, idx) => ({ ...q, entry_index: idx + 1 }))
    if (!cleaned.length) {
      setError('Add at least one question with text.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/series-form/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          title: title.trim(),
          seriesLabel,
          seriesLength: cleaned.length,
          format,
          framing,
          brandLine: brandLine.trim() || null,
          ctaText: ctaText.trim() || null,
          questions: cleaned,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Save failed')
      setDraft([])
      setTitle('')
      setBrandLine('')
      setCtaText('')
      await fetchPastForms(selectedClient.id)
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(data.url).catch(() => {})
      }
      setCopiedUrl(data.url)
      setTimeout(() => setCopiedUrl(''), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleBuildPrompt = async (formId: string) => {
    setBuildingPromptId(formId)
    setBuiltPromptForId(null)
    setBuiltPrompt('')
    try {
      const res = await fetch('/api/series-form/build-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesFormId: formId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Build failed')
      setBuiltPromptForId(formId)
      setBuiltPrompt(data.prompt)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuildingPromptId(null)
    }
  }

  const copyUrl = (url: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(url).catch(() => {})
    setCopiedUrl(url)
    setTimeout(() => setCopiedUrl(''), 2000)
  }

  const copyPrompt = async () => {
    if (!builtPrompt) return
    const ok = await copyToClipboard(builtPrompt)
    if (!ok) return
    setPromptCopied(true)
    setTimeout(() => setPromptCopied(false), 2000)
  }

  const deleteForm = async (id: string) => {
    setPastForms((prev) => prev.filter((f) => f.id !== id))
    if (builtPromptForId === id) {
      setBuiltPromptForId(null)
      setBuiltPrompt('')
    }
    await fetch('/api/series-form/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  }

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="space-y-6">
      <Card className="card-premium">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#2B79F7]" />
            <h3 className="text-sm font-semibold text-theme-primary">Series Form Generator</h3>
          </div>
          <p className="text-[11px] text-theme-tertiary mt-0.5">
            Build a per-entry intake form for a multi-day series. The client fills it out, then
            you build one external prompt anchored to their actual answers — no AI invention.
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Series title (the brand line)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='e.g. "30 lessons by 30" or "60 days of selling"'
                className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Open every entry with (optional)
              </label>
              <input
                type="text"
                value={brandLine}
                onChange={(e) => setBrandLine(e.target.value)}
                placeholder='e.g. "30 lessons by 30, lesson"'
                className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
              <p className="text-[10px] text-theme-secondary mt-1">
                The literal phrase that opens every entry, e.g. &quot;30 lessons by 30, lesson 18.&quot; If empty, opens just with the entry label (&quot;Day 18.&quot;).
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] uppercase tracking-wide font-medium text-theme-tertiary">Framing</label>
            <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-full border border-theme-primary bg-theme-card">
              {SERIES_FRAMINGS.map((f) => {
                const active = framing === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFraming(f.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      active
                        ? 'bg-[#2B79F7] text-white shadow-sm'
                        : 'text-theme-secondary hover:text-theme-primary hover:bg-theme-card-hover'
                    }`}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
            {(() => {
              const activeFraming = SERIES_FRAMINGS.find((f) => f.id === framing)
              return activeFraming ? (
                <p className="text-[11px] text-theme-tertiary px-1">{activeFraming.description}</p>
              ) : null
            })()}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Entry label
              </label>
              <select
                value={seriesLabel}
                onChange={(e) => setSeriesLabel(e.target.value as SeriesLabel)}
                className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              >
                {SERIES_LABELS.map((l) => (
                  <option key={l} value={l}>
                    {l} 1, {l} 2, ...
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Length (1-60)
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={seriesLength}
                onChange={(e) =>
                  setSeriesLength(Math.max(1, Math.min(60, Number(e.target.value) || 1)))
                }
                className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as SeriesFormat)}
                className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              >
                {SERIES_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-primary mb-1">
              Optional CTA (used at the end of relevant entries)
            </label>
            <textarea
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              placeholder="e.g. Comment SERIES and I'll send you the breakdown."
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary resize-none focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            />
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleGenerate}
              isLoading={generating}
              disabled={!selectedClientId || !title.trim()}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {draft.length ? 'Regenerate questions' : 'Generate questions'}
            </Button>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {draft.length > 0 && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-sm font-semibold text-theme-primary">
                  Draft questions ({draft.length})
                </h3>
                <p className="text-[11px] text-theme-tertiary mt-0.5">
                  Edit anything that&rsquo;s off, drop weak ones, then save and share the link.
                </p>
                {shortfall > 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded mt-2 inline-block">
                    Profile only supported {draft.length} entries (you asked for {draft.length + shortfall}). Add more to the brand profile if you want a longer series.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={addBlankQuestion}>
                  <Plus className="h-4 w-4 mr-1" /> Add question
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveAndShare}
                  isLoading={saving}
                  disabled={!draft.length}
                >
                  <LinkIcon className="h-4 w-4 mr-1" /> Save & generate link
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {draft.map((q, idx) => (
              <div
                key={q.id}
                className="p-3 rounded-lg border border-theme-primary bg-theme-card space-y-2"
              >
                <div className="flex items-start gap-3">
                  <span className="shrink-0 h-7 w-7 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-semibold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <div className="flex-1 space-y-2">
                    <textarea
                      value={q.text}
                      onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                      rows={2}
                      placeholder="Question text..."
                      className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-bg text-sm text-theme-primary resize-none focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-theme-secondary mb-1">
                          Beat type
                        </label>
                        <select
                          value={q.beat_type}
                          onChange={(e) =>
                            updateQuestion(q.id, { beat_type: e.target.value as SeriesBeatType })
                          }
                          className="w-full px-2 py-1.5 rounded-md border border-theme-primary bg-theme-bg text-xs text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                        >
                          {BEAT_TYPES.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-theme-secondary mb-1">
                          Anchor (read-only)
                        </label>
                        <p className="text-[11px] text-theme-secondary truncate px-2 py-1.5 bg-theme-bg rounded-md">
                          {q.anchor_field
                            ? `${q.anchor_field}${q.anchor_value ? ` · ${q.anchor_value}` : ''}`
                            : 'no anchor'}
                        </p>
                      </div>
                    </div>
                    {q.placeholder && (
                      <p className="text-[10px] text-theme-secondary italic">
                        Placeholder: {q.placeholder}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQuestion(q.id)}
                    className="p-1.5 text-theme-tertiary hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                    aria-label="Remove question"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {selectedClient && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-[#2B79F7]" />
              <h3 className="text-sm font-semibold text-theme-primary">Past series forms</h3>
              {pastForms.length > 0 && (
                <span className="text-[11px] text-theme-tertiary">({pastForms.length})</span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingForms ? (
              <p className="text-sm text-theme-secondary">Loading…</p>
            ) : pastForms.length === 0 ? (
              <p className="text-sm text-theme-secondary">
                No series forms yet. Generate questions above and save to create your first.
              </p>
            ) : (
              <div className="space-y-2">
                {pastForms.map((f) => {
                  const url = `${appOrigin}/series/${f.token}`
                  const submitted = !!f.submitted_at
                  return (
                    <div
                      key={f.id}
                      className="p-3 rounded-lg border border-theme-primary bg-theme-card"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-theme-primary truncate">
                            {f.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-theme-secondary">
                            <span className="px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD]">
                              {f.series_length} {f.series_label.toLowerCase()}s
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                              {f.format}
                            </span>
                            {f.framing && (
                              <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                                {f.framing}
                              </span>
                            )}
                            {submitted ? (
                              <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                Submitted · {f.answer_count} answers
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" /> Awaiting answers
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => copyUrl(url)}>
                            {copiedUrl === url ? (
                              <>
                                <Check className="h-4 w-4 mr-1" /> Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4 mr-1" /> Copy link
                              </>
                            )}
                          </Button>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center px-2 py-1 rounded-md border border-theme-primary text-xs text-theme-secondary hover:bg-theme-card"
                          >
                            <ExternalLink className="h-3 w-3 mr-1" /> Preview
                          </a>
                          {submitted && (
                            <Button
                              size="sm"
                              onClick={() => handleBuildPrompt(f.id)}
                              isLoading={buildingPromptId === f.id}
                            >
                              {builtPromptForId === f.id ? (
                                <>
                                  <RefreshCw className="h-4 w-4 mr-1" /> Rebuild
                                </>
                              ) : (
                                <>
                                  <Sparkles className="h-4 w-4 mr-1" /> Build prompt
                                </>
                              )}
                            </Button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(f.id)}
                            className="p-1.5 text-theme-tertiary hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                            aria-label="Delete form"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {builtPrompt && builtPromptForId && (
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-sm font-semibold text-theme-primary">External Prompt</h3>
                <p className="text-[11px] text-theme-tertiary mt-0.5">
                  One copy, one paste. The client&rsquo;s actual answers are baked in — the
                  external AI builds each entry from their words, not from inference.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={copyPrompt}>
                {promptCopied ? (
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
          </CardHeader>
          <CardContent>
            <textarea
              value={builtPrompt}
              readOnly
              rows={20}
              className="w-full px-4 py-3 rounded-lg border border-theme-primary bg-theme-bg text-theme-primary font-mono text-xs leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            />
            <p className="mt-2 text-[11px] text-theme-secondary">
              Paste into ChatGPT, Claude, or Gemini. The prompt instructs the AI to deliver in
              batches of 10 - reply &quot;continue&quot; in the same chat to get the next batch.
            </p>
          </CardContent>
        </Card>
      )}

      <ConfirmModal
        open={!!pendingDeleteId}
        title="Delete this series form?"
        message="The form, its link, and all client answers for it will be removed. This can't be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (!pendingDeleteId) return
          await deleteForm(pendingDeleteId)
          setPendingDeleteId(null)
        }}
        onClose={() => setPendingDeleteId(null)}
      />
    </div>
  )
}
