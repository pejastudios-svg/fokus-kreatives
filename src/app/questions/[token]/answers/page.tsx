/* eslint-disable @next/next/no-img-element */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { AlertCircle, Sparkles, ClipboardList, AlertTriangle } from 'lucide-react'
import type { TopicInputType } from '@/lib/types/questionForm'

interface PublicClient {
  id: string
  name: string | null
  business_name: string | null
  profile_picture_url: string | null
  industry: string | null
}

interface LegacyAnswerRow {
  id?: string
  text: string
  pillar: string | null
  answer: string | null
  thin_flag?: boolean
}

interface TopicQuestionAnswer {
  id: string
  input_type: TopicInputType
  text: string
  answer: string | null
  thin_flag: boolean
}

interface TopicAnswerGroup {
  id: string
  title: string
  pillar_hint: string
  thin_count: number
  questions: TopicQuestionAnswer[]
}

const PILLAR_LABEL: Record<string, string> = {
  educational: 'Educational',
  storytelling: 'Storytelling',
  authority: 'Authority',
  series: 'Series',
  doubledown: 'Double Down',
  unassigned: 'Unassigned',
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

export default function AnswersViewerPage() {
  const params = useParams()
  const token = (params?.token as string) || ''

  const [title, setTitle] = useState<string>('')
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [isTopicForm, setIsTopicForm] = useState(false)
  const [topics, setTopics] = useState<TopicAnswerGroup[]>([])
  const [legacyAnswers, setLegacyAnswers] = useState<LegacyAnswerRow[]>([])
  const [client, setClient] = useState<PublicClient | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [thinOnly, setThinOnly] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [answersRes, infoRes] = await Promise.all([
          fetch(`/api/question-form/answers?token=${encodeURIComponent(token)}`),
          fetch(`/api/question-form/info?token=${encodeURIComponent(token)}`),
        ])
        const answersData = await answersRes.json()
        const infoData = await infoRes.json()

        if (!answersData.success) {
          setError(answersData.error || 'Invalid link')
          return
        }
        if (!answersData.submitted) {
          setError('This form has not been submitted yet.')
          return
        }

        setTitle(answersData.title || infoData?.form?.title || 'Content Braindump')
        setSubmittedAt(answersData.submittedAt || null)
        setIsTopicForm(!!answersData.isTopicForm)
        setTopics((answersData.topics as TopicAnswerGroup[]) || [])
        setLegacyAnswers((answersData.answers as LegacyAnswerRow[]) || [])
        setClient(infoData?.client || null)
      } catch (e) {
        console.error('answers viewer load error:', e)
        setError('Failed to load answers')
      } finally {
        setIsLoading(false)
      }
    }
    if (token) load()
  }, [token])

  const totalThin = useMemo(() => {
    if (isTopicForm) return topics.reduce((n, t) => n + t.thin_count, 0)
    return legacyAnswers.filter((a) => a.thin_flag).length
  }, [isTopicForm, topics, legacyAnswers])

  const visibleTopics = useMemo(() => {
    if (!thinOnly) return topics
    return topics
      .map((t) => ({ ...t, questions: t.questions.filter((q) => q.thin_flag) }))
      .filter((t) => t.questions.length > 0)
  }, [thinOnly, topics])

  const visibleLegacy = useMemo(() => {
    if (!thinOnly) return legacyAnswers
    return legacyAnswers.filter((a) => a.thin_flag)
  }, [thinOnly, legacyAnswers])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-tertiary)] flex items-center justify-center p-4">
        <p className="text-sm text-[var(--text-tertiary)]">Loading answers...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--bg-tertiary)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Cannot show answers</h2>
            <p className="text-[var(--text-tertiary)]">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const displayName = client?.business_name || client?.name || 'this client'
  const totalAnswers = isTopicForm
    ? topics.reduce((n, t) => n + t.questions.filter((q) => q.answer).length, 0)
    : legacyAnswers.filter((a) => a.answer).length

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
                  <h1 className="text-2xl font-bold text-[var(--text-primary)]">{title}</h1>
                </div>
                <p className="text-sm text-[var(--text-tertiary)]">for {displayName}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                <ClipboardList className="h-3.5 w-3.5" />
                <span>
                  {totalAnswers} {totalAnswers === 1 ? 'answer' : 'answers'}
                  {submittedAt && (
                    <> &middot; submitted {new Date(submittedAt).toLocaleDateString()}</>
                  )}
                </span>
              </div>
              {totalThin > 0 && (
                <button
                  type="button"
                  onClick={() => setThinOnly((v) => !v)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                    thinOnly
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                  }`}
                >
                  <AlertTriangle className="h-3 w-3" />
                  {totalThin} thin {totalThin === 1 ? 'answer' : 'answers'}
                  {thinOnly && ' (showing only)'}
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {isTopicForm
          ? visibleTopics.map((topic, tIdx) => (
              <Card key={topic.id}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 h-7 w-7 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-semibold flex items-center justify-center">
                      {tIdx + 1}
                    </span>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-[var(--text-primary)]">
                        {topic.title}
                      </h3>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] capitalize">
                          {PILLAR_LABEL[topic.pillar_hint] || topic.pillar_hint}
                        </span>
                        {topic.thin_count > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 inline-flex items-center gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {topic.thin_count} thin
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {topic.questions.map((q) => (
                    <div key={q.id} className="border-l-2 border-[var(--border-primary)] pl-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] capitalize">
                          {INPUT_TYPE_LABEL[q.input_type] || q.input_type}
                        </span>
                        {q.thin_flag && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 inline-flex items-center gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            thin
                          </span>
                        )}
                        <p className="text-xs text-[var(--text-secondary)] font-medium">{q.text}</p>
                      </div>
                      {q.answer ? (
                        <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
                          {q.answer}
                        </p>
                      ) : (
                        <p className="text-sm text-[var(--text-tertiary)] italic">No answer.</p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          : visibleLegacy.map((a, idx) => (
              <Card key={a.id || idx}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 h-7 w-7 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-semibold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-[var(--text-primary)]">{a.text}</h3>
                      <div className="mt-1 flex items-center gap-2">
                        {a.pillar && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] capitalize">
                            {PILLAR_LABEL[a.pillar] || a.pillar}
                          </span>
                        )}
                        {a.thin_flag && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 inline-flex items-center gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            thin
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {a.answer ? (
                    <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{a.answer}</p>
                  ) : (
                    <p className="text-sm text-[var(--text-tertiary)] italic">No answer provided.</p>
                  )}
                </CardContent>
              </Card>
            ))}

        {((isTopicForm && visibleTopics.length === 0) ||
          (!isTopicForm && visibleLegacy.length === 0)) && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-[var(--text-tertiary)]">
              {thinOnly ? 'No thin answers in this submission.' : 'No answers found.'}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
