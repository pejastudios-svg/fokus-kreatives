/* eslint-disable @next/next/no-img-element */
// src/app/approvals/[id]/page.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { createClient } from '@/lib/supabase/client'
import { RealtimeChannel } from '@supabase/supabase-js'
import { AssetRenderer, type AssetRendererHandle } from '@/components/approvals/AssetRenderer'
import { formatTimestamp } from '@/lib/types/annotations'
import {
  Loader2,
  X,
  MessageCircle,
  Paperclip,
  Copy,
  Pencil,
  Clock as ClockIcon,
  Pen as PenIcon,
} from 'lucide-react'

interface ApprovalDetail {
  id: string
  client_id: string
  title: string
  description: string | null
  status: string
  clickup_task_id: string | null
  clickup_task_name: string | null
  auto_approve_at: string | null
  created_at: string
  clients?: {
    name: string
    business_name: string
  }
}

interface CloudinaryAttachment {
  public_id: string
  secure_url: string
  resource_type: 'image' | 'video'
  format: string
  width: number
  height: number
  duration?: number
  bytes: number
  name: string
}

interface ApprovalItem {
  id: string
  approval_id: string
  title: string
  url: string
  initial_comment: string | null
  status: string
  position: number
  created_at: string
  attachments?: CloudinaryAttachment[]
  is_carousel?: boolean
  kind?: 'url' | 'image' | 'video' | 'mixed'
}

interface Assignee {
  id: string
  role: string
  user_id: string
  users?: {
    name: string
    email: string
    profile_picture_url: string | null
  } | null
}

interface Comment {
  id: string
  approval_id: string
  approval_item_id: string | null
  user_id: string
  content: string
  file_url: string | null
  file_name: string | null
  resolved: boolean
  parent_comment_id: string | null
  created_at: string
  timestamp_seconds: number | null
  region: import('@/lib/types/annotations').CommentRegion | null
  attachment_index: number | null
  users?: {
    name: string
    email: string
    profile_picture_url: string | null
  } | null
}

function getEmbedUrl(url: string): string {
  if (!url) return ''
  // Basic Google Drive "file/d/ID/view" → "file/d/ID/preview"
  if (url.includes('drive.google.com')) {
    const match = url.match(/\/file\/d\/([^/]+)/)
    if (match && match[1]) {
      return `https://drive.google.com/file/d/${match[1]}/preview`
    }
  }
  return url
}

