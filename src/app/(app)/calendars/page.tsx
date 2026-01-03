'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import { Plus, X, Calendar as CalendarIcon } from 'lucide-react'

type Tier = 'beginner' | 'mid' | 'advanced'

type ClientRow = {
  id: string
  name: string
  business_name: string
  industry: string | null
  competitor_insights: string | null
  content_tier: Tier | null
}

type CalendarRow = {
  id: string
  client_id: string
  name: string
  month_start: string
  tier: Tier
  platforms: string[]
  created_at: string
}

const CONTENT_TYPES = [
  'Long-form Script',
  'Short-form Script',
  'Carousel',
  'Story Post',
  'Engagement Reel',
] as const

function safeUpper(s: string) {
  return (s || '').toUpperCase()
}

export default function CalendarsPage() {
  const supabase = createClient()
  const router = useRouter()

  const [clients, setClients] = useState<ClientRow[]>([])
  const [calendars, setCalendars] = useState<CalendarRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [selectedClientId, setSelectedClientId] = useState<string>('')

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [calendarName, setCalendarName] = useState('30-Day Content Calendar')
  const [monthStart, setMonthStart] = useState(() => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    return `${yyyy}-${mm}-01`
  })
  const [tier, setTier] = useState<Tier>('beginner')
  const [platforms, setPlatforms] = useState<string[]>(['instagram', 'youtube'])

  // research inputs
  const [painPoints, setPainPoints] = useState('')
  const [competitorInsights, setCompetitorInsights] = useState('')
  const [transcriptsText, setTranscriptsText] = useState('')

  // counts
  const [counts, setCounts] = useState<Record<string, number>>({
    'Long-form Script': 4,
    'Short-form Script': 12,
    'Carousel': 4,
    'Story Post': 4,
    'Engagement Reel': 4,
  })

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId]
  )

  useEffect(() => {
    ;(async () => {
      setIsLoading(true)
      try {
        const { data: cData, error: cErr } = await supabase
          .from('clients')
          .select('id,name,business_name,industry,competitor_insights,content_tier')
          .order('name')

        if (cErr) console.error('clients load error', cErr)
        setClients((cData || []) as ClientRow[])

        const { data: calData, error: calErr } = await supabase
          .from('content_calendars')
          .select('id,client_id,name,month_start,tier,platforms,created_at')
          .order('created_at', { ascending: false })

        if (calErr) console.error('calendars load error', calErr)
        setCalendars((calData || []) as CalendarRow[])
      } finally {
        setIsLoading(false)
      }
    })()
  }, [supabase])

  // Autofill competitor insights + tier from client
  useEffect(() => {
    if (!selectedClient) return
    setCompetitorInsights(selectedClient.competitor_insights || '')
    setTier(selectedClient.content_tier || 'beginner')
  }, [selectedClient])

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }

  const updateCount = (k: string, v: string) => {
    const n = Number(v)
    setCounts((prev) => ({ ...prev, [k]: Number.isFinite(n) ? Math.max(0, n) : 0 }))
  }

  const totalCount = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0)

  const openCreate = () => {
    setError('')
    setShowCreate(true)
  }

  const createCalendar = async () => {
    if (!selectedClientId) {
      setError('Select a client first.')
      return
    }
    if (!monthStart) {
      setError('Choose a month start (YYYY-MM-01).')
      return
    }
    if (platforms.length === 0) {
      setError('Select at least one platform.')
      return
    }
    if (totalCount <= 0) {
      setError('Set at least one content count above 0.')
      return
    }

    setCreating(true)
    setError('')

    try {
      const transcripts = transcriptsText
        .split('\n---\n')
        .map((t) => t.trim())
        .filter(Boolean)

      // ✅ IMPORTANT: this must be /api/...
      const res = await fetch('/api/calendars/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClientId,
          name: calendarName,
          monthStart,
          tier,
          platforms,
          counts,
          painPoints,
          competitorInsights,
          transcripts,
        }),
      })

      // ✅ Safe parse (prevents <!DOCTYPE crash)
      const ct = res.headers.get('content-type') || ''
      const text = await res.text()

      if (!ct.includes('application/json')) {
        console.error('Non-JSON response from /api/calendars/create:', text)
        setError('Calendar API returned non-JSON (route missing or server error).')
        return
      }

      let data: { success: boolean; calendarId?: string; error?: string } | null = null

