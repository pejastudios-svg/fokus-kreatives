// src/app/approvals/page.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/Loading'
import { ClientPicker } from '@/components/dashboard/ClientPicker'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { cldThumb, cldVideoPosterFromUrl } from '@/lib/cloudinary'
import {
  Plus,
  Search,
  CheckCircle,
  Clock,
  Link as LinkIcon,
  Trash2,
  X,
  ChevronDown,
  Loader2,
  LayoutGrid,
  List as ListIcon,
  Copy,
  FileText,
  Check,
  Upload as UploadIcon,
  Image as ImageIcon,
  Video as VideoIcon,
} from 'lucide-react'

interface Client {
  id: string
  name: string
  business_name: string
  profile_picture_url: string | null
}

interface User {
  id: string
  name: string
  email: string
  role: string
  profile_picture_url: string | null
}

interface Approval {
  id: string
  client_id: string
  title: string
  clickup_task_id: string | null
  clickup_task_name: string | null
  status: string
  share_token: string | null
  created_at: string
  clients?: {
    name: string
    business_name: string
  }
}

interface ApprovalItemDraft {
  title: string
  url: string
  initialComment: string
  attachments: import('@/lib/cloudinary').CloudinaryAsset[]
  isCarousel: boolean
  // Per-file upload progress (transient - not sent to server).
  uploads: { id: string; name: string; pct: number; error?: string }[]
}

const AUTO_APPROVE_PRESETS = [
  { label: 'No auto-approve', valueMinutes: null },
  { label: '7 days', valueMinutes: 7 * 24 * 60 },
  { label: '3 days', valueMinutes: 3 * 24 * 60 },
  { label: '24 hours', valueMinutes: 24 * 60 },
]

export default function ApprovalsPage() {
  const supabase = createClient()
  const router = useRouter()

  const [clients, setClients] = useState<Client[]>([])
  const [teamUsers, setTeamUsers] = useState<User[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Create modal state - separate from the filter `selectedClientId` so picking
  // a client for a NEW approval doesn't filter the underlying list.
  const [showModal, setShowModal] = useState(false)
  const [formClientId, setFormClientId] = useState('')
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [clickupTaskId, setClickupTaskId] = useState('')
  const [clickupTaskName, setClickupTaskName] = useState<string | null>(null)
  const [clickupLookupError, setClickupLookupError] = useState<string | null>(null)
  const [isFetchingClickup, setIsFetchingClickup] = useState(false)
  const [autoApproveMinutes, setAutoApproveMinutes] = useState<number | null>(7 * 24 * 60)
  const [items, setItems] = useState<ApprovalItemDraft[]>([
    { title: '', url: '', initialComment: '', attachments: [], isCarousel: true, uploads: [] },
  ])
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([])
  const [assigneeSearchOpen, setAssigneeSearchOpen] = useState(false)
  const [assigneeSearch, setAssigneeSearch] = useState('')

  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [statusTab, setStatusTab] = useState<'all' | 'pending' | 'approved'>('all')
  // Read the user's saved view mode synchronously during initial state so the
  // first paint already matches their preference. If we let a useEffect flip
  // it post-mount the user sees the wrong-shape skeleton flash, then snap to
  // the correct shape - which reads as "the skeleton is glitching."
  const [viewMode, setViewMode] = useState<'board' | 'list'>(() => {
    if (typeof window === 'undefined') return 'board'
    try {
      const stored = window.localStorage.getItem('fk:approvals:view')
      if (stored === 'list' || stored === 'board') return stored
    } catch {
      // ignore
    }
    return 'board'
  })
  const [topAssets, setTopAssets] = useState<Record<string, { url: string; title: string | null; total: number }>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const showToast = (kind: 'success' | 'error', text: string, ms = 2400) => {
    setToast({ kind, text })
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), ms)
  }
  const [confirmAction, setConfirmAction] = useState<{
  approvalId: string
  mode: 'approve' | 'unapprove'
} | null>(null)

  const [deleteConfirm, setDeleteConfirm] = useState<Approval | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // React Strict Mode (dev) double-mounts components and runs effects twice;
  // a stale second init() call would flip isLoading true→false→true→false and
  // the user perceives the skeleton flickering on and off. The ref guard
  // ensures init only runs once per real mount.
  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setView = (mode: 'board' | 'list') => {
    setViewMode(mode)
    try {
      window.localStorage.setItem('fk:approvals:view', mode)
    } catch {
      // ignore
    }
  }

  // Load the top asset for each visible approval so we can render a preview
  // card. We fetch in a single query using `in()` and pick position=0 per
  // approval. Refetched whenever the approvals list changes.
  useEffect(() => {
    if (approvals.length === 0) {
      setTopAssets({})
      return
    }
    let cancelled = false
    void (async () => {
      const ids = approvals.map((a) => a.id)
      const { data, error } = await supabase
        .from('approval_items')
        .select('approval_id, url, title, position')
        .in('approval_id', ids)
        .order('position', { ascending: true })
      if (cancelled) return
      if (error) {
        console.error('Load top assets error:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        })
        return
      }
      const map: Record<string, { url: string; title: string | null; total: number }> = {}
      for (const row of data || []) {
        const r = row as { approval_id: string; url: string; title: string | null; position: number }
        if (!map[r.approval_id]) {
          map[r.approval_id] = { url: r.url, title: r.title, total: 1 }
        } else {
          map[r.approval_id].total += 1
        }
      }
      setTopAssets(map)
    })()
    return () => {
      cancelled = true
    }
  }, [approvals, supabase])

  // Debounced ClickUp lookup. Fires automatically as the user types so they
  // don't need to click a "Check" button. We cancel any in-flight call when
  // the input changes and only honor the most recent response.
  useEffect(() => {
    if (!showModal) return
    const trimmed = clickupTaskId.trim()
    if (!trimmed) {
      setClickupTaskName(null)
      setClickupLookupError(null)
      setIsFetchingClickup(false)
      return
    }

    setIsFetchingClickup(true)
    setClickupLookupError(null)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/clickup/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: trimmed }),
        })
        const data = await res.json()
        if (cancelled) return
        if (data.success) {
          setClickupTaskName(data.name)
          setClickupLookupError(null)
        } else {
          setClickupTaskName(null)
          setClickupLookupError(data.error || 'Task not found')
        }
      } catch (err) {
        if (cancelled) return
        console.error('ClickUp lookup error:', err)
        setClickupTaskName(null)
        setClickupLookupError('Lookup failed')
      } finally {
        if (!cancelled) setIsFetchingClickup(false)
      }
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [clickupTaskId, showModal])

  // When the form's client changes, preselect the client's assignees
  // (from `client_assignees`) as the default approval reviewers.
  useEffect(() => {
    if (!showModal || !formClientId) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('client_assignees')
        .select('user_id')
        .eq('client_id', formClientId)
      if (cancelled) return
      const ids = (data || [])
        .map((r: { user_id: string | null }) => r.user_id)
        .filter((id): id is string => Boolean(id))
      setSelectedAssigneeIds(ids)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formClientId, showModal])

  const init = async () => {
    setIsLoading(true)
    try {
      // Current user
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        setCurrentUserId(user.id)
      }

      // Clients
      const { data: clientsData } = await supabase
        .from('clients')
        .select('id, name, business_name, profile_picture_url')
        .is('archived_at', null)
        .order('name')

      setClients((clientsData || []) as Client[])

      // Team users (non-client roles). Match the Team page filters
      // exactly - is_agency_user=true + client_id IS NULL + role in
      // (admin,manager,employee) - so the assignee dropdown can't surface
      // users who don't appear on the Team page. Without this, partially-
      // invited users (is_agency_user=false) leak into assignments.
      const { data: usersData } = await supabase
        .from('users')
        .select('id, name, email, role, profile_picture_url')
        .eq('is_agency_user', true)
        .is('client_id', null)
        .in('role', ['admin', 'manager', 'employee'])

      setTeamUsers(usersData || [])

      await loadApprovals()
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
  let t: ReturnType<typeof setTimeout> | null = null

  const reload = () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      loadApprovals(selectedClientId || undefined)
    }, 250)
  }

  const channel = supabase
    .channel('approvals-list-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'approvals' },
      () => reload()
    )
    .subscribe()

  return () => {
    if (t) clearTimeout(t)
    supabase.removeChannel(channel)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedClientId])

  const roleRank: Record<string, number> = {
  admin: 0,
  manager: 1,
  employee: 2,
  guest: 3,
  client: 4,
}

