'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Loading'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { SaveIndicator } from '@/components/ui/SaveIndicator'
import { TaskChat } from '@/components/tasks/TaskChat'
import { TaskSubtasks } from '@/components/tasks/TaskSubtasks'
import { TaskChecklists } from '@/components/tasks/TaskChecklists'
import { TaskCustomFields } from '@/components/tasks/TaskCustomFields'
import { SaveTemplateModal } from '@/components/tasks/TemplateModals'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Trash2,
  History,
  Calendar,
  Flag,
  Users,
  ChevronDown,
  Search,
  X,
  Check,
  Copy,
  Bookmark,
} from 'lucide-react'

type TaskStatus =
  | 'new'
  | 'in_progress'
  | 'waiting_for_footage'
  | 'discontinued'
  | 'ready_for_review'
  | 'ready_for_approval'
  | 'approved'
  | 'complete'

type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

interface Task {
  id: string
  client_id: string
  folder_id: string | null
  parent_task_id: string | null
  name: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  start_at: string | null
  due_at: string | null
  position: number
  created_at: string
  updated_at: string
  assignee_ids: string[]
}

interface AgencyMember {
  id: string
  name: string | null
  email: string
  profile_picture_url: string | null
}

interface StatusLogEntry {
  id: string
  from_status: TaskStatus | null
  to_status: TaskStatus
  changed_at: string
  users: { id: string; name: string | null; email: string } | null
}

export const STATUSES: { id: TaskStatus; label: string; dot: string; pill: string }[] = [
  { id: 'new',                 label: 'New',                 dot: '#3B82F6', pill: 'bg-blue-50 text-blue-700' },
  { id: 'in_progress',         label: 'In progress',         dot: '#A855F7', pill: 'bg-purple-50 text-purple-700' },
  { id: 'waiting_for_footage', label: 'Waiting for footage', dot: '#F59E0B', pill: 'bg-amber-50 text-amber-700' },
  { id: 'discontinued',        label: 'Discontinued',        dot: '#EF4444', pill: 'bg-red-50 text-red-700' },
  { id: 'ready_for_review',    label: 'Ready for review',    dot: '#06B6D4', pill: 'bg-cyan-50 text-cyan-700' },
  { id: 'ready_for_approval',  label: 'Ready for approval',  dot: '#6366F1', pill: 'bg-indigo-50 text-indigo-700' },
  { id: 'approved',            label: 'Approved',            dot: '#10B981', pill: 'bg-emerald-50 text-emerald-700' },
  { id: 'complete',            label: 'Complete',            dot: '#22C55E', pill: 'bg-green-50 text-green-700' },
]

const STATUS_BY_ID = STATUSES.reduce(
  (acc, s) => ({ ...acc, [s.id]: s }),
  {} as Record<TaskStatus, (typeof STATUSES)[number]>,
)

const PRIORITIES: { id: TaskPriority; label: string; color: string }[] = [
  { id: 'low',    label: 'Low',    color: 'text-[var(--text-tertiary)]' },
  { id: 'medium', label: 'Medium', color: 'text-blue-500' },
  { id: 'high',   label: 'High',   color: 'text-amber-500' },
  { id: 'urgent', label: 'Urgent', color: 'text-red-600' },
]

function dateInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function inputToIso(date: string): string | null {
  return date ? new Date(date).toISOString() : null
}

