// src/app/approvals/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import {
  Plus,
  Search,
  CheckCircle,
  Clock,
  Link as LinkIcon,
  ExternalLink,
  Loader2,
  Trash2,
  X,
} from 'lucide-react'

interface Client {
  id: string
  name: string
  business_name: string
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

  // Create modal state
  const [showModal, setShowModal] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [clickupTaskId, setClickupTaskId] = useState('')
  const [clickupTaskName, setClickupTaskName] = useState<string | null>(null)
  const [isFetchingClickup, setIsFetchingClickup] = useState(false)
  const [autoApproveMinutes, setAutoApproveMinutes] = useState<number | null>(7 * 24 * 60)
  const [items, setItems] = useState<ApprovalItemDraft[]>([
    { title: '', url: '', initialComment: '' },
  ])
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)

  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
  approvalId: string
  mode: 'approve' | 'unapprove'
} | null>(null)

  const [deleteConfirm, setDeleteConfirm] = useState<Approval | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    init()
  }, [])

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
        .select('id, name, business_name')
        .order('name')

      setClients(clientsData || [])

      // Team users (non-client roles)
      const { data: usersData } = await supabase
        .from('users')
        .select('id, name, email, role, profile_picture_url')
        .is('client_id', null)
        .in('role', ['admin', 'manager', 'employee'])

      setTeamUsers(usersData || [])

      await loadApprovals()
    } finally {
      setIsLoading(false)
    }
  }

  const loadApprovals = async (clientId?: string) => {
    const query = supabase
      .from('approvals')
      .select('id, client_id, title, clickup_task_id, clickup_task_name, status, created_at, clients(name, business_name)')
      .order('created_at', { ascending: false })

    if (clientId) {
      query.eq('client_id', clientId)
    }

      const { data, error } = await query
  if (error) {
    console.error('Load approvals error:', error)
    return
  }

  const mapped: Approval[] = (data || []).map((row: any) => ({
    id: row.id,
    client_id: row.client_id,
    title: row.title,
    clickup_task_id: row.clickup_task_id,
    clickup_task_name: row.clickup_task_name,
    status: row.status,
    created_at: row.created_at,
    clients: Array.isArray(row.clients) ? row.clients[0] : row.clients,
  }))

  setApprovals(mapped)
}



  const filteredApprovals = approvals.filter((a) => {
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

  const handleClickupLookup = async () => {
    if (!clickupTaskId.trim()) {
      setClickupTaskName(null)
      return
    }

    setIsFetchingClickup(true)
    setClickupTaskName(null)
    try {
      const res = await fetch('/api/clickup/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: clickupTaskId.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setClickupTaskName(data.name)
      } else {
        setClickupTaskName(null)
        console.error('ClickUp lookup error:', data.error)
      }
    } catch (err) {
      console.error('ClickUp lookup exception:', err)
      setClickupTaskName(null)
    } finally {
      setIsFetchingClickup(false)
    }
  }

  const handleAddItem = () => {
    setItems((prev) => [...prev, { title: '', url: '', initialComment: '' }])
  }

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: keyof ApprovalItemDraft, value: string) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  const toggleAssignee = (userId: string) => {
    setSelectedAssigneeIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  const handleCreateApproval = async () => {
    if (!currentUserId) return
    if (!selectedClientId) {
      alert('Please select a client')
      return
    }
    if (!formTitle.trim()) {
      alert('Please enter an approval title')
      return
    }

    const validItems = items
      .map((i) => ({
        ...i,
        url: i.url.trim(),
        title: i.title.trim(),
        initialComment: i.initialComment.trim(),
      }))
      .filter((i) => i.url)

    if (validItems.length === 0) {
      alert('Please add at least one asset URL')
      return
    }

    setIsCreating(true)
    try {
      const res = await fetch('/api/approvals/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: currentUserId,
          clientId: selectedClientId,
          title: formTitle.trim(),
          description: formDescription.trim() || null,
          clickupTaskId: clickupTaskId.trim() || null,
          autoApproveMinutes: autoApproveMinutes,
          assigneeIds: selectedAssigneeIds,
          items: validItems,
        }),
      })

      const data = await res.json()
      if (!data.success) {
        alert(data.error || 'Failed to create approval')
        return
      }

      // Reset form
      setShowModal(false)
      setFormTitle('')
      setFormDescription('')
      setClickupTaskId('')
      setClickupTaskName(null)
      setAutoApproveMinutes(7 * 24 * 60)
      setItems([{ title: '', url: '', initialComment: '' }])
      setSelectedAssigneeIds([])

      await loadApprovals(selectedClientId || undefined)
    } catch (err) {
      console.error('Create approval exception:', err)
      alert('Failed to create approval. Check console.')
    } finally {
      setIsCreating(false)
    }
  }

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
    const data = await res.json()
    if (!data.success) {
      alert(data.error || 'Failed to update approval')
      await loadApprovals(selectedClientId || undefined) // rollback from server
      return
    }

    // Optional: re-sync from server
    await loadApprovals(selectedClientId || undefined)
  } catch (err) {
    console.error('Toggle approve exception:', err)
    alert('Failed to update approval. Check console.')
    await loadApprovals(selectedClientId || undefined)
  } finally {
    setApprovingId(null)
  }
}

