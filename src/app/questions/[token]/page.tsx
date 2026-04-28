/* eslint-disable @next/next/no-img-element */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { CheckCircle, AlertCircle, Sparkles } from 'lucide-react'
import type { FormQuestion } from '@/lib/types/questionForm'
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
  pillars: string[]
  already_submitted: boolean
}

const PILLAR_LABEL: Record<string, string> = {
  educational: 'Educational',
  storytelling: 'Storytelling',
  authority: 'Authority',
  series: 'Series',
  doubledown: 'Double Down',
}

export default function QuestionFormPage() {
  const params = useParams()
  const token = (params?.token as string) || ''

  const [form, setForm] = useState<PublicForm | null>(null)
  const [client, setClient] = useState<PublicClient | null>(null)
  const [answers, setAnswers, clearAnswers] = useFormPersistence<Record<string, string>>(
    `question-form:${token}`,
    {},
  )
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
        setForm(data.form as PublicForm)
        setClient((data.client as PublicClient) || null)
      } catch (e) {
        console.error('question-form load error:', e)
        setError('Failed to load form')
      } finally {
        setIsLoading(false)
      }
    }
    if (token) load()
  }, [token])

  const answeredCount = useMemo(
    () => Object.values(answers).filter((v) => v && v.trim().length > 0).length,
    [answers],
  )

  const handleChange = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  const handleSubmit = async () => {
    if (!form) return
    setIsSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/question-form/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, answers }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Failed to submit')
      } else {
        clearAnswers()
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    )
  }

  if (error && !form) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Link not available</h2>
            <p className="text-gray-500">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Thanks - we got it!</h2>
            <p className="text-gray-500">
              Your answers are being turned into content ideas right now. You can close this page.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!form) return null

  const displayName = client?.business_name || client?.name || 'your brand'

  return (
    <div className="min-h-screen bg-gray-50">
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
                  <h1 className="text-2xl font-bold text-gray-900">
                    {form.title || 'Content Braindump'}
                  </h1>
                </div>
                <p className="text-sm text-gray-500">for {displayName}</p>
              </div>
            </div>

            <p className="text-sm text-gray-600">
              Answer what you can. Every answer becomes a script. Specifics win - real stories,
              mistakes, wins, and hot takes turn into content that actually sounds like you.
              {form.already_submitted && (
                <span className="block mt-2 text-xs text-gray-500">
                  You&apos;ve submitted this before - feel free to add more answers and resubmit.
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        {form.questions.map((q, idx) => (
          <Card key={q.id}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="shrink-0 h-7 w-7 rounded-full bg-[#E8F1FF] text-[#2B79F7] text-xs font-semibold flex items-center justify-center">
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-gray-900">{q.text}</h3>
                  <div className="mt-1">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#2B79F7] capitalize">
                      {PILLAR_LABEL[q.pillar] || q.pillar}
                    </span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <textarea
                value={answers[q.id] ?? ''}
                onChange={(e) => handleChange(q.id, e.target.value)}
                placeholder={q.placeholder || 'Type your answer - 2 to 6 sentences is perfect.'}
                rows={4}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none"
              />
            </CardContent>
          </Card>
        ))}

        {error && (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-gray-500">
            {answeredCount} of {form.questions.length} answered
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

        <p className="text-xs text-gray-400 text-center">Powered by Fokus Kreativez</p>
      </div>
    </div>
  )
}
