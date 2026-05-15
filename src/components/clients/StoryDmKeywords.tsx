'use client'

// Brand DM keywords - small card on the client edit page that lets staff
// pin 1-3 short keywords the AI uses for story DM CTAs ("DM me PLAYBOOK").
// Persists to brand_content_settings.dm_keywords (array). Self-contained:
// fetches and saves on its own so the parent edit form doesn't have to
// thread a separate table through its handleSave.
//
// Reads/writes go through /api/clients/[clientId]/dm-keywords because the
// brand_content_settings RLS policy is service-role-only - direct browser
// upserts are blocked.

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { X, Plus, Check, AlertCircle, Loader2 } from 'lucide-react'

interface Props {
  clientId: string
}

const MAX_KEYWORDS = 3
const MAX_LEN = 24

export function StoryDmKeywords({ clientId }: Props) {
  const [keywords, setKeywords] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      try {
        const r = await fetch(`/api/clients/${clientId}/dm-keywords`, { cache: 'no-store' })
        const json = (await r.json()) as { success?: boolean; keywords?: unknown; error?: string }
        if (cancelled) return
        if (!json.success) {
          setNotice({ type: 'error', message: json.error || 'Failed to load keywords' })
          setKeywords([])
        } else {
          const raw = Array.isArray(json.keywords) ? (json.keywords as unknown[]) : []
          setKeywords(raw.filter((k): k is string => typeof k === 'string'))
        }
      } catch (err) {
        if (cancelled) return
        setNotice({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load keywords' })
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [clientId])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(t)
  }, [notice])

  const normalize = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '_').slice(0, MAX_LEN)

  const addKeyword = () => {
    const next = normalize(draft)
    if (!next) return
    if (keywords.includes(next)) {
      setNotice({ type: 'error', message: 'Already added' })
      setDraft('')
      return
    }
    if (keywords.length >= MAX_KEYWORDS) {
      setNotice({ type: 'error', message: `Max ${MAX_KEYWORDS} keywords` })
      return
    }
    setKeywords((prev) => [...prev, next])
    setDraft('')
  }

  const removeKeyword = (k: string) => {
    setKeywords((prev) => prev.filter((x) => x !== k))
  }

  const save = async () => {
    // Promote any unsaved draft text into a chip before saving so users
    // who type then click Save (without pressing Enter) don't end up
    // persisting an empty array.
    let nextKeywords = keywords
    const pending = normalize(draft)
    if (pending && !nextKeywords.includes(pending) && nextKeywords.length < MAX_KEYWORDS) {
      nextKeywords = [...nextKeywords, pending]
      setKeywords(nextKeywords)
      setDraft('')
    }

    setIsSaving(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/dm-keywords`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: nextKeywords }),
      })
      const json = (await r.json()) as { success?: boolean; keywords?: unknown; error?: string }
      if (!json.success) {
        setNotice({ type: 'error', message: `Save failed: ${json.error || 'unknown error'}` })
        return
      }
      const persisted = Array.isArray(json.keywords)
        ? (json.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
        : []
      setKeywords(persisted)
      if (persisted.length !== nextKeywords.length) {
        setNotice({
          type: 'error',
          message: `Saved but only ${persisted.length}/${nextKeywords.length} persisted (duplicate or invalid keywords were dropped).`,
        })
        return
      }
      setNotice({ type: 'success', message: `Saved ${persisted.length} keyword(s)` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setNotice({ type: 'error', message: `Save failed: ${msg}` })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Story DM Keywords</h3>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          1-{MAX_KEYWORDS} short keywords the AI uses for DM CTAs in stories
          (&ldquo;DM me PLAYBOOK&rdquo;). Pick consistent terms so audiences associate
          them with specific deliverables. Leave empty to let the AI pick contextually.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading keywords...
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {keywords.length === 0 ? (
                <span className="text-sm text-[var(--text-tertiary)]">No keywords set.</span>
              ) : (
                keywords.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-xs font-mono font-semibold text-[var(--text-primary)]"
                  >
                    {k}
                    <button
                      type="button"
                      onClick={() => removeKeyword(k)}
                      className="text-[var(--text-tertiary)] hover:text-red-500 transition"
                      aria-label={`Remove ${k}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addKeyword()
                  }
                }}
                placeholder="e.g. PLAYBOOK"
                maxLength={MAX_LEN}
                disabled={keywords.length >= MAX_KEYWORDS}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] uppercase font-mono disabled:opacity-50"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addKeyword}
                disabled={!draft.trim() || keywords.length >= MAX_KEYWORDS}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-[var(--text-tertiary)]">
                {keywords.length}/{MAX_KEYWORDS} keywords
              </p>
              <Button type="button" size="sm" onClick={save} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save keywords'}
              </Button>
            </div>

            {notice && (
              <div
                className={`flex items-center gap-2 text-xs ${
                  notice.type === 'success' ? 'text-green-600' : 'text-red-500'
                }`}
              >
                {notice.type === 'success' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                {notice.message}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