const handleDeleteApproval = async (approvalId: string) => {
  setIsDeleting(true)
  try {
    const res = await fetch('/api/approvals/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId }),
    })
    const data = await res.json()
    if (!data.success) {
      alert(data.error || 'Failed to delete approval')
      return
    }

    setApprovals(prev => prev.filter(a => a.id !== approvalId))
  } catch (err) {
    console.error('Delete approval exception:', err)
    alert('Failed to delete approval')
  } finally {
    setIsDeleting(false)
    setDeleteConfirm(null)
  }
}

  return (
    <DashboardLayout>
      <Header
        title="Approvals"
        subtitle="Send assets for client approval and track ClickUp status"
      />
      <div className="p-8">
        {/* Top bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            {/* Client filter */}
            <select
              value={selectedClientId}
              onChange={(e) => {
                const val = e.target.value
                setSelectedClientId(val)
                loadApprovals(val || undefined)
              }}
              className="w-64 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            >
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} - {c.business_name}
                </option>
              ))}
            </select>

            {/* Search */}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search approvals..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>
          </div>

          <Button onClick={() => setShowModal(true)}>
            <Plus className="h-5 w-5 mr-2" />
            New Approval
          </Button>
        </div>

        {/* Approvals list */}
        {isLoading ? (
          <Card>
            <CardContent className="py-10 text-center text-gray-500">
              <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
              Loading approvals...
            </CardContent>
          </Card>
        ) : filteredApprovals.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              No approvals yet. Create your first one.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredApprovals.map((a) => {
              const clientName =
                a.clients?.business_name || a.clients?.name || 'Unknown client'
              const createdDate = new Date(a.created_at).toLocaleDateString()
              const isApproved = a.status === 'approved'

              return (
                <Card key={a.id}>
                  <CardContent className="p-4 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-[#E8F1FF]">
                        {isApproved ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <Clock className="h-5 w-5 text-[#2B79F7]" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">
                          {a.title}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {clientName} · Created {createdDate}
                        </p>
                        {a.clickup_task_id && (
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                            <LinkIcon className="h-3 w-3" />
                            <span>
                              ClickUp: {a.clickup_task_name || a.clickup_task_id}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
  <Button
    variant="outline"
    size="sm"
    onClick={() => router.push(`/approvals/${a.id}`)}
  >
    <ExternalLink className="h-4 w-4 mr-1" />
    Open
  </Button>
  <Button
    size="sm"
    onClick={() =>
      setConfirmAction({
        approvalId: a.id,
        mode: isApproved ? 'unapprove' : 'approve',
      })
    }
    isLoading={approvingId === a.id}
    className="bg-[#2B79F7] hover:bg-[#1E54B7] shadow-premium"
  >
    {isApproved ? 'Approved' : 'Approve'}
  </Button>
  <Button
  variant="outline"
  size="sm"
  className="border-red-200 text-red-600 hover:bg-red-50"
  onClick={() => setDeleteConfirm(a)}
  aria-label="Delete approval"
  title="Delete"
>
  <Trash2 className="h-4 w-4" />
</Button>
</div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Create Approval Modal */}
        {showModal && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col">
      <CardHeader>
        <h3 className="text-lg font-semibold text-gray-900">
          New Approval
        </h3>
      </CardHeader>
      <CardContent className="space-y-4 overflow-y-auto">
                {/* Client */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client
                  </label>
                  <select
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  >
                    <option value="">Select client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} - {c.business_name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Title & Description */}
                <Input
                  label="Approval Title"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="March content batch, Week 1"
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                    placeholder="Anything the client should know about this batch..."
                  />
                </div>

                {/* ClickUp Task ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ClickUp Task ID (optional)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={clickupTaskId}
                      onChange={(e) => setClickupTaskId(e.target.value)}
                      className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      placeholder="e.g. 9h3d5k..."
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClickupLookup}
                      isLoading={isFetchingClickup}
                    >
                      Check
                    </Button>
                  </div>
                  {clickupTaskName && (
                    <p className="mt-1 text-xs text-green-600">
                      Task: {clickupTaskName}
                    </p>
                  )}
                </div>

                {/* Auto-approve preset */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Auto-approval
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {AUTO_APPROVE_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setAutoApproveMinutes(p.valueMinutes)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                          autoApproveMinutes === p.valueMinutes
                            ? 'bg-[#2B79F7] text-white border-[#2B79F7]'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-[#2B79F7]'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Clients cannot change this. Any unapproved assets will auto-approve after
                    this time.
                  </p>
                </div>

                {/* Assets */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Assets for approval
                  </label>
                  <div className="space-y-3">
                    {items.map((item, index) => (
                      <div
                        key={index}
                        className="border border-gray-200 rounded-lg p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-500">
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
                          label="URL"
                          value={item.url}
                          onChange={(e) =>
                            handleItemChange(index, 'url', e.target.value)
                          }
                          placeholder="https://drive.google.com/..."
                        />
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
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
                            className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Assign internal team (optional)
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {teamUsers.map((u) => {
                      const selected = selectedAssigneeIds.includes(u.id)
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => toggleAssignee(u.id)}
                          className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs text-left border ${
                            selected
                              ? 'bg-[#E8F1FF] border-[#2B79F7] text-[#1E293B]'
                              : 'bg-white border-gray-200 text-gray-700 hover:border-[#2B79F7]'
                          }`}
                        >
                          {u.profile_picture_url ? (
                            <img
                              src={u.profile_picture_url}
                              alt={u.name}
                              className="h-5 w-5 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-5 w-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] text-gray-700">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="truncate">
                            {u.name || u.email}
                          </span>
                        </button>
                      )
                    })}
                    {teamUsers.length === 0 && (
                      <p className="text-xs text-gray-400 col-span-full">
                        No team members found.
                      </p>
                    )}
                  </div>
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
                    onClick={handleCreateApproval}
                    isLoading={isCreating}
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
    <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-sm shadow-2xl">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">
          {confirmAction.mode === 'approve'
            ? 'Approve all assets?'
            : 'Revert approval?'}
        </h3>
      </div>

      <div className="px-4 py-3 text-sm text-gray-600">
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

      <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
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
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
    <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-sm shadow-2xl">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Delete Approval?</h3>
        <button
          type="button"
          onClick={() => setDeleteConfirm(null)}
          className="p-1 rounded-full hover:bg-gray-100 text-gray-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-3 text-sm text-gray-600">
        <p>
          This will permanently delete{' '}
          <span className="font-semibold">“{deleteConfirm.title}”</span> and all attached assets and
          comments. This cannot be undone.
        </p>
      </div>

      <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
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
    </DashboardLayout>
  )
}