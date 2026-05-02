'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Plus, Trash2, RotateCcw, Check, Lightbulb } from 'lucide-react'
import type { Topic, TopicPillar } from '@/lib/types/topics'

const PILLAR_OPTIONS: { id: TopicPillar; label: string }[] = [
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'educational', label: 'Educational' },
  { id: 'storytelling', label: 'Storytelling' },
  { id: 'authority', label: 'Authority' },
  { id: 'series', label: 'Series' },
  { id: 'doubledown', label: 'Double Down' },
]

interface Props {
  clientId: string
}

export function TopicsBank({ clientId }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [showUsed, setShowUsed] = useState(true)

  const [newQuestion, setNewQuestion] = useState('')
  const [newAnswer, setNewAnswer] = useState('')
  const [newPillar, setNewPillar] = useState<TopicPillar>('unassigned')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('topics')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    if (!error && data) setTopics(data as Topic[])
    setLoading(false)
  }, [clientId, supabase])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleAdd = async () => {
    const answer = newAnswer.trim()
    if (!answer) return
    setAdding(true)
    const { error } = await supabase.from('topics').insert({
      client_id: clientId,
      question: newQuestion.trim() || null,
      answer,
      pillar: newPillar,
      source: 'manual',
    })
    setAdding(false)
    if (error) {
      alert(`Failed to add topic: ${error.message}`)
      return
    }
    setNewQuestion('')
    setNewAnswer('')
    setNewPillar('unassigned')
    refresh()
  }

  const handleDelete = async (id: string) => {
    setTopics((prev) => prev.filter((t) => t.id !== id))
    await supabase.from('topics').delete().eq('id', id)
  }

  const handleToggleUsed = async (t: Topic) => {
    const nextUsed = !t.used_at
    setTopics((prev) =>
      prev.map((x) =>
        x.id === t.id
          ? { ...x, used_at: nextUsed ? new Date().toISOString() : null, last_used_content_id: null }
          : x,
      ),
    )
    await supabase
      .from('topics')
      .update({
        used_at: nextUsed ? new Date().toISOString() : null,
        last_used_content_id: null,
      })
      .eq('id', t.id)
  }

  const visible = showUsed ? topics : topics.filter((t) => !t.used_at)
  const unusedCount = topics.filter((t) => !t.used_at).length

  return (
    <Card className="card-premium">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-[#2B79F7]" />
            <h3 className="text-lg font-semibold text-theme-primary">Topics Bank</h3>
            <span className="text-xs text-theme-secondary">
              {unusedCount} unused · {topics.length} total
            </span>
          </div>
          <label className="flex items-center gap-2 text-xs text-theme-secondary">
            <input
              type="checkbox"
              checked={showUsed}
              onChange={(e) => setShowUsed(e.target.checked)}
              className="rounded border-theme-primary"
            />
            Show used topics
          </label>
        </div>
        <p className="text-xs text-theme-secondary mt-1">
          Client braindumps. Each answer is a topic. Used topics turn grey - the AI will skip them unless you manually pick one again.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Add manual topic */}
        <div className="rounded-xl border border-theme-primary bg-theme-tertiary/40 p-4 space-y-3">
          <p className="text-xs font-semibold text-theme-primary uppercase tracking-wide">Add a topic</p>
          <input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Question (optional - e.g. 'What's a hard lesson you learned about pricing?')"
            className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
          <textarea
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
            rows={3}
            placeholder="Paste the client's answer / braindump here. This becomes the source for a script."
            className="w-full px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary resize-none focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={newPillar}
              onChange={(e) => setNewPillar(e.target.value as TopicPillar)}
              className="px-3 py-2 rounded-lg border border-theme-primary bg-theme-card text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            >
              {PILLAR_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={handleAdd} isLoading={adding} disabled={!newAnswer.trim()}>
              <Plus className="h-4 w-4 mr-1" />
              Add Topic
            </Button>
          </div>
        </div>

        {/* Topics list */}
        {loading ? (
          <p className="text-sm text-theme-secondary text-center py-6">Loading topics…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-theme-secondary text-center py-6">
            {topics.length === 0
              ? 'No topics yet. Add one above, or generate a question form once it ships.'
              : 'All topics are marked used. Uncheck "Show used topics" to see only fresh ones.'}
          </p>
        ) : (
          <ul className="divide-y divide-theme-primary rounded-xl border border-theme-primary overflow-hidden">
            {visible.map((t) => {
              const used = !!t.used_at
              return (
                <li
                  key={t.id}
                  className={`p-4 flex flex-col md:flex-row md:items-start gap-3 ${
                    used ? 'bg-theme-tertiary/40 opacity-60' : 'bg-theme-card'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    {t.question && (
                      <p className="text-xs text-theme-secondary mb-1">Q: {t.question}</p>
                    )}
                    <p className="text-sm text-theme-primary whitespace-pre-wrap break-words">
                      {t.answer}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px]">
                      <span className="px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#2B79F7] capitalize">
                        {t.pillar}
                      </span>
                      <span className="text-theme-secondary">
                        Added {new Date(t.created_at).toLocaleDateString()}
                      </span>
                      {used && (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--bg-card-hover)] text-[var(--text-secondary)]">
                          Used {new Date(t.used_at!).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => handleToggleUsed(t)}>
                      {used ? (
                        <>
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Mark unused
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Mark used
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:bg-red-500/10"
                      onClick={() => setPendingDeleteId(t.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      <ConfirmModal
        open={!!pendingDeleteId}
        title="Delete this topic?"
        message="The topic will be removed from this client's bank."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (!pendingDeleteId) return
          await handleDelete(pendingDeleteId)
          setPendingDeleteId(null)
        }}
        onClose={() => setPendingDeleteId(null)}
      />
    </Card>
  )
}
