'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import { TIER_KEY_LABEL, type TierKey } from '@/lib/campaignTiers'
import {
  ExternalLink,
  Plus,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  Search,
  Trash2,
  X,
} from 'lucide-react'

type PackageTier = TierKey

type Status =
  | 'todo'
  | 'in_progress'
  | 'ready_for_review'
  | 'waiting_for_feedback'
  | 'discontinued'
  | 'approved'
  | 'completed'

interface CampaignRow {
  id: string
  client_id: string
  campaign_number: number
  month_number: number
  name: string
  tier_at_creation: PackageTier | null
  expected_long_form: number
  expected_short_form: number
  expected_engagement_reels: number
  expected_carousels: number
  expected_stories: number
  status: Status
  clickup_task_id: string | null
  created_at: string
  updated_at: string
}

interface ClientLite {
  id: string
  name: string | null
  business_name: string | null
  package_tier: PackageTier | null
  profile_picture_url: string | null
}

const STATUS_LABEL: Record<Status, string> = {
  todo: 'TO DO',
  in_progress: 'IN PROGRESS',
  ready_for_review: 'READY FOR REVIEW',
  waiting_for_feedback: 'WAITING FOR FEEDBACK',
  discontinued: 'DISCONTINUED',
  approved: 'APPROVED',
  completed: 'COMPLETED',
}

const STATUS_PILL: Record<Status, string> = {
  todo: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
  in_progress: 'bg-blue-50 text-blue-700',
  ready_for_review: 'bg-purple-50 text-purple-700',
  waiting_for_feedback: 'bg-orange-50 text-orange-700',
  discontinued: 'bg-red-50 text-red-700',
  approved: 'bg-green-50 text-green-700',
  completed: 'bg-emerald-50 text-emerald-700',
}

const TABS: { key: 'all' | Status; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'todo', label: STATUS_LABEL.todo },
  { key: 'in_progress', label: STATUS_LABEL.in_progress },
  { key: 'ready_for_review', label: STATUS_LABEL.ready_for_review },
  { key: 'waiting_for_feedback', label: STATUS_LABEL.waiting_for_feedback },
  { key: 'approved', label: STATUS_LABEL.approved },
  { key: 'completed', label: STATUS_LABEL.completed },
  { key: 'discontinued', label: STATUS_LABEL.discontinued },
]

