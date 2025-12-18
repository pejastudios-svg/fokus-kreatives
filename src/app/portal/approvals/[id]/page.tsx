// src/app/approvals/[id]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import {
  Loader2,
  CheckCircle,
  Clock,
  Edit3,
  Save,
  X,
  Trash2,
  MessageCircle,
  Paperclip,
  Copy,
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

interface ApprovalItem {
  id: string
  approval_id: string
  title: string
  url: string
  initial_comment: string | null
  status: string
  position: number
  created_at: string
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
  const [sendingCommentForItem, setSendingCommentForItem] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState<string>('')
  const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(null)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [mentionTargetItemId, setMentionTargetItemId] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string>('')
  const [replyTarget, setReplyTarget] = useState<{
  itemId: string | null
  commentId: string
  userName: string
} | null>(null)

  useEffect(() => {
  let channel: any = null

  const run = async () => {
    await init() // portal version: loads approval, items, assignees, comments, and user

    channel = supabase
      .channel(`portal-approval-comments-${approvalId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'approval_comments',
          filter: `approval_id=eq.${approvalId}`,
        },
        () => {
          loadComments()
        }
      )
      .subscribe()
  }

  run()

  return () => {
    if (channel) {
      supabase.removeChannel(channel)
    }
  }
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

  const mapped: Assignee[] = (data || []).map((row: any) => ({
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
      'id, approval_id, approval_item_id, user_id, content, file_url, file_name, resolved, parent_comment_id, created_at, users(name, email, profile_picture_url)'
    )
    .eq('approval_id', approvalId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Load comments error:', error)
    return
  }

  const mapped: Comment[] = (data || []).map((row: any) => ({
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
        const finalItems = await supabase
          .from('approval_items')
          .select('status')
          .eq('approval_id', approvalId)

        const allApproved =
          finalItems.data?.length &&
          finalItems.data.every((i: any) => i.status === 'approved')

        await fetch('/api/approvals/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvalId,
            actorId: currentUserId,
            approved: allApproved,
          }),
        })
        await loadApproval()
      }
    } catch (err) {
      console.error('Toggle item exception', err)
      await loadItems()
    }
  }

  const startEditItem = (item: ApprovalItem) => {
    setEditingItemId(item.id)
    setEditItemTitle(item.title || '')
    setEditItemUrl(item.url || '')
    setEditItemComment(item.initial_comment || '')
  }

  const cancelEditItem = () => {
    setEditingItemId(null)
    setEditItemTitle('')
    setEditItemUrl('')
    setEditItemComment('')
  }

  const saveEditItem = async (itemId: string) => {
    if (!canEditItems) return

    const title = editItemTitle.trim()
    const url = editItemUrl.trim()
    const comment = editItemComment.trim()

    if (!url) {
      alert('URL is required')
      return
    }

    try {
      const { error } = await supabase
        .from('approval_items')
        .update({
          title: title || null,
          url,
          initial_comment: comment || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)

      if (error) {
        console.error('Save edit item error:', error)
        alert('Failed to save changes')
      } else {
        await loadItems()
        cancelEditItem()
      }
    } catch (err) {
      console.error('Save edit item exception', err)
      alert('Failed to save changes')
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
      // Realtime should refresh comments, but we can also reload
      await loadComments()
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
    setResolvingCommentId(comment.id)
    try {
      const { error } = await supabase
        .from('approval_comments')
        .update({
          resolved: !comment.resolved,
          updated_at: new Date().toISOString(),
        })
        .eq('id', comment.id)

      if (error) {
        console.error('Resolve comment error:', error)
        alert('Failed to update')
      } else {
        await loadComments()
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
            <CardContent className="py-10 text-center text-gray-500">
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
  <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 break-words">
    <div className="max-w-full">
      {approval.description && (
        <p className="text-sm text-gray-700 mb-1 whitespace-pre-wrap break-words">
          {approval.description}
        </p>
      )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
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
            <div className="flex items-center gap-2">
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
                <CardHeader className="flex flex-row items-center justify-between gap-3 break-words">
  <div className="flex-1 min-w-0">
    <h3 className="text-sm font-semibold text-gray-900 break-words">
      {item.title || 'Untitled asset'}
    </h3>
    {item.initial_comment && (
      <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap break-words">
        {item.initial_comment}
      </p>
    )}
  </div>
  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        isApproved
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {isApproved ? 'Approved' : 'Pending'}
                    </span>
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
                  <div className="w-full rounded-lg overflow-hidden border border-gray-200 bg-black">
                    {editingItemId === item.id ? (
                      <div className="space-y-3 p-3 bg-white">
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
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Comment
                          </label>
                          <textarea
                            value={editItemComment}
                            onChange={(e) =>
                              setEditItemComment(e.target.value)
                            }
                            rows={3}
                            className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                          />
                        </div>
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
                  <div className="border-t border-gray-200 pt-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-gray-500" />
                      <span className="text-xs font-semibold text-gray-700">
                        Comments ({itemComments.length})
                      </span>
                    </div>

                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {itemComments.length === 0 ? (
                        <p className="text-xs text-gray-400">
                          No comments yet.
                        </p>
                      ) : (
                        itemComments.map((c) => {
                          const isOwner = c.user_id === currentUserId
                          return (
                            <div
                              key={c.id}
                              className={`flex items-start gap-2 text-xs border border-gray-100 rounded-lg p-2 ${
                                c.resolved ? 'bg-green-50' : 'bg-gray-50'
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
                                  <p className="font-semibold text-gray-800 truncate">
                                    {c.users?.name || c.users?.email || 'User'}
                                  </p>
                                  <span className="text-[10px] text-gray-400">
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
                                      className="w-full px-2 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#2B79F7] resize-none"
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
        <div className="mb-1 px-2 py-1 bg-gray-100 rounded text-[10px] text-gray-500">
          Replying to <span className="font-semibold">{parentAuthor}</span>:
          {' '}
          <span className="italic">"{snippet}"</span>
        </div>
      )
    })()}

    <p className="mt-0.5 text-gray-700 break-words">
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
              className="max-h-40 rounded-lg border border-gray-200 cursor-pointer"
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
                                    <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
  <button
    type="button"
    onClick={() => toggleResolveComment(c)}
    className={`px-2 py-0.5 rounded-full border ${
      c.resolved
        ? 'border-green-500 text-green-600 bg-green-50'
        : 'border-gray-300 text-gray-500 hover:border-[#2B79F7]'
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
        onClick={() => deleteComment(c)}
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

                    {/* New comment input */}
                    <div className="border border-gray-200 rounded-lg p-2 space-y-2">
  {replyTarget && replyTarget.itemId === item.id && (
    <p className="text-[10px] text-gray-500">
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
  <textarea
    value={newCommentText[item.id] || ''}
    onChange={(e) =>
      handleNewCommentChange(item.id, e.target.value)
    }
    rows={2}
    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
    placeholder="Leave a comment... use @name to tag someone."
  />
  {mentionTargetItemId === item.id && mentionQuery && (
  <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-lg text-[11px] max-h-40 overflow-y-auto">
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
          className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 text-left"
        >
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
        </button>
      ))}
    {mentionUsers.filter((u) =>
      u.name.toLowerCase().includes(mentionQuery)
    ).length === 0 && (
      <p className="px-2 py-1 text-gray-400">
        No matches
      </p>
    )}
  </div>
)}
  {commentFile && (
    <p className="text-[10px] text-gray-500">
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
  <div className="flex items-center justify-between">
    <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
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
    </PortalLayout>
  )
}