export default function PortalApprovalDetailPage() {
  const params = useParams()
  const approvalId = params.id as string
  const supabase = createClient()

  const [approval, setApproval] = useState<ApprovalDetail | null>(null)
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)

  // Editing item
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editItemTitle, setEditItemTitle] = useState('')
  const [editItemUrl, setEditItemUrl] = useState('')
  const [editItemComment, setEditItemComment] = useState('')

  // Comments
  const [newCommentText, setNewCommentText] = useState<Record<string, string>>({})
  const [commentFile, setCommentFile] = useState<File | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewImageName, setPreviewImageName] = useState<string | null>(null)

  // AssetRenderer handles + pending annotation, mirroring the agency page so
  // a client commenting from the portal gets the same time-grab + region
  // highlight tooling agency reviewers have.
  const assetRendererRefs = useRef<Record<string, AssetRendererHandle | null>>({})
  const registerAssetRenderer = useCallback(
    (id: string, handle: AssetRendererHandle | null) => {
      assetRendererRefs.current[id] = handle
    },
    [],
  )
  const [pendingAnnotation, setPendingAnnotation] = useState<
    Record<
      string,
      {
        timestampSeconds?: number | null
        region?: import('@/lib/types/annotations').CommentRegion | null
        attachmentIndex: number | null
      }
    >
  >({})

  // Per-item refs to the composer textarea + scrollable comments list, used
  // for the phone-first scroll behaviours (Annotate -> asset, Use -> textbox,
  // Send -> latest message) and the new-comment preview bubble.
  const composerTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const commentsListRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [commentsAtBottom, setCommentsAtBottom] = useState<Record<string, boolean>>({})
  const [unreadPreview, setUnreadPreview] = useState<
    Record<string, { id: string; name: string; preview: string; avatar: string | null } | null>
  >({})
  const [pendingScrollToCommentId, setPendingScrollToCommentId] = useState<string | null>(null)

  const handleCommentsScroll = (itemId: string) => () => {
    const el = commentsListRefs.current[itemId]
    if (!el) return
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
    const atBottom = distanceFromBottom < 40
    setCommentsAtBottom((prev) =>
      prev[itemId] === atBottom ? prev : { ...prev, [itemId]: atBottom },
    )
    if (atBottom && unreadPreview[itemId]) {
      setUnreadPreview((prev) => ({ ...prev, [itemId]: null }))
    }
  }
  const scrollCommentsToBottom = (itemId: string) => {
    const el = commentsListRefs.current[itemId]
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const handleGrabTime = (itemId: string) => {
    const handle = assetRendererRefs.current[itemId]
    if (!handle) return
    const time = handle.getCurrentTime()
    if (time === null) {
      handle.scrollIntoView()
      alert('Play or seek the video first, then click Grab time.')
      return
    }
    handle.scrollIntoView()
    setPendingAnnotation((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] ?? { attachmentIndex: null }),
        timestampSeconds: time,
        attachmentIndex: handle.getActiveIndex(),
      },
    }))
  }
  const handleAnnotate = async (itemId: string, shape: 'circle' | 'freeform') => {
    const handle = assetRendererRefs.current[itemId]
    if (!handle) return
    handle.scrollIntoView()
    const result = await handle.enterDrawMode(shape)
    if (!result) return
    setPendingAnnotation((prev) => ({
      ...prev,
      [itemId]: {
        timestampSeconds:
          prev[itemId]?.timestampSeconds ?? result.timestampSeconds ?? null,
        region: result.region,
        attachmentIndex: handle.getActiveIndex(),
      },
    }))
    const ta = composerTextareaRefs.current[itemId]
    if (ta) {
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' })
      ta.focus({ preventScroll: true })
    }
  }
  const handleClearPending = (key: string) => {
    setPendingAnnotation((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }
  const handleClearPendingField = (
    key: string,
    field: 'timestampSeconds' | 'region',
  ) => {
    setPendingAnnotation((prev) => {
      const cur = prev[key]
      if (!cur) return prev
      const next = { ...cur, [field]: null }
      if (!next.timestampSeconds && !next.region) {
        const out = { ...prev }
        delete out[key]
        return out
      }
      return { ...prev, [key]: next }
    })
  }
  const handleFocusComment = (
    itemId: string | null,
    timestampSeconds: number | null,
    attachmentIndex: number | null,
    region: import('@/lib/types/annotations').CommentRegion | null = null,
  ) => {
    if (!itemId) return
    const handle = assetRendererRefs.current[itemId]
    if (!handle) return
    handle.focusAnnotation({ attachmentIndex, timestampSeconds, region })
  }
  const [sendingCommentForItem, setSendingCommentForItem] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState<string>('')
  const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(null)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [pendingDeleteComment, setPendingDeleteComment] = useState<Comment | null>(null)
  const [mentionTargetItemId, setMentionTargetItemId] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string>('')
  const [replyTarget, setReplyTarget] = useState<{
  itemId: string | null
  commentId: string
  userName: string
} | null>(null)

  // Mark which comments we've already shown so a new arrival via realtime
  // can be flagged as a preview bubble.
  const seenCommentIdsRef = useRef<Set<string>>(new Set())
  const seenInitialisedRef = useRef(false)
  useEffect(() => {
    if (!seenInitialisedRef.current) {
      for (const c of comments) {
        if (!c.id.startsWith('temp-')) seenCommentIdsRef.current.add(c.id)
      }
      seenInitialisedRef.current = true
      return
    }
    for (const c of comments) {
      if (c.id.startsWith('temp-')) continue
      if (seenCommentIdsRef.current.has(c.id)) continue
      seenCommentIdsRef.current.add(c.id)
      if (c.user_id === currentUserId) continue
      const itemKey = c.approval_item_id || 'general'
      const atBottom = commentsAtBottom[itemKey] !== false
      if (atBottom) continue
      setUnreadPreview((prev) => ({
        ...prev,
        [itemKey]: {
          id: c.id,
          name: c.users?.name || c.users?.email || 'Someone',
          preview: (c.content || '').slice(0, 60),
          avatar: c.users?.profile_picture_url || null,
        },
      }))
    }
  }, [comments, currentUserId, commentsAtBottom])

  useEffect(() => {
    if (!pendingScrollToCommentId) return
    const target = comments.find((c) => c.id === pendingScrollToCommentId)
    if (!target) return
    const itemKey = target.approval_item_id || 'general'
    requestAnimationFrame(() => scrollCommentsToBottom(itemKey))
    setPendingScrollToCommentId(null)
  }, [pendingScrollToCommentId, comments])

  // On first paint after the page hydrates, jump each item's comments list to
  // the bottom so the latest message is visible without manual scrolling.
  const initialScrollDoneRef = useRef(false)
  useEffect(() => {
    if (initialScrollDoneRef.current) return
    if (isLoading) return
    if (comments.length === 0) return
    initialScrollDoneRef.current = true
    requestAnimationFrame(() => {
      for (const itemId of Object.keys(commentsListRefs.current)) {
        const el = commentsListRefs.current[itemId]
        if (el) el.scrollTop = el.scrollHeight
      }
    })
  }, [isLoading, comments])

  useEffect(() => {
    let channel: RealtimeChannel | null = null

    const run = async () => {
    await init()

    channel = supabase
      .channel(`portal-approval-live-${approvalId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'approval_comments',
          filter: `approval_id=eq.${approvalId}`,
        },
        // Apply the change directly from the realtime payload so the message
        // shows up the instant the websocket delivers it, instead of paying
        // for a full re-fetch round-trip. loadComments() runs as a backfill
        // for INSERT (the payload doesn't carry the users join, so the
        // avatar/name only land after the backfill resolves).
        (payload) => {
          const evt = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'
          if (evt === 'DELETE') {
            const oldId = (payload.old as { id?: string } | null)?.id
            if (oldId) setComments((prev) => prev.filter((c) => c.id !== oldId))
            return
          }
          const row = payload.new as Partial<Comment> & { id: string }
          if (evt === 'INSERT') {
            setComments((prev) => {
              if (prev.some((c) => c.id === row.id)) return prev
              const hasOptimistic = prev.some(
                (c) =>
                  c.id.startsWith('temp-') &&
                  c.user_id === (row.user_id ?? null) &&
                  c.content === row.content,
              )
              if (hasOptimistic) return prev
              return [...prev, { ...(row as Comment), users: null }]
            })
            loadComments()
            return
          }
          setComments((prev) =>
            prev.map((c) => (c.id === row.id ? { ...c, ...row } : c)),
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'approval_items',
          filter: `approval_id=eq.${approvalId}`,
        },
        () => {
          loadItems()
          loadApproval()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'approvals',
          filter: `id=eq.${approvalId}`,
        },
        () => loadApproval()
      )
      .subscribe()
  }

  run()

  return () => {
    if (channel) supabase.removeChannel(channel)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [approvalId])

  const init = async () => {
  setIsLoading(true)
  try {
    // load user, role, approval, items, assignees, comments
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setIsLoading(false)
      return
    }
    setCurrentUserId(user.id)

    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    setCurrentUserRole(userRow?.role || null)

    await Promise.all([loadApproval(), loadItems(), loadAssignees(), loadComments()])
  } finally {
    setIsLoading(false)
  }
}

  const loadApproval = async () => {
    const { data, error } = await supabase
      .from('approvals')
      .select(
        'id, client_id, title, description, status, clickup_task_id, clickup_task_name, auto_approve_at, created_at, clients(name, business_name)'
      )
      .eq('id', approvalId)
      .single()

    if (error) {
      console.error('Load approval detail error:', error)
      return
    }

    const mapped: ApprovalDetail = {
      id: data.id,
      client_id: data.client_id,
      title: data.title,
      description: data.description,
      status: data.status,
      clickup_task_id: data.clickup_task_id,
      clickup_task_name: data.clickup_task_name,
      auto_approve_at: data.auto_approve_at,
      created_at: data.created_at,
      clients: Array.isArray(data.clients) ? data.clients[0] : data.clients,
    }

    setApproval(mapped)
  }

  const loadItems = async () => {
    const { data, error } = await supabase
      .from('approval_items')
      .select('*')
      .eq('approval_id', approvalId)
      .order('position', { ascending: true })

    if (error) {
      console.error('Load approval items error:', error)
      return
    }

    setItems(data || [])
  }

  const loadAssignees = async () => {
    const { data, error } = await supabase
      .from('approval_assignees')
      .select('id, role, user_id, users(name, email, profile_picture_url)')
      .eq('approval_id', approvalId)

    if (error) {
      console.error('Load assignees error:', error)
      return
    }

    type AssigneeRow = {
      id: string
      role: string
      user_id: string
      users: { name: string; email: string; profile_picture_url: string | null } | { name: string; email: string; profile_picture_url: string | null }[] | null
    }

    const mapped: Assignee[] = ((data as unknown) as AssigneeRow[] || []).map((row) => ({
      id: row.id,
      role: row.role,
      user_id: row.user_id,
      users: Array.isArray(row.users) ? row.users[0] : row.users,
    }))

    setAssignees(mapped)
  }

  const loadComments = async () => {
    const { data, error } = await supabase
      .from('approval_comments')
      .select(
        'id, approval_id, approval_item_id, user_id, content, file_url, file_name, resolved, parent_comment_id, created_at, timestamp_seconds, region, attachment_index, users(name, email, profile_picture_url)'
      )
      .eq('approval_id', approvalId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Load comments error:', error)
      return
    }

    type CommentRow = {
      id: string
      approval_id: string
      approval_item_id: string | null
      user_id: string
      content: string
      file_url: string | null
      file_name: string | null
      resolved: boolean
      parent_comment_id: string | null
      created_at: string
      timestamp_seconds: number | null
      region: import('@/lib/types/annotations').CommentRegion | null
      attachment_index: number | null
      users: { name: string; email: string; profile_picture_url: string | null } | { name: string; email: string; profile_picture_url: string | null }[] | null
    }

    const mapped: Comment[] = ((data as unknown) as CommentRow[] || []).map((row) => ({
      id: row.id,
      approval_id: row.approval_id,
      approval_item_id: row.approval_item_id,
      user_id: row.user_id,
      content: row.content,
      file_url: row.file_url,
      file_name: row.file_name,
      resolved: row.resolved,
      parent_comment_id: row.parent_comment_id,
      created_at: row.created_at,
      timestamp_seconds: row.timestamp_seconds,
      region: row.region,
      attachment_index: row.attachment_index,
      users: Array.isArray(row.users) ? row.users[0] : row.users,
    }))

    setComments(mapped)
  }

  const mentionUsers = Array.from(
  new Map(
    (assignees || [])
      .filter((a) => a.users)
      .map((a) => [
        a.user_id,
        {
          id: a.user_id,
          name: a.users!.name || a.users!.email || 'User',
          profile_picture_url: a.users!.profile_picture_url || null,
        },
      ])
  ).values()
)

  const canEditItems = currentUserRole && currentUserRole !== 'client'

  // --- New Edit Item Functions ---
  const startEditItem = (item: ApprovalItem) => {
    setEditingItemId(item.id)
    setEditItemTitle(item.title)
    setEditItemUrl(item.url)
    setEditItemComment(item.initial_comment || '')
  }

  const cancelEditItem = () => {
    setEditingItemId(null)
    setEditItemTitle('')
    setEditItemUrl('')
    setEditItemComment('')
  }

  const saveItem = async () => {
    if (!editingItemId) return

    try {
      const { error } = await supabase
        .from('approval_items')
        .update({
          title: editItemTitle,
          url: editItemUrl,
          initial_comment: editItemComment,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingItemId)

      if (error) {
        console.error('Update item error:', error)
        alert('Failed to update item')
      } else {
        await loadItems()
        cancelEditItem()
      }
    } catch (err) {
      console.error('Update item exception', err)
      alert('Failed to update item')
    }
  }
  // -------------------------------

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      alert('Approval link copied to clipboard.')
    } catch (err) {
      console.error('Copy link error', err)
    }
  }

  const toggleItemStatus = async (item: ApprovalItem) => {
    if (!currentUserId) return

    const newStatus = item.status === 'approved' ? 'pending' : 'approved'

    // Optimistic update
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: newStatus } : i))
    )

    try {
      const { error } = await supabase
        .from('approval_items')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', item.id)

      if (error) {
        console.error('Toggle item status error:', error)
        await loadItems()
      } else {
        // If all items are approved, set approval to approved & sync ClickUp
        // If any item is pending, set approval to pending
        await fetch('/api/approvals/recompute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ approvalId, actorId: currentUserId }),
})
await loadApproval()
      }
    } catch (err) {
      console.error('Toggle item exception', err)
      await loadItems()
    }
  }

  const handleNewCommentChange = (itemId: string, value: string) => {
  setNewCommentText((prev) => ({ ...prev, [itemId]: value }))

  const parts = value.split(/\s/)
  const last = parts[parts.length - 1]
  if (last.startsWith('@') && last.length > 1) {
    setMentionTargetItemId(itemId)
    setMentionQuery(last.slice(1).toLowerCase())
  } else if (mentionTargetItemId === itemId) {
    setMentionTargetItemId(null)
    setMentionQuery('')
  }
}

  const sendComment = async (itemId: string | null) => {
  if (!currentUserId) return

  const key = itemId || 'general'
  const text = (newCommentText[key] || '').trim()
  if (!text && !commentFile) return

  setSendingCommentForItem(key)

  let fileUrl: string | null = null
  let fileName: string | null = null

  // Upload file if present
  if (commentFile) {
    const formData = new FormData()
    formData.append('file', commentFile)
    formData.append('folder', `approvals/${approvalId}/comments`)

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      const uploadData = await res.json()
      if (uploadData.success) {
        fileUrl = uploadData.url
        fileName = commentFile.name
      }
    } catch (err) {
      console.error('Comment file upload error:', err)
    }
  }

  const annotation = pendingAnnotation[key] || null

  try {
    const res = await fetch('/api/approvals/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvalId,
        approvalItemId: itemId,
        userId: currentUserId,
        content: text,
        fileUrl,
        fileName,
        parentCommentId:
          replyTarget && replyTarget.itemId === itemId
            ? replyTarget.commentId
            : null,
        timestampSeconds: annotation?.timestampSeconds ?? null,
        region: annotation?.region ?? null,
        attachmentIndex: annotation?.attachmentIndex ?? null,
      }),
    })

    const apiData = await res.json()
    if (!apiData.success) {
      console.error('Send comment API error:', apiData.error)
      alert('Failed to send comment')
    } else {
      setNewCommentText((prev) => ({ ...prev, [key]: '' }))
      setCommentFile(null)
      setReplyTarget((prev) =>
        prev && prev.itemId === itemId ? null : prev
      )
      handleClearPending(key)
      // Realtime should refresh comments, but we can also reload
      await loadComments()
      // Scroll the per-item comments list to its bottom so the user
      // sees their just-sent bubble.
      requestAnimationFrame(() => scrollCommentsToBottom(key))
    }
  } catch (err) {
    console.error('Send comment exception', err)
    alert('Failed to send comment')
  } finally {
    setSendingCommentForItem(null)
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

    try {
      const { error } = await supabase
        .from('approval_comments')
        .update({
          content: editingCommentText.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingCommentId)

      if (error) {
        console.error('Edit comment error:', error)
        alert('Failed to save comment')
      } else {
        await loadComments()
        cancelEditComment()
      }
    } catch (err) {
      console.error('Edit comment exception', err)
      alert('Failed to save comment')
    }
  }

  const toggleResolveComment = async (comment: Comment) => {
    const nextResolved = !comment.resolved
    setResolvingCommentId(comment.id)
    try {
      const { error } = await supabase
        .from('approval_comments')
        .update({
          resolved: nextResolved,
          updated_at: new Date().toISOString(),
        })
        .eq('id', comment.id)

      if (error) {
        console.error('Resolve comment error:', error)
        alert('Failed to update')
      } else {
        await loadComments()
        if (nextResolved) {
          if (comment.approval_item_id) {
            assetRendererRefs.current[comment.approval_item_id]?.clearFlash()
          }
          // Fire-and-forget popup notification.
          void fetch('/api/approvals/notify-comment-resolved', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commentId: comment.id, actorId: currentUserId }),
          }).catch((e) => console.error('resolve notify failed:', e))
        }
      }
    } catch (err) {
      console.error('Resolve comment exception', err)
      alert('Failed to update')
    } finally {
      setResolvingCommentId(null)
    }
  }

  const deleteComment = async (comment: Comment) => {
    setDeletingCommentId(comment.id)
    try {
      const { error } = await supabase
        .from('approval_comments')
        .delete()
        .eq('id', comment.id)

      if (error) {
        console.error('Delete comment error:', error)
        alert('Failed to delete')
      } else {
        await loadComments()
      }
    } catch (err) {
      console.error('Delete comment exception', err)
      alert('Failed to delete')
    } finally {
      setDeletingCommentId(null)
    }
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

  if (isLoading || !approval) {
    return (
  <PortalLayout>
        <Header title="Approval Detail" />
            <div className="p-8 max-w-4xl mx-auto space-y-6 overflow-x-hidden">

          <Card>
            <CardContent className="py-10 text-center text-[var(--text-tertiary)]">
              <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
              Loading approval...
            </CardContent>
          </Card>
        </div>
      </PortalLayout>
    )
  }

  const clientName =
    approval.clients?.business_name || approval.clients?.name || 'Client'
  const createdDate = new Date(approval.created_at).toLocaleString()
  const autoApproveStr = approval.auto_approve_at
    ? new Date(approval.auto_approve_at).toLocaleString()
    : null

  const commentsByItem: Record<string, Comment[]> = {}
  comments.forEach((c) => {
    const key = c.approval_item_id || 'general'
    if (!commentsByItem[key]) commentsByItem[key] = []
    commentsByItem[key].push(c)
  })

  return (
    <PortalLayout>
      <Header
        title={approval.title}
        subtitle={`${clientName} · Created ${createdDate}`}
      />
      <div className="p-8 max-w-4xl mx-auto space-y-6 overflow-x-hidden">
        {/* Top card */}
        <Card>
  <CardContent className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
  <div className="flex-1 min-w-0">
      {approval.description && (
        <p className="text-sm text-[var(--text-secondary)] mb-1 whitespace-pre-wrap break-all">
          {approval.description}
        </p>
      )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-tertiary)]">
                <span>
                  Status:{' '}
                  {approval.status === 'approved'
                    ? '✅ APPROVED'
                    : '⏳ WAITING FOR FEEDBACK'}
                </span>
                {autoApproveStr && (
                  <span>· Auto-approve at {autoApproveStr}</span>
                )}
                {approval.clickup_task_id && (
                  <span>
                    · ClickUp:{' '}
                    {approval.clickup_task_name || approval.clickup_task_id}
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
              >
                <Copy className="h-4 w-4 mr-1" />
                Copy Link
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Assets */}
        <div className="space-y-4">
          {items.map((item) => {
            const isApproved = item.status === 'approved'
            const itemComments = commentsByItem[item.id] || []

            return (
              <Card key={item.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-3 break-all">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] break-all">
                      {item.title || 'Untitled asset'}
                    </h3>
                    {item.initial_comment && (
                      <p className="text-xs text-[var(--text-tertiary)] mt-1 whitespace-pre-wrap break-all">
                        {item.initial_comment}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        isApproved
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {isApproved ? 'Approved' : 'Pending'}
                    </span>
                    
                    {/* EDIT BUTTON (Fixes canEditItems unused error) */}
                    {canEditItems && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditItem(item)}
                        disabled={editingItemId === item.id}
                        className="h-8 w-8 p-0"
                      >
                        <Pencil className="h-4 w-4 text-[var(--text-tertiary)]" />
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleItemStatus(item)}
                    >
                      {isApproved ? 'Un-approve' : 'Approve'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Video/Image embed */}
                  <div className="w-full rounded-lg overflow-hidden border border-[var(--border-primary)] bg-black">
                    {editingItemId === item.id ? (
                      <div className="space-y-3 p-3 bg-[var(--bg-card)]">
                        <Input
                          label="Title"
                          value={editItemTitle}
                          onChange={(e) => setEditItemTitle(e.target.value)}
                          placeholder="Asset title"
                        />
                        <Input
                          label="URL"
                          value={editItemUrl}
                          onChange={(e) => setEditItemUrl(e.target.value)}
                          placeholder="https://drive.google.com/..."
                        />
                        <div>
                          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                            Comment
                          </label>
                          <textarea
                            value={editItemComment}
                            onChange={(e) =>
                              setEditItemComment(e.target.value)
                            }
                            rows={3}
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                          />
                        </div>
                        {/* SAVE / CANCEL BUTTONS (Fixes setEditingItemId unused error) */}
                        <div className="flex justify-end gap-2 mt-2">
                           <Button 
                             size="sm" 
                             variant="outline" 
                             onClick={cancelEditItem}
                           >
                             Cancel
                           </Button>
                           <Button 
                             size="sm" 
                             onClick={saveItem}
                           >
                             Save Changes
                           </Button>
                        </div>
                      </div>
                    ) : item.attachments && item.attachments.length > 0 ? (
                      <div className="p-3">
                        <AssetRendererSlot
                          itemId={item.id}
                          onRegister={registerAssetRenderer}
                          attachments={item.attachments}
                          isCarousel={!!item.is_carousel}
                          onImageClick={(url, name) => {
                            setPreviewImageUrl(url)
                            setPreviewImageName(name)
                          }}
                        />
                      </div>
                    ) : (
                      <iframe
                        src={getEmbedUrl(item.url)}
                        className="w-full h-64 md:h-80 border-0"
                        allowFullScreen
                      />
                    )}
                  </div>

                  {/* Comments */}
                  <div className="border-t border-[var(--border-primary)] pt-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-[var(--text-tertiary)]" />
                      <span className="text-xs font-semibold text-[var(--text-secondary)]">
                        Comments ({itemComments.length})
                      </span>
                    </div>

                    <div
                      ref={(el) => {
                        commentsListRefs.current[item.id] = el
                      }}
                      onScroll={handleCommentsScroll(item.id)}
                      className="relative space-y-3 max-h-64 overflow-y-auto overscroll-contain touch-pan-y"
                    >
                      {itemComments.length === 0 ? (
                        <p className="text-xs text-[var(--text-tertiary)]">
                          No comments yet.
                        </p>
                      ) : (
                        itemComments.map((c) => {
                          const isOwner = c.user_id === currentUserId
                          return (
                            <div
                              key={c.id}
                              className={`flex items-start gap-2 text-xs border border-[var(--border-primary)] rounded-lg p-2 ${
                                c.resolved ? 'bg-green-50' : 'bg-[var(--bg-tertiary)]'
                              }`}
                            >
                              <div className="mt-0.5">
                                {c.users?.profile_picture_url ? (
                                  <img
                                    src={c.users.profile_picture_url}
                                    alt={c.users.name || ''}
                                    className="h-6 w-6 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="h-6 w-6 rounded-full bg-brand-gradient flex items-center justify-center text-white text-[10px] font-semibold">
                                    {(c.users?.name || c.users?.email || 'U')
                                      .charAt(0)
                                      .toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <p className="font-semibold text-[var(--text-primary)] truncate">
                                    {c.users?.name || c.users?.email || 'User'}
                                  </p>
                                  <span className="text-[10px] text-[var(--text-tertiary)]">
                                    {new Date(
                                      c.created_at
                                    ).toLocaleString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                                {editingCommentId === c.id ? (
                                  <div className="mt-1 space-y-1">
                                    <textarea
                                      value={editingCommentText}
                                      onChange={(e) =>
                                        setEditingCommentText(e.target.value)
                                      }
                                      rows={2}
                                      className="w-full px-2 py-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#2B79F7] resize-none"
                                    />
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={cancelEditComment}
                                      >
                                        Cancel
                                      </Button>
                                      <Button size="sm" onClick={saveEditComment}>
                                        Save
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {/* Reply preview if this comment is a reply */}
                                    {c.parent_comment_id && (() => {
                                      const parent = comments.find((p) => p.id === c.parent_comment_id)
                                      if (!parent) return null
                                      const parentAuthor = parent.users?.name || parent.users?.email || 'User'
                                      const snippet = parent.content.length > 80
                                        ? parent.content.slice(0, 80) + '...'
                                        : parent.content

                                      return (
                                        <div className="mb-1 px-2 py-1 bg-[var(--bg-tertiary)] rounded text-[10px] text-[var(--text-tertiary)]">
                                          Replying to <span className="font-semibold">{parentAuthor}</span>:
                                          {' '}
                                          <span className="italic">&quot;{snippet}&quot;</span>
                                        </div>
                                      )
                                    })()}

                                    {(c.timestamp_seconds != null || c.region) && (
                                      <div className="mt-0.5 flex flex-wrap gap-1">
                                        {c.timestamp_seconds != null && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleFocusComment(
                                                c.approval_item_id,
                                                c.timestamp_seconds,
                                                c.attachment_index,
                                                c.region,
                                              )
                                            }
                                            title="Jump to this moment"
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] text-[10px] font-medium hover:bg-[#D6E5FF] transition-colors"
                                          >
                                            <ClockIcon className="h-3 w-3" />
                                            {formatTimestamp(c.timestamp_seconds)}
                                          </button>
                                        )}
                                        {c.region && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleFocusComment(
                                                c.approval_item_id,
                                                c.timestamp_seconds,
                                                c.attachment_index,
                                                c.region,
                                              )
                                            }
                                            title="Show the highlighted region"
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] text-[10px] font-medium hover:bg-[#D6E5FF] transition-colors"
                                          >
                                            <PenIcon className="h-3 w-3" />
                                            View highlight
                                          </button>
                                        )}
                                      </div>
                                    )}
                                    <p className="mt-0.5 text-[var(--text-secondary)] break-all">
                                      {formatComment(c.content)}
                                    </p>
                                    {c.file_url && (
                                      <div className="mt-1">
                                        {(() => {
                                          const name = c.file_name || c.file_url
                                          const isImage = /\.(png|jpe?g|gif|webp)$/i.test(name)

                                          if (isImage) {
                                            return (
                                              <div className="space-y-1">
                                                <img
                                                  src={c.file_url || ''}
                                                  alt={c.file_name || 'Image'}
                                                  className="max-h-40 rounded-lg border border-[var(--border-primary)] cursor-pointer"
                                                  onClick={() => {
                                                    setPreviewImageUrl(c.file_url!)
                                                    setPreviewImageName(c.file_name || 'Image')
                                                  }}
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setPreviewImageUrl(c.file_url!)
                                                    setPreviewImageName(c.file_name || 'Image')
                                                  }}
                                                  className="inline-flex items-center gap-1 text-[11px] text-[#2B79F7] hover:underline"
                                                >
                                                  <Paperclip className="h-3 w-3" />
                                                  <span>{c.file_name || 'View image'}</span>
                                                </button>
                                              </div>
                                            )
                                          }

                                          return (
                                            <a
                                              href={c.file_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-1 text-[11px] text-[#2B79F7] hover:underline"
                                            >
                                              <Paperclip className="h-3 w-3" />
                                              <span>{c.file_name || 'Attachment'}</span>
                                            </a>
                                          )
                                        })()}
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-tertiary)]">
                                      <button
                                        type="button"
                                        onClick={() => toggleResolveComment(c)}
                                        className={`px-2 py-0.5 rounded-full border ${
                                          c.resolved
                                            ? 'border-green-500 text-green-600 bg-green-50'
                                            : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[#2B79F7]'
                                        }`}
                                        disabled={resolvingCommentId === c.id}
                                      >
                                        {c.resolved ? 'Resolved' : 'Mark resolved'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setReplyTarget({
                                            itemId: item.id,
                                            commentId: c.id,
                                            userName: c.users?.name || c.users?.email || 'User',
                                          })
                                        }
                                        className="hover:text-[#2B79F7]"
                                      >
                                        Reply
                                      </button>
                                      {isOwner && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => startEditComment(c)}
                                            className="hover:text-[#2B79F7]"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setPendingDeleteComment(c)}
                                            className="hover:text-red-500"
                                            disabled={deletingCommentId === c.id}
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
                          )
                        })
                      )}
                    </div>

                    {/* New-comment preview bubble - same as agency. */}
                    {unreadPreview[item.id] && (
                      <button
                        type="button"
                        onClick={() => {
                          scrollCommentsToBottom(item.id)
                          setUnreadPreview((prev) => ({ ...prev, [item.id]: null }))
                        }}
                        aria-label={`Jump to new comment from ${unreadPreview[item.id]!.name}`}
                        className="group flex items-center gap-2 mt-1 pl-1 pr-3 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--border-primary)] shadow-md text-[11px] text-[var(--text-secondary)] hover:border-[#2B79F7] hover:shadow-lg transition-all animate-in fade-in slide-in-from-bottom-1 duration-200"
                      >
                        {unreadPreview[item.id]!.avatar ? (
                          <img
                            src={unreadPreview[item.id]!.avatar!}
                            alt=""
                            className="h-6 w-6 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <span className="h-6 w-6 rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                            {(unreadPreview[item.id]!.name || 'U').charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="font-semibold truncate max-w-[80px]">
                          {unreadPreview[item.id]!.name.split(' ')[0]}
                        </span>
                        <span className="text-[var(--text-tertiary)] truncate max-w-[180px]">
                          {unreadPreview[item.id]!.preview || 'sent an attachment'}
                        </span>
                      </button>
                    )}

                    {/* New comment input */}
                    <div className="border border-[var(--border-primary)] rounded-lg p-2 space-y-2">
                      {replyTarget && replyTarget.itemId === item.id && (
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                          Replying to <span className="font-semibold">{replyTarget.userName}</span>
                          {' '}
                          <button
                            type="button"
                            onClick={() => setReplyTarget(null)}
                            className="text-red-500 hover:underline ml-1"
                          >
                            Cancel
                          </button>
                        </p>
                      )}
                      <div className="relative">
                        <textarea
                          ref={(el) => {
                            composerTextareaRefs.current[item.id] = el
                          }}
                          value={newCommentText[item.id] || ''}
                          onChange={(e) =>
                            handleNewCommentChange(item.id, e.target.value)
                          }
                          rows={2}
                          onFocus={() => {
                            // Mobile keyboard fix: re-scroll into view once
                            // the keyboard finishes animating so it doesn't
                            // sit on top of the composer.
                            setTimeout(() => {
                              composerTextareaRefs.current[item.id]?.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                              })
                            }, 300)
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                          placeholder="Leave a comment... use @name to tag someone."
                        />
                        {mentionTargetItemId === item.id && mentionQuery && (
                          <div className="absolute bottom-full left-0 right-0 mb-1 z-20 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-card)] shadow-lg text-[11px] max-h-40 overflow-y-auto">
                            {mentionUsers
                              .filter((u) =>
                                u.name.toLowerCase().includes(mentionQuery)
                              )
                              .slice(0, 5)
                              .map((u) => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => {
                                    const current = newCommentText[item.id] || ''
                                    const parts = current.split(/\s/)
                                    parts[parts.length - 1] = '@' + u.name.split(' ')[0]
                                    const next = parts.join(' ') + ' '
                                    setNewCommentText((prev) => ({
                                      ...prev,
                                      [item.id]: next,
                                    }))
                                    setMentionTargetItemId(null)
                                    setMentionQuery('')
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--bg-tertiary)] text-left"
                                >
                                  {u.profile_picture_url ? (
                                    <img
                                      src={u.profile_picture_url}
                                      alt={u.name}
                                      className="h-4 w-4 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="h-4 w-4 rounded-full bg-[var(--bg-card-hover)] flex items-center justify-center text-[9px] text-[var(--text-secondary)]">
                                      {u.name.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <span className="truncate">{u.name}</span>
                                </button>
                              ))}
                            {mentionUsers.filter((u) =>
                              u.name.toLowerCase().includes(mentionQuery)
                            ).length === 0 && (
                              <p className="px-2 py-1 text-[var(--text-tertiary)]">
                                No matches
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      {commentFile && (
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                          Attached: {commentFile.name}{' '}
                          <button
                            type="button"
                            onClick={() => setCommentFile(null)}
                            className="text-red-500 hover:underline"
                          >
                            Remove
                          </button>
                        </p>
                      )}
                      {pendingAnnotation[item.id] && (pendingAnnotation[item.id].timestampSeconds || pendingAnnotation[item.id].region) && (
                        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] flex-wrap">
                          <span>Tagged:</span>
                          {pendingAnnotation[item.id].timestampSeconds != null && (
                            <button
                              type="button"
                              onClick={() => handleClearPendingField(item.id, 'timestampSeconds')}
                              title="Remove timestamp"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] font-medium hover:bg-[#D6E5FF] transition-colors"
                            >
                              <ClockIcon className="h-3 w-3" />
                              {formatTimestamp(pendingAnnotation[item.id].timestampSeconds!)}
                              <X className="h-3 w-3" />
                            </button>
                          )}
                          {pendingAnnotation[item.id].region && (
                            <button
                              type="button"
                              onClick={() => handleClearPendingField(item.id, 'region')}
                              title="Remove highlight"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] font-medium hover:bg-[#D6E5FF] transition-colors"
                            >
                              <PenIcon className="h-3 w-3" />
                              {pendingAnnotation[item.id].region!.shape === 'circle' ? 'Circle' : 'Highlight'}
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] cursor-pointer">
                            <Paperclip className="h-3 w-3" />
                            <span>Attach file</span>
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0] || null
                                setCommentFile(file)
                              }}
                            />
                          </label>
                          {item.attachments && item.attachments.length > 0 && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleGrabTime(item.id)}
                                title="Grab the current playback time"
                                className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[#2B79F7] transition-colors"
                              >
                                <ClockIcon className="h-3 w-3" />
                                <span>Grab time</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAnnotate(item.id, 'circle')}
                                title="Draw a region on the asset"
                                className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[#2B79F7] transition-colors"
                              >
                                <PenIcon className="h-3 w-3" />
                                <span>Annotate</span>
                              </button>
                            </>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => sendComment(item.id)}
                          isLoading={sendingCommentForItem === item.id}
                          disabled={
                            !commentFile &&
                            !(newCommentText[item.id] || '').trim()
                          }
                        >
                          Send
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
        {previewImageUrl && (
  <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
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
      </div>
      <ConfirmModal
        open={!!pendingDeleteComment}
        title="Delete this comment?"
        message="This will permanently remove your comment for everyone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          const target = pendingDeleteComment
          if (!target) return
          await deleteComment(target)
          setPendingDeleteComment(null)
        }}
        onClose={() => setPendingDeleteComment(null)}
      />
    </PortalLayout>
  )
}

/**
 * Stable wrapper around AssetRenderer - keeps the imperative-handle callback
 * ref identity-stable per item, so React doesn't churn the registration on
 * every parent render. Mirrors the agency page's slot.
 */
interface AssetRendererSlotProps {
  itemId: string
  onRegister: (id: string, handle: AssetRendererHandle | null) => void
  attachments: CloudinaryAttachment[]
  isCarousel: boolean
  onImageClick?: (url: string, name: string) => void
}

function AssetRendererSlot({
  itemId,
  onRegister,
  attachments,
  isCarousel,
  onImageClick,
}: AssetRendererSlotProps) {
  const setRef = useCallback(
    (handle: AssetRendererHandle | null) => {
      onRegister(itemId, handle)
    },
    [itemId, onRegister],
  )
  return (
    <AssetRenderer
      ref={setRef}
      attachments={attachments}
      isCarousel={isCarousel}
      onImageClick={onImageClick}
    />
  )
}