'use client'

// Brand description settings - card on the client edit page that lets staff
// pin the social handles, brand bio, and audience blurb the AI uses for
// the [DESCRIPTION] section of long-form scripts. Without these, the AI
// would fabricate handles by guessing from the brand name (e.g.
// "@fokuskreativez" on every platform). Empty = AI omits that line.
//
// Reads/writes go through /api/clients/[clientId]/brand-description-settings
// because the brand_content_settings RLS policy is service-role-only.

import { useEffect, useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Check, AlertCircle, Loader2 } from 'lucide-react'

interface Props {
  clientId: string
}

interface Settings {
  instagram_handle: string | null
  tiktok_handle: string | null
  youtube_handle: string | null
  linkedin_handle: string | null
  x_handle: string | null
  brand_bio: string | null
  audience_blurb: string | null
  default_hashtags: string[] | null
}

const EMPTY: Settings = {
  instagram_handle: null,
  tiktok_handle: null,
  youtube_handle: null,
  linkedin_handle: null,
  x_handle: null,
  brand_bio: null,
  audience_blurb: null,
  default_hashtags: null,
}

export function BrandDescriptionSettings({ clientId }: Props) {
  const [settings, setSettings] = useState<Settings>(EMPTY)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      try {
        const r = await fetch(`/api/clients/${clientId}/brand-description-settings`, { cache: 'no-store' })
        const json = (await readJsonSafe(r)) as { success?: boolean; settings?: Settings; error?: string }
        if (cancelled) return
        if (!json.success || !json.settings) {
          setNotice({ type: 'error', message: json.error || 'Failed to load settings' })
        } else {
          setSettings({ ...EMPTY, ...json.settings })
        }
      } catch (err) {
        if (cancelled) return
        setNotice({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load' })
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

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const save = async () => {
    setIsSaving(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/brand-description-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const json = (await readJsonSafe(r)) as { success?: boolean; settings?: Settings; error?: string }
      if (!json.success) {
        setNotice({ type: 'error', message: `Save failed: ${json.error || 'unknown error'}` })
        return
      }
      if (json.settings) setSettings({ ...EMPTY, ...json.settings })
      setNotice({ type: 'success', message: 'Saved description settings' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setNotice({ type: 'error', message: `Save failed: ${msg}` })
    } finally {
      setIsSaving(false)
    }
  }

  const handleField = (
    label: string,
    key: keyof Settings,
    placeholder: string,
  ) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--text-secondary)]">{label}</label>
      <input
        type="text"
        value={(settings[key] as string | null) ?? ''}
        onChange={(e) => update(key, (e.target.value || null) as Settings[typeof key])}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
      />
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Long-form Description Settings</h3>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          Used in the YouTube description block of generated long-form scripts.
          Paste the FULL profile URL for each social so it auto-hyperlinks when YouTube renders the description.
          Leave a field blank and the AI will omit that line entirely.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading settings...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {handleField('Instagram URL', 'instagram_handle', 'https://www.instagram.com/your_handle/')}
              {handleField('TikTok URL', 'tiktok_handle', 'https://www.tiktok.com/@your_handle')}
              {handleField('YouTube URL', 'youtube_handle', 'https://www.youtube.com/@your_channel')}
              {handleField('LinkedIn URL', 'linkedin_handle', 'https://www.linkedin.com/in/your_handle')}
              {handleField('X / Twitter URL', 'x_handle', 'https://x.com/your_handle')}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Brand bio (1-2 sentences)</label>
              <textarea
                value={settings.brand_bio ?? ''}
                onChange={(e) => update('brand_bio', e.target.value || null)}
                placeholder="One paragraph about the creator / brand. Used in the description summary."
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Who this is for (audience blurb)</label>
              <textarea
                value={settings.audience_blurb ?? ''}
                onChange={(e) => update('audience_blurb', e.target.value || null)}
                placeholder="If you're a [role] who [problem], this is for you."
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                Default hashtags (one per line or space-separated, up to 20)
              </label>
              <textarea
                value={(settings.default_hashtags ?? []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                onChange={(e) => {
                  const tokens = e.target.value
                    .split(/\s+/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                  update('default_hashtags', tokens.length > 0 ? tokens : null)
                }}
                placeholder="#contentcreation #personalbrand #youtubetips ..."
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] font-mono"
              />
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Appended verbatim to the bottom of every long-form description. Leave empty to skip the hashtag block.
              </p>
            </div>

            <div className="flex items-center justify-end pt-2">
              <Button type="button" size="sm" onClick={save} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save settings'}
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
