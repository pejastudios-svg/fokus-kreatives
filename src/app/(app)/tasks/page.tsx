'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loading'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { createClient } from '@/lib/supabase/client'
import {
  Plus,
  Folder,
  ChevronRight,
  ChevronDown as ChevronDownIcon,
  MoreVertical,
  Pencil,
  Trash2,
  CheckCircle,
  AlertCircle,
  LayoutGrid,
  List as ListIcon,
  Flag,
  Calendar as CalendarIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Briefcase,
  Sparkles,
  Copy,
} from 'lucide-react'
import { ApplyTemplateModal } from '@/components/tasks/TemplateModals'

interface ClientLite {
  id: string
  name: string
  business_name: string
  profile_picture_url: string | null
}

interface TaskFolder {
  id: string
  client_id: string
  parent_folder_id: string | null
  name: string
  position: number
  created_at: string
}

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
  assignee_ids: string[]
}

interface AgencyMember {
  id: string
  name: string | null
  email: string
  profile_picture_url: string | null
}

const STATUSES: { id: TaskStatus; label: string; dot: string; pill: string }[] = [
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

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: 'text-gray-400',
  medium: 'text-blue-500',
  high: 'text-amber-500',
  urgent: 'text-red-600',
}

const STORAGE_KEY = 'fk:tasks:clientId'
const VIEW_KEY = 'fk:tasks:view'
const NAV_KEY = 'fk:tasks:navOpen'

type ViewMode = 'list' | 'board'

// Drag payload helpers — we serialize {kind, id} into the dataTransfer 'text/plain'.
type DragKind = 'task' | 'folder'
function encodeDrag(kind: DragKind, id: string): string {
  return `${kind}:${id}`
}
function decodeDrag(raw: string): { kind: DragKind; id: string } | null {
  if (!raw) return null
  const [kind, id] = raw.split(':')
  if (kind !== 'task' && kind !== 'folder') return null
  if (!id) return null
  return { kind, id }
}

