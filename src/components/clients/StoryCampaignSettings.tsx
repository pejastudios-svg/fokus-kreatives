'use client'

// Brand story campaign - the active launch offer that launch-intent stories
// pull from (offer / event date / reply keyword / mechanic). When active and
// not past its event date, the planner can auto-generate launch stories that
// drive to THIS offer (instead of inventing one). Persists to
// brand_content_settings.story_campaign via /api/clients/[clientId]/story-campaign
// (RLS is service-role-only, so the browser cannot write the table directly).

import { useEffect, useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Check, AlertCircle, Loader2 } from 'lucide-react'

interface Props {
  clientId: string
}

interface Campaign {
  offer: string
  event_date: string | null
  keyword: string | null
  mechanic: 'reply' | 'dm'
  active: boolean
}

const EMPTY: Campaign = { offer: '', event_date: null, keyword: null, mechanic: 'reply', active: true }

const MAX_OFFER_LEN = 120
const MAX_KEYWORD_LEN = 24

export function StoryCampaignSettings({ clientId }: Props) {
  const [campaign, setCampaign] = useState<Campaign>(EMPTY)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      try {
        const r = await fetch(`/api/clients/${clientId}/story-campaign`, { cache: 'no-store' })
        const json = (await readJsonSafe(r)) as { success?: boolean; campaign?: Partial<Campaign> | null; error?: string }
        if (cancelled) return
        if (!json.success) {
          setNotice({ type: 'error', message: json.error || 'Failed to load campaign' })
        } else if (json.campaign) {
          setCampaign({ ...EMPTY, ...json.campaign })
        }
      } catch (err) {
        if (cancelled) return
        setNotice({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load campaign' })
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

  const update = (patch: Partial<Campaign>) => setCampaign((c) => ({ ...c, ...patch }))

  const save = async (clear = false) => {
    setIsSaving(true)
    try {
      // Sending an empty offer clears the campaign server-side.
      const payload = clear ? null : campaign.offer.trim() ? campaign : null
      const r = await fetch(`/api/clients/${clientId}/story-campaign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: payload }),
      })
      const json = (await readJsonSafe(r)) as { success?: boolean; campaign?: Partial<Campaign> | null; error?: string }
      if (!json.success) {
        setNotice({ type: 'error', message: `Save failed: ${json.error || 'unknown error'}` })
        return
      }
      setCampaign(json.campaign ? { ...EMPTY, ...json.campaign } : EMPTY)
      setNotice({ type: 'success', message: clear || !payload ? 'Campaign cleared' : 'Campaign saved' })
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
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Story Launch Campaign</h3>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          The current offer launch stories drive to. When active and not past its date,
          the planner can auto-generate &ldquo;PSA&rdquo; launch stories for it. Leave the offer
          empty to turn off launch stories.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading campaign...
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Offer</label>
              <input
                type="text"
                value={campaign.offer}
                onChange={(e) => update({ offer: e.target.value })}
                placeholder="e.g. Free ManyChat workshop"
                maxLength={MAX_OFFER_LEN}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Event date (optional)</label>
                <input
                  type="date"
                  value={campaign.event_date ?? ''}
                  onChange={(e) => update({ event_date: e.target.value || null })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Reply keyword</label>
                <input
                  type="text"
                  value={campaign.keyword ?? ''}
                  onChange={(e) => update({ keyword: e.target.value || null })}
                  placeholder="e.g. 14"
                  maxLength={MAX_KEYWORD_LEN}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] uppercase font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">CTA mechanic</label>
                <select
                  value={campaign.mechanic}
                  onChange={(e) => update({ mechanic: e.target.value === 'dm' ? 'dm' : 'reply' })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="reply">Reply to story</option>
                  <option value="dm">DM</option>
                </select>
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={campaign.active}
                  onChange={(e) => update({ active: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border-primary)]"
                />
                Active
              </label>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => save(true)}
                disabled={isSaving || !campaign.offer.trim()}
              >
                Clear
              </Button>
              <Button type="button" size="sm" onClick={() => save(false)} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save campaign'}
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