const sortedTeamUsers = [...teamUsers].sort((a, b) => {
  const ra = roleRank[a.role] ?? 99
  const rb = roleRank[b.role] ?? 99
  if (ra !== rb) return ra - rb
  const an = (a.name || a.email || '').toLowerCase()
  const bn = (b.name || b.email || '').toLowerCase()
  return an.localeCompare(bn)
})

const topAssignees = sortedTeamUsers.slice(0, 3)

const searchResults = assigneeSearchOpen
  ? sortedTeamUsers
      .filter((u) => {
        // exclude top 3 so it stays clean (they're already visible)
        if (topAssignees.some((t) => t.id === u.id)) return false
        const q = assigneeSearch.trim().toLowerCase()
        if (!q) return false
        const hay = `${u.name || ''} ${u.email || ''} ${u.role || ''}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 5)
  : []

  const loadApprovals = async (clientId?: string) => {
    const buildQuery = (withShareToken: boolean) => {
      const fields = withShareToken
        ? 'id, client_id, title, clickup_task_id, clickup_task_name, status, share_token, created_at, clients(name, business_name)'
        : 'id, client_id, title, clickup_task_id, clickup_task_name, status, created_at, clients(name, business_name)'
      const q = supabase.from('approvals').select(fields).order('created_at', { ascending: false })
      if (clientId) q.eq('client_id', clientId)
      return q
    }

    // Try with share_token first; if the column doesn't exist (migration not
    // run yet), retry without it. PostgREST returns code 42703 / PGRST204 in
    // that case.
    let { data, error } = await buildQuery(true)
    if (error && /42703|PGRST204|share_token/i.test(`${(error as { message?: string }).message || ''} ${(error as { code?: string }).code || ''}`)) {
      console.warn('approvals.share_token missing - falling back. Run the latest migration to enable public review links.')
      const retry = await buildQuery(false)
      data = retry.data
      error = retry.error
    }
    if (error) {
      // supabase-js sometimes returns an error whose enumerable props print
      // as {} in DevTools - pull the named ones AND a stringified fallback so
      // we can actually see what's wrong.
      const props = Object.getOwnPropertyNames(error || {})
      console.error('Load approvals error:', {
        clientIdFilter: clientId || null,
        message: (error as { message?: string }).message ?? '(no message)',
        details: (error as { details?: string }).details ?? '(no details)',
        hint: (error as { hint?: string }).hint ?? '(no hint)',
        code: (error as { code?: string }).code ?? '(no code)',
        rawJSON: JSON.stringify(error, props),
      })
      return
    }
    console.debug('[approvals] loaded', { count: data?.length ?? 0, clientIdFilter: clientId || null })

    const mapped: Approval[] = (data || []).map((row: unknown) => {
    const r = row as {
      id: string
      client_id: string
      title: string
      clickup_task_id: string | null
      clickup_task_name: string | null
      status: string
      share_token: string | null
      created_at: string
      clients: { name: string; business_name: string } | { name: string; business_name: string }[] | null
    }
    return {
      id: r.id,
      client_id: r.client_id,
      title: r.title,
      clickup_task_id: r.clickup_task_id,
      clickup_task_name: r.clickup_task_name,
      status: r.status,
      share_token: r.share_token,
      created_at: r.created_at,
      // Fix: Convert null to undefined to match Approval interface
      clients: (Array.isArray(r.clients) ? r.clients[0] : r.clients) || undefined,
    }
  })

  setApprovals(mapped)
}

  const handleCopyApprovalLink = async (approvalId: string) => {
    try {
      // Prefer the public review URL (token-based, what clients use). Fall
      // back to the agency URL if the share_token isn't set yet (e.g. row
      // predates the migration).
      const a = approvals.find((x) => x.id === approvalId)
      const url = a?.share_token
        ? `${window.location.origin}/review/${a.share_token}`
        : `${window.location.origin}/approvals/${approvalId}`
      await navigator.clipboard.writeText(url)
      setCopiedId(approvalId)
      showToast('success', a?.share_token ? 'Review link copied' : 'Link copied')
      setTimeout(() => {
        setCopiedId((prev) => (prev === approvalId ? null : prev))
      }, 1500)
    } catch (err) {
      console.error('Copy approval link error:', err)
      showToast('error', "Couldn't copy. Try again.")
    }
  }

  // Search-filtered subset (used by both the tabs and their counts).
  const searchedApprovals = approvals.filter((a) => {
    const q = searchQuery.toLowerCase()
    if (!q) return true
    const title = a.title.toLowerCase()
    const clientName =
      (a.clients?.business_name || a.clients?.name || '').toLowerCase()
    const clickupName = (a.clickup_task_name || '').toLowerCase()
    return (
      title.includes(q) ||
      clientName.includes(q) ||
      clickupName.includes(q) ||
      (a.clickup_task_id || '').toLowerCase().includes(q)
    )
  })

  const counts = useMemo(() => {
    let approved = 0
    let pending = 0
    for (const a of searchedApprovals) {
      if (a.status === 'approved') approved += 1
      else pending += 1
    }
    return { all: searchedApprovals.length, approved, pending }
  }, [searchedApprovals])

  const filteredApprovals = searchedApprovals.filter((a) => {
    if (statusTab === 'approved') return a.status === 'approved'
    if (statusTab === 'pending') return a.status !== 'approved'
    return true
  })

  const handleAddItem = () => {
    setItems((prev) => [...prev, { title: '', url: '', initialComment: '', attachments: [], isCarousel: true, uploads: [] }])
  }

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: 'title' | 'url' | 'initialComment', value: string) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  const handleItemFlag = (index: number, field: 'isCarousel', value: boolean) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  const handleRemoveAttachment = (itemIndex: number, attachmentIndex: number) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== itemIndex) return item
        const next = item.attachments.filter((_, j) => j !== attachmentIndex)
        return {
          ...item,
          attachments: next,
          // Carousel only makes sense with 2+ assets.
          isCarousel: next.length > 1 ? item.isCarousel : false,
        }
      }),
    )
  }

  const handleUploadFiles = async (itemIndex: number, files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return

    const { uploadToCloudinary, fileKind } = await import('@/lib/cloudinary')

    // Seed upload tracking entries so each file gets its own progress bar.
    const tracking = list.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${f.name}`,
      name: f.name,
      pct: 0,
    }))

    setItems((prev) =>
      prev.map((item, i) =>
        i === itemIndex ? { ...item, uploads: [...item.uploads, ...tracking] } : item,
      ),
    )

    // Kick off uploads in parallel; each updates its own tracking entry.
    await Promise.all(
      list.map(async (file, j) => {
        const trackingId = tracking[j].id
        const kind = fileKind(file)
        if (kind === 'other') {
          setItems((prev) =>
            prev.map((item, i) =>
              i === itemIndex
                ? {
                    ...item,
                    uploads: item.uploads.map((u) =>
                      u.id === trackingId ? { ...u, error: 'Unsupported type' } : u,
                    ),
                  }
                : item,
            ),
          )
          return
        }

        try {
          const asset = await uploadToCloudinary(file, {
            folder: `approvals/drafts/${formClientId || 'unscoped'}`,
            onProgress: (pct) => {
              setItems((prev) =>
                prev.map((item, i) =>
                  i === itemIndex
                    ? {
                        ...item,
                        uploads: item.uploads.map((u) =>
                          u.id === trackingId ? { ...u, pct } : u,
                        ),
                      }
                    : item,
                ),
              )
            },
          })

          setItems((prev) =>
            prev.map((item, i) =>
              i === itemIndex
                ? {
                    ...item,
                    attachments: [...item.attachments, asset],
                    uploads: item.uploads.filter((u) => u.id !== trackingId),
                  }
                : item,
            ),
          )
        } catch (err) {
          console.error('Upload failed:', err)
          const msg = err instanceof Error ? err.message : 'Upload failed'
          setItems((prev) =>
            prev.map((item, i) =>
              i === itemIndex
                ? {
                    ...item,
                    uploads: item.uploads.map((u) =>
                      u.id === trackingId ? { ...u, error: msg } : u,
                    ),
                  }
                : item,
            ),
          )
        }
      }),
    )
  }

  const toggleAssignee = (userId: string) => {
    setSelectedAssigneeIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  const validItems = useMemo(
    () =>
      items
        .map((i) => ({
          title: i.title.trim(),
          url: i.url.trim(),
          initialComment: i.initialComment.trim(),
          attachments: i.attachments,
          isCarousel: i.isCarousel,
        }))
        // Valid = has at least a URL OR one finished upload. Pending uploads
        // shouldn't gate submission - the user can still add a URL alongside.
        .filter((i) => i.url || i.attachments.length > 0),
    [items],
  )

  const anyUploadInFlight = useMemo(
    () => items.some((i) => i.uploads.length > 0 && i.uploads.every((u) => !u.error)),
    [items],
  )

  const canSubmitNewApproval =
    Boolean(currentUserId) &&
    Boolean(formClientId) &&
    formTitle.trim().length > 0 &&
    validItems.length > 0 &&
    !isFetchingClickup &&
    !anyUploadInFlight

  const { run: handleCreateApproval, isRunning: isCreating } = useAsyncAction(async () => {
    if (!canSubmitNewApproval || !currentUserId) return
    try {
      const res = await fetch('/api/approvals/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: currentUserId,
          clientId: formClientId,
          title: formTitle.trim(),
          description: formDescription.trim() || null,
          clickupTaskId: clickupTaskId.trim() || null,
          autoApproveMinutes,
          assigneeIds: selectedAssigneeIds,
          items: validItems,
        }),
      })

      // The route returns JSON on every code path, but if it 500s with an HTML
      // error page, json() throws - make sure the user sees what happened
      // instead of a silent close.
      let data: { success?: boolean; error?: string; approvalId?: string } | null = null
      try {
        data = await res.json()
      } catch (parseErr) {
        console.error('Create approval: response was not JSON', parseErr, { status: res.status })
        showToast('error', `Couldn't create the approval (server returned ${res.status}).`)
        return
      }

      if (!data?.success) {
        console.error('Create approval failed:', data?.error, { status: res.status })
        showToast(
          'error',
          data?.error || "Couldn't create the approval. Please try again.",
        )
        return
      }

      // Sanity check: did the row actually land where this user can see it?
      // Server-side insert uses the service-role key (bypasses RLS), but the
      // list page reads via cookie auth (RLS-enforced). If the row exists but
      // the policies don't allow this user to SELECT it, that's why "the new
      // approval doesn't show up" - surface that explicitly here.
      const newId = data.approvalId
      if (newId) {
        const { data: visibilityCheck, error: visibilityErr } = await supabase
          .from('approvals')
          .select('id')
          .eq('id', newId)
          .maybeSingle()

        if (visibilityErr) {
          console.error('Created approval visibility check error:', {
            approvalId: newId,
            message: visibilityErr.message,
            details: visibilityErr.details,
            hint: visibilityErr.hint,
            code: visibilityErr.code,
          })
        } else if (!visibilityCheck) {
          console.warn(
            'Approval was created server-side but the current user cannot SELECT it back - likely an RLS policy issue on the `approvals` table.',
            { approvalId: newId },
          )
          showToast(
            'error',
            "Approval created, but you don't have permission to view it. Ask an admin to update RLS.",
            5000,
          )
        }
      }

      // Reset form.
      const createdForClient = formClientId
      setShowModal(false)
      setFormClientId('')
      setFormTitle('')
      setFormDescription('')
      setClickupTaskId('')
      setClickupTaskName(null)
      setClickupLookupError(null)
      setAutoApproveMinutes(7 * 24 * 60)
      setItems([{ title: '', url: '', initialComment: '', attachments: [], isCarousel: true, uploads: [] }])
      setSelectedAssigneeIds([])

      // Reload visible approvals. Only switch the client filter if the user
      // was already filtering by a DIFFERENT client - otherwise we'd narrow
      // an "all clients" view down to just the one we just uploaded for,
      // which makes the rest of the list look like it disappeared.
      const needsFilterSwitch =
        selectedClientId !== '' && selectedClientId !== createdForClient
      if (needsFilterSwitch) {
        setSelectedClientId(createdForClient)
        await loadApprovals(createdForClient)
      } else {
        await loadApprovals(selectedClientId || undefined)
      }
      showToast('success', 'Approval created')
    } catch (err) {
      console.error('Create approval exception:', err)
      showToast('error', 'Network hiccup. Please try again.')
    }
  })

  const handleToggleApprove = async (approvalId: string, approved: boolean) => {
  if (!currentUserId) return

  // Optimistic update
  setApprovals((prev) =>
    prev.map((a) =>
      a.id === approvalId ? { ...a, status: approved ? 'approved' : 'pending' } : a
    )
  )

  setApprovingId(approvalId)
  try {
    const res = await fetch('/api/approvals/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvalId,
        actorId: currentUserId,
        approved,
      }),
    })
    const data = await res.json().catch(() => ({ success: false }))
    if (!data.success) {
      console.error('Toggle approve failed:', data.error)
      showToast('error', data.error || "Couldn't update that approval. Please try again.")
      await loadApprovals(selectedClientId || undefined) // rollback from server
      return
    }

    // Re-sync from server (status, ClickUp, etc.)
    await loadApprovals(selectedClientId || undefined)
    showToast('success', approved ? 'Marked as approved' : 'Marked as pending')
  } catch (err) {
    console.error('Toggle approve exception:', err)
    showToast('error', 'Network hiccup. Please try again.')
    await loadApprovals(selectedClientId || undefined)
  } finally {
    setApprovingId(null)
  }
}

