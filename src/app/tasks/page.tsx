'use client'

import { useState, useEffect, useRef } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import {
  Plus,
  Search,
  Kanban,
  Table2,
  Calendar,
  User as UserIcon,
  MessageCircle,
  X,
  Paperclip,              // <-- add this
  Trash2,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'

const STATUSES = [
  { id: 'new', label: 'New', color: '#6366F1' },
  { id: 'in_progress', label: 'In Progress', color: '#3B82F6' },
  { id: 'waiting_feedback', label: 'Waiting Feedback', color: '#F59E0B' },
  { id: 'ready_review', label: 'Ready for Review', color: '#A855F7' },
  { id: 'in_review', label: 'In Review', color: '#EC4899' },
  { id: 'approved', label: 'Approved', color: '#10B981' },
  { id: 'complete', label: 'Complete', color: '#6B7280' },
]

const getStatusMeta = (id: string) =>
  STATUSES.find(s => s.id === id) || STATUSES[0]

interface Task {
  id: string
  client_id: string | null
  client_name: string | null
  client_business: string | null
  title: string
  description: string | null
  status: string
  start_date: string | null
  due_date: string | null
  is_template: boolean
  created_at: string
}

interface Assignee {
  id: string
  name: string
  avatar: string | null
}

interface Client {
  id: string
  name: string
  business_name: string
}

interface Comment {
  id: string
  user_id: string | null
  content: string
  created_at: string
  user_name: string | null
  user_avatar: string | null
  file_url?: string | null
  file_name?: string | null
  file_type?: string | null
}

interface MentionUser {
  id: string
  name: string
  profile_picture_url: string | null
}


export default function TasksPage() {
const searchParams = useSearchParams()
const [initialTaskOpened, setInitialTaskOpened] = useState(false)
  const supabase = createClient()

    const createNotifications = async (
    userIds: string[],
    type: string,
    data: any
  ) => {
    if (!userIds.length) return
    try {
      await fetch('/api/notifications/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds, type, data }),
      })
    } catch (err) {
      console.error('Notify error:', err)
    }
  }

  const [tasks, setTasks] = useState<Task[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [view, setView] = useState<'board' | 'table'>('board')
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragOverStatusId, setDragOverStatusId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null)
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const [taskAssignees, setTaskAssignees] = useState<Record<string, Assignee[]>>({})
 const [assigneeSearch, setAssigneeSearch] = useState('')

  // Task modal
  const [showModal, setShowModal] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewImageName, setPreviewImageName] = useState<string | null>(null)
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    client_id: '',
    status: 'new',
    start_date: '',
    due_date: '',
    is_template: false,
  })
  const [isSavingTask, setIsSavingTask] = useState(false)

  // Comments sidebar
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentInput, setCommentInput] = useState('')
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [isSendingComment, setIsSendingComment] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [commentFile, setCommentFile] = useState<File | null>(null)


  // Comment edit state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')

    // Comment file upload
  const fileInputRef = useRef<HTMLInputElement | null>(null)

    // Mentions
  const [allUsers, setAllUsers] = useState<MentionUser[]>([])
  const [mentionQuery, setMentionQuery] = useState('')
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)



  useEffect(() => {
  if (initialTaskOpened) return
  const taskIdParam = searchParams.get('taskId')
  if (!taskIdParam || !tasks.length) return

  const t = tasks.find(task => task.id === taskIdParam)
  if (t) {
    openEditTaskModal(t)
    setInitialTaskOpened(true)
  }
}, [tasks, searchParams, initialTaskOpened])

  useEffect(() => {
  // Realtime subscription for tasks and comments
  const channel = supabase
    .channel('tasks-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tasks' },
      payload => {
        console.log('Realtime: tasks change', payload)
        loadTasks()
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'task_comments' },
      payload => {
        console.log('Realtime: task_comments change', payload)

        // If the comments sidebar is open for this task, reload its comments
        const newRow: any = payload.new
        const oldRow: any = payload.old

        const affectedTaskId =
          newRow?.task_id || oldRow?.task_id || null

        if (selectedTask && affectedTaskId === selectedTask.id) {
          loadComments(selectedTask.id)
        }
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [supabase, selectedTask])
  
  useEffect(() => {
    init()
  }, [])

  const init = async () => {
    setIsLoading(true)

    // Current user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setCurrentUserId(user?.id || null)

    // Load clients
    const { data: clientData } = await supabase
      .from('clients')
      .select('id, name, business_name')
      .order('name')

    if (clientData) {
      setClients(clientData as Client[])
    }

    // Load users for @mention
    const { data: usersData } = await supabase
      .from('users')
      .select('id, name, email, profile_picture_url')
      .order('name')

    if (usersData) {
      setAllUsers(
        usersData.map((u: any) => ({
          id: u.id,
          name: u.name || u.email || 'User',
          profile_picture_url: u.profile_picture_url || null,
        }))
      )
    }
    

    await loadTasks()
    setIsLoading(false)
  }

  

    const loadTasks = async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select(
        'id, client_id, title, description, status, start_date, due_date, is_template, created_at, clients(name, business_name)'
      )
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Load tasks error:', error)
      return
    }

    const mapped: Task[] =
      data?.map((t: any) => ({
        id: t.id,
        client_id: t.client_id,
        client_name: t.clients?.name || null,
        client_business: t.clients?.business_name || null,
        title: t.title,
        description: t.description,
        status: t.status,
        start_date: t.start_date,
        due_date: t.due_date,
        is_template: t.is_template,
        created_at: t.created_at,
      })) || []

    setTasks(mapped)
    await loadAssignees()
  }

    const deleteTask = async () => {
    if (!taskToDelete) return
    setIsDeletingTask(true)

    const id = taskToDelete.id
    const prev = tasks

    // Optimistic remove
    setTasks(prev.filter(t => t.id !== id))

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete task error:', error)
      setTasks(prev) // rollback
    } else {
      // Close modals/sidebars if they show this task
      if (editingTask && editingTask.id === id) {
        setShowModal(false)
        setEditingTask(null)
      }
      if (selectedTask && selectedTask.id === id) {
        setSelectedTask(null)
        setComments([])
      }
    }

    setIsDeletingTask(false)
    setTaskToDelete(null)
  }

    const loadAssignees = async () => {
    const { data, error } = await supabase
      .from('task_assignees')
      .select('task_id, user_id, users(name, profile_picture_url)')

    if (error) {
      console.error('Load task assignees error:', error)
      return
    }

    const map: Record<string, Assignee[]> = {}

    ;(data || []).forEach((row: any) => {
      const tId = row.task_id as string
      const u = row.users
      if (!u) return

      const assignee: Assignee = {
        id: row.user_id,
        name: u.name || 'User',
        avatar: u.profile_picture_url || null,
      }

      if (!map[tId]) map[tId] = []
      // Avoid duplicates
      if (!map[tId].some(a => a.id === assignee.id)) {
        map[tId].push(assignee)
      }
    })

    setTaskAssignees(map)
  }

    const toggleAssignee = async (user: MentionUser) => {
    if (!editingTask) return
    const taskId = editingTask.id
    const current = taskAssignees[taskId] || []
    const isAssigned = current.some(a => a.id === user.id)

    if (isAssigned) {
      // Unassign
      const { error } = await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', taskId)
        .eq('user_id', user.id)

      if (error) {
        console.error('Unassign user error:', error)
        return
      }

      setTaskAssignees(prev => ({
        ...prev,
        [taskId]: (prev[taskId] || []).filter(a => a.id !== user.id),
      }))
    } else {
      // Assign
      const { error } = await supabase
        .from('task_assignees')
        .insert({
          task_id: taskId,
          user_id: user.id,
        })

      if (error) {
        console.error('Assign user error:', error)
        return
      }

      const newAssignee: Assignee = {
        id: user.id,
        name: user.name,
        avatar: user.profile_picture_url,
      }

      setTaskAssignees(prev => ({
        ...prev,
        [taskId]: [...(prev[taskId] || []), newAssignee],
      }))

      // Notify the assigned user
      createNotifications([user.id], 'task_assigned', {
        taskId,
        title: editingTask.title,
      })
    }
  }

  const openNewTaskModal = () => {
    setEditingTask(null)
    setTaskForm({
      title: '',
      description: '',
      client_id: '',
      status: 'new',
      start_date: '',
      due_date: '',
      is_template: false,
    })
    setShowModal(true)
  }

  const openEditTaskModal = (task: Task) => {
  setEditingTask(task)
  setTaskForm({
    title: task.title,
    description: task.description || '',
    client_id: task.client_id || '',
    status: task.status,
    start_date: task.start_date || '',
    due_date: task.due_date || '',
    is_template: task.is_template,
  })
  setShowModal(true)

  // Also prepare comments for this task
  setSelectedTask(task)
  setCommentInput('')
  setEditingCommentId(null)
  setEditingCommentText('')
  setCommentFile(null)
  loadComments(task.id)
}

  const handleTaskFormChange = (
  e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
) => {
  const { name, value } = e.target
  setTaskForm(prev => ({ ...prev, [name]: value }))

  // If editing an existing task, auto-save this field
  if (editingTask) {
    const fieldName = name
    let fieldValue: any = value

    // Convert empty strings to null for nullable fields
    if (
      ['description', 'client_id', 'start_date', 'due_date'].includes(
        fieldName
      ) &&
      value === ''
    ) {
      fieldValue = null
    }

    const updatePayload: any = {
      [fieldName]: fieldValue,
    }

    supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', editingTask.id)
      .then(({ error }) => {
        if (error) {
          console.error('Auto-save task field error:', error)
        } else {
          // Also update local tasks state for immediate UI feedback
          setTasks(prev =>
            prev.map(t =>
              t.id === editingTask.id
                ? { ...t, [fieldName]: fieldValue }
                : t
            )
          )
        }
      })
  }
}

  const saveTask = async () => {
    if (!taskForm.title) return
    setIsSavingTask(true)

    try {
      if (editingTask) {
        const { error } = await supabase
          .from('tasks')
          .update({
            title: taskForm.title,
            description: taskForm.description || null,
            client_id: taskForm.client_id || null,
            status: taskForm.status,
            start_date: taskForm.start_date || null,
            due_date: taskForm.due_date || null,
            is_template: taskForm.is_template,
          })
          .eq('id', editingTask.id)

        if (error) {
          console.error('Update task error:', error)
        }
      } else {
         const { data, error } = await supabase
          .from('tasks')
          .insert({
            title: taskForm.title,
            description: taskForm.description || null,
            client_id: taskForm.client_id || null,
            status: taskForm.status,
            start_date: taskForm.start_date || null,
            due_date: taskForm.due_date || null,
            is_template: taskForm.is_template,
          })
          .select('id')
          .single()
          
          if (error) {
          console.error('Create task error:', error)
        } else if (data && currentUserId) {
          // Notify creator (you can later expand to team)
          createNotifications([currentUserId], 'task_created', {
            taskId: data.id,
            title: taskForm.title,
          })
        }
      }

      setShowModal(false)
      await loadTasks()
    } finally {
      setIsSavingTask(false)
    }
  }

  const changeTaskStatus = async (taskId: string, status: string) => {
    setTasks(prev =>
      prev.map(t => (t.id === taskId ? { ...t, status } : t))
    )

    const { error } = await supabase
      .from('tasks')
      .update({ status })
      .eq('id', taskId)

        if (error) {
      console.error('Change task status error:', error)
      await loadTasks()
    } else if (currentUserId) {
      const changedTask = tasks.find(t => t.id === taskId)
      createNotifications([currentUserId], 'task_status_changed', {
        taskId,
        title: changedTask?.title || '',
        status,
      })
    }
  }

  const filteredTasks = tasks.filter(t => {
    const q = search.toLowerCase()
    return (
      t.title.toLowerCase().includes(q) ||
      (t.client_name && t.client_name.toLowerCase().includes(q)) ||
      (t.client_business && t.client_business.toLowerCase().includes(q))
    )
  })

  const tasksByStatus = STATUSES.map(status => ({
    ...status,
    tasks: filteredTasks.filter(t => t.status === status.id),
  }))

  // COMMENTS

  const openTaskComments = (task: Task) => {
    setSelectedTask(task)
    setCommentInput('')
    setEditingCommentId(null)
    setEditingCommentText('')
    setShowMentionDropdown(false)
    loadComments(task.id)
  }

    const loadComments = async (taskId: string) => {
  setIsLoadingComments(true)

  const { data, error } = await supabase
    .from('task_comments')
    .select(
      'id, task_id, user_id, content, created_at, file_url, file_name, file_type, users(name, profile_picture_url)'
    )
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Load comments error:', error)
    setIsLoadingComments(false)
    return
  }

  const mapped: Comment[] =
    data?.map((c: any) => ({
      id: c.id,
      user_id: c.user_id,
      content: c.content,
      created_at: c.created_at,
      user_name: c.users?.name || null,
      user_avatar: c.users?.profile_picture_url || null,
      file_url: c.file_url || null,
      file_name: c.file_name || null,
      file_type: c.file_type || null,
    })) || []

  setComments(mapped)
  setIsLoadingComments(false)
}

  const sendComment = async () => {
  if (!selectedTask || (!commentInput.trim() && !commentFile)) return
  setIsSendingComment(true)

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setIsSendingComment(false)
      return
    }

    let fileUrl: string | null = null
    let fileName: string | null = null
    let fileType: string | null = null

    // If a file is attached, upload via /api/upload
    if (commentFile) {
      const formData = new FormData()
      formData.append('file', commentFile)
      formData.append('folder', `task-comments/${selectedTask.id}`)

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        if (data.success) {
          fileUrl = data.url
          fileName = commentFile.name
          fileType = commentFile.type
        } else {
          console.error('Comment file upload failed:', data.error)
        }
      } catch (err) {
        console.error('Comment file upload error:', err)
      }
    }

    const content = commentInput.trim()

    const { data, error } = await supabase
      .from('task_comments')
      .insert({
        task_id: selectedTask.id,
        user_id: user.id,
        content: content || '',
        file_url: fileUrl,
        file_name: fileName,
        file_type: fileType,
      })
      .select(
        'id, task_id, user_id, content, created_at, file_url, file_name, file_type, users(name, profile_picture_url)'
      )
      .single()

    if (error) {
      console.error('Send comment error:', error)
    } else if (data) {
      const newComment: Comment = {
        id: data.id,
        user_id: data.user_id,
        content: data.content,
        created_at: data.created_at,
        user_name: data.users?.name || null,
        user_avatar: data.users?.profile_picture_url || null,
        file_url: data.file_url || null,
        file_name: data.file_name || null,
        file_type: data.file_type || null,
      }

      setComments(prev => [...prev, newComment])
      setCommentInput('')
      setCommentFile(null)

      // Mention notifications (keep your existing logic here)
      const words = content.split(/\s+/)
      const mentionedFirstNames = words
        .filter(w => w.startsWith('@') && w.length > 1)
        .map(w => w.slice(1).toLowerCase())

      if (mentionedFirstNames.length && allUsers.length && selectedTask) {
        const targetUsers = allUsers.filter(u =>
          mentionedFirstNames.includes(
            u.name.split(' ')[0].toLowerCase()
          )
        )
        const userIds = targetUsers
          .map(u => u.id)
          .filter(id => !!id)

        if (userIds.length) {
          createNotifications(userIds, 'task_mentioned', {
            taskId: selectedTask.id,
            commentId: data.id,
            content,
          })
        }
      }
    }
  } finally {
    setIsSendingComment(false)
  }
}

  const startEditComment = (comment: Comment) => {
    setEditingCommentId(comment.id)
    setEditingCommentText(comment.content)
  }

  const cancelEditComment = () => {
    setEditingCommentId(null)
    setEditingCommentText('')
  }

  const saveEditComment = async () => {
    if (!editingCommentId || !editingCommentText.trim()) return

    const { error } = await supabase
      .from('task_comments')
      .update({ content: editingCommentText.trim() })
      .eq('id', editingCommentId)

    if (error) {
      console.error('Edit comment error:', error)
      return
    }

    setComments(prev =>
      prev.map(c =>
        c.id === editingCommentId
          ? { ...c, content: editingCommentText.trim() }
          : c
      )
    )

    setEditingCommentId(null)
    setEditingCommentText('')
  }

  const deleteComment = async (id: string) => {
    const prev = comments
    setComments(prev.filter(c => c.id !== id))

    const { error } = await supabase
      .from('task_comments')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete comment error:', error)
      setComments(prev)
    }
  }

  const handleReply = (comment: Comment) => {
    if (!comment.user_name) return
    const first = comment.user_name.split(' ')[0]
    setCommentInput(prev => `${prev ? prev + ' ' : ''}@${first} `)
  }

  const formatComment = (content: string) => {
    const parts = content.split(/(\s+)/)
    return parts.map((part, idx) => {
      if (part.startsWith('@') && part.length > 1) {
        return (
          <span key={idx} className="text-[#2563EB] font-medium">
            {part}
          </span>
        )
      }
      return <span key={idx}>{part}</span>
    })
  }

  const filteredMentionUsers =
    mentionQuery.length > 0
      ? allUsers
          .filter(u =>
            u.name.toLowerCase().includes(mentionQuery.toLowerCase())
          )
          .slice(0, 5)
      : []

  return (
    <DashboardLayout>
      <Header
        title="Tasks"
        subtitle="Manage your content production and approvals"
      />
      <div className="p-8 flex gap-6 min-h-[calc(100vh-80px)]">
        {/* MAIN AREA */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              {/* View toggle */}
              <div className="inline-flex rounded-xl border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setView('board')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-l-xl ${
                    view === 'board'
                      ? 'bg-[#2B79F7] text-white'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <Kanban className="h-4 w-4 mr-1 inline" />
                  Board
                </button>
                <button
                  type="button"
                  onClick={() => setView('table')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-r-xl ${
                    view === 'table'
                      ? 'bg-[#2B79F7] text-white'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <Table2 className="h-4 w-4 mr-1 inline" />
                  Table
                </button>
              </div>

              {/* Search */}
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] text-sm"
                />
              </div>
            </div>

            <Button onClick={openNewTaskModal}>
              <Plus className="h-5 w-5 mr-2" />
              New Task
            </Button>
          </div>

          {/* Content */}
          {isLoading ? (
            <Card>
              <CardContent className="py-10 text-center text-gray-500">
                Loading tasks...
              </CardContent>
            </Card>
          ) : filteredTasks.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-gray-500">
                No tasks yet. Create one to get started.
              </CardContent>
            </Card>
          ) : view === 'board' ? (
            // Board view
            <div className="flex gap-4 overflow-x-auto pb-4">
              {tasksByStatus.map(column => (
  <div
    key={column.id}
    className="flex-shrink-0 w-72"
    onDragOver={e => {
      e.preventDefault()
      setDragOverStatusId(column.id)
    }}
    onDragLeave={e => {
      e.preventDefault()
      setDragOverStatusId(prev => (prev === column.id ? null : prev))
    }}
    onDrop={e => {
      e.preventDefault()
      if (dragTaskId) {
        changeTaskStatus(dragTaskId, column.id)
      }
      setDragTaskId(null)
      setDragOverStatusId(null)
    }}
  >
    <div
      className={`bg-white rounded-2xl border shadow-sm flex flex-col h-full ${
        dragOverStatusId === column.id
          ? 'border-[#2B79F7]'
          : 'border-gray-200'
      }`}
    >
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: column.color }}
                        />
                        <span className="text-sm font-semibold text-gray-800">
                          {column.label}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {column.tasks.length}
                      </span>
                    </div>
                    <div className="p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-220px)]">
                      {column.tasks.map(task => {
                        const statusMeta = getStatusMeta(task.status)
                        return (
                          <div
  key={task.id}
  className="bg-gray-50 rounded-xl border border-gray-200 px-3 py-3 cursor-pointer hover:border-[#2B79F7] hover:shadow-sm transition-all"
  onClick={() => openEditTaskModal(task)}
  draggable
  onDragStart={e => {
    e.stopPropagation()
    setDragTaskId(task.id)
  }}
  onDragEnd={e => {
    e.stopPropagation()
    setDragTaskId(null)
    setDragOverStatusId(null)
  }}
>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <h4 className="font-medium text-sm text-gray-900 truncate">
                                {task.title}
                              </h4>
                              {task.is_template && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-semibold">
                                  Template
                                </span>
                              )}
                            </div>
                            {task.client_name && (
                              <p className="text-xs text-gray-500 mb-1 truncate">
                                {task.client_name} – {task.client_business}
                              </p>
                            )}
                            <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
                                  {task.client_name && (
    <p className="text-xs text-gray-500 mb-1 truncate">
      {task.client_name} – {task.client_business}
    </p>
  )}

  {/* Assignees row */}
  <div className="flex items-center gap-1 mb-1 min-h-[20px]">
    {(taskAssignees[task.id] || []).slice(0, 3).map(a => (
      <div
        key={a.id}
        className="h-5 w-5 rounded-full bg-gray-200 overflow-hidden border border-white"
        title={a.name}
      >
        {a.avatar ? (
          <img
            src={a.avatar}
            alt={a.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-[10px] text-gray-700">
            {a.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    ))}
    {taskAssignees[task.id] && taskAssignees[task.id].length > 3 && (
      <span className="text-[10px] text-gray-400">
        +{taskAssignees[task.id].length - 3}
      </span>
    )}
  </div>
  <div className="flex items-center gap-1">
    <Calendar className="h-3 w-3" />
    <span>
      {task.due_date
        ? new Date(task.due_date).toLocaleDateString()
        : 'No due date'}
    </span>
  </div>
  {/* no comments button here */}
</div>
                            <div className="mt-2">
                              <select
                                value={task.status}
                                onChange={e =>
                                  changeTaskStatus(task.id, e.target.value)
                                }
                                onClick={e => e.stopPropagation()}
                                className="w-full px-2 py-1 text-xs rounded-lg border bg-white focus:outline-none focus:ring-1 focus:ring-[#2B79F7]"
                                style={{
                                  borderColor: statusMeta.color + '80',
                                  color: statusMeta.color,
                                  backgroundColor: statusMeta.color + '10',
                                }}
                              >
                                {STATUSES.map(s => (
                                  <option key={s.id} value={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Table view
            <Card>
              <CardContent className="p-0">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">
                        Task
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">
                        Client
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">
  Start
</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">
                        Due
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">
                        Comments
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredTasks.map(task => {
                      const statusMeta = getStatusMeta(task.status)
                      return (
                        <tr
                          key={task.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => openEditTaskModal(task)}
                        >
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {task.title}
                              </span>
                              {task.is_template && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-semibold">
                                  Template
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
  {task.client_name ? (
    <>
      {task.client_name}
      {task.client_business && ` – ${task.client_business}`}
    </>
  ) : (
    <span className="text-gray-400">No client</span>
  )}
  <div className="flex items-center gap-1 mt-1">
    {(taskAssignees[task.id] || []).slice(0, 3).map(a => (
      <div
        key={a.id}
        className="h-5 w-5 rounded-full bg-gray-200 overflow-hidden border border-white"
        title={a.name}
      >
        {a.avatar ? (
          <img
            src={a.avatar}
            alt={a.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-[10px] text-gray-700">
            {a.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    ))}
    {taskAssignees[task.id] && taskAssignees[task.id].length > 3 && (
      <span className="text-[10px] text-gray-400">
        +{taskAssignees[task.id].length - 3}
      </span>
    )}
  </div>
</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            <select
                              value={task.status}
                              onChange={e =>
                                changeTaskStatus(task.id, e.target.value)
                              }
                              onClick={e => e.stopPropagation()}
                              className="px-2 py-1 text-xs rounded-lg border bg-white focus:outline-none focus:ring-1 focus:ring-[#2B79F7]"
                              style={{
                                borderColor: statusMeta.color + '80',
                                color: statusMeta.color,
                                backgroundColor:
                                  statusMeta.color + '10',
                              }}
                            >
                              {STATUSES.map(s => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {task.start_date
                              ? new Date(
                                  task.start_date
                                ).toLocaleDateString()
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {task.due_date
                              ? new Date(
                                  task.due_date
                                ).toLocaleDateString()
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-right text-gray-400">
  —
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>

        
      </div>

            {/* TASK MODAL WITH COMMENTS (side-by-side, scrollable) */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 overflow-y-auto">
          <div className="min-h-full flex items-center justify-center p-4">
            <div
              className={`flex w-full ${
                selectedTask ? 'max-w-5xl' : 'max-w-3xl'
              } gap-4`}
            >
              {/* Left: Task details */}
              <Card className={selectedTask ? 'flex-1' : 'w-full'}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {editingTask ? 'Edit Task' : 'New Task'}
                    </h3>
                    <div className="flex items-center gap-2">
                      {editingTask && (
                        <button
                          type="button"
                          onClick={() => setTaskToDelete(editingTask)}
                          className="p-1 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-500"
                          title="Delete task"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowModal(false)}
                        className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Title */}
                    <Input
                      label="Title"
                      name="title"
                      value={taskForm.title}
                      onChange={handleTaskFormChange}
                      placeholder="Task title"
                      required
                    />

                    {/* Description */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        name="description"
                        value={taskForm.description}
                        onChange={handleTaskFormChange}
                        rows={4}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                        placeholder="Describe the task, deliverables, links, etc."
                      />
                    </div>

                    {/* Client & Status */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Client
                        </label>
                        <select
                          name="client_id"
                          value={taskForm.client_id}
                          onChange={handleTaskFormChange}
                          className="w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                        >
                          <option value="">No client</option>
                          {clients.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name} – {c.business_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Status
                        </label>
                        <select
                          name="status"
                          value={taskForm.status}
                          onChange={handleTaskFormChange}
                          className="w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                        >
                          {STATUSES.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Assignees */}
                    {editingTask && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Assignees
                        </label>

                        {/* Current assignees avatars */}
                        <div className="flex items-center gap-1 mb-2 min-h-[24px]">
                          {(taskAssignees[editingTask.id] || []).map(a => (
                            <div
                              key={a.id}
                              className="h-6 w-6 rounded-full bg-gray-200 overflow-hidden border border-white"
                              title={a.name}
                            >
                              {a.avatar ? (
                                <img
                                  src={a.avatar}
                                  alt={a.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-[11px] text-gray-700">
                                  {a.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                            </div>
                          ))}
                          {(!taskAssignees[editingTask.id] ||
                            taskAssignees[editingTask.id].length === 0) && (
                            <span className="text-[11px] text-gray-400">
                              No assignees yet
                            </span>
                          )}
                        </div>

                        {/* Search input */}
                        <Input
                          label="Add assignee"
                          value={assigneeSearch}
                          onChange={e => setAssigneeSearch(e.target.value)}
                          placeholder="Type a name..."
                        />

                        {/* Search results dropdown */}
                        <div className="mt-1 border border-gray-200 rounded-lg bg-white max-h-40 overflow-y-auto">
                          {allUsers
                            .filter(u =>
                              assigneeSearch
                                ? u.name
                                    .toLowerCase()
                                    .includes(assigneeSearch.toLowerCase())
                                : true
                            )
                            .slice(0, 10)
                            .map(u => {
                              const assigned =
                                taskAssignees[editingTask.id]?.some(
                                  a => a.id === u.id
                                ) || false
                              return (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => toggleAssignee(u)}
                                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                                >
                                  <div className="flex items-center gap-2">
                                    {u.profile_picture_url ? (
                                      <img
                                        src={u.profile_picture_url}
                                        alt={u.name}
                                        className="h-4 w-4 rounded-full object-cover"
                                      />
                                    ) : (
                                      <div className="h-4 w-4 rounded-full bg-gray-200 flex items-center justify-center text-[9px] text-gray-700">
                                        {u.name.charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                    <span className="truncate">{u.name}</span>
                                  </div>
                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                                      assigned
                                        ? 'bg-green-100 text-green-600'
                                        : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    {assigned ? 'Assigned' : 'Assign'}
                                  </span>
                                </button>
                              )
                            })}
                          {allUsers.length === 0 && (
                            <p className="px-3 py-2 text-[11px] text-gray-400">
                              No users found
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="Start Date"
                        name="start_date"
                        type="date"
                        value={taskForm.start_date}
                        onChange={handleTaskFormChange}
                      />
                      <Input
                        label="Due Date"
                        name="due_date"
                        type="date"
                        value={taskForm.due_date}
                        onChange={handleTaskFormChange}
                      />
                    </div>

                    {/* Template toggle */}
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={taskForm.is_template}
                        onChange={e =>
                          setTaskForm(prev => ({
                            ...prev,
                            is_template: e.target.checked,
                          }))
                        }
                        className="w-4 h-4 rounded border-gray-400 text-[#2B79F7] focus:ring-[#2B79F7]"
                      />
                      Mark as template task
                    </label>
                  </div>

                  {/* Footer for new tasks only */}
                  {!editingTask && (
                    <div className="flex justify-end gap-3 mt-6">
                      <Button
                        variant="outline"
                        onClick={() => setShowModal(false)}
                      >
                        Cancel
                      </Button>
                      <Button onClick={saveTask} isLoading={isSavingTask}>
                        Save Task
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Right: Comments panel */}
              {selectedTask && (
                <div className="w-80 flex-shrink-0 bg-white rounded-2xl border border-gray-200 shadow-lg flex flex-col">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-gray-500" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">
                          {selectedTask.title}
                        </p>
                        <p className="text-[11px] text-gray-400">
                          Comments & mentions
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                    {isLoadingComments ? (
                      <p className="text-xs text-gray-400">Loading comments...</p>
                    ) : comments.length === 0 ? (
                      <p className="text-xs text-gray-400">
                        No comments yet. Start the conversation.
                      </p>
                    ) : (
                      comments.map(comment => (
                        <div key={comment.id} className="flex items-start gap-2">
                          <div className="mt-0.5">
                            {comment.user_avatar ? (
                              <img
                                src={comment.user_avatar}
                                alt={comment.user_name || 'User'}
                                className="h-7 w-7 rounded-full object-cover"
                              />
                            ) : (
                              <div className="h-7 w-7 rounded-full bg-brand-gradient flex items-center justify-center text-white text-xs font-semibold">
                                {(comment.user_name || 'U')
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold text-gray-800">
                                {comment.user_name || 'User'}
                              </p>
                              <span className="text-[10px] text-gray-400">
                                {new Date(
                                  comment.created_at
                                ).toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>

                            {editingCommentId === comment.id ? (
                              <div className="mt-1 space-y-1">
                                <textarea
                                  value={editingCommentText}
                                  onChange={e =>
                                    setEditingCommentText(e.target.value)
                                  }
                                  rows={2}
                                  className="w-full px-2 py-1.5 rounded-lg border border-gray-300 bg-white text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#2B79F7] resize-none"
                                />
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={cancelEditComment}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={saveEditComment}
                                  >
                                    Save
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="text-xs text-gray-700 mt-0.5 break-words">
                                  {formatComment(comment.content)}
                                </p>

                                {comment.file_url && (
                                  <div className="mt-1">
                                    {comment.file_type &&
                                    comment.file_type.startsWith('image/') ? (
                                      <img
                                        src={comment.file_url}
                                        alt={comment.file_name || 'Attachment'}
                                        className="max-h-40 rounded-lg border border-gray-200 cursor-pointer"
                                        onClick={() => {
                                          setPreviewImageUrl(comment.file_url || null)
                                          setPreviewImageName(
                                            comment.file_name || null
                                          )
                                        }}
                                      />
                                    ) : (
                                      <a
                                        href={comment.file_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[11px] text-[#2B79F7] hover:underline"
                                      >
                                        <Paperclip className="h-3 w-3" />
                                        <span>
                                          {comment.file_name || 'Attachment'}
                                        </span>
                                      </a>
                                    )}
                                  </div>
                                )}

                                <div className="flex items-center gap-2 mt-1">
                                  <button
                                    type="button"
                                    onClick={() => handleReply(comment)}
                                    className="text-[10px] text-gray-400 hover:text-[#2B79F7]"
                                  >
                                    Reply
                                  </button>
                                  {comment.user_id &&
                                    comment.user_id === currentUserId && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => startEditComment(comment)}
                                          className="text-[10px] text-gray-400 hover:text-[#2B79F7]"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => deleteComment(comment.id)}
                                          className="text-[10px] text-red-400 hover:text-red-500"
                                        >
                                          Delete
                                        </button>
                                      </>
                                    )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Comment input */}
                  <div className="border-t border-gray-100 px-3 py-2">
                    <div className="flex items-start gap-2 relative">
                      <div className="mt-1">
                        <UserIcon className="h-4 w-4 text-gray-400" />
                      </div>
                      <div className="flex-1">
                        <textarea
                          value={commentInput}
                          onChange={e => {
                            const value = e.target.value
                            setCommentInput(value)

                            const parts = value.split(/\s/)
                            const last = parts[parts.length - 1]
                            if (last && last.startsWith('@') && last.length > 1) {
                              setMentionQuery(last.slice(1))
                              setShowMentionDropdown(true)
                            } else {
                              setMentionQuery('')
                              setShowMentionDropdown(false)
                            }
                          }}
                          rows={2}
                          placeholder="Add a comment... Use @name to mention."
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                        />

                        {commentFile && (
                          <p className="mt-1 text-[10px] text-gray-500">
                            Attached: {commentFile.name}{' '}
                            <button
                              type="button"
                              onClick={() => setCommentFile(null)}
                              className="text-red-500 hover:underline ml-1"
                            >
                              Remove
                            </button>
                          </p>
                        )}

                        {showMentionDropdown &&
                          filteredMentionUsers.length > 0 && (
                            <div className="absolute left-8 right-0 bottom-16 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg text-xs z-10">
                              {filteredMentionUsers.map(user => (
                                <button
                                  key={user.id}
                                  type="button"
                                  onClick={() => {
                                    const parts = commentInput.split(/\s/)
                                    parts[parts.length - 1] =
                                      '@' + user.name.split(' ')[0]
                                    const newValue = parts.join(' ')
                                    setCommentInput(newValue + ' ')
                                    setMentionQuery('')
                                    setShowMentionDropdown(false)
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 text-left"
                                >
                                  {user.profile_picture_url ? (
                                    <img
                                      src={user.profile_picture_url}
                                      alt={user.name}
                                      className="h-5 w-5 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="h-5 w-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] text-gray-700">
                                      {user.name.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <span className="truncate">{user.name}</span>
                                </button>
                              ))}
                            </div>
                          )}

                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
                            >
                              <Paperclip className="h-4 w-4" />
                            </button>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*,video/*,application/pdf"
                              className="hidden"
                              onChange={e => {
                                const file = e.target.files?.[0] || null
                                setCommentFile(file)
                              }}
                            />
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={sendComment}
                            isLoading={isSendingComment}
                            disabled={!commentInput.trim() && !commentFile}
                          >
                            Send
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
                {/* IMAGE PREVIEW MODAL */}
      {previewImageUrl && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]">
          <button
            type="button"
            onClick={() => setPreviewImageUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={previewImageUrl}
            alt={previewImageName || 'Preview'}
            className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl"
          />
        </div>
      )}
            {/* DELETE TASK CONFIRMATION */}
      {taskToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <Card className="w-full max-w-md">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Delete Task
                </h3>
                <button
                  type="button"
                  onClick={() => setTaskToDelete(null)}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="text-sm text-gray-700 mb-2">
                Are you sure you want to delete the task{' '}
                <span className="font-semibold">
                  "{taskToDelete.title}"
                </span>
                ?
              </p>
              <p className="text-xs text-gray-500 mb-4">
                This will remove the task and all its comments, assignees and
                related items. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setTaskToDelete(null)}
                  disabled={isDeletingTask}
                >
                  Cancel
                </Button>
                <Button
                  onClick={deleteTask}
                  isLoading={isDeletingTask}
                  className="bg-red-600 hover:bg-red-500"
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
        </div>
      )}
    </DashboardLayout>
  )
}