export default function CampaignsPage() {
  const supabase = useMemo(() => createClient(), [])

  const [clients, setClients] = useState<ClientLite[]>([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all')

  // Selected client - drives BOTH the create form's auto-fill AND the
  // campaign list (the list only shows when a client is picked, mirroring
  // how the agency thinks about per-client campaign history).
  const [selectedClientId, setSelectedClientId] = useState('')
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  )

  // Create-form state
  const [campaignName, setCampaignName] = useState('')
  const [campaignNumber, setCampaignNumber] = useState<number>(1)
  const [monthNumber, setMonthNumber] = useState<number>(1)
  const [pickedTier, setPickedTier] = useState<PackageTier | null>(null)
  const [nameDirty, setNameDirty] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  // Delete-modal state - holds the campaign being deleted plus the chosen
  // mode. mode=null = the two-option chooser is showing; mode set = we're
  // running the delete and waiting on the API.
  const [pendingDelete, setPendingDelete] = useState<CampaignRow | null>(null)
  const [deleteMode, setDeleteMode] = useState<'app' | 'app+clickup' | null>(null)

  // Duplicate-name modal state. Shown when the server returns 409 because
  // a campaign with the same name already exists for this client. mode=null
  // = the chooser is showing; mode set = we're running the resolve action.
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    name: string
    existingCount: number
  } | null>(null)
  const [duplicateMode, setDuplicateMode] = useState<'create' | 'replace' | null>(null)

  const [notification, setNotification] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  useEffect(() => {
    if (!notification) return
    const t = setTimeout(() => setNotification(null), 3500)
    return () => clearTimeout(t)
  }, [notification])

  // Load clients (for the picker) once.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name, business_name, package_tier, profile_picture_url')
        .is('archived_at', null)
        .order('business_name', { ascending: true })
      setClients((data || []) as ClientLite[])
      setClientsLoading(false)
    })()
  }, [supabase])

  // Load campaigns for the *selected client only*. Empty until a client is
  // picked - the agency doesn't want to see all clients' tasks bleeding
  // into one view when they're focused on a specific client.
  // `silent` skips the loading spinner so the polling refresh doesn't
  // flicker the UI on every tick.
  const loadCampaigns = async (clientId: string, silent = false) => {
    if (!clientId) {
      setCampaigns([])
      return
    }
    if (!silent) setIsLoading(true)
    try {
      const res = await fetch(`/api/campaigns?clientId=${encodeURIComponent(clientId)}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => null)
      if (data?.success) {
        setCampaigns(data.campaigns as CampaignRow[])
      }
    } finally {
      if (!silent) setIsLoading(false)
    }
  }
  useEffect(() => {
    void loadCampaigns(selectedClientId)
  }, [selectedClientId])

  // Poll for ClickUp status changes so the board reflects moves the agency
  // makes directly in ClickUp without a manual refresh. The API already runs
  // a status-sync inside the GET handler, so refetching it is enough.
  // 20s is a good balance: short enough that "drag a card" feels live within
  // a few seconds, long enough that we don't hammer ClickUp's rate limit.
  // Also refetch when the tab regains focus so a long-idle tab catches up
  // immediately instead of waiting for the next tick.
  useEffect(() => {
    if (!selectedClientId) return
    const tick = () => void loadCampaigns(selectedClientId, true)
    const interval = window.setInterval(tick, 20_000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [selectedClientId])

  // Pull the next slot + tier when the client changes so the create form
  // prefills. Reset the name-dirty flag too so editing the numbers updates
  // the auto-name.
  useEffect(() => {
    if (!selectedClientId) {
      setCampaignName('')
      setCampaignNumber(1)
      setMonthNumber(1)
      setPickedTier(null)
      setNameDirty(false)
      return
    }
    void (async () => {
      const res = await fetch(
        `/api/campaigns/next-slot?clientId=${encodeURIComponent(selectedClientId)}`,
        { cache: 'no-store' },
      )
      const data = await res.json().catch(() => null)
      if (data?.success) {
        setCampaignNumber(data.campaignNumber as number)
        setMonthNumber(data.monthNumber as number)
        setPickedTier((data.tier as PackageTier | null) ?? null)
        setCampaignName(`Campaign ${data.campaignNumber} | Month ${data.monthNumber}`)
        setNameDirty(false)
      }
    })()
  }, [selectedClientId])

  useEffect(() => {
    if (nameDirty || !selectedClientId) return
    setCampaignName(`Campaign ${campaignNumber} | Month ${monthNumber}`)
  }, [campaignNumber, monthNumber, selectedClientId, nameDirty])

  // Core POST. If the server flags a duplicate name (409 +
  // requiresConfirmation), we surface the modal and return - the modal's
  // buttons re-call this with onDuplicate set to the chosen action.
  const submitCreate = async (
    onDuplicate?: 'create' | 'replace',
  ): Promise<'ok' | 'duplicate' | 'error'> => {
    if (!selectedClientId) return 'error'
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: selectedClientId,
        name: campaignName.trim() || undefined,
        campaignNumber,
        monthNumber,
        ...(onDuplicate ? { onDuplicate } : {}),
      }),
    })
    const data = await res.json().catch(() => null)

    if (res.status === 409 && data?.requiresConfirmation) {
      setPendingDuplicate({
        name: data.duplicateName || campaignName.trim(),
        existingCount: Number(data.existingCount) || 1,
      })
      return 'duplicate'
    }

    if (!data?.success) {
      setNotification({ type: 'error', message: data?.error || 'Failed to create campaign' })
      return 'error'
    }

    setNotification({
      type: 'success',
      message: data.clickupError
        ? `Campaign created. ClickUp warning: ${data.clickupError}`
        : 'Campaign created and pushed to ClickUp.',
    })
    await loadCampaigns(selectedClientId)
    // Refresh the next-slot suggestion so the next create increments.
    const slotRes = await fetch(
      `/api/campaigns/next-slot?clientId=${encodeURIComponent(selectedClientId)}`,
      { cache: 'no-store' },
    )
    const slot = await slotRes.json().catch(() => null)
    if (slot?.success) {
      setCampaignNumber(slot.campaignNumber as number)
      setMonthNumber(slot.monthNumber as number)
      setNameDirty(false)
    }
    return 'ok'
  }

  const handleCreate = async () => {
    if (!selectedClientId || isCreating) return
    setIsCreating(true)
    try {
      await submitCreate()
    } finally {
      setIsCreating(false)
    }
  }

  // Resolve the duplicate-name modal. 'create' allows the duplicate;
  // 'replace' deletes existing same-name campaigns server-side first.
  const resolveDuplicate = async (mode: 'create' | 'replace') => {
    if (!pendingDuplicate) return
    setDuplicateMode(mode)
    try {
      const outcome = await submitCreate(mode)
      if (outcome === 'ok') {
        setPendingDuplicate(null)
      }
    } finally {
      setDuplicateMode(null)
    }
  }

  // Two-option delete: run the delete with the chosen mode, close the
  // modal, refresh the list. Errors don't auto-close so the user can see
  // what happened.
  const runDelete = async (mode: 'app' | 'app+clickup') => {
    if (!pendingDelete) return
    setDeleteMode(mode)
    try {
      const params = mode === 'app+clickup' ? '?clickup=delete' : ''
      const res = await fetch(`/api/campaigns/${pendingDelete.id}${params}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => null)
      if (!data?.success) {
        setNotification({ type: 'error', message: data?.error || 'Failed to delete' })
        setDeleteMode(null)
        return
      }
      setNotification({
        type: 'success',
        message:
          mode === 'app+clickup'
            ? data.clickupError
              ? `Deleted from campaigns. ClickUp warning: ${data.clickupError}`
              : 'Deleted from campaigns + ClickUp.'
            : 'Deleted from campaigns. ClickUp task untouched.',
      })
      setPendingDelete(null)
      await loadCampaigns(selectedClientId)
    } finally {
      setDeleteMode(null)
    }
  }

  const filtered = tab === 'all' ? campaigns : campaigns.filter((c) => c.status === tab)

  return (
    <>
      <Header title="Campaigns" subtitle="Create monthly campaign tasks in ClickUp" />

      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto space-y-6">
        {/* Create form - client picker is a searchable combobox so an agency
            with 50+ clients can find one fast. */}
        <Card>
          <CardContent className="py-5 space-y-4">
            <div className="glass-eyebrow">Create campaign</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Client</label>
                <ClientCombobox
                  clients={clients}
                  selectedId={selectedClientId}
                  loading={clientsLoading}
                  onSelect={(id) => {
                    setSelectedClientId(id)
                    setNameDirty(false)
                  }}
                />
                {selectedClientId && pickedTier == null && (
                  <p className="mt-1 text-xs text-orange-600">
                    No package tier set on this client. Defaults will use the Foundation deliverable counts.
                  </p>
                )}
              </div>

              <Input
                label="Name"
                value={campaignName}
                onChange={(e) => {
                  setCampaignName(e.target.value)
                  setNameDirty(true)
                }}
                placeholder="Campaign 1 | Month 1"
                disabled={!selectedClientId}
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Campaign #"
                  type="number"
                  value={String(campaignNumber)}
                  onChange={(e) => setCampaignNumber(Math.max(1, Number(e.target.value) || 1))}
                  disabled={!selectedClientId}
                />
                <Input
                  label="Month #"
                  type="number"
                  value={String(monthNumber)}
                  onChange={(e) => setMonthNumber(Math.max(1, Number(e.target.value) || 1))}
                  disabled={!selectedClientId}
                />
              </div>

              <div className="md:flex md:items-end md:justify-end">
                <Button
                  onClick={handleCreate}
                  disabled={!selectedClientId || isCreating}
                  isLoading={isCreating}
                  className="w-full md:w-auto"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Create
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status tabs - only meaningful once a client is picked. */}
        {selectedClientId && (
          <div className="flex gap-1 flex-wrap">
            {TABS.map((t) => {
              const count =
                t.key === 'all'
                  ? campaigns.length
                  : campaigns.filter((c) => c.status === t.key).length
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[#2B79F7] text-white'
                      : 'bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[#2B79F7]'
                  }`}
                >
                  <span>{t.label}</span>
                  <span className={`text-[10px] ${active ? 'text-white/80' : 'text-[var(--text-tertiary)]'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* List */}
        <Card>
          <CardContent className="p-0">
            {!selectedClientId ? (
              <p className="py-12 text-center text-sm text-[var(--text-tertiary)]">
                Pick a client to see their campaigns.
              </p>
            ) : isLoading ? (
              <div className="py-12 flex items-center justify-center text-[var(--text-tertiary)]">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-[var(--text-tertiary)]">
                {tab === 'all'
                  ? 'No campaigns yet for this client.'
                  : `No campaigns in ${STATUS_LABEL[tab as Status]}.`}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-primary)]">
                {filtered.map((c) => {
                  const created = new Date(c.created_at)
                  return (
                    <li
                      key={c.id}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-card-hover)] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {c.name}
                          </span>
                          <span
                            className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_PILL[c.status]}`}
                          >
                            {STATUS_LABEL[c.status]}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">
                          {selectedClient?.business_name || selectedClient?.name || ''}
                          {c.tier_at_creation ? ` · ${TIER_KEY_LABEL[c.tier_at_creation]}` : ''}
                          {' · '}
                          {created.toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      </div>

                      {c.clickup_task_id && (
                        <a
                          href={`https://app.clickup.com/t/${c.clickup_task_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 inline-flex items-center gap-1 text-xs text-[#2B79F7] hover:underline"
                        >
                          ClickUp
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => setPendingDelete(c)}
                        className="shrink-0 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-500/10 transition-colors"
                        aria-label={`Delete ${c.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete-mode chooser. Two options - app-only or app + ClickUp - then
          a final confirm for whichever was picked. We model this as a single
          modal that swaps content based on `deleteMode` so the user always
          sees one decision at a time. */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => deleteMode == null && setPendingDelete(null)}
        >
          <div
            className="glass-pop relative w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-none rounded-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              disabled={deleteMode !== null}
              className="absolute top-3 right-3 p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Delete campaign?</h3>
              <p className="mt-1 text-sm text-[var(--text-tertiary)]">
                <span className="font-medium text-[var(--text-secondary)]">{pendingDelete.name}</span>
                {'. '}
                Pick how far the delete should go.
              </p>

              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={() => void runDelete('app')}
                  disabled={deleteMode !== null}
                  className="w-full flex items-start gap-3 p-3 rounded-lg border border-[var(--border-primary)] hover:border-[#2B79F7] hover:bg-blue-50 dark:hover:bg-[#1E3A6F]/40 text-left transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4 mt-0.5 text-[var(--text-tertiary)] shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      Remove from campaigns only
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      The ClickUp task stays put. Useful when the work continues there but
                      shouldn&apos;t clutter the campaigns log.
                    </div>
                    {deleteMode === 'app' && (
                      <div className="mt-1 text-xs text-[#2B79F7] inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Deleting…
                      </div>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void runDelete('app+clickup')}
                  disabled={deleteMode !== null}
                  className="w-full flex items-start gap-3 p-3 rounded-lg border border-red-200 hover:border-red-500 hover:bg-red-500/10 text-left transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4 mt-0.5 text-red-600 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-red-700">
                      Delete from campaigns + ClickUp
                    </div>
                    <div className="text-xs text-red-500/80 mt-0.5">
                      Permanent. Removes the ClickUp task and all of its subtasks. Cannot be undone.
                    </div>
                    {deleteMode === 'app+clickup' && (
                      <div className="mt-1 text-xs text-red-600 inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Deleting…
                      </div>
                    )}
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate-name chooser. Surfaces when the server returns 409
          because a campaign with the same name already exists for this
          client. Three options: create the duplicate, replace the existing
          same-name campaign(s), or cancel. Modeled like the delete modal. */}
      {pendingDuplicate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => duplicateMode == null && setPendingDuplicate(null)}
        >
          <div
            className="glass-pop relative w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-none rounded-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={() => setPendingDuplicate(null)}
              disabled={duplicateMode !== null}
              className="absolute top-3 right-3 p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                Campaign with this name already exists
              </h3>
              <p className="mt-1 text-sm text-[var(--text-tertiary)]">
                {pendingDuplicate.existingCount === 1 ? 'A campaign' : `${pendingDuplicate.existingCount} campaigns`}{' '}
                named{' '}
                <span className="font-medium text-[var(--text-secondary)]">
                  {pendingDuplicate.name}
                </span>
                {' '}
                already exist for this client. How do you want to proceed?
              </p>

              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={() => void resolveDuplicate('create')}
                  disabled={duplicateMode !== null}
                  className="w-full flex items-start gap-3 p-3 rounded-lg border border-[var(--border-primary)] hover:border-[#2B79F7] hover:bg-blue-50 dark:hover:bg-[#1E3A6F]/40 text-left transition-colors disabled:opacity-50"
                >
                  <Plus className="h-4 w-4 mt-0.5 text-[var(--text-tertiary)] shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      Create duplicate
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      Both campaigns will exist side by side. ClickUp accepts duplicate task names.
                    </div>
                    {duplicateMode === 'create' && (
                      <div className="mt-1 text-xs text-[#2B79F7] inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Creating…
                      </div>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void resolveDuplicate('replace')}
                  disabled={duplicateMode !== null}
                  className="w-full flex items-start gap-3 p-3 rounded-lg border border-red-200 hover:border-red-500 hover:bg-red-500/10 text-left transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4 mt-0.5 text-red-600 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-red-700">
                      Replace existing
                    </div>
                    <div className="text-xs text-red-500/80 mt-0.5">
                      Permanently deletes the existing same-name campaign{pendingDuplicate.existingCount > 1 ? 's' : ''}{' '}
                      and {pendingDuplicate.existingCount > 1 ? 'their' : 'its'} ClickUp task{pendingDuplicate.existingCount > 1 ? 's' : ''} before creating the new one. Cannot be undone.
                    </div>
                    {duplicateMode === 'replace' && (
                      <div className="mt-1 text-xs text-red-600 inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Replacing…
                      </div>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPendingDuplicate(null)}
                  disabled={duplicateMode !== null}
                  className="w-full p-3 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {notification && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 ${
            notification.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle className="h-5 w-5 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0" />
          )}
          <span className="text-sm font-medium">{notification.message}</span>
        </div>
      )}
    </>
  )
}

/**
 * Searchable client picker. Click to open, type to filter, click an option
 * to select. Keeps the query in local state so the search is in-memory and
 * we don't hammer the DB.
 */
function ClientCombobox({
  clients,
  selectedId,
  onSelect,
  loading = false,
}: {
  clients: ClientLite[]
  selectedId: string
  onSelect: (id: string) => void
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Click-outside to close.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = clients.find((c) => c.id === selectedId) || null
  const selectedLabel = selected
    ? selected.business_name || selected.name || 'Untitled'
    : 'Pick a client'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) =>
      [c.business_name, c.name].some((v) => (v || '').toLowerCase().includes(q)),
    )
  }, [clients, query])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-left text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] flex items-center gap-2.5"
      >
        {selected ? (
          selected.profile_picture_url ? (
            <Image
              src={selected.profile_picture_url}
              alt={selectedLabel}
              width={24}
              height={24}
              unoptimized
              className="rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="h-6 w-6 rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
              {selectedLabel.charAt(0).toUpperCase()}
            </div>
          )
        ) : null}
        <span className={`flex-1 truncate ${selected ? '' : 'text-[var(--text-tertiary)]'}`}>
          {selectedLabel}
        </span>
        <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)] shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-lg">
          <div className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border-primary)] p-2">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[var(--bg-tertiary)]">
              <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients…"
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
              />
            </div>
          </div>
          {loading ? (
            <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">Loading clients...</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">No matching clients.</p>
          ) : (
            <ul>
              {filtered.map((c) => {
                const active = c.id === selectedId
                const label = c.business_name || c.name || 'Untitled'
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(c.id)
                        setOpen(false)
                        setQuery('')
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${
                        active
                          ? 'bg-blue-100 text-[#1E54B7] dark:bg-[#1E3A6F] dark:text-[#93C5FD]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {c.profile_picture_url ? (
                        <Image
                          src={c.profile_picture_url}
                          alt={label}
                          width={22}
                          height={22}
                          unoptimized
                          className="rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-[22px] w-[22px] rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                          {label.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="flex-1 truncate">{label}</span>
                      {c.package_tier && (
                        <span
                          className={`text-[10px] shrink-0 ${
                            active
                              ? 'text-[#1E54B7]/70 dark:text-[#93C5FD]/70'
                              : 'text-[var(--text-tertiary)]'
                          }`}
                        >
                          {TIER_KEY_LABEL[c.package_tier]}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