export default function TaskDetailPage() {
  const params = useParams()
  const router = useRouter()
  const taskId = (params?.id as string) ?? ''
  const supabase = useMemo(() => createClient(), [])

  const [task, setTask] = useState<Task | null>(null)
  const [members, setMembers] = useState<AgencyMember[]>([])
  const [statusLog, setStatusLog] = useState<StatusLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false)
  const [assigneeQuery, setAssigneeQuery] = useState('')
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Local edit buffers - committed on blur / button click.
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskStatus>('new')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [startAt, setStartAt] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])

  const flash = useCallback((type: 'success' | 'error', message: string, ms = 2000) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), ms)
  }, [])

  // Close popovers on outside click / ESC.
  useEffect(() => {
    if (!statusOpen && !assigneePopoverOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (statusOpen && !t.closest('[data-status-pop]')) setStatusOpen(false)
      if (assigneePopoverOpen && !t.closest('[data-assignee-pop]')) {
        setAssigneePopoverOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStatusOpen(false)
        setAssigneePopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [statusOpen, assigneePopoverOpen])

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}`)
    const data = await readJsonSafe(res)
    if (!data.success) {
      setTask(null)
      return
    }
    const t = data.task as Task
    setTask(t)
    setName(t.name)
    setDescription(t.description ?? '')
    setStatus(t.status)
    setPriority(t.priority)
    setStartAt(dateInputValue(t.start_at))
    setDueAt(dateInputValue(t.due_at))
    setAssigneeIds(t.assignee_ids)
  }, [taskId])

  useEffect(() => {
    if (!taskId) return
    void (async () => {
      setIsLoading(true)
      try {
        await refresh()
        const { data } = await supabase
          .from('users')
          .select('id, name, email, profile_picture_url')
          .eq('is_agency_user', true)
          .is('client_id', null)
          .in('role', ['admin', 'manager', 'employee'])
          .order('name')
        setMembers((data || []) as AgencyMember[])
      } finally {
        setIsLoading(false)
      }
    })()
  }, [taskId, refresh, supabase])

  const loadStatusLog = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}/status-log`)
    const data = await readJsonSafe(res)
    if (data.success) setStatusLog(data.log)
  }, [taskId])

  useEffect(() => {
    if (showLog) void loadStatusLog()
  }, [showLog, loadStatusLog])

  // Live updates: someone else moves the task on a board, edits a field, or
  // a status flip happens - we surface it without a page refresh.
  useEffect(() => {
    if (!taskId) return
    const channel = supabase
      .channel(`task-${taskId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tasks',
          filter: `id=eq.${taskId}`,
        },
        () => {
          void refresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'task_status_log',
          filter: `task_id=eq.${taskId}`,
        },
        () => {
          if (showLog) void loadStatusLog()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [taskId, supabase, refresh, showLog, loadStatusLog])

  const patch = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setIsSaving(true)
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await readJsonSafe(res)
        if (!data.success) {
          flash('error', data.error || 'Save failed')
          return false
        }
        if (data.task) setTask(data.task as Task)
        return true
      } finally {
        setIsSaving(false)
      }
    },
    [taskId, flash],
  )

  const onNameBlur = async () => {
    if (!task) return
    if (name.trim() === task.name) return
    if (!name.trim()) {
      setName(task.name)
      return
    }
    const ok = await patch({ name: name.trim() })
    if (ok) flash('success', 'Saved')
  }

  const onDescriptionBlur = async () => {
    if (!task) return
    if (description === (task.description ?? '')) return
    const ok = await patch({ description: description || null })
    if (ok) flash('success', 'Saved')
  }

  const onStatusChange = async (next: TaskStatus) => {
    setStatus(next)
    setStatusOpen(false)
    const ok = await patch({ status: next })
    if (ok) {
      flash('success', `Status: ${STATUS_BY_ID[next].label}`)
      if (showLog) void loadStatusLog()
    }
  }

  const onPriorityChange = async (next: TaskPriority) => {
    setPriority(next)
    const ok = await patch({ priority: next })
    if (ok) flash('success', `Priority: ${next}`)
  }

  const onDateBlur = async (kind: 'start' | 'due') => {
    if (!task) return
    const value = kind === 'start' ? startAt : dueAt
    const current = kind === 'start' ? dateInputValue(task.start_at) : dateInputValue(task.due_at)
    if (value === current) return
    const iso = inputToIso(value)
    const ok = await patch(kind === 'start' ? { startAt: iso } : { dueAt: iso })
    if (ok) flash('success', 'Saved')
  }

  const toggleAssignee = async (uid: string) => {
    const next = assigneeIds.includes(uid)
      ? assigneeIds.filter((id) => id !== uid)
      : [...assigneeIds, uid]
    setAssigneeIds(next)
    await patch({ assigneeIds: next })
  }

  const handleDelete = async () => {
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    const data = await readJsonSafe(res)
    if (!data.success) throw new Error(data.error || 'Failed to delete task')
    router.push('/tasks')
  }

  const handleDuplicate = async () => {
    setIsDuplicating(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/duplicate`, { method: 'POST' })
      const data = await readJsonSafe(res)
      if (!data.success) {
        flash('error', data.error || 'Failed to duplicate task')
        return
      }
      router.push(`/tasks/${data.taskId}`)
    } finally {
      setIsDuplicating(false)
    }
  }

  const filteredMembers = useMemo(() => {
    const q = assigneeQuery.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => {
      const n = (m.name || '').toLowerCase()
      const e = (m.email || '').toLowerCase()
      return n.includes(q) || e.includes(q)
    })
  }, [members, assigneeQuery])

  const assigneeMembers = useMemo(
    () => assigneeIds.map((id) => members.find((m) => m.id === id)).filter(Boolean) as AgencyMember[],
    [assigneeIds, members],
  )

  if (isLoading) {
    return (
      <>
        <Header title="Task" />
        <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-4 w-28" />
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 grid grid-cols-2 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  if (!task) {
    return (
      <>
        <Header title="Task" />
        <div className="p-4 md:p-8 text-center">
          <p className="text-[var(--text-tertiary)] mb-4">Task not found.</p>
          <Link href="/tasks" className="text-[#2B79F7] hover:underline">
            Back to tasks
          </Link>
        </div>
      </>
    )
  }

  const currentStatus = STATUS_BY_ID[status]

  return (
    <>
      <Header title={task.name} subtitle={`Status: ${currentStatus.label}`} />

      <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
        {/* Top action row */}
        <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
          <Link
            href="/tasks"
            className="inline-flex items-center text-sm text-[#2B79F7] hover:underline"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to tasks
          </Link>

          <div className="flex items-center gap-1 flex-wrap">
            <SaveIndicator isSaving={isSaving} />
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              className="glass-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg"
            >
              <History className="h-4 w-4" />
              History
            </button>
            <button
              type="button"
              onClick={() => setShowSaveTemplate(true)}
              className="glass-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg"
            >
              <Bookmark className="h-4 w-4" />
              Save as template
            </button>
            <button
              type="button"
              onClick={() => void handleDuplicate()}
              disabled={isDuplicating}
              className="glass-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              {isDuplicating ? 'Duplicating…' : 'Duplicate'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-500/10 rounded-lg"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>

        {notification && (
          <div
            className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] ${
              notification.type === 'success'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {notification.message}
          </div>
        )}

        {/* Hero card: title + status + assignees side-by-side */}
        <Card className="mb-4">
          <CardContent className="p-5 md:p-6 space-y-5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={onNameBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              className="w-full text-2xl md:text-3xl font-bold text-[var(--text-primary)] bg-transparent border-0 outline-none focus:ring-0 p-0"
              placeholder="Task name"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Status picker */}
              <div data-status-pop className="relative">
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1.5">
                  Status
                </p>
                <button
                  type="button"
                  onClick={() => setStatusOpen((v) => !v)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] ${currentStatus.pill} hover:opacity-90 transition`}
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: currentStatus.dot }}
                    />
                    <span className="text-sm font-medium">{currentStatus.label}</span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-current/60 transition-transform ${statusOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {statusOpen && (
                  <div className="glass-pop absolute z-30 left-0 right-0 mt-2 rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                    {STATUSES.map((s) => {
                      const active = s.id === status
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onStatusChange(s.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 ${
                            active ? 'bg-[#E8F1FF]' : ''
                          }`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: s.dot }}
                          />
                          <span className="flex-1 text-[var(--text-primary)]">{s.label}</span>
                          {active && <Check className="h-4 w-4 text-[#2B79F7]" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Assignees popover */}
              <div data-assignee-pop className="relative">
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1.5">
                  Assignees
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setAssigneePopoverOpen((v) => !v)
                    setAssigneeQuery('')
                  }}
                  className="glass-chip w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition"
                >
                  {assigneeMembers.length === 0 ? (
                    <span className="text-sm text-[var(--text-tertiary)]">Add assignees</span>
                  ) : (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="flex -space-x-2">
                        {assigneeMembers.slice(0, 4).map((m) => (
                          <Avatar key={m.id} member={m} className="h-6 w-6 ring-2 ring-white" />
                        ))}
                      </div>
                      {assigneeMembers.length > 4 && (
                        <span className="text-xs text-[var(--text-tertiary)]">+{assigneeMembers.length - 4}</span>
                      )}
                      <span className="text-xs text-[var(--text-tertiary)] truncate">
                        {assigneeMembers.length} {assigneeMembers.length === 1 ? 'person' : 'people'}
                      </span>
                    </div>
                  )}
                  <ChevronDown
                    className={`h-4 w-4 text-[var(--text-tertiary)] shrink-0 transition-transform ${assigneePopoverOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {assigneePopoverOpen && (
                  <div className="glass-pop absolute z-30 left-0 right-0 mt-2 rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="p-2 border-b border-[var(--glass-border)]">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
                        <input
                          autoFocus
                          type="text"
                          value={assigneeQuery}
                          onChange={(e) => setAssigneeQuery(e.target.value)}
                          placeholder="Search team…"
                          className="w-full pl-8 pr-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                        />
                      </div>
                    </div>
                    <ul className="max-h-72 overflow-y-auto py-1">
                      {filteredMembers.length === 0 ? (
                        <li className="px-3 py-3 text-xs text-[var(--text-tertiary)] text-center">No matches</li>
                      ) : (
                        filteredMembers.map((m) => {
                          const selected = assigneeIds.includes(m.id)
                          return (
                            <li key={m.id}>
                              <button
                                type="button"
                                onClick={() => toggleAssignee(m.id)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 ${
                                  selected ? 'bg-[#E8F1FF]' : ''
                                }`}
                              >
                                <Avatar member={m} className="h-7 w-7 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                    {m.name || 'Unnamed'}
                                  </p>
                                  <p className="text-[11px] text-[var(--text-tertiary)] truncate">{m.email}</p>
                                </div>
                                {selected && <Check className="h-4 w-4 text-[#2B79F7] shrink-0" />}
                              </button>
                            </li>
                          )
                        })
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Meta grid: priority, dates */}
        <Card className="mb-4">
          <CardContent className="p-5 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium flex items-center gap-1.5 mb-1.5">
                <Flag className="h-3.5 w-3.5" /> Priority
              </label>
              <select
                value={priority}
                onChange={(e) => onPriorityChange(e.target.value as TaskPriority)}
                className="w-full pl-4 pr-10 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium flex items-center gap-1.5 mb-1.5">
                <Calendar className="h-3.5 w-3.5" /> Start date
              </label>
              <input
                type="date"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                onBlur={() => onDateBlur('start')}
                className="w-full px-4 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium flex items-center gap-1.5 mb-1.5">
                <Calendar className="h-3.5 w-3.5" /> Due date
              </label>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                onBlur={() => onDateBlur('due')}
                className="w-full px-4 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium flex items-center gap-1.5 mb-1.5">
                <Users className="h-3.5 w-3.5" /> Created
              </label>
              <p className="text-sm text-[var(--text-secondary)] py-2">
                {new Date(task.created_at).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Description */}
        <Card className="mb-4">
          <CardContent className="p-5 md:p-6">
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-2">
              Description
            </p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={onDescriptionBlur}
              placeholder="Add a description…"
              rows={4}
              className="w-full text-sm text-[var(--text-secondary)] bg-transparent border border-[var(--glass-border)] rounded-lg p-3 outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none placeholder:text-[var(--text-tertiary)]"
            />
          </CardContent>
        </Card>

        {/* Subtasks */}
        <Card className="mb-4">
          <CardContent className="p-5 md:p-6">
            <TaskSubtasks parentTaskId={taskId} clientId={task.client_id} />
          </CardContent>
        </Card>

        {/* Checklists */}
        <Card className="mb-4">
          <CardContent className="p-5 md:p-6">
            <TaskChecklists taskId={taskId} />
          </CardContent>
        </Card>

        {/* Custom fields */}
        <Card className="mb-4">
          <CardContent className="p-5 md:p-6">
            <TaskCustomFields taskId={taskId} />
          </CardContent>
        </Card>

        {showLog && (
          <Card className="mb-4 animate-in fade-in slide-in-from-top-1 duration-150">
            <CardContent className="p-5 md:p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-[#2B79F7]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Status history</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLog(false)}
                  className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  aria-label="Close history"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {statusLog.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)]">No status changes yet.</p>
              ) : (
                <ul className="space-y-2">
                  {statusLog.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-3 text-sm py-2 border-b border-[var(--glass-border)] last:border-0"
                    >
                      <span className="inline-flex items-center gap-2">
                        {entry.from_status ? (
                          <StatusPill status={entry.from_status} muted />
                        ) : (
                          <span className="text-[var(--text-tertiary)] text-xs">Created</span>
                        )}
                        <span className="text-[var(--text-tertiary)]">→</span>
                        <StatusPill status={entry.to_status} />
                      </span>
                      <span className="text-xs text-[var(--text-tertiary)] text-right shrink-0">
                        {entry.users?.name || entry.users?.email || 'System'}
                        <br />
                        {new Date(entry.changed_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Floating chat - scoped to this task only. */}
      <TaskChat taskId={taskId} members={members} />

      <SaveTemplateModal
        open={showSaveTemplate}
        taskId={taskId}
        defaultName={task.name}
        onClose={() => setShowSaveTemplate(false)}
        onSaved={() => flash('success', 'Template saved')}
      />

      <ConfirmModal
        open={confirmDelete}
        title="Delete task?"
        message={`"${task.name}" will be permanently deleted along with its subtasks, checklists, custom fields and messages.`}
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await handleDelete()
        }}
      />
    </>
  )
}

function Avatar({ member, className }: { member: AgencyMember; className?: string }) {
  if (member.profile_picture_url) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={member.profile_picture_url}
        alt={member.name || member.email}
        className={`rounded-full object-cover ${className || ''}`}
      />
    )
  }
  return (
    <div
      className={`rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center ${className || ''}`}
    >
      {((member.name || member.email).charAt(0) || '?').toUpperCase()}
    </div>
  )
}

function StatusPill({ status, muted }: { status: TaskStatus; muted?: boolean }) {
  const s = STATUS_BY_ID[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] ${s.pill} ${muted ? 'opacity-60' : ''}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.dot }} />
      {s.label}
    </span>
  )
}
