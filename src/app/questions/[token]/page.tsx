/* eslint-disable @next/next/no-img-element */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { CheckCircle, AlertCircle, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import type {
  FormQuestion,
  FormTopic,
  FormTopicQuestion,
  TopicInputType,
} from '@/lib/types/questionForm'
import { useFormPersistence } from '@/hooks/useFormPersistence'

interface PublicClient {
  id: string
  name: string | null
  business_name: string | null
  profile_picture_url: string | null
  industry: string | null
}

interface PublicForm {
  id: string
  title: string | null
  questions: FormQuestion[]
  topics: FormTopic[]
  pillars: string[]
  already_submitted: boolean
}

interface Prefill {
  answers: Record<string, string>
  topicAnswers: Record<string, Record<string, string>>
  thinFlags: Record<string, boolean>
}

const PILLAR_LABEL: Record<string, string> = {
  educational: 'Educational',
  storytelling: 'Storytelling',
  authority: 'Authority',
  series: 'Series',
  doubledown: 'Double Down',
}

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

// Doc 10.3 spec: thin if word count < 25 AND no number / no proper noun /
// no quoted phrase. Trust the client check; the server doesn't recompute.
function isThinAnswer(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false // empty is "not thin", just unanswered
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  if (wordCount >= 25) return false
  if (/\d/.test(trimmed)) return false
  // Proper noun: a capital letter mid-sentence (skip the very first char so
  // "I had ..." or sentence-start capitals aren't counted as proper nouns).
  if (/\b[A-Z][a-z]+/.test(trimmed.replace(/^[A-Z]/, ''))) return false
  if (/["'']/.test(trimmed)) return false
  return true
}

export default function QuestionFormPage() {
  const params = useParams()
  const token = (params?.token as string) || ''

  const [form, setForm] = useState<PublicForm | null>(null)
  const [client, setClient] = useState<PublicClient | null>(null)

  // Persisted draft state. We keep two maps so we can drive both legacy
  // and topic forms from the same persistence hook.
  const [answers, setAnswers, clearAnswers] = useFormPersistence<Record<string, string>>(
    `question-form:${token}`,
    {},
  )
  const [topicAnswers, setTopicAnswers, clearTopicAnswers] = useFormPersistence<
    Record<string, Record<string, string>>
  >(`question-form-topics:${token}`, {})
  // Voice-note URLs keyed by question id (unique across legacy + topic forms).
  const [audioUrls, setAudioUrls, clearAudioUrls] = useFormPersistence<Record<string, string>>(
    `question-form-audio:${token}`,
    {},
  )

  const [prefilled, setPrefilled] = useState(false)
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/question-form/info?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (!data.success) {
          setError(data.error || 'Invalid link')
          return
        }
        const f = data.form as PublicForm
        setForm(f)
        setClient((data.client as PublicClient) || null)

        // Pre-fill from server only when the local draft is empty - if the
        // user has been editing locally we don't want to clobber their work
        // with the saved-on-the-server snapshot.
        const prefill = data.prefill as Prefill | null
        if (prefill && !prefilled) {
          setPrefilled(true)
          if (Object.keys(answers).length === 0 && Object.keys(prefill.answers || {}).length) {
            setAnswers(prefill.answers)
          }
          if (
            Object.keys(topicAnswers).length === 0 &&
            Object.keys(prefill.topicAnswers || {}).length
          ) {
            setTopicAnswers(prefill.topicAnswers)
          }
        }

        // Open the first topic by default. Subsequent topics start collapsed
        // so the page doesn't feel like a wall of textareas.
        if (f.topics.length && expandedTopics.size === 0) {
          setExpandedTopics(new Set([f.topics[0].id]))
        }
      } catch (e) {
        console.error('question-form load error:', e)
        setError('Failed to load form')
      } finally {
        setIsLoading(false)
      }
    }
    if (token) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const isTopicForm = !!form?.topics?.length

  const totalQuestions = useMemo(() => {
    if (!form) return 0
    return isTopicForm
      ? form.topics.reduce((sum, t) => sum + t.questions.length, 0)
      : form.questions.length
  }, [form, isTopicForm])

  const answeredCount = useMemo(() => {
    if (!form) return 0
    if (isTopicForm) {
      let n = 0
      for (const t of form.topics) {
        const ans = topicAnswers[t.id] || {}
        for (const q of t.questions) {
          if (ans[q.id]?.trim()) n++
        }
      }
      return n
    }
    return Object.values(answers).filter((v) => v && v.trim().length > 0).length
  }, [form, isTopicForm, answers, topicAnswers])

  // Count answers that are filled in but read thin - the ones that may not
  // turn into content. Drives the per-topic chip and the submit nudge.
  const thinCount = useMemo(() => {
    if (!form) return 0
    if (isTopicForm) {
      let n = 0
      for (const t of form.topics) {
        const ans = topicAnswers[t.id] || {}
        for (const q of t.questions) {
          const v = ans[q.id]
          if (v && v.trim() && isThinAnswer(v)) n++
        }
      }
      return n
    }
    return Object.values(answers).filter((v) => v && v.trim() && isThinAnswer(v)).length
  }, [form, isTopicForm, answers, topicAnswers])

  const handleLegacyChange = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  const handleTopicChange = (topicId: string, qid: string, value: string) => {
    setTopicAnswers((prev) => ({
      ...prev,
      [topicId]: { ...(prev[topicId] || {}), [qid]: value },
    }))
  }

  const handleAudioChange = (qid: string, url: string | null) => {
    setAudioUrls((prev) => {
      const next = { ...prev }
      if (url) next[qid] = url
      else delete next[qid]
      return next
    })
  }

  const toggleTopic = (id: string) => {
    setExpandedTopics((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async () => {
    if (!form) return
    setIsSubmitting(true)
    setError('')
    try {
      // Build thinFlags map from the current draft state.
      const thinFlags: Record<string, boolean> = {}
      if (isTopicForm) {
        for (const t of form.topics) {
          const ans = topicAnswers[t.id] || {}
          for (const q of t.questions) {
            const v = ans[q.id] || ''
            if (v.trim() && isThinAnswer(v)) thinFlags[q.id] = true
          }
        }
      } else {
        for (const q of form.questions) {
          const v = answers[q.id] || ''
          if (v.trim() && isThinAnswer(v)) thinFlags[q.id] = true
        }
      }

      const res = await fetch('/api/question-form/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          ...(isTopicForm ? { topicAnswers } : { answers }),
          audioUrls,
          thinFlags,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Failed to submit')
      } else {
        clearAnswers()
        clearTopicAnswers()
        clearAudioUrls()
        setSuccess(true)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (e) {
      console.error('question-form submit error:', e)
      setError('Failed to submit')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen form-canvas flex items-center justify-center">
        <p className="text-[var(--text-tertiary)]">Loading…</p>
      </div>
    )
  }

  if (error && !form) {
    return (
      <div className="min-h-screen form-canvas flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Link not available</h2>
            <p className="text-[var(--text-tertiary)]">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen form-canvas flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Thanks - we got it!</h2>
            <p className="text-[var(--text-tertiary)]">
              Your answers are being turned into content ideas right now. You can close this page,
              or come back to this link any time to update your answers.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!form) return null

  const displayName = client?.business_name || client?.name || 'your brand'
  const submitLabel = form.already_submitted ? 'Update Answers' : 'Submit Answers'

  return (
    <div className="min-h-screen form-canvas">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <Card>
          <CardContent className="p-6 md:p-8">
            <div className="flex items-center gap-4 mb-4">
              {client?.profile_picture_url ? (
                <img
                  src={client.profile_picture_url}
                  alt={client.name || ''}
                  className="h-14 w-14 rounded-full object-cover"
                />
              ) : (
                <div className="h-14 w-14 rounded-full bg-brand-gradient flex items-center justify-center text-white font-bold text-lg">
                  {(displayName || 'C').charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-[var(--text-primary)]">
                  {form.title || 'Content Braindump'}
                </h1>
                <p className="text-sm text-[var(--text-tertiary)]">for {displayName}</p>
              </div>
            </div>

            <p className="text-sm text-[var(--text-secondary)]">
              Answer what you can. Every answer becomes a script. Specifics win - real stories,
              mistakes, wins, and hot takes turn into content that actually sounds like you.
              {form.already_submitted && (
                <span className="block mt-2 text-xs text-[var(--text-tertiary)]">
                  You&apos;ve submitted this before. Your previous answers are loaded below - tweak
                  what you like and resubmit.
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        {isTopicForm ? (
          form.topics.map((topic, tIdx) => {
            const expanded = expandedTopics.has(topic.id)
            const topicAns = topicAnswers[topic.id] || {}
            const answeredHere = topic.questions.filter((q) => topicAns[q.id]?.trim()).length
            const thinHere = topic.questions.filter((q) => {
              const v = topicAns[q.id]
              return !!v && !!v.trim() && isThinAnswer(v)
            }).length
            return (
              <Card key={topic.id}>
                <button
                  type="button"
                  onClick={() => toggleTopic(topic.id)}
                  className="w-full text-left"
                  aria-expanded={expanded}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="shrink-0 h-7 w-7 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-semibold flex items-center justify-center">
                          {tIdx + 1}
                        </span>
                        <div className="flex-1">
                          <h3 className="text-base font-semibold text-[var(--text-primary)]">
                            {topic.title}
                          </h3>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)] whitespace-nowrap">
                            <span className="uppercase tracking-[0.08em] font-semibold">
                              {PILLAR_LABEL[topic.pillar_hint] || topic.pillar_hint}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {answeredHere} of {topic.questions.length} answered
                            </span>
                            {thinHere > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-600 dark:text-amber-500 font-semibold">
                                  {thinHere} need{thinHere === 1 ? 's' : ''} detail
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="text-[var(--text-tertiary)] shrink-0">
                        {expanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </span>
                    </div>
                  </CardHeader>
                </button>
                {expanded && (
                  <CardContent className="pt-0 space-y-4">
                    {topic.questions.map((q) => (
                      <TopicQuestionField
                        key={q.id}
                        question={q}
                        value={topicAns[q.id] || ''}
                        onChange={(v) => handleTopicChange(topic.id, q.id, v)}
                        audioUrl={audioUrls[q.id] ?? null}
                        onAudioChange={(url) => handleAudioChange(q.id, url)}
                      />
                    ))}
                  </CardContent>
                )}
              </Card>
            )
          })
        ) : (
          form.questions.map((q, idx) => (
            <Card key={q.id}>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <span className="shrink-0 h-7 w-7 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-semibold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-[var(--text-primary)]">{q.text}</h3>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--text-tertiary)] whitespace-nowrap">
                      {PILLAR_LABEL[q.pillar] || q.pillar}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <LegacyAnswerField
                  value={answers[q.id] ?? ''}
                  placeholder={q.placeholder}
                  onChange={(v) => handleLegacyChange(q.id, v)}
                  audioUrl={audioUrls[q.id] ?? null}
                  onAudioChange={(url) => handleAudioChange(q.id, url)}
                />
              </CardContent>
            </Card>
          ))
        )}

        {error && (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        {thinCount > 0 && (
          <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {thinCount} answer{thinCount === 1 ? ' is' : 's are'} a little short and may not turn into content.
              Add a specific moment, number, or name to each. You can still submit as is.
            </span>
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-[var(--text-tertiary)]">
            {answeredCount} of {totalQuestions} answered
            {thinCount > 0 && (
              <span className="text-amber-600 dark:text-amber-500"> · {thinCount} need detail</span>
            )}
          </p>
          <Button
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={answeredCount === 0}
            size="lg"
          >
            {submitLabel}
          </Button>
        </div>

        <p className="text-xs text-[var(--text-tertiary)] text-center">Powered by Fokus Kreativez</p>
      </div>
    </div>
  )
}

function ThinNudge() {
  return (
    <div className="mt-2 flex items-start gap-2 text-xs text-[var(--text-tertiary)] bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-2">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
      <span>
        This reads thin - can you ground it? A specific moment (&quot;It was Tuesday morning when…&quot;),
        a number, or a name makes it usable. You can save anyway.
      </span>
    </div>
  )
}

function LegacyAnswerField({
  value,
  placeholder,
  onChange,
  audioUrl,
  onAudioChange,
}: {
  value: string
  placeholder?: string
  onChange: (v: string) => void
  audioUrl?: string | null
  onAudioChange?: (url: string | null) => void
}) {
  const [touched, setTouched] = useState(false)
  const showThin = touched && !!value.trim() && isThinAnswer(value)
  return (
    <div>
      <VoiceTextarea
        value={value}
        onChange={onChange}
        onBlur={() => setTouched(true)}
        audioUrl={audioUrl}
        onAudioChange={onAudioChange}
        uploadFolder="voice-notes/questions"
        placeholder={placeholder || 'Type your answer - 2 to 6 sentences, or tap the mic to record.'}
        rows={4}
        className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
      />
      {showThin && <ThinNudge />}
    </div>
  )
}

function TopicQuestionField({
  question,
  value,
  onChange,
  audioUrl,
  onAudioChange,
}: {
  question: FormTopicQuestion
  value: string
  onChange: (v: string) => void
  audioUrl?: string | null
  onAudioChange?: (url: string | null) => void
}) {
  const [touched, setTouched] = useState(false)
  const showThin = touched && !!value.trim() && isThinAnswer(value)
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--text-tertiary)] mb-1.5 whitespace-nowrap">
        {INPUT_TYPE_LABEL[question.input_type] || question.input_type}
      </div>
      <p className="text-sm text-[var(--text-primary)] font-medium mb-2">{question.text}</p>
      <VoiceTextarea
        value={value}
        onChange={onChange}
        onBlur={() => setTouched(true)}
        audioUrl={audioUrl}
        onAudioChange={onAudioChange}
        uploadFolder="voice-notes/questions"
        placeholder={question.placeholder || 'Type your answer - 2 to 6 sentences, or tap the mic to record.'}
        rows={4}
        className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
      />
      {showThin && <ThinNudge />}
    </div>
  )
}
