'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import { TIER_LABEL } from '@/lib/campaignTiers'
import {
  Sparkles,
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

type PackageTier = 'top' | 'middle' | 'lower'

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
  todo: 'bg-gray-100 text-gray-700',
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
        .select('id, name, business_name, package_tier')
        .is('archived_at', null)
        .order('business_name', { ascending: true })
      setClients((data || []) as ClientLite[])
    })()
  }, [supabase])

  // Load campaigns for the *selected client only*. Empty until a client is
  // picked - the agency doesn't want to see all clients' tasks bleeding
  // into one view when they're focused on a specific client.
  const loadCampaigns = async (clientId: string) => {
    if (!clientId) {
      setCampaigns([])
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch(`/api/campaigns?clientId=${encodeURIComponent(clientId)}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => null)
      if (data?.success) {
        setCampaigns(data.campaigns as CampaignRow[])
      }
    } finally {
      setIsLoading(false)
    }
  }
  useEffect(() => {
    void loadCampaigns(selectedClientId)
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

  const handleCreate = async () => {
    if (!selectedClientId || isCreating) return
    setIsCreating(true)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClientId,
          name: campaignName.trim() || undefined,
          campaignNumber,
          monthNumber,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!data?.success) {
        setNotification({ type: 'error', message: data?.error || 'Failed to create campaign' })
        return
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
    } finally {
      setIsCreating(false)
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
            <div className="flex items-center gap-2 text-[#2B79F7]">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Create campaign</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                <ClientCombobox
                  clients={clients}
                  selectedId={selectedClientId}
                  onSelect={(id) => {
                    setSelectedClientId(id)
                    setNameDirty(false)
                  }}
                />
                {selectedClientId && pickedTier == null && (
                  <p className="mt-1 text-xs text-orange-600">
                    No package tier set on this client. Defaults will use the Lower-tier deliverable counts.
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
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-[#2B79F7]'
                  }`}
                >
                  <span>{t.label}</span>
                  <span className={`text-[10px] ${active ? 'text-white/80' : 'text-gray-400'}`}>
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
              <p className="py-12 text-center text-sm text-gray-400">
                Pick a client to see their campaigns.
              </p>
            ) : isLoading ? (
              <div className="py-12 flex items-center justify-center text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">
                {tab === 'all'
                  ? 'No campaigns yet for this client.'
                  : `No campaigns in ${STATUS_LABEL[tab as Status]}.`}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filtered.map((c) => {
                  const created = new Date(c.created_at)
                  return (
                    <li
                      key={c.id}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {c.name}
                          </span>
                          <span
                            className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_PILL[c.status]}`}
                          >
                            {STATUS_LABEL[c.status]}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {selectedClient?.business_name || selectedClient?.name || ''}
                          {c.tier_at_creation ? ` · ${TIER_LABEL[c.tier_at_creation]}` : ''}
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
                        className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
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
            className="relative w-full max-w-md rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              disabled={deleteMode !== null}
              className="absolute top-3 right-3 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900">Delete campaign?</h3>
              <p className="mt-1 text-sm text-gray-500">
                <span className="font-medium text-gray-700">{pendingDelete.name}</span>
                {'. '}
                Pick how far the delete should go.
              </p>

              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={() => void runDelete('app')}
                  disabled={deleteMode !== null}
                  className="w-full flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-[#2B79F7] hover:bg-blue-50 text-left transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4 mt-0.5 text-gray-500 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Remove from campaigns only
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
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
                  className="w-full flex items-start gap-3 p-3 rounded-lg border border-red-200 hover:border-red-500 hover:bg-red-50 text-left transition-colors disabled:opacity-50"
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
}: {
  clients: ClientLite[]
  selectedId: string
  onSelect: (id: string) => void
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
        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-left text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] flex items-center justify-between"
      >
        <span className={selected ? '' : 'text-gray-400'}>{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="sticky top-0 bg-white border-b border-gray-100 p-2">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-gray-50">
              <Search className="h-3.5 w-3.5 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients…"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-400">No matching clients.</p>
          ) : (
            <ul>
              {filtered.map((c) => {
                const active = c.id === selectedId
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(c.id)
                        setOpen(false)
                        setQuery('')
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 ${
                        active ? 'bg-blue-50 text-[#2B79F7]' : 'text-gray-700'
                      }`}
                    >
                      <span className="flex-1 truncate">
                        {c.business_name || c.name || 'Untitled'}
                      </span>
                      {c.package_tier && (
                        <span className="text-[10px] text-gray-400 shrink-0">
                          {TIER_LABEL[c.package_tier]}
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