export default function TasksPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [clients, setClients] = useState<ClientLite[]>([])
  const [clientId, setClientId] = useState('')
  const [folders, setFolders] = useState<TaskFolder[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<AgencyMember[]>([])
  const [breadcrumb, setBreadcrumb] = useState<TaskFolder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [navOpen, setNavOpen] = useState(true)
  const [navQuery, setNavQuery] = useState('')
  // Tracks which clients are expanded in the left navigator. Independent of
  // which client is "active" (i.e. selected for the main view).
  const [expandedClients, setExpandedClients] = useState<Set<string>>(() => new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showApplyTemplate, setShowApplyTemplate] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [newTaskName, setNewTaskName] = useState('')
  const [creating, setCreating] = useState(false)

  const [renameTarget, setRenameTarget] = useState<TaskFolder | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<TaskFolder | null>(null)
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null)
  const [openMenu, setOpenMenu] = useState<{ kind: 'folder' | 'task'; id: string } | null>(null)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null)
  const [dragOverFolder, setDragOverFolder] = useState<string | 'root' | null>(null)

  const flash = useCallback((type: 'success' | 'error', message: string, ms = 2500) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), ms)
  }, [])

  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-row-menu]')) setOpenMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  // Restore view + nav state.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY)
      if (v === 'list' || v === 'board') setViewMode(v)
      const n = window.localStorage.getItem(NAV_KEY)
      if (n === 'closed') setNavOpen(false)
    } catch {}
  }, [])

  const setView = (mode: ViewMode) => {
    setViewMode(mode)
    try {
      window.localStorage.setItem(VIEW_KEY, mode)
    } catch {}
  }

  const toggleNav = () => {
    setNavOpen((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(NAV_KEY, next ? 'open' : 'closed')
      } catch {}
      return next
    })
  }

  // Load clients + agency members + ALL accessible folders on mount.
  // Loading folders for every accessible client up front lets the left nav
  // expand any client's folder list without an extra round-trip.
  useEffect(() => {
    void (async () => {
      try {
        const [clientsRes, membersRes, foldersRes] = await Promise.all([
          supabase
            .from('clients')
            .select('id, name, business_name, profile_picture_url')
            .is('archived_at', null)
            .order('name'),
          supabase
            .from('users')
            .select('id, name, email, profile_picture_url')
            .eq('is_agency_user', true)
            .is('client_id', null)
            .in('role', ['admin', 'manager', 'employee'])
            .order('name'),
          fetch('/api/tasks/folders').then((r) => r.json()),
        ])

        const list = (clientsRes.data || []) as ClientLite[]
        setClients(list)
        setMembers((membersRes.data || []) as AgencyMember[])
        if (foldersRes?.success) {
          setFolders((foldersRes.folders || []) as TaskFolder[])
        }

        let initial = ''
        try {
          initial = window.sessionStorage.getItem(STORAGE_KEY) || ''
        } catch {}
        if (initial && list.some((c) => c.id === initial)) {
          setClientId(initial)
          setExpandedClients(new Set([initial]))
        } else if (list.length > 0) {
          setClientId(list[0].id)
          setExpandedClients(new Set([list[0].id]))
        }
      } finally {
        setIsLoading(false)
      }
    })()
  }, [supabase])

  const loadFoldersAndTasks = useCallback(async (cid: string, folderId: string | null) => {
    if (!cid) return
    setIsLoadingTasks(true)
    try {
      // Tasks are scoped to the active client + folder; folders are pre-loaded
      // once on mount and updated locally on mutations.
      const [tasksRes, foldersRes] = await Promise.all([
        fetch(
          `/api/tasks?clientId=${encodeURIComponent(cid)}&folderId=${folderId || 'root'}`,
        ).then((r) => r.json()),
        // Refresh folders for this client in case they changed elsewhere.
        fetch(`/api/tasks/folders?clientId=${encodeURIComponent(cid)}`).then((r) => r.json()),
      ])
      if (tasksRes?.success) setTasks(tasksRes.tasks || [])
      if (foldersRes?.success) {
        const fresh = (foldersRes.folders || []) as TaskFolder[]
        // Merge: replace folders for this client, keep folders for others.
        setFolders((prev) => [
          ...prev.filter((f) => f.client_id !== cid),
          ...fresh,
        ])
      }
    } finally {
      setIsLoadingTasks(false)
    }
  }, [])

  useEffect(() => {
    if (!clientId) return
    try {
      window.sessionStorage.setItem(STORAGE_KEY, clientId)
    } catch {}
    setCurrentFolderId(null)
    setBreadcrumb([])
    void loadFoldersAndTasks(clientId, null)
  }, [clientId, loadFoldersAndTasks])

  // Realtime: tasks moved/changed by another user reflect immediately for everyone
  // viewing this client.
  useEffect(() => {
    if (!clientId) return
    const channel = supabase
      .channel(`tasks-client-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          void loadFoldersAndTasks(clientId, currentFolderId)
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_folders',
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          void loadFoldersAndTasks(clientId, currentFolderId)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [clientId, currentFolderId, supabase, loadFoldersAndTasks])

  const childFolders = useMemo(
    () =>
      folders.filter(
        (f) =>
          f.client_id === clientId &&
          (f.parent_folder_id ?? null) === (currentFolderId ?? null),
      ),
    [folders, clientId, currentFolderId],
  )

  const enterFolder = (folder: TaskFolder) => {
    setBreadcrumb((prev) => [...prev, folder])
    setCurrentFolderId(folder.id)
    void loadFoldersAndTasks(clientId, folder.id)
  }

  const goToBreadcrumb = (idx: number) => {
    if (idx < 0) {
      setCurrentFolderId(null)
      setBreadcrumb([])
      void loadFoldersAndTasks(clientId, null)
    } else {
      const next = breadcrumb.slice(0, idx + 1)
      const target = next[next.length - 1]
      setBreadcrumb(next)
      setCurrentFolderId(target.id)
      void loadFoldersAndTasks(clientId, target.id)
    }
  }

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/tasks/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          parentFolderId: currentFolderId,
          name,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        flash('error', data.error || 'Failed to create folder')
        return
      }
      setFolders((prev) => [...prev, data.folder])
      setNewFolderName('')
      setShowCreateFolder(false)
      flash('success', 'Folder created')
    } finally {
      setCreating(false)
    }
  }

  const handleCreateTask = async () => {
    const name = newTaskName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          folderId: currentFolderId,
          name,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        flash('error', data.error || 'Failed to create task')
        return
      }
      setTasks((prev) => [data.task, ...prev])
      setNewTaskName('')
      setShowCreateTask(false)
      flash('success', 'Task created')
    } finally {
      setCreating(false)
    }
  }

  const handleRenameFolder = async () => {
    if (!renameTarget) return
    const name = renameValue.trim()
    if (!name) return
    const res = await fetch(`/api/tasks/folders/${renameTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || 'Failed to rename folder')
    setFolders((prev) =>
      prev.map((f) => (f.id === renameTarget.id ? { ...f, name } : f)),
    )
    setBreadcrumb((prev) => prev.map((b) => (b.id === renameTarget.id ? { ...b, name } : b)))
    setRenameTarget(null)
  }

  const handleDeleteFolder = async () => {
    if (!deleteFolderTarget) return
    const res = await fetch(`/api/tasks/folders/${deleteFolderTarget.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || 'Failed to delete folder')
    setFolders((prev) => prev.filter((f) => f.id !== deleteFolderTarget.id))
    if (currentFolderId === deleteFolderTarget.id) {
      goToBreadcrumb(breadcrumb.length - 2)
    }
    setDeleteFolderTarget(null)
  }

  const handleDeleteTask = async () => {
    if (!deleteTaskTarget) return
    const res = await fetch(`/api/tasks/${deleteTaskTarget.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || 'Failed to delete task')
    setTasks((prev) => prev.filter((t) => t.id !== deleteTaskTarget.id))
    setDeleteTaskTarget(null)
  }

  const handleDuplicateTask = async (id: string) => {
    setDuplicatingId(id)
    try {
      const res = await fetch(`/api/tasks/${id}/duplicate`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        flash('error', data.error || 'Failed to duplicate task')
        return
      }
      flash('success', 'Task duplicated')
      // Refresh the task list so the copy appears in place.
      void loadFoldersAndTasks(clientId, currentFolderId)
    } finally {
      setDuplicatingId(null)
    }
  }

  const handleDuplicateFolder = async (id: string) => {
    setDuplicatingId(id)
    try {
      const res = await fetch(`/api/tasks/folders/${id}/duplicate`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        flash('error', data.error || 'Failed to duplicate folder')
        return
      }
      flash('success', 'Folder duplicated')
      void loadFoldersAndTasks(clientId, currentFolderId)
    } finally {
      setDuplicatingId(null)
    }
  }

  // Drag a task card onto a status column.
  const handleDropOnStatus = async (taskId: string, nextStatus: TaskStatus) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === nextStatus) return
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus } : t)))
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      const data = await res.json()
      if (!data.success) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)))
        flash('error', data.error || 'Failed to update status')
      }
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)))
      flash('error', 'Failed to update status')
    }
  }

  // Drag a task card onto a folder (or the breadcrumb root) — moves the task.
  const handleDropTaskOnFolder = async (taskId: string, folderId: string | null) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    if ((task.folder_id ?? null) === folderId) return
    // Optimistic: pull it out of the current view (since it's no longer in this folder).
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      })
      const data = await res.json()
      if (!data.success) {
        // Revert.
        setTasks((prev) => [task, ...prev])
        flash('error', data.error || 'Failed to move task')
        return
      }
      flash('success', 'Task moved')
    } catch {
      setTasks((prev) => [task, ...prev])
      flash('error', 'Failed to move task')
    }
  }

  const memberById = useCallback(
    (id: string) => members.find((m) => m.id === id) || null,
    [members],
  )

  const filteredClients = useMemo(() => {
    const q = navQuery.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.business_name || '').toLowerCase().includes(q),
    )
  }, [clients, navQuery])

  return (
    <>
      <Header title="Tasks" subtitle="Organize work by client and folder" />

      <div className="flex">
        {/* Left navigator. `sticky top-0` keeps it pinned as the user scrolls
            the main column; the height reaches the bottom of the viewport.
            On mobile the (app) layout has a 56px hamburger header above us, on
            desktop it doesn't — so we subtract that on mobile only. */}
        <aside
          className={`shrink-0 border-r border-gray-200 bg-white transition-[width] duration-200 ease-out overflow-hidden sticky top-0 self-start h-[calc(100dvh-3.5rem)] md:h-dvh ${
            navOpen ? 'w-64' : 'w-12'
          }`}
        >
          <div className={`h-full flex flex-col ${navOpen ? '' : 'items-center'}`}>
            <div
              className={`flex items-center ${navOpen ? 'justify-between px-3' : 'justify-center px-0'} py-3 border-b border-gray-100`}
            >
              {navOpen && (
                <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">
                  Clients
                </span>
              )}
              <button
                type="button"
                onClick={toggleNav}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                aria-label={navOpen ? 'Collapse navigator' : 'Expand navigator'}
                title={navOpen ? 'Collapse' : 'Expand'}
              >
                {navOpen ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeftOpen className="h-4 w-4" />
                )}
              </button>
            </div>

            {navOpen && (
              <>
                <div className="px-3 py-2 border-b border-gray-100">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      value={navQuery}
                      onChange={(e) => setNavQuery(e.target.value)}
                      placeholder="Search clients…"
                      className="w-full pl-8 pr-2 py-1.5 rounded-md border border-gray-200 bg-white text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                </div>

                <ul className="flex-1 overflow-y-auto py-1">
                  {filteredClients.length === 0 ? (
                    <li className="px-3 py-4 text-xs text-gray-400 text-center">No matches</li>
                  ) : (
                    filteredClients.map((c) => {
                      const active = c.id === clientId
                      const expanded = expandedClients.has(c.id)
                      return (
                        <li key={c.id}>
                          <div
                            className={`w-full flex items-center gap-1 pl-1 pr-3 py-1.5 transition-colors ${
                              active
                                ? 'bg-[#E8F1FF] text-[#2B79F7]'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedClients((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(c.id)) next.delete(c.id)
                                  else next.add(c.id)
                                  return next
                                })
                              }}
                              aria-label={expanded ? 'Collapse' : 'Expand'}
                              className="p-0.5 rounded hover:bg-gray-200/70 text-gray-400 hover:text-gray-700 shrink-0"
                            >
                              {expanded ? (
                                <ChevronDownIcon className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setClientId(c.id)
                                setExpandedClients((prev) => new Set(prev).add(c.id))
                              }}
                              className="flex items-center gap-2 flex-1 min-w-0 text-left"
                            >
                              {c.profile_picture_url ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={c.profile_picture_url}
                                  alt={c.name}
                                  className="h-6 w-6 rounded-full object-cover shrink-0"
                                />
                              ) : (
                                <div className="h-6 w-6 rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                                  {(c.name || '?').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <span className="text-xs font-medium truncate flex-1">{c.name}</span>
                            </button>
                          </div>
                          {expanded && (
                            <ClientNavTree
                              clientId={c.id}
                              folders={folders}
                              currentFolderId={c.id === clientId ? currentFolderId : null}
                              isActiveClient={c.id === clientId}
                              onPickFolder={(folder) => {
                                if (folder === null) {
                                  if (c.id !== clientId) setClientId(c.id)
                                  setBreadcrumb([])
                                  setCurrentFolderId(null)
                                  if (c.id === clientId) {
                                    void loadFoldersAndTasks(c.id, null)
                                  }
                                  return
                                }
                                // Build breadcrumb path to that folder, walking
                                // up via parent_folder_id.
                                const path: TaskFolder[] = []
                                let cursor: TaskFolder | null = folder
                                while (cursor) {
                                  path.unshift(cursor)
                                  cursor = cursor.parent_folder_id
                                    ? folders.find((f) => f.id === cursor!.parent_folder_id) || null
                                    : null
                                }
                                if (c.id !== clientId) setClientId(c.id)
                                setBreadcrumb(path)
                                setCurrentFolderId(folder.id)
                                if (c.id === clientId) {
                                  void loadFoldersAndTasks(c.id, folder.id)
                                }
                              }}
                            />
                          )}
                        </li>
                      )
                    })
                  )}
                </ul>
              </>
            )}

            {!navOpen && (
              /* Collapsed: small client list of avatars only. */
              <ul className="flex-1 overflow-y-auto py-2 space-y-1 w-full">
                {clients.slice(0, 12).map((c) => {
                  const active = c.id === clientId
                  return (
                    <li key={c.id} className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => setClientId(c.id)}
                        title={c.name}
                        className={`p-1 rounded-md transition ${active ? 'ring-2 ring-[#2B79F7]' : 'hover:bg-gray-100'}`}
                      >
                        {c.profile_picture_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={c.profile_picture_url}
                            alt={c.name}
                            className="h-7 w-7 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center">
                            {(c.name || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0 p-4 md:p-8">
          {notification && (
            <div
              className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
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

          {isLoading ? (
            <Skeleton className="h-10 w-64 rounded-lg" />
          ) : !clientId ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                <Briefcase className="h-8 w-8 mx-auto text-gray-300 mb-3" />
                <p className="text-sm">Pick a client from the sidebar to get started.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Breadcrumb + drop zone (root) */}
              <div
                className={`mb-4 flex items-center gap-1 text-sm flex-wrap ${
                  dragOverFolder === 'root' ? 'bg-blue-50 ring-2 ring-[#2B79F7]/30 rounded-md' : ''
                } px-2 py-1 -mx-2 transition-colors`}
                onDragOver={(e) => {
                  // We can't read the payload during dragOver, so just always
                  // accept and let the drop handler decide whether it's a task.
                  e.preventDefault()
                  setDragOverFolder('root')
                }}
                onDragLeave={() => setDragOverFolder(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverFolder(null)
                  const payload = decodeDrag(e.dataTransfer.getData('text/plain'))
                  if (payload?.kind === 'task') {
                    void handleDropTaskOnFolder(payload.id, null)
                  }
                }}
              >
                <button
                  type="button"
                  onClick={() => goToBreadcrumb(-1)}
                  className={`hover:text-gray-900 ${currentFolderId === null ? 'text-gray-900 font-medium' : 'text-gray-500'}`}
                >
                  All folders
                </button>
                {breadcrumb.map((b, idx) => (
                  <span key={b.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                    <button
                      type="button"
                      onClick={() => goToBreadcrumb(idx)}
                      className={`hover:text-gray-900 ${
                        idx === breadcrumb.length - 1
                          ? 'text-gray-900 font-medium'
                          : 'text-gray-500'
                      }`}
                    >
                      {b.name}
                    </button>
                  </span>
                ))}
                {dragOverFolder === 'root' && (
                  <span className="ml-2 text-xs text-[#2B79F7] font-medium">Drop to move here</span>
                )}
              </div>

              {/* Action bar + view toggle */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => setShowCreateFolder(true)}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    New folder
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowCreateTask(true)}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    New task
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowApplyTemplate(true)}>
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    From template
                  </Button>
                </div>

                <div className="inline-flex items-center bg-white rounded-xl p-1 border border-gray-200">
                  <button
                    type="button"
                    onClick={() => setView('list')}
                    className={`p-1.5 rounded-lg transition-colors ${
                      viewMode === 'list'
                        ? 'bg-[#E8F1FF] text-[#2B79F7] shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    aria-label="List view"
                    title="List view"
                  >
                    <ListIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('board')}
                    className={`p-1.5 rounded-lg transition-colors ${
                      viewMode === 'board'
                        ? 'bg-[#E8F1FF] text-[#2B79F7] shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    aria-label="Board view"
                    title="Board view"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {showCreateFolder && (
                <Card className="mb-3">
                  <CardContent className="p-3 flex flex-wrap items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateFolder()
                        if (e.key === 'Escape') {
                          setShowCreateFolder(false)
                          setNewFolderName('')
                        }
                      }}
                      placeholder="Folder name…"
                      className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                    <Button size="sm" onClick={handleCreateFolder} isLoading={creating}>
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowCreateFolder(false)
                        setNewFolderName('')
                      }}
                    >
                      Cancel
                    </Button>
                  </CardContent>
                </Card>
              )}

              {showCreateTask && (
                <Card className="mb-3">
                  <CardContent className="p-3 flex flex-wrap items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={newTaskName}
                      onChange={(e) => setNewTaskName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateTask()
                        if (e.key === 'Escape') {
                          setShowCreateTask(false)
                          setNewTaskName('')
                        }
                      }}
                      placeholder="Task name…"
                      className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                    <Button size="sm" onClick={handleCreateTask} isLoading={creating}>
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowCreateTask(false)
                        setNewTaskName('')
                      }}
                    >
                      Cancel
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Folders strip — drop targets for tasks. */}
              {childFolders.length > 0 && (
                <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {childFolders.map((f) => {
                    const isOver = dragOverFolder === f.id
                    return (
                      <Card
                        key={f.id}
                        className={`hover:shadow-md transition ${
                          isOver ? 'ring-2 ring-[#2B79F7] bg-[#E8F1FF]' : ''
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          setDragOverFolder(f.id)
                        }}
                        onDragLeave={() => setDragOverFolder(null)}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDragOverFolder(null)
                          const payload = decodeDrag(e.dataTransfer.getData('text/plain'))
                          if (payload?.kind === 'task') {
                            void handleDropTaskOnFolder(payload.id, f.id)
                          }
                        }}
                      >
                        <CardContent className="p-3 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => enterFolder(f)}
                            className="flex items-center gap-3 flex-1 min-w-0 text-left"
                          >
                            <div className="h-9 w-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                              <Folder className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">{f.name}</p>
                              <p className="text-xs text-gray-400">
                                {isOver ? 'Drop to move task here' : 'Folder'}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                          </button>

                          <div className="relative shrink-0" data-row-menu>
                            <button
                              type="button"
                              onClick={() =>
                                setOpenMenu(
                                  openMenu?.kind === 'folder' && openMenu.id === f.id
                                    ? null
                                    : { kind: 'folder', id: f.id },
                                )
                              }
                              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                              aria-label="Folder options"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                            {openMenu?.kind === 'folder' && openMenu.id === f.id && (
                              <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenameTarget(f)
                                    setRenameValue(f.name)
                                    setOpenMenu(null)
                                  }}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  <Pencil className="h-4 w-4" />
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  disabled={duplicatingId === f.id}
                                  onClick={() => {
                                    setOpenMenu(null)
                                    void handleDuplicateFolder(f.id)
                                  }}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                  <Copy className="h-4 w-4" />
                                  {duplicatingId === f.id ? 'Duplicating…' : 'Duplicate'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteFolderTarget(f)
                                    setOpenMenu(null)
                                  }}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}

              {/* Tasks view */}
              {isLoadingTasks ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <Skeleton className="h-5 w-1/2" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : tasks.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-gray-500">
                    <p className="text-sm">No tasks here yet.</p>
                    <p className="text-xs mt-1">Create one to get started.</p>
                  </CardContent>
                </Card>
              ) : viewMode === 'list' ? (
                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    <table className="w-full min-w-[760px]">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="px-4 py-3 font-medium">Task</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium">Assignees</th>
                          <th className="px-4 py-3 font-medium">Priority</th>
                          <th className="px-4 py-3 font-medium">Start</th>
                          <th className="px-4 py-3 font-medium">Due</th>
                          <th className="px-4 py-3 font-medium" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {tasks.map((t) => {
                          const s = STATUS_BY_ID[t.status]
                          return (
                            <tr
                              key={t.id}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', encodeDrag('task', t.id))
                                e.dataTransfer.effectAllowed = 'move'
                                setDraggingId(t.id)
                              }}
                              onDragEnd={() => {
                                setDraggingId(null)
                                setDragOverFolder(null)
                              }}
                              className={`hover:bg-gray-50 cursor-pointer transition-colors ${draggingId === t.id ? 'opacity-50' : ''}`}
                              onClick={(e) => {
                                const target = e.target as HTMLElement
                                if (target.closest('[data-row-menu]')) return
                                router.push(`/tasks/${t.id}`)
                              }}
                            >
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                {t.name}
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${s.pill}`}
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: s.dot }}
                                  />
                                  {s.label}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <AvatarStack ids={t.assignee_ids} lookup={memberById} />
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center gap-1 text-xs ${PRIORITY_COLOR[t.priority]}`}
                                >
                                  <Flag className="h-3.5 w-3.5" />
                                  {PRIORITY_LABEL[t.priority]}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">
                                {t.start_at ? new Date(t.start_at).toLocaleDateString() : '—'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">
                                {t.due_at ? new Date(t.due_at).toLocaleDateString() : '—'}
                              </td>
                              <td className="px-4 py-3 text-right" data-row-menu>
                                <div className="relative inline-block">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenMenu(
                                        openMenu?.kind === 'task' && openMenu.id === t.id
                                          ? null
                                          : { kind: 'task', id: t.id },
                                      )
                                    }
                                    className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                                    aria-label="Task options"
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </button>
                                  {openMenu?.kind === 'task' && openMenu.id === t.id && (
                                    <div className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          router.push(`/tasks/${t.id}`)
                                          setOpenMenu(null)
                                        }}
                                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <Pencil className="h-4 w-4" />
                                        Open
                                      </button>
                                      <button
                                        type="button"
                                        disabled={duplicatingId === t.id}
                                        onClick={() => {
                                          setOpenMenu(null)
                                          void handleDuplicateTask(t.id)
                                        }}
                                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                      >
                                        <Copy className="h-4 w-4" />
                                        {duplicatingId === t.id ? 'Duplicating…' : 'Duplicate'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDeleteTaskTarget(t)
                                          setOpenMenu(null)
                                        }}
                                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              ) : (
                /* Board view */
                <div className="overflow-x-auto pb-2 -mx-2 px-2">
                  <div className="flex gap-3 items-start min-w-max">
                    {STATUSES.map((col) => {
                      const colTasks = tasks.filter((t) => t.status === col.id)
                      const isDragOver = dragOverStatus === col.id
                      return (
                        <div
                          key={col.id}
                          className={`w-72 shrink-0 self-start bg-gray-50 rounded-xl border ${
                            isDragOver ? 'border-[#2B79F7] ring-2 ring-[#2B79F7]/20' : 'border-gray-200'
                          } transition`}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            setDragOverStatus(col.id)
                          }}
                          onDragLeave={() => setDragOverStatus(null)}
                          onDrop={(e) => {
                            e.preventDefault()
                            setDragOverStatus(null)
                            setDraggingId(null)
                            const payload = decodeDrag(e.dataTransfer.getData('text/plain'))
                            if (payload?.kind === 'task') {
                              void handleDropOnStatus(payload.id, col.id)
                            }
                          }}
                        >
                          <div className="px-3 py-2.5 flex items-center justify-between border-b border-gray-200">
                            <span className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: col.dot }}
                              />
                              {col.label}
                            </span>
                            <span className="text-[11px] text-gray-400">{colTasks.length}</span>
                          </div>
                          <div className="p-2 space-y-2">
                            {colTasks.length === 0 ? (
                              <p className="text-[11px] text-gray-400 text-center py-3">
                                Drop tasks here
                              </p>
                            ) : (
                              colTasks.map((t) => (
                                <div
                                  key={t.id}
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData('text/plain', encodeDrag('task', t.id))
                                    e.dataTransfer.effectAllowed = 'move'
                                    setDraggingId(t.id)
                                  }}
                                  onDragEnd={() => {
                                    setDraggingId(null)
                                    setDragOverStatus(null)
                                    setDragOverFolder(null)
                                  }}
                                  onClick={() => router.push(`/tasks/${t.id}`)}
                                  className={`bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md transition ${
                                    draggingId === t.id ? 'opacity-50' : ''
                                  }`}
                                >
                                  <p className="text-sm font-medium text-gray-900 line-clamp-2">
                                    {t.name}
                                  </p>
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <AvatarStack
                                      ids={t.assignee_ids}
                                      lookup={memberById}
                                      max={3}
                                    />
                                    <span
                                      className={`inline-flex items-center gap-1 text-[11px] ${PRIORITY_COLOR[t.priority]}`}
                                    >
                                      <Flag className="h-3 w-3" />
                                      {PRIORITY_LABEL[t.priority]}
                                    </span>
                                  </div>
                                  {t.due_at && (
                                    <p className="mt-1.5 text-[11px] text-gray-400 inline-flex items-center gap-1">
                                      <CalendarIcon className="h-3 w-3" />
                                      Due {new Date(t.due_at).toLocaleDateString()}
                                    </p>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ApplyTemplateModal
        open={showApplyTemplate}
        clientId={clientId}
        folderId={currentFolderId}
        onClose={() => setShowApplyTemplate(false)}
        onApplied={(taskId) => {
          flash('success', 'Template applied')
          void loadFoldersAndTasks(clientId, currentFolderId)
          router.push(`/tasks/${taskId}`)
        }}
      />

      <ConfirmModal
        open={!!renameTarget}
        title="Rename folder"
        message={
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Folder name"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
        }
        confirmLabel="Save"
        onClose={() => setRenameTarget(null)}
        onConfirm={async () => {
          await handleRenameFolder()
        }}
      />
      <ConfirmModal
        open={!!deleteFolderTarget}
        title="Delete folder?"
        message={
          deleteFolderTarget
            ? `"${deleteFolderTarget.name}" and everything inside it will be permanently deleted.`
            : ''
        }
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setDeleteFolderTarget(null)}
        onConfirm={async () => {
          await handleDeleteFolder()
        }}
      />
      <ConfirmModal
        open={!!deleteTaskTarget}
        title="Delete task?"
        message={
          deleteTaskTarget
            ? `"${deleteTaskTarget.name}" will be permanently deleted along with its subtasks, checklists and messages.`
            : ''
        }
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setDeleteTaskTarget(null)}
        onConfirm={async () => {
          await handleDeleteTask()
        }}
      />
    </>
  )
}

/**
 * Compact folder tree shown under each expanded client in the left navigator.
 * Top-level folders only — clicking drills into the folder, which in turn
 * loads tasks for that folder in the main pane and (if it wasn't already)
 * makes that client the active one.
 */
function ClientNavTree({
  clientId,
  folders,
  currentFolderId,
  isActiveClient,
  onPickFolder,
}: {
  clientId: string
  folders: TaskFolder[]
  currentFolderId: string | null
  isActiveClient: boolean
  onPickFolder: (folder: TaskFolder | null) => void
}) {
  const topLevel = folders.filter((f) => f.client_id === clientId && !f.parent_folder_id)
  if (topLevel.length === 0) {
    return (
      <p className="pl-9 pr-2 py-1 text-[11px] text-gray-400 italic">No folders yet.</p>
    )
  }
  return (
    <ul className="pl-9 pr-2 py-1 space-y-0.5">
      <li>
        <button
          type="button"
          onClick={() => onPickFolder(null)}
          className={`w-full text-left text-[11px] px-2 py-1 rounded-md transition-colors ${
            isActiveClient && currentFolderId === null
              ? 'bg-gray-100 text-gray-900 font-medium'
              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          All folders
        </button>
      </li>
      {topLevel.map((f) => {
        const active = isActiveClient && f.id === currentFolderId
        return (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onPickFolder(f)}
              className={`w-full text-left text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                active
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
              title={f.name}
            >
              <Folder className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="truncate">{f.name}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function AvatarStack({
  ids,
  lookup,
  max = 3,
}: {
  ids: string[]
  lookup: (id: string) => AgencyMember | null
  max?: number
}) {
  if (ids.length === 0) return <span className="text-xs text-gray-400">—</span>
  const visible = ids.slice(0, max)
  const overflow = ids.length - visible.length
  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((id) => {
        const m = lookup(id)
        if (!m) return null
        if (m.profile_picture_url) {
          return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={id}
              src={m.profile_picture_url}
              alt={m.name || m.email}
              className="h-6 w-6 rounded-full object-cover ring-2 ring-white"
              title={m.name || m.email}
            />
          )
        }
        return (
          <div
            key={id}
            className="h-6 w-6 rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white"
            title={m.name || m.email}
          >
            {((m.name || m.email).charAt(0) || '?').toUpperCase()}
          </div>
        )
      })}
      {overflow > 0 && (
        <span className="h-6 w-6 rounded-full bg-gray-100 text-gray-500 text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">
          +{overflow}
        </span>
      )}
    </div>
  )
}
