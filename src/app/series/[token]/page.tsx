/* eslint-disable @next/next/no-img-element */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { Button } from '@/components/ui/Button'
import { CheckCircle, AlertCircle, Sparkles } from 'lucide-react'
import type {
  SeriesFormat,
  SeriesFraming,
  SeriesLabel,
  SeriesQuestion,
} from '@/lib/types/seriesForm'
import { useFormPersistence } from '@/hooks/useFormPersistence'

interface PublicClient {
  id: string
  name: string | null
  business_name: string | null
  profile_picture_url: string | null
  industry: string | null
}

interface PublicSeriesForm {
  id: string
  title: string
  series_label: SeriesLabel
  series_length: number
  format: SeriesFormat
  framing: SeriesFraming | null
  questions: SeriesQuestion[]
  cta_text: string | null
  brand_line: string | null
  already_submitted: boolean
}

interface SavedAnswer {
  question_id: string
  answer: string
  entry_index: number
}

const BEAT_LABEL: Record<string, string> = {
  lesson: 'Lesson',
  story: 'Story',
  progress: 'Progress',
  tip: 'Tip',
  mistake: 'Mistake',
  win: 'Win',
  belief: 'Belief',
}

export default function SeriesFormPage() {
  const params = useParams()
  const token = (params?.token as string) || ''

  const [form, setForm] = useState<PublicSeriesForm | null>(null)
  const [client, setClient] = useState<PublicClient | null>(null)
  const [answers, setAnswers, clearAnswers] = useFormPersistence<Record<string, string>>(
    `series-form:${token}`,
    {},
  )
  // Voice-note URLs keyed by question id, persisted alongside the text answers.
  const [audioUrls, setAudioUrls, clearAudioUrls] = useFormPersistence<Record<string, string>>(
    `series-form-audio:${token}`,
    {},
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) return
    const load = async () => {
      try {
        const res = await fetch(`/api/series-form/info?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (!data.success) {
          setError(data.error || 'Invalid link')
          return
        }
        setForm(data.form as PublicSeriesForm)
        setClient((data.client as PublicClient) || null)

        // If the user previously submitted and we have rows in DB but nothing
        // in sessionStorage, hydrate from DB so they can edit.
        const saved = (data.answers || []) as SavedAnswer[]
        if (saved.length) {
          setAnswers((prev) => {
            if (Object.keys(prev).length) return prev
            const next: Record<string, string> = {}
            for (const a of saved) {
              if (a.question_id && a.answer) next[a.question_id] = a.answer
            }
            return next
          })
        }
      } catch (e) {
        console.error('series-form load error:', e)
        setError('Failed to load form')
      } finally {
        setIsLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const sortedQuestions = useMemo(() => {
    if (!form) return []
    return [...form.questions].sort((a, b) => a.entry_index - b.entry_index)
  }, [form])

  const answeredCount = useMemo(
    () => Object.values(answers).filter((v) => v && v.trim().length > 0).length,
    [answers],
  )

  const handleChange = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  const handleAudioChange = (id: string, url: string | null) => {
    setAudioUrls((prev) => {
      const next = { ...prev }
      if (url) next[id] = url
      else delete next[id]
      return next
    })
  }

  const handleSubmit = async () => {
    if (!form) return
    setIsSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/series-form/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, answers, audioUrls }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Failed to submit')
      } else {
        clearAnswers()
        clearAudioUrls()
        setSuccess(true)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (e) {
      console.error('series-form submit error:', e)
      setError('Failed to submit')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-tertiary)] flex items-center justify-center">
        <p className="text-[var(--text-tertiary)]">Loading…</p>
      </div>
    )
  }

  if (error && !form) {
    return (
      <div className="min-h-screen bg-[var(--bg-tertiary)] flex items-center justify-center p-4">
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
      <div className="min-h-screen bg-[var(--bg-tertiary)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Got it - thank you!</h2>
            <p className="text-[var(--text-tertiary)]">
              Your stories are about to become {form?.series_length || 30} {form?.series_label?.toLowerCase() || 'days'} of content. You can close this page.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!form) return null

  const displayName = client?.business_name || client?.name || 'your brand'
  const labelLower = form.series_label.toLowerCase()

  return (
    <div className="min-h-screen bg-[var(--bg-tertiary)]">
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
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#2B79F7]" />
                  <h1 className="text-2xl font-bold text-[var(--text-primary)]">{form.title}</h1>
                </div>
                <p className="text-sm text-[var(--text-tertiary)]">for {displayName}</p>
              </div>
            </div>

            <p className="text-sm text-[var(--text-secondary)]">
              You&rsquo;re filling out the spine for a {form.series_length}-{labelLower} series.
              One question per {labelLower}. Each answer becomes that {labelLower}&rsquo;s script.
            </p>
            <p className="text-sm text-[var(--text-secondary)] mt-2">
              <strong>Be specific.</strong> The point is the actual moment, the actual mistake,
              the actual lesson. 3-8 sentences is perfect. Polished, generic answers turn into
              polished, generic videos. Raw turns into real.
            </p>
            {form.already_submitted && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                You&rsquo;ve submitted this before. Editing and resubmitting will replace your previous answers.
              </p>
            )}
          </CardContent>
        </Card>

        {sortedQuestions.map((q) => (
          <Card key={q.id} className={q.is_intro ? 'border-2 border-[#2B79F7]/40' : undefined}>
            <CardHeader>
              <div className="flex items-start gap-3">
                {q.is_intro ? (
                  <span className="shrink-0 h-8 px-2.5 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold uppercase tracking-wide flex items-center justify-center">
                    Intro
                  </span>
                ) : (
                  <span className="shrink-0 h-8 w-8 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-semibold flex items-center justify-center">
                    {q.entry_index}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mb-1">
                    {q.is_intro ? (
                      'Intro · sets up the series'
                    ) : (
                      <>
                        {form.series_label} {q.entry_index}
                        {q.beat_type && (
                          <span className="ml-2 text-[var(--text-tertiary)]">· {BEAT_LABEL[q.beat_type] || q.beat_type}</span>
                        )}
                      </>
                    )}
                  </p>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">{q.text}</h3>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <VoiceTextarea
                value={answers[q.id] ?? ''}
                onChange={(v) => handleChange(q.id, v)}
                audioUrl={audioUrls[q.id] ?? null}
                onAudioChange={(url) => handleAudioChange(q.id, url)}
                uploadFolder="voice-notes/series"
                placeholder={
                  q.placeholder ||
                  'Tell the actual story - 3 to 8 sentences. Specific moments beat polished summaries. Or tap the mic to record.'
                }
                rows={5}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-y"
              />
            </CardContent>
          </Card>
        ))}

        {error && (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-3 sticky bottom-4 bg-[var(--bg-tertiary)]/95 py-2">
          <p className="text-sm text-[var(--text-tertiary)]">
            {answeredCount} of {sortedQuestions.length} answered
          </p>
          <Button
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={answeredCount === 0}
            size="lg"
          >
            Submit Answers
          </Button>
        </div>

        <p className="text-xs text-[var(--text-tertiary)] text-center">Powered by Fokus Kreativez</p>
      </div>
    </div>
  )
}