try {
  data = JSON.parse(text)
} catch (err) {
  console.error('Failed to parse JSON from /api/calendars/create')
  console.error('First 800 chars of response:', text.slice(0, 800))
  setError('Server returned invalid JSON. Check console for details.')
  return
}

if (!data?.success) {
  setError(data?.error || 'Failed to create calendar')
  return
}

      if (!data.success) {
        setError(data.error || 'Failed to create calendar')
        return
      }

      if (!data.calendarId) {
        setError('Calendar created but no calendarId returned')
        return
      }

      router.push(`/calendars/${data.calendarId}`)
    } catch (e) {
      console.error(e)
      setError('Failed to create calendar')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Header title="Content Calendars" subtitle="Research-based monthly calendars (no guessing)" />

      <div className="p-8 space-y-6">
        <Card>
          <CardContent className="py-4 flex items-center justify-between gap-4">
            <div className="w-96">
              <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              >
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.business_name}
                  </option>
                ))}
              </select>
            </div>

            <Button onClick={openCreate}>
              <Plus className="h-5 w-5 mr-2" />
              New Calendar
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">Loading calendars…</CardContent>
          </Card>
        ) : calendars.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              No calendars yet. Create your first one.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {calendars.map((c) => (
              <Card
                key={c.id}
                hover
                onClick={() => router.push(`/calendars/${c.id}`)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">{c.name}</h3>
                    <div className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <CalendarIcon className="h-4 w-4" />
                      {new Date(c.month_start).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-gray-600">
                    Tier: <span className="font-medium">{c.tier}</span>
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    Platforms: <span className="font-medium">{(c.platforms || []).join(', ') || '—'}</span>
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create modal - now scroll-safe */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto">
            <div className="min-h-full flex items-start justify-center p-4 py-8">
              <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Create Calendar</h3>
                  <button onClick={() => setShowCreate(false)} className="p-2 rounded-lg hover:bg-gray-100">
                    <X className="h-5 w-5 text-gray-500" />
                  </button>
                </CardHeader>

                {/* Scrollable content */}
                <CardContent className="space-y-5 overflow-y-auto">
                  {!selectedClientId && (
                    <p className="text-sm text-red-600">Select a client first (top dropdown).</p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Input
                      label="Calendar name"
                      value={calendarName}
                      onChange={(e) => setCalendarName(e.target.value)}
                    />
                    <Input
                      label="Month start"
                      type="date"
                      value={monthStart}
                      onChange={(e) => setMonthStart(e.target.value)}
                    />
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tier</label>
                      <select
                        value={tier}
                        onChange={(e) => setTier(e.target.value as Tier)}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      >
                        <option value="beginner">Beginner</option>
                        <option value="mid">Mid</option>
                        <option value="advanced">Advanced</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Platforms</label>
                    <div className="flex flex-wrap gap-2">
                      {['instagram', 'tiktok', 'youtube', 'linkedin', 'facebook'].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => togglePlatform(p)}
                          className={`px-3 py-1.5 rounded-full text-xs border ${
                            platforms.includes(p)
                              ? 'bg-[#E8F1FF] border-[#2B79F7] text-[#2B79F7]'
                              : 'bg-white border-gray-300 text-gray-600'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Counts for this month <span className="text-gray-400">(total: {totalCount})</span>
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {CONTENT_TYPES.map((t) => (
                        <div key={t}>
                          <label className="block text-xs text-gray-500 mb-1">{t}</label>
                          <input
                            value={String(counts[t] ?? 0)}
                            onChange={(e) => updateCount(t, e.target.value)}
                            type="number"
                            min={0}
                            className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Pain points research (required)
                      </label>
                      <textarea
                        value={painPoints}
                        onChange={(e) => setPainPoints(e.target.value)}
                        rows={7}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                        placeholder="Paste real pain points you researched…"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Competitor insights (required)
                      </label>
                      <textarea
                        value={competitorInsights}
                        onChange={(e) => setCompetitorInsights(e.target.value)}
                        rows={7}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                        placeholder="Auto-filled from client profile if available."
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Viral transcripts (optional)
                    </label>
                    <textarea
                      value={transcriptsText}
                      onChange={(e) => setTranscriptsText(e.target.value)}
                      rows={6}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                      placeholder={`Paste 1+ transcripts. Separate multiple transcripts with:\n---`}
                    />
                  </div>

                  {error && <p className="text-sm text-red-600">{error}</p>}

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>
                      Cancel
                    </Button>
                    <Button onClick={createCalendar} isLoading={creating} disabled={!selectedClientId}>
                      Create Calendar
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