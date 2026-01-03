'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { Copy, X, Save } from 'lucide-react'

type ItemRow = {
  id: string
  day: string
  content_type: string
  platform: string
  pillar: string
  hook: string
  topic: string
  rationale: string
  research_basis: string
  evidence_source: string
  evidence_snippet: string
  cta: string
  script: string | null
}

export default function CalendarDetailPage() {
  const params = useParams()
  const calendarId = params.id as string
  const supabase = createClient()

  const [items, setItems] = useState<ItemRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [openItem, setOpenItem] = useState<ItemRow | null>(null)
  const [edit, setEdit] = useState<Partial<ItemRow>>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    ;(async () => {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('content_calendar_items')
        .select('id,day,content_type,platform,pillar,hook,topic,rationale,research_basis,evidence_source,evidence_snippet,cta,script')
        .eq('calendar_id', calendarId)
        .order('day', { ascending: true })
        .order('position', { ascending: true })

      if (error) console.error(error)
      setItems((data || []) as ItemRow[])
      setIsLoading(false)
    })()
  }, [supabase, calendarId])

  const grouped = useMemo(() => {
    const map = new Map<string, ItemRow[]>()
    for (const it of items) {
      const key = it.day
      const arr = map.get(key) || []
      arr.push(it)
      map.set(key, arr)
    }
    return Array.from(map.entries())
  }, [items])

  const open = (it: ItemRow) => {
    setOpenItem(it)
    setEdit({
      hook: it.hook,
      topic: it.topic,
      cta: it.cta,
      script: it.script || '',
    })
    setErr('')
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
  }

  const save = async () => {
    if (!openItem) return
    setSaving(true)
    setErr('')
    try {
      const patch: Partial<ItemRow> = {
        hook: String(edit.hook || '').trim(),
        topic: String(edit.topic || '').trim(),
        cta: String(edit.cta || '').trim(),
        script: String(edit.script || '').trim() || null,
      }

      const { error } = await supabase
        .from('content_calendar_items')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', openItem.id)

      if (error) {
        setErr(error.message)
        return
      }

      // update local list
      setItems((prev) => prev.map((x) => (x.id === openItem.id ? { ...x, ...patch } as ItemRow : x)))
      setOpenItem((prev) => (prev ? ({ ...prev, ...patch } as ItemRow) : prev))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Header title="Calendar" subtitle="Click any item to edit/copy/paste script" />
      <div className="p-8 space-y-4">
        {isLoading ? (
          <Card><CardContent className="py-10 text-center text-gray-500">Loading…</CardContent></Card>
        ) : items.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-gray-500">No items found.</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {grouped.map(([day, list]) => (
              <Card key={day}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {new Date(day).toLocaleDateString()}
                    </h3>
                    <span className="text-xs text-gray-500">{list.length} item(s)</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {list.map((it) => (
                    <div
                      key={it.id}
                      className="p-3 rounded-lg border border-gray-200 hover:border-[#2B79F7] cursor-pointer transition-colors"
                      onClick={() => open(it)}
                    >
                      <div className="text-xs text-gray-500">
                        {it.platform} · {it.content_type} · {it.pillar}
                      </div>
                      <div className="mt-1 font-semibold text-gray-900">{it.hook}</div>
                      <div className="text-sm text-gray-700 mt-1">{it.topic}</div>
                      <div className="text-xs text-gray-500 mt-2">
                        Evidence: <span className="font-medium">{it.evidence_source}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Item modal */}
        {openItem && (
          <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto">
            <div className="min-h-full flex items-start justify-center p-4 py-8">
              <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-500">
                      {new Date(openItem.day).toLocaleDateString()} · {openItem.platform} · {openItem.content_type} · {openItem.pillar}
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mt-1">Edit item</h3>
                  </div>
                  <button onClick={() => setOpenItem(null)} className="p-2 rounded-lg hover:bg-gray-100">
                    <X className="h-5 w-5 text-gray-600" />
                  </button>
                </CardHeader>

                <CardContent className="overflow-y-auto space-y-4">
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => copy(openItem.hook)}>
                      <Copy className="h-4 w-4 mr-1" /> Copy Hook
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => copy(openItem.topic)}>
                      <Copy className="h-4 w-4 mr-1" /> Copy Topic
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => copy(openItem.cta)}>
                      <Copy className="h-4 w-4 mr-1" /> Copy CTA
                    </Button>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Hook</label>
                    <textarea
                      value={String(edit.hook || '')}
                      onChange={(e) => setEdit((p) => ({ ...p, hook: e.target.value }))}
                      rows={2}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
                    <textarea
                      value={String(edit.topic || '')}
                      onChange={(e) => setEdit((p) => ({ ...p, topic: e.target.value }))}
                      rows={2}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">CTA</label>
                    <textarea
                      value={String(edit.cta || '')}
                      onChange={(e) => setEdit((p) => ({ ...p, cta: e.target.value }))}
                      rows={2}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900"
                    />
                  </div>

                  <Card className="bg-gray-50">
                    <CardContent className="py-3">
                      <p className="text-xs text-gray-600 font-semibold">Evidence (verbatim)</p>
                      <p className="text-xs text-gray-600 mt-1">
                        Source: <span className="font-medium">{openItem.evidence_source}</span>
                      </p>
                      <p className="text-sm text-gray-800 mt-2 whitespace-pre-wrap">
                        “{openItem.evidence_snippet}”
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        Research basis: {openItem.research_basis}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Rationale: {openItem.rationale}
                      </p>
                    </CardContent>
                  </Card>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Script</label>
                    <textarea
                      value={String(edit.script || '')}
                      onChange={(e) => setEdit((p) => ({ ...p, script: e.target.value }))}
                      rows={10}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 font-sans"
                      placeholder="Paste the script here (or generate it from your dashboard later)."
                    />
                  </div>

                  {err && <p className="text-sm text-red-600">{err}</p>}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setOpenItem(null)} disabled={saving}>
                      Close
                    </Button>
                    <Button onClick={save} isLoading={saving}>
                      <Save className="h-4 w-4 mr-2" /> Save
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </>
  )
}