const handleDeleteApproval = async (approvalId: string) => {
  // Optimistic removal - restore on failure.
  const previous = approvals
  setApprovals((prev) => prev.filter((a) => a.id !== approvalId))
  setIsDeleting(true)
  try {
    const res = await fetch('/api/approvals/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId }),
    })
    const data = await res.json().catch(() => ({ success: false }))
    if (!data.success) {
      console.error('Delete approval failed:', data.error)
      setApprovals(previous)
      showToast('error', data.error || "Couldn't delete that approval. Please try again.")
      return
    }
    showToast('success', 'Approval deleted')
  } catch (err) {
    console.error('Delete approval exception:', err)
    setApprovals(previous)
    showToast('error', 'Network error while deleting. Please try again.')
  } finally {
    setIsDeleting(false)
    setDeleteConfirm(null)
  }
}

function ClientFilterCombobox({
  clients,
  value,
  onChange,
}: {
  clients: Client[]
  value: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = clients.find((c) => c.id === value) || null
  const label = selected
    ? selected.business_name
      ? `${selected.name} - ${selected.business_name}`
      : selected.name
    : 'All clients'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => {
      const a = (c.name || '').toLowerCase()
      const b = (c.business_name || '').toLowerCase()
      return a.includes(q) || b.includes(q)
    })
  }, [clients, query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative w-full md:w-64">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setQuery('')
        }}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] text-left"
      >
        <span className="truncate text-sm">{label}</span>
        <ChevronDown
          className={`h-4 w-4 text-[var(--text-tertiary)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-2 bg-[var(--bg-card)] rounded-lg border border-[var(--border-primary)] shadow-lg overflow-hidden">
          <div className="p-2 border-b border-[var(--border-primary)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients…"
                autoFocus
                className="w-full pl-8 pr-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>
          </div>

          <ul className="max-h-64 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  value === ''
                    ? 'bg-blue-100 text-[#1E54B7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] font-medium'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                All clients
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-[var(--text-tertiary)]">No matches</li>
            ) : (
              filtered.map((c) => {
                const active = c.id === value
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(c.id)
                        setOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-blue-100 text-[#1E54B7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] font-medium'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <div className="truncate">{c.name}</div>
                      {c.business_name && (
                        <div className="text-xs text-[var(--text-tertiary)] truncate">{c.business_name}</div>
                      )}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function ApprovalsBoardSkeleton() {
  // No `animate-in fade-in` here on purpose - that mount-time animation
  // re-triggers on React's Strict Mode dev double-mount, which the user
  // perceives as the skeleton flickering on/off. The Skeleton blocks
  // already have their own animate-pulse shimmer for "loading" feel.
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
        <Card key={i} className="overflow-hidden">
          <Skeleton className="aspect-video w-full rounded-none" />
          <CardContent className="p-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-7 w-12 rounded-md" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

  return (
    <>
      <Header
        title="Approvals"
        subtitle="Send assets for client approval and track ClickUp status"
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border ${
              toast.kind === 'success'
                ? 'bg-[var(--bg-card)] border-[#2B79F7]/30 text-[#2B79F7] dark:text-[#93C5FD]'
                : 'bg-[var(--bg-card)] border-red-500/30 text-red-500'
            }`}
          >
            {toast.kind === 'success' ? (
              <CheckCircle className="h-4 w-4 shrink-0" />
            ) : (
              <X className="h-4 w-4 shrink-0" />
            )}
            <span className="text-sm">{toast.text}</span>
          </div>
        </div>
      )}

      <div className="p-4 md:p-8">
        {/* Top bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            {/* Client filter */}
            <ClientFilterCombobox
              clients={clients}
              value={selectedClientId}
              onChange={(val) => {
                setSelectedClientId(val)
                loadApprovals(val || undefined)
              }}
            />

            {/* Search */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="Search approvals..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center bg-[var(--bg-card)] rounded-xl p-1 border border-[var(--border-primary)]">
              <button
                type="button"
                onClick={() => setView('board')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'board'
                    ? 'bg-[#E8F1FF] text-[#2B79F7] shadow-sm'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
                aria-label="Board view"
                title="Board view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[#E8F1FF] text-[#2B79F7] shadow-sm'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
                aria-label="List view"
                title="List view"
              >
                <ListIcon className="h-4 w-4" />
              </button>
            </div>
            <Button
              onClick={() => {
                if (selectedClientId) setFormClientId(selectedClientId)
                setShowModal(true)
              }}
            >
              <Plus className="h-5 w-5 mr-2" />
              New Approval
            </Button>
          </div>
        </div>

        {/* Status tabs - All / Pending / Approved with live counts. */}
        <div className="mb-4 inline-flex items-center bg-[var(--bg-card)] rounded-xl p-1 border border-[var(--border-primary)]">
          {([
            { id: 'all', label: 'All', count: counts.all },
            { id: 'pending', label: 'Pending', count: counts.pending },
            { id: 'approved', label: 'Approved', count: counts.approved },
          ] as const).map((tab) => {
            const active = statusTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-[#E8F1FF] text-[#2B79F7] shadow-sm font-medium'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
              >
                {tab.label}
                <span
                  className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium ${
                    active ? 'bg-[#2B79F7] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Approvals list */}
        {isLoading ? (
          // The skeleton is intentionally not branched on viewMode. When we
          // branched, hydrating the page (where the server defaulted to
          // 'board' but the client read 'list' from localStorage) re-rendered
          // the skeleton with a different shape, which the user perceived as
          // the skeleton "glitching on and off." The board-shape placeholder
          // works visually for both layouts.
          <ApprovalsBoardSkeleton />
        ) : filteredApprovals.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-[var(--text-tertiary)]">
              {statusTab === 'all'
                ? 'No approvals yet. Create your first one.'
                : statusTab === 'pending'
                  ? 'No pending approvals - every asset has been signed off.'
                  : 'Nothing approved yet.'}
            </CardContent>
          </Card>
        ) : viewMode === 'board' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredApprovals.map((a) => (
              <ApprovalBoardCard
                key={a.id}
                approval={a}
                preview={topAssets[a.id]}
                isCopied={copiedId === a.id}
                isApproving={approvingId === a.id}
                onOpen={() => router.push(`/approvals/${a.id}`)}
                onCopy={() => void handleCopyApprovalLink(a.id)}
                onToggleApprove={(isApproved) =>
                  setConfirmAction({
                    approvalId: a.id,
                    mode: isApproved ? 'unapprove' : 'approve',
                  })
                }
                onDelete={() => setDeleteConfirm(a)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredApprovals.map((a) => (
              <ApprovalListRow
                key={a.id}
                approval={a}
                isCopied={copiedId === a.id}
                isApproving={approvingId === a.id}
                onOpen={() => router.push(`/approvals/${a.id}`)}
                onCopy={() => void handleCopyApprovalLink(a.id)}
                onToggleApprove={(isApproved) =>
                  setConfirmAction({
                    approvalId: a.id,
                    mode: isApproved ? 'unapprove' : 'approve',
                  })
                }
                onDelete={() => setDeleteConfirm(a)}
              />
            ))}
          </div>
        )}

        {/* Create Approval Modal */}
        {showModal && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
      {/* Indeterminate progress bar - shows while we POST the approval. */}
      <div className="relative h-1 bg-[var(--bg-tertiary)] overflow-hidden">
        {isCreating && (
          <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-[#2B79F7] to-transparent animate-[approval-progress_1.2s_ease-in-out_infinite]" />
        )}
      </div>
      <CardHeader>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          New Approval
        </h3>
      </CardHeader>
      <CardContent className="space-y-4 overflow-y-auto">
                {/* Client */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Client
                  </label>
                  <ClientPicker
                    clients={clients}
                    value={formClientId}
                    onChange={setFormClientId}
                    placeholder="Search & select client…"
                  />
                </div>

                {/* Title & Description */}
                <Input
                  label="Approval Title"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="March content batch, Week 1"
                />
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                    placeholder="Anything the client should know about this batch..."
                  />
                </div>

                {/* ClickUp Task ID - auto-resolves task name on input. */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    ClickUp Task ID
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={clickupTaskId}
                      onChange={(e) => setClickupTaskId(e.target.value)}
                      className="w-full px-4 py-2.5 pr-9 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      placeholder="e.g. 9h3d5k…"
                    />
                    {isFetchingClickup && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)] animate-spin" />
                    )}
                    {!isFetchingClickup && clickupTaskName && (
                      <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-600" />
                    )}
                  </div>
                  {clickupTaskName && !isFetchingClickup && (
                    <p className="mt-1 text-xs text-green-600">
                      Task found: <span className="font-medium">{clickupTaskName}</span>
                    </p>
                  )}
                  {clickupLookupError && !isFetchingClickup && clickupTaskId.trim() && (
                    <p className="mt-1 text-xs text-amber-600">{clickupLookupError}</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    Leave empty if this approval isn&rsquo;t tied to a ClickUp task. When set,
                    the task will auto-flip to &ldquo;waiting for feedback&rdquo; on create and
                    &ldquo;approved&rdquo; once every asset is approved.
                  </p>
                </div>

                {/* Auto-approve preset */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Auto-approval
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {AUTO_APPROVE_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setAutoApproveMinutes(p.valueMinutes)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          autoApproveMinutes === p.valueMinutes
                            ? 'bg-[#2B79F7] text-white border-[#2B79F7] hover:bg-[#1E54B7]'
                            : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:border-[#2B79F7] hover:bg-[var(--bg-card-hover)]'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    Clients cannot change this. Any unapproved assets will auto-approve after
                    this time.
                  </p>
                </div>

                {/* Assets */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    Assets for approval
                  </label>
                  <div className="space-y-3">
                    {items.map((item, index) => (
                      <div
                        key={index}
                        className="border border-[var(--border-primary)] rounded-lg p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-[var(--text-tertiary)]">
                            Asset #{index + 1}
                          </span>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(index)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        <Input
                          label="Title (optional)"
                          value={item.title}
                          onChange={(e) =>
                            handleItemChange(index, 'title', e.target.value)
                          }
                          placeholder="e.g. Longform #1, Hooks batch, Stories..."
                        />
                        <Input
                          label="URL (optional if uploading)"
                          value={item.url}
                          onChange={(e) =>
                            handleItemChange(index, 'url', e.target.value)
                          }
                          placeholder="https://drive.google.com/..."
                        />

                        {/* Upload area */}
                        <div>
                          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                            Or upload images / videos
                          </label>
                          <label
                            htmlFor={`asset-upload-${index}`}
                            className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-[var(--border-primary)] rounded-lg text-xs text-[var(--text-tertiary)] hover:border-[#2B79F7] hover:bg-[#E8F1FF]/30 cursor-pointer transition-colors"
                          >
                            <UploadIcon className="h-4 w-4" />
                            <span>Click to pick files (multi-select supported)</span>
                          </label>
                          <input
                            id={`asset-upload-${index}`}
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            className="sr-only"
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length) {
                                handleUploadFiles(index, e.target.files)
                              }
                              // Reset so picking the same file twice still fires.
                              e.target.value = ''
                            }}
                          />
                        </div>

                        {/* Live upload progress */}
                        {item.uploads.length > 0 && (
                          <div className="space-y-1.5">
                            {item.uploads.map((u) => (
                              <div key={u.id} className="text-[11px]">
                                <div className="flex items-center justify-between text-[var(--text-secondary)]">
                                  <span className="truncate pr-2">{u.name}</span>
                                  <span>
                                    {u.error ? (
                                      <span className="text-red-500">{u.error}</span>
                                    ) : (
                                      `${u.pct}%`
                                    )}
                                  </span>
                                </div>
                                {!u.error && (
                                  <div className="h-1 bg-[var(--bg-card-hover)] rounded overflow-hidden mt-0.5">
                                    <div
                                      className="h-full bg-[#2B79F7] transition-all duration-150"
                                      style={{ width: `${u.pct}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Uploaded thumbnails */}
                        {item.attachments.length > 0 && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-3 gap-2">
                              {item.attachments.map((a, j) => {
                                // Use Cloudinary's frame-extraction so videos
                                // render an actual poster image, not just an icon.
                                const thumbUrl = cldThumb(a, { w: 600, h: 600, crop: 'fill' })
                                return (
                                <div
                                  key={`${a.public_id}-${j}`}
                                  className="relative group aspect-square rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] overflow-hidden"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={thumbUrl}
                                    alt={a.name}
                                    className="h-full w-full object-cover"
                                  />
                                  {a.resource_type === 'video' && (
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                      <div className="h-9 w-9 rounded-full bg-black/55 flex items-center justify-center backdrop-blur-sm">
                                        <VideoIcon className="h-4 w-4 text-white" />
                                      </div>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveAttachment(index, j)}
                                    className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                    aria-label="Remove attachment"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                  <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px]">
                                    {a.resource_type === 'video' ? (
                                      <VideoIcon className="h-2.5 w-2.5" />
                                    ) : (
                                      <ImageIcon className="h-2.5 w-2.5" />
                                    )}
                                    {a.format}
                                  </span>
                                </div>
                                )
                              })}
                            </div>
                            {item.attachments.length > 1 && (
                              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={item.isCarousel}
                                  onChange={(e) =>
                                    handleItemFlag(index, 'isCarousel', e.target.checked)
                                  }
                                  className="h-3.5 w-3.5 rounded border-[var(--border-primary)] text-[#2B79F7] focus:ring-[#2B79F7]"
                                />
                                View as a carousel
                              </label>
                            )}
                          </div>
                        )}

                        <div>
                          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                            Comment (optional)
                          </label>
                          <textarea
                            value={item.initialComment}
                            onChange={(e) =>
                              handleItemChange(
                                index,
                                'initialComment',
                                e.target.value
                              )
                            }
                            rows={2}
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-xs focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                            placeholder="Context for this asset, CTA, platform, etc."
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddItem}
                    className="mt-2"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Another Asset
                  </Button>
                </div>

                {/* Assignees */}
<div>
  <div className="flex items-center justify-between mb-1">
    <label className="block text-sm font-medium text-[var(--text-secondary)]">
      Assign internal team
    </label>

    <button
      type="button"
      onClick={() => {
        setAssigneeSearchOpen((v) => !v)
        setAssigneeSearch('')
      }}
      className="p-2 rounded-lg border border-[var(--border-primary)] hover:border-[#2B79F7] text-[var(--text-tertiary)] hover:text-[#2B79F7] transition-colors"
      title="Search team"
      aria-label="Search team"
    >
      <Search className="h-4 w-4" />
    </button>
  </div>

  {/* Selected assignees as removable chips. When a client is picked,
      this fills automatically from `client_assignees` so the user can
      see (and tweak) who's already on the hook. */}
  {selectedAssigneeIds.length > 0 && (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {selectedAssigneeIds.map((id) => {
        const u = teamUsers.find((m) => m.id === id)
        if (!u) return null
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] text-xs"
          >
            {u.profile_picture_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={u.profile_picture_url}
                alt={u.name || u.email}
                className="h-5 w-5 rounded-full object-cover"
              />
            ) : (
              <span className="h-5 w-5 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold flex items-center justify-center">
                {(u.name || u.email || 'U').charAt(0).toUpperCase()}
              </span>
            )}
            <span className="truncate max-w-[120px]">{u.name || u.email}</span>
            <button
              type="button"
              onClick={() => toggleAssignee(id)}
              className="text-[#1E54B7]/60 hover:text-[#1E54B7]"
              aria-label={`Remove ${u.name || u.email}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )
      })}
    </div>
  )}

  {/* Top 3 users */}
  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border border-[var(--border-primary)] rounded-lg p-2">
    {topAssignees.map((u) => {
      const selected = selectedAssigneeIds.includes(u.id)
      return (
        <button
          key={u.id}
          type="button"
          onClick={() => toggleAssignee(u.id)}
          className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs text-left border ${
            selected
              ? 'bg-[#E8F1FF] dark:bg-[#1E3A6F] border-[#2B79F7] text-[#2B79F7] dark:text-[#93C5FD]'
              : 'bg-[var(--bg-card)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[#2B79F7] hover:bg-[var(--bg-card-hover)]'
          }`}
        >
          {u.profile_picture_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={u.profile_picture_url}
              alt={u.name}
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
            <div className="h-5 w-5 rounded-full bg-[var(--bg-card-hover)] flex items-center justify-center text-[10px] text-[var(--text-secondary)]">
              {(u.name || u.email || 'U').charAt(0).toUpperCase()}
            </div>
          )}
          <span className="truncate">{u.name || u.email}</span>
        </button>
      )
    })}
  </div>

  {/* Fold-out search */}
  {assigneeSearchOpen && (
    <div className="mt-2 border border-[var(--border-primary)] rounded-lg p-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
        <input
          value={assigneeSearch}
          onChange={(e) => setAssigneeSearch(e.target.value)}
          placeholder="Search team members..."
          className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
        />
      </div>

      {assigneeSearch.trim() && (
        <div className="mt-2 space-y-1">
          {searchResults.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)] px-2 py-1">No matches</p>
          ) : (
            searchResults.map((u) => {
              const selected = selectedAssigneeIds.includes(u.id)
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleAssignee(u.id)}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-left border ${
                    selected
                      ? 'bg-[#E8F1FF] dark:bg-[#1E3A6F] border-[#2B79F7] text-[#2B79F7] dark:text-[#93C5FD]'
                      : 'bg-[var(--bg-card)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[#2B79F7] hover:bg-[var(--bg-card-hover)]'
                  }`}
                >
                  <span className="truncate flex-1">
                    {u.name || u.email} <span className="text-[var(--text-tertiary)]">· {u.role}</span>
                  </span>
                  {selected && <span className="text-[#2B79F7] font-semibold">Selected</span>}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )}
</div>

                {/* Footer */}
                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setShowModal(false)}
                    disabled={isCreating}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleCreateApproval()}
                    isLoading={isCreating}
                    disabled={!canSubmitNewApproval || isCreating}
                  >
                    Create Approval
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
      {confirmAction && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-sm max-h-[90vh] overflow-y-auto scrollbar-none shadow-2xl">
      <div className="px-4 py-3 border-b border-[var(--border-primary)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {confirmAction.mode === 'approve'
            ? 'Approve all assets?'
            : 'Revert approval?'}
        </h3>
      </div>

      <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">
        {confirmAction.mode === 'approve' ? (
          <p>
            This will mark all assets as <span className="font-semibold">Approved</span> and update
            the linked ClickUp task (if any).
          </p>
        ) : (
          <p>
            This will revert this approval back to <span className="font-semibold">Waiting</span>.
          </p>
        )}
      </div>

      <div className="px-4 py-3 border-t border-[var(--border-primary)] flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setConfirmAction(null)}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            await handleToggleApprove(
              confirmAction.approvalId,
              confirmAction.mode === 'approve'
            )
            setConfirmAction(null)
          }}
        >
          {confirmAction.mode === 'approve' ? 'Yes, approve' : 'Yes, revert'}
        </Button>
      </div>
    </div>
  </div>
)}

{deleteConfirm && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60 p-4">
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-sm max-h-[90vh] overflow-y-auto scrollbar-none shadow-2xl">
      <div className="px-4 py-3 border-b border-[var(--border-primary)] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Delete Approval?</h3>
        <button
          type="button"
          onClick={() => setDeleteConfirm(null)}
          className="p-1 rounded-full hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">
        <p>
          This will permanently delete{' '}
          <span className="font-semibold">“{deleteConfirm.title}”</span> and all attached assets and
          comments. This cannot be undone.
        </p>
      </div>

      <div className="px-4 py-3 border-t border-[var(--border-primary)] flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDeleteConfirm(null)}
          disabled={isDeleting}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => handleDeleteApproval(deleteConfirm.id)}
          isLoading={isDeleting}
          className="bg-red-600 hover:bg-red-500"
        >
          Delete
        </Button>
      </div>
    </div>
  </div>
)}
    </>
  )
}

// =============================================================================
// Approval cards
// =============================================================================

interface ApprovalRowAction {
  approval: Approval
  isCopied: boolean
  isApproving: boolean
  onOpen: () => void
  onCopy: () => void
  onToggleApprove: (isApproved: boolean) => void
  onDelete: () => void
}

function ApprovalBoardCard({
  approval,
  preview,
  isCopied,
  isApproving,
  onOpen,
  onCopy,
  onToggleApprove,
  onDelete,
}: ApprovalRowAction & {
  preview?: { url: string; title: string | null; total: number }
}) {
  const clientName =
    approval.clients?.business_name || approval.clients?.name || 'Unknown client'
  const createdDate = new Date(approval.created_at).toLocaleDateString()
  const isApproved = approval.status === 'approved'

  return (
    <Card
      onClick={onOpen}
      className="overflow-hidden cursor-pointer transition-shadow hover:shadow-md"
    >
      <CardContent className="p-0">
        <div className="aspect-video bg-[var(--bg-tertiary)] relative overflow-hidden">
          {preview ? (
            <AssetPreview url={preview.url} title={preview.title || approval.title} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[var(--text-tertiary)]">
              <FileText className="h-10 w-10" />
            </div>
          )}
          <div className="absolute top-2 left-2">
            <StatusPill approved={isApproved} />
          </div>
          {preview?.total && preview.total > 1 && (
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-medium">
              +{preview.total - 1} more
            </div>
          )}
        </div>

        <div className="p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{approval.title}</h3>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">
            {clientName} · {createdDate}
          </p>
          {approval.clickup_task_id && (
            <p className="text-[11px] text-[var(--text-tertiary)] mt-1 inline-flex items-center gap-1 truncate">
              <LinkIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {approval.clickup_task_name || approval.clickup_task_id}
              </span>
            </p>
          )}

          <div
            className="mt-3 flex items-center gap-1.5 -mx-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCopy()
              }}
              className="p-2 rounded-md text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-blue-50 dark:hover:bg-[#1E3A6F]/40 transition-colors"
              aria-label="Copy approval link"
              title={isCopied ? 'Copied' : 'Copy link'}
            >
              {isCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </button>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onToggleApprove(isApproved)
              }}
              isLoading={isApproving}
              className="ml-auto bg-[#2B79F7] hover:bg-[#1E54B7]"
            >
              {isApproved ? 'Approved' : 'Approve'}
            </Button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="p-2 rounded-md text-red-500 hover:bg-red-500/10 transition-colors"
              aria-label="Delete approval"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ApprovalListRow({
  approval,
  isCopied,
  isApproving,
  onOpen,
  onCopy,
  onToggleApprove,
  onDelete,
}: ApprovalRowAction) {
  const clientName =
    approval.clients?.business_name || approval.clients?.name || 'Unknown client'
  const createdDate = new Date(approval.created_at).toLocaleDateString()
  const isApproved = approval.status === 'approved'

  return (
    <Card
      onClick={onOpen}
      className="cursor-pointer transition-shadow hover:shadow-md"
    >
      <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="p-2 rounded-lg bg-[#E8F1FF] shrink-0">
            {isApproved ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <Clock className="h-4 w-4 text-[#2B79F7]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{approval.title}</h3>
            <p className="text-xs text-[var(--text-tertiary)] truncate">
              {clientName} · {createdDate}
              {approval.clickup_task_id && (
                <>
                  {' · '}
                  <span className="text-[var(--text-tertiary)]">
                    {approval.clickup_task_name || approval.clickup_task_id}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onCopy()
            }}
            className="p-2 rounded-md text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-blue-50 dark:hover:bg-[#1E3A6F]/40 transition-colors"
            aria-label="Copy approval link"
            title={isCopied ? 'Copied' : 'Copy link'}
          >
            {isCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
          </button>
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onToggleApprove(isApproved)
            }}
            isLoading={isApproving}
            className="bg-[#2B79F7] hover:bg-[#1E54B7]"
          >
            {isApproved ? 'Approved' : 'Approve'}
          </Button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-2 rounded-md text-red-500 hover:bg-red-500/10 transition-colors"
            aria-label="Delete approval"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusPill({ approved }: { approved: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
        approved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${approved ? 'bg-green-500' : 'bg-yellow-500'}`}
      />
      {approved ? 'Approved' : 'Pending'}
    </span>
  )
}

/**
 * Inline preview for an asset URL. Tries (in order):
 *   - Direct image extension → <img>
 *   - Direct video extension → <video>
 *   - YouTube → derived thumbnail
 *   - Vimeo / Drive / Dropbox / etc. → branded play card
 *   - Anything else → generic file icon
 *
 * No network probing - pure URL inspection - so this is cheap to render for
 * a list of cards.
 */
// Video thumbnail with graceful degradation:
//   1. Cloudinary poster frame (so_auto .jpg) - the best case.
//   2. If that 404s (strict transformations disabled, or just not a Cloudinary
//      video), fall back to the raw <video> seeked to 0.1s for a first frame.
//   3. If the source itself is gone (e.g. the asset was deleted from Cloudinary
//      but the approval still references it), the <video> simply paints nothing
//      over a neutral background - a clean placeholder, never a broken-image
//      glyph + alt text.
function VideoThumb({ url, title }: { url: string; title: string }) {
  const poster = cldVideoPosterFromUrl(url, { w: 800, h: 450, crop: 'fill' })
  const [posterFailed, setPosterFailed] = useState(false)
  const showVideo = !poster || posterFailed

  return (
    <div className="absolute inset-0 bg-[var(--bg-tertiary)]">
      {!showVideo && poster ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={poster}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setPosterFailed(true)}
        />
      ) : (
        <video
          src={`${url}#t=0.1`}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
        />
      )}
    </div>
  )
}

function AssetPreview({ url, title }: { url: string; title: string }) {
  const lower = url.toLowerCase()
  const isImage = /\.(png|jpe?g|gif|webp|svg|avif|heic)(\?|$)/.test(lower)
  const isVideo = /\.(mp4|mov|webm|m4v)(\?|$)/.test(lower)
  const ytId = extractYouTubeId(url)
  const isVimeo = /vimeo\.com/.test(lower)
  const isDrive = /drive\.google\.com|docs\.google\.com/.test(lower)
  const isDropbox = /dropbox\.com/.test(lower)

  if (isImage) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={url} alt={title} className="absolute inset-0 h-full w-full object-cover" />
    )
  }
  if (isVideo) {
    return <VideoThumb url={url} title={title} />
  }
  if (ytId) {
    return (
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/15">
          <div className="h-12 w-12 rounded-full bg-white/85 flex items-center justify-center text-[var(--text-primary)]">
            <svg className="h-5 w-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>
    )
  }
  if (isDrive) {
    // Google Drive: turn /file/d/<ID>/view → /file/d/<ID>/preview so we get
    // the inline player. The pointer-events-none + absolute overlay lets the
    // user click through to the card.
    const m = url.match(/\/file\/d\/([^/]+)/)
    const previewUrl = m
      ? `https://drive.google.com/file/d/${m[1]}/preview`
      : url
    return (
      <>
        <iframe
          src={previewUrl}
          title={title}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay"
        />
        <div className="absolute inset-0 pointer-events-none" />
      </>
    )
  }
  if (isVimeo) {
    const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
    const previewUrl = m
      ? `https://player.vimeo.com/video/${m[1]}`
      : url
    return (
      <>
        <iframe
          src={previewUrl}
          title={title}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen"
        />
        <div className="absolute inset-0 pointer-events-none" />
      </>
    )
  }
  if (isDropbox) {
    // Dropbox direct-render: ?raw=1 returns the file bytes so an <img> or
    // <video> tag works. We don't know which one without HEAD, so default
    // to <img> with a fallback to a label.
    const direct = url.replace(/\?dl=\d/, '').replace(/\?$/, '') + '?raw=1'
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={direct}
        alt={title}
        className="absolute inset-0 h-full w-full object-cover"
      />
    )
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-tertiary)]">
      <FileText className="h-10 w-10" />
      <span className="mt-2 text-[11px] truncate max-w-[80%] text-center">{title}</span>
    </div>
  )
}

/**
 * Pull a YouTube video id out of a watch / shorts / youtu.be URL. Returns
 * null when the URL isn't recognisable as YouTube - used by the board card
 * to render a real thumbnail.
 */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0]
      return id || null
    }
    if (host.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([\w-]+)/)
      if (m) return m[2]
    }
    return null
  } catch {
    return null
  }
}