/* eslint-disable @next/next/no-img-element */
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { AlertCircle, Sparkles, ClipboardList } from 'lucide-react'

interface PublicClient {
  id: string
  name: string | null
  business_name: string | null
  profile_picture_url: string | null
  industry: string | null
}

interface AnswerRow {
  id?: string
  text: string
  pillar: string | null
  answer: string | null
}

const PILLAR_LABEL: Record<string, string> = {
  educational: 'Educational',
  storytelling: 'Storytelling',
  authority: 'Authority',
  series: 'Series',
  doubledown: 'Double Down',
}

export default function AnswersViewerPage() {
  const params = useParams()
  const token = (params?.token as string) || ''

  const [title, setTitle] = useState<string>('')
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [client, setClient] = useState<PublicClient | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

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
        setAnswers((answersData.answers as AnswerRow[]) || [])
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

            <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
              <ClipboardList className="h-3.5 w-3.5" />
              <span>
                {answers.length} {answers.length === 1 ? 'answer' : 'answers'}
                {submittedAt && (
                  <> &middot; submitted {new Date(submittedAt).toLocaleDateString()}</>
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        {answers.map((a, idx) => (
          <Card key={a.id || idx}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="shrink-0 h-7 w-7 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-semibold flex items-center justify-center">
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">{a.text}</h3>
                  {a.pillar && (
                    <div className="mt-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] capitalize">
                        {PILLAR_LABEL[a.pillar] || a.pillar}
                      </span>
                    </div>
                  )}
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
      </div>
    </div>
  )
}
