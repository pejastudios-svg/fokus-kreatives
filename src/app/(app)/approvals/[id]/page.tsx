// src/app/approvals/[id]/page.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { readApprovalCache, writeApprovalCache } from '@/lib/approvalCache'
import { uploadWithProgress } from '@/lib/uploadWithProgress'
import { AssetRenderer, type AssetRendererHandle } from '@/components/approvals/AssetRenderer'
import { formatTimestamp } from '@/lib/types/annotations'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import { RealtimeChannel } from '@supabase/supabase-js'
import {
  Loader2,
  Edit3,
  Save,
  X,
  MessageCircle,
  Paperclip,
  Copy,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Send as SendIcon,
  Upload as UploadIcon,
  Video as VideoIcon,
  Image as ImageIcon,
  RefreshCw,
  Trash2 as TrashIcon,
  Clock as ClockIcon,
} from 'lucide-react'
import { cldThumb, destroyCloudinaryAssets } from '@/lib/cloudinary'

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
  share_token: string | null
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

interface CommentAttachment {
  url: string
  name: string
  size: number | null
}

interface Comment {
  id: string
  approval_id: string
  approval_item_id: string | null
  user_id: string | null
  content: string
  file_url: string | null
  file_name: string | null
  reviewer_email: string | null
  attachments: CommentAttachment[] | null
  resolved: boolean
  parent_comment_id: string | null
  created_at: string
  // Annotations (3a foundation; UI lands in 3b/3c).
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

interface ApprovalCachedSnapshot {
  approval: ApprovalDetail | null
  items: ApprovalItem[]
  assignees: Assignee[]
  comments: Comment[]
}

export default function ApprovalDetailPage() {
  const params = useParams()
  const approvalId = params.id as string | undefined
  // Single Supabase client per page instance. Without useMemo it gets re-created
  // on every render, which churns the realtime subscription and was a likely
  // cause of the loading-state flicker.
  const supabase = useMemo(() => createClient(), [])
  // Prevents init() from running twice in dev StrictMode (or being re-entered
  // before the first run finishes), which produces a true→false→true flicker.
  const initInFlightRef = useRef(false)

  // Edit-session attachment snapshots used to clean up orphaned Cloudinary
  // assets at Save/Cancel time. `original` is the item's attachments at the
  // moment Edit was opened; `fresh` collects every successful upload during
  // the session. On Save we destroy (original \ current); on Cancel we
  // destroy `fresh` (anything uploaded but never persisted).
  const editOriginalAttachmentsRef = useRef<CloudinaryAttachment[]>([])
  const editFreshUploadsRef = useRef<CloudinaryAttachment[]>([])

  // Hydrate from sessionStorage so navigating in/out of the page doesn't
  // re-render an empty skeleton. If we have cached data, the first paint
  // shows the page immediately and we silently revalidate in the background.
  const cachedInitial = useMemo<ApprovalCachedSnapshot | null>(() => {
    if (!approvalId) return null
    return readApprovalCache<ApprovalCachedSnapshot>(approvalId)
  }, [approvalId])

  const [approval, setApproval] = useState<ApprovalDetail | null>(
    cachedInitial?.approval ?? null,
  )
  const [items, setItems] = useState<ApprovalItem[]>(cachedInitial?.items ?? [])
  const [assignees, setAssignees] = useState<Assignee[]>(cachedInitial?.assignees ?? [])
  const [comments, setComments] = useState<Comment[]>(cachedInitial?.comments ?? [])
  // Skip the skeleton entirely on a cache hit - the page is already populated.
  const [isLoading, setIsLoading] = useState(!cachedInitial)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [currentUserProfile, setCurrentUserProfile] = useState<{
    name: string
    email: string
    profile_picture_url: string | null
  } | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const showToast = (kind: 'success' | 'error', text: string, ms = 2400) => {
    setToast({ kind, text })
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), ms)
  }

  // Editing item
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editItemTitle, setEditItemTitle] = useState('')
  const [editItemUrl, setEditItemUrl] = useState('')
  const [editItemComment, setEditItemComment] = useState('')
  const [editItemAttachments, setEditItemAttachments] = useState<CloudinaryAttachment[]>([])
  const [editItemIsCarousel, setEditItemIsCarousel] = useState(false)
  // Per-file upload progress while editing. `replaceIndex` is set when a file
  // is uploading to replace an existing attachment at that position, so we can
  // splice it in once the upload finishes.
  const [editItemUploads, setEditItemUploads] = useState<
    { id: string; name: string; pct: number; error?: string; replaceIndex?: number }[]
  >([])

  // Comments
  const [newCommentText, setNewCommentText] = useState<Record<string, string>>({})
  const [commentFile, setCommentFile] = useState<File | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  // Per-comment upload progress, keyed by the optimistic comment's tempId so a
  // user uploading on one item composer doesn't see progress on another.
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})

  // Imperative handles into each item's AssetRenderer, so we can `getCurrentTime`
  // when the user clicks "Grab time" and `focusAnnotation` when they click a
  // saved timestamp pill on an existing comment. Keyed by item id.
  const assetRendererRefs = useRef<Record<string, AssetRendererHandle | null>>({})

  // Annotations attached to the next comment, per composer (general + per-item).
  const [pendingAnnotation, setPendingAnnotation] = useState<
    Record<string, { timestampSeconds: number; attachmentIndex: number | null }>
  >({})

  const handleGrabTime = (itemId: string) => {
    const handle = assetRendererRefs.current[itemId]
    if (!handle) return
    const time = handle.getCurrentTime()
    if (time === null) {
      alert('Play or seek the video first, then click Grab time.')
      return
    }
    setPendingAnnotation((prev) => ({
      ...prev,
      [itemId]: {
        timestampSeconds: time,
        attachmentIndex: handle.getActiveIndex(),
      },
    }))
  }

  const handleClearPending = (key: string) => {
    setPendingAnnotation((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const handleFocusComment = (
    itemId: string | null,
    timestampSeconds: number | null,
    attachmentIndex: number | null,
  ) => {
    if (!itemId) return
    const handle = assetRendererRefs.current[itemId]
    if (!handle) return
    handle.focusAnnotation({ attachmentIndex, timestampSeconds })
  }
  const [previewImageName, setPreviewImageName] = useState<string | null>(null)
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
  // Wait for the route param to actually resolve before doing anything.
  // Without this guard the effect can fire once with approvalId=undefined
  // (each load function bails, isLoading flips to false), then again when
  // the real id arrives (isLoading flips back true) - which is the flicker.
  if (!approvalId) return

  let channel: RealtimeChannel | null = null
  let cancelled = false

  const run = async () => {
    await init()
    if (cancelled) return

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
        () => loadComments()
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
    cancelled = true
    if (channel) supabase.removeChannel(channel)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [approvalId])

  // Persist the latest snapshot to sessionStorage so a return visit hydrates
  // instantly. Skip while still loading (avoids caching half-populated state)
  // and skip when there's no approval row yet (avoids caching the empty shell).
  useEffect(() => {
    if (!approvalId || isLoading || !approval) return
    writeApprovalCache<ApprovalCachedSnapshot>(approvalId, {
      approval,
      items,
      assignees,
      comments,
    })
  }, [approvalId, isLoading, approval, items, assignees, comments])

  const init = async () => {
  // Bail if we don't have a route id yet, or another init() is already in flight.
  // Both guards together kill the spurious second pass that produced the
  // skeleton flicker.
  if (!approvalId) return
  if (initInFlightRef.current) return
  initInFlightRef.current = true
  // Only show the skeleton when we have nothing to show. If the cache
  // already populated state at mount, this is a background revalidation and
  // the user should keep seeing the page they had.
  if (!cachedInitial) setIsLoading(true)
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
      .select('role, name, email, profile_picture_url')
      .eq('id', user.id)
      .single()
    setCurrentUserRole(userRow?.role || null)
    if (userRow) {
      setCurrentUserProfile({
        name: userRow.name || '',
        email: userRow.email || user.email || '',
        profile_picture_url: userRow.profile_picture_url || null,
      })
    }

    await Promise.all([loadApproval(), loadItems(), loadAssignees(), loadComments()])
  } finally {
    setIsLoading(false)
    initInFlightRef.current = false
  }
}

  const loadApproval = async () => {
    if (!approvalId) {
      console.warn('loadApproval: missing approvalId in route params')
      return
    }
    let { data, error } = await supabase
      .from('approvals')
      .select(
        'id, client_id, title, description, status, clickup_task_id, clickup_task_name, auto_approve_at, created_at, share_token, clients(name, business_name)'
      )
      .eq('id', approvalId)
      .maybeSingle()

    // Older DBs don't have share_token yet — fall back so the page still loads.
    if (
      error &&
      ((error as { code?: string }).code === '42703' ||
        (error as { code?: string }).code === 'PGRST204')
    ) {
      const fallback = await supabase
        .from('approvals')
        .select(
          'id, client_id, title, description, status, clickup_task_id, clickup_task_name, auto_approve_at, created_at, clients(name, business_name)'
        )
        .eq('id', approvalId)
        .maybeSingle()
      data = fallback.data
        ? { ...fallback.data, share_token: null }
        : null
      error = fallback.error
    }

    if (error) {
      // Supabase errors don't expose enumerable fields by default — pluck the
      // useful ones explicitly so we can see what's actually wrong instead of
      // an empty `{}` in the console.
      console.error('Load approval detail error:', {
        approvalId,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      })
      return
    }
    if (!data) {
      console.warn('Approval not found or not accessible to current user', { approvalId })
      setApproval(null)
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
      share_token:
        (data as { share_token?: string | null }).share_token ?? null,
      clients: Array.isArray(data.clients) ? data.clients[0] : data.clients,
    }

    setApproval(mapped)
  }

  const loadItems = async () => {
    if (!approvalId) return
    const { data, error } = await supabase
      .from('approval_items')
      .select('*')
      .eq('approval_id', approvalId)
      .order('position', { ascending: true })

    if (error) {
      console.error('Load approval items error:', {
        approvalId,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      })
      return
    }
    console.debug('[approval-detail] items loaded', { approvalId, count: data?.length ?? 0 })
    setItems(data || [])
  }

  const loadAssignees = async () => {
  if (!approvalId) return
  const { data, error } = await supabase
    .from('approval_assignees')
    .select('id, role, user_id, users(name, email, profile_picture_url)')
    .eq('approval_id', approvalId)

  if (error) {
    console.error('Load assignees error:', {
      approvalId,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    })
    return
  }

  const mapped: Assignee[] = (data || []).map((row: unknown) => {
    const r = row as {
      id: string
      role: string
      user_id: string
      users: { name: string; email: string; profile_picture_url: string | null } | { name: string; email: string; profile_picture_url: string | null }[] | null
    }
    return {
      id: r.id,
      role: r.role,
      user_id: r.user_id,
      users: Array.isArray(r.users) ? r.users[0] : r.users,
    }
  })

  setAssignees(mapped)
}

  const loadComments = async () => {
  if (!approvalId) return
  const { data, error } = await supabase
    .from('approval_comments')
    .select(
      'id, approval_id, approval_item_id, user_id, content, file_url, file_name, reviewer_email, attachments, resolved, parent_comment_id, created_at, timestamp_seconds, region, attachment_index, users(name, email, profile_picture_url)'
    )
    .eq('approval_id', approvalId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Load comments error:', {
      approvalId,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    })
    return
  }

  const mapped: Comment[] = (data || []).map((row: unknown) => {
    const r = row as {
      id: string
      approval_id: string
      approval_item_id: string | null
      user_id: string | null
      content: string
      file_url: string | null
      file_name: string | null
      reviewer_email: string | null
      attachments: CommentAttachment[] | null
      resolved: boolean
      parent_comment_id: string | null
      created_at: string
      timestamp_seconds: number | null
      region: import('@/lib/types/annotations').CommentRegion | null
      attachment_index: number | null
      users: { name: string; email: string; profile_picture_url: string | null } | { name: string; email: string; profile_picture_url: string | null }[] | null
    }
    return {
      id: r.id,
      approval_id: r.approval_id,
      approval_item_id: r.approval_item_id,
      user_id: r.user_id,
      content: r.content,
      file_url: r.file_url,
      file_name: r.file_name,
      reviewer_email: r.reviewer_email,
      attachments: r.attachments,
      resolved: r.resolved,
      parent_comment_id: r.parent_comment_id,
      created_at: r.created_at,
      timestamp_seconds: r.timestamp_seconds,
      region: r.region,
      attachment_index: r.attachment_index,
      users: Array.isArray(r.users) ? r.users[0] : r.users,
    }
  })

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
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const url = approval?.share_token
        ? `${origin}/review/${approval.share_token}`
        : `${origin}/portal/approvals/${approvalId}`
      await navigator.clipboard.writeText(url)
      showToast(
        'success',
        approval?.share_token ? 'Review link copied' : 'Link copied',
      )
    } catch (err) {
      console.error('Copy link error', err)
      showToast('error', "Couldn't copy. Try again.")
    }
  }

  // Per-item race lock: ignore re-entry for an item that's already toggling.
  // (A user double-clicking the same Approve button shouldn't fire two PATCH
  // requests + two recomputes; same for clicking it then immediately undoing.)
  const togglingItemsRef = useRef<Set<string>>(new Set())
  const [togglingItemIds, setTogglingItemIds] = useState<Set<string>>(new Set())

  const toggleItemStatus = async (item: ApprovalItem) => {
    if (!currentUserId) return
    if (togglingItemsRef.current.has(item.id)) return
    togglingItemsRef.current.add(item.id)
    setTogglingItemIds(new Set(togglingItemsRef.current))

    const newStatus = item.status === 'approved' ? 'pending' : 'approved'

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
    } finally {
      togglingItemsRef.current.delete(item.id)
      setTogglingItemIds(new Set(togglingItemsRef.current))
    }
  }

  const startEditItem = (item: ApprovalItem) => {
    setEditingItemId(item.id)
    setEditItemTitle(item.title || '')
    setEditItemUrl(item.url || '')
    setEditItemComment(item.initial_comment || '')
    setEditItemAttachments(item.attachments ?? [])
    setEditItemIsCarousel(!!item.is_carousel)
    setEditItemUploads([])
    // Snapshot the originals so we can diff at Save and clean up the
    // assets the user removed/replaced. Reset the fresh-uploads tally too.
    editOriginalAttachmentsRef.current = item.attachments ?? []
    editFreshUploadsRef.current = []
  }

  const cancelEditItem = () => {
    // Anything uploaded during this session was never saved, so it's now
    // orphaned. Clean it up from Cloudinary in the background.
    if (editFreshUploadsRef.current.length) {
      destroyCloudinaryAssets(
        editFreshUploadsRef.current.map((a) => ({
          public_id: a.public_id,
          resource_type: a.resource_type,
        })),
      )
    }
    editOriginalAttachmentsRef.current = []
    editFreshUploadsRef.current = []

    setEditingItemId(null)
    setEditItemTitle('')
    setEditItemUrl('')
    setEditItemComment('')
    setEditItemAttachments([])
    setEditItemIsCarousel(false)
    setEditItemUploads([])
  }

  const handleEditAttachmentDelete = (index: number) => {
    setEditItemAttachments((prev) => {
      const next = prev.filter((_, i) => i !== index)
      // Carousel only makes sense with 2+; turn it off if we drop below.
      if (next.length < 2) setEditItemIsCarousel(false)
      return next
    })
  }

  /**
   * Upload one or more files. If `replaceIndex` is provided, the first file
   * uploaded swaps in at that position; the rest append. Otherwise everything
   * appends to the end.
   */
  const handleEditAttachmentUpload = async (
    files: FileList | File[],
    replaceIndex?: number,
  ) => {
    const list = Array.from(files)
    if (!list.length) return

    const { uploadToCloudinary, fileKind } = await import('@/lib/cloudinary')

    const tracking = list.map((f, i) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${f.name}`,
      name: f.name,
      pct: 0,
      // Only the first file in a replace operation actually replaces; later
      // files just append.
      replaceIndex: i === 0 ? replaceIndex : undefined,
    }))

    setEditItemUploads((prev) => [...prev, ...tracking])

    await Promise.all(
      list.map(async (file, j) => {
        const tid = tracking[j].id
        const ri = tracking[j].replaceIndex
        const kind = fileKind(file)
        if (kind === 'other') {
          setEditItemUploads((prev) =>
            prev.map((u) => (u.id === tid ? { ...u, error: 'Unsupported type' } : u)),
          )
          return
        }
        try {
          const asset = await uploadToCloudinary(file, {
            folder: `approvals/${approvalId || 'misc'}/items`,
            onProgress: (pct) =>
              setEditItemUploads((prev) =>
                prev.map((u) => (u.id === tid ? { ...u, pct } : u)),
              ),
          })

          if (typeof ri === 'number') {
            // Replace at position; preserve the rest.
            setEditItemAttachments((prev) =>
              prev.map((a, idx) => (idx === ri ? asset : a)),
            )
          } else {
            setEditItemAttachments((prev) => [...prev, asset])
          }
          // Track the new asset so Cancel/Save can clean it up if needed.
          editFreshUploadsRef.current = [...editFreshUploadsRef.current, asset]

          setEditItemUploads((prev) => prev.filter((u) => u.id !== tid))
        } catch (err) {
          console.error('Edit upload failed:', err)
          const msg = err instanceof Error ? err.message : 'Upload failed'
          setEditItemUploads((prev) =>
            prev.map((u) => (u.id === tid ? { ...u, error: msg } : u)),
          )
        }
      }),
    )
  }

  /** Wipes the existing attachment list and uploads the new selection in its place. */
  const handleEditAttachmentReplaceAll = async (files: FileList | File[]) => {
    setEditItemAttachments([])
    setEditItemIsCarousel(false)
    await handleEditAttachmentUpload(files)
  }

  const editUploadInFlight =
    editItemUploads.length > 0 && editItemUploads.every((u) => !u.error)

  const saveEditItem = async (itemId: string) => {
    if (!canEditItems) return
    if (editUploadInFlight) {
      alert('Wait for uploads to finish before saving.')
      return
    }

    const title = editItemTitle.trim()
    const urlInput = editItemUrl.trim()
    const comment = editItemComment.trim()

    // Either a URL or at least one attachment is required - the create flow
    // already enforces this; mirror it here so editors don't accidentally save
    // an empty asset.
    if (!urlInput && editItemAttachments.length === 0) {
      alert('Add a URL or at least one attachment.')
      return
    }

    // Mirror the create-route normalisation: when attachments are present,
    // the canonical `url` falls back to the first asset's secure_url so any
    // legacy reader still gets something.
    const firstAttachmentUrl = editItemAttachments[0]?.secure_url || null
    const url = urlInput || firstAttachmentUrl || ''

    // Re-derive `kind` from attachment types.
    let kind: 'url' | 'image' | 'video' | 'mixed' = 'url'
    if (editItemAttachments.length) {
      const types = new Set(editItemAttachments.map((a) => a.resource_type))
      kind =
        types.size > 1 ? 'mixed' : types.has('video') ? 'video' : 'image'
    }
    const isCarousel = editItemIsCarousel && editItemAttachments.length > 1

    // Compute the orphan list BEFORE we tear down the edit state. Anything
    // that was on the item originally but isn't in the saved list is now
    // unreferenced; same for any fresh upload that was added then removed
    // before saving.
    const currentIds = new Set(editItemAttachments.map((a) => a.public_id))
    const original = editOriginalAttachmentsRef.current
    const fresh = editFreshUploadsRef.current
    const toDestroy = [...original, ...fresh].filter((a) => !currentIds.has(a.public_id))
    // De-dupe by public_id so we never double-destroy.
    const seen = new Set<string>()
    const orphanList = toDestroy.filter((a) => {
      if (seen.has(a.public_id)) return false
      seen.add(a.public_id)
      return true
    })

    // Reset the snapshots so cancelEditItem (called below) doesn't also
    // destroy the fresh uploads that just got persisted.
    editOriginalAttachmentsRef.current = []
    editFreshUploadsRef.current = []

    // Optimistic patch + rollback on failure.
    const snapshot = items
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? {
              ...i,
              title: title || '',
              url,
              initial_comment: comment || null,
              attachments: editItemAttachments,
              is_carousel: isCarousel,
              kind,
              updated_at: new Date().toISOString(),
            }
          : i,
      ),
    )
    cancelEditItem()

    try {
      const { error } = await supabase
        .from('approval_items')
        .update({
          title: title || null,
          url,
          initial_comment: comment || null,
          attachments: editItemAttachments,
          is_carousel: isCarousel,
          kind,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)

      if (error) {
        console.error('Save edit item error:', error)
        setItems(snapshot)
        alert('Failed to save changes')
        // DB write failed - DON'T destroy anything, since the original
        // attachments are still referenced by the un-modified row.
      } else {
        // Server may normalize fields - quietly reconcile from db.
        await loadItems()
        // DB write succeeded; safe to clean up Cloudinary orphans now.
        if (orphanList.length) {
          destroyCloudinaryAssets(
            orphanList.map((a) => ({
              public_id: a.public_id,
              resource_type: a.resource_type,
            })),
          )
        }
      }
    } catch (err) {
      console.error('Save edit item exception', err)
      setItems(snapshot)
      alert('Failed to save changes')
    }
  }

  const handleNewCommentChange = (itemId: string, value: string) => {
  setNewCommentText((prev) => ({ ...prev, [itemId]: value }))

  const parts = value.split(/\s/)
  const last = parts[parts.length - 1]
  // Open the dropdown the moment "@" is typed (length === 1, empty query
  // shows top results) and keep it open while the user types more letters.
  if (last.startsWith('@')) {
    setMentionTargetItemId(itemId)
    setMentionQuery(last.slice(1).toLowerCase())
  } else if (mentionTargetItemId === itemId) {
    setMentionTargetItemId(null)
    setMentionQuery('')
  }
}

  const sendComment = async (itemId: string | null) => {
    if (!currentUserId) return
    if (!approvalId) return

    const key = itemId || 'general'
    const text = (newCommentText[key] || '').trim()
    if (!text && !commentFile) return

    // Snapshot then clear inputs immediately so the user can keep typing.
    const fileToUpload = commentFile
    const replyToCommentId =
      replyTarget && replyTarget.itemId === itemId ? replyTarget.commentId : null
    const annotation = pendingAnnotation[key] || null
    setNewCommentText((prev) => ({ ...prev, [key]: '' }))
    setCommentFile(null)
    setReplyTarget((prev) => (prev && prev.itemId === itemId ? null : prev))
    handleClearPending(key)

    // Optimistic comment — gets replaced once realtime/loadComments brings in
    // the real one (it'll have a real uuid and our temp- one drops out).
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimisticPreviewUrl = fileToUpload
      ? URL.createObjectURL(fileToUpload)
      : null
    const optimistic: Comment = {
      id: tempId,
      approval_id: approvalId,
      approval_item_id: itemId,
      user_id: currentUserId,
      content: text,
      file_url: optimisticPreviewUrl,
      file_name: fileToUpload?.name || null,
      reviewer_email: null,
      attachments: null,
      resolved: false,
      parent_comment_id: replyToCommentId,
      created_at: new Date().toISOString(),
      timestamp_seconds: annotation?.timestampSeconds ?? null,
      region: null,
      attachment_index: annotation?.attachmentIndex ?? null,
      users: currentUserProfile
        ? { ...currentUserProfile }
        : { name: 'You', email: '', profile_picture_url: null },
    }
    setComments((prev) => [...prev, optimistic])

    // Background send so the UI never waits.
    ;(async () => {
      let fileUrl: string | null = null
      let fileName: string | null = null

      if (fileToUpload) {
        const formData = new FormData()
        formData.append('file', fileToUpload)
        formData.append('folder', `approvals/${approvalId}/comments`)
        // Seed progress at 0 so the bar appears instantly.
        setUploadProgress((prev) => ({ ...prev, [tempId]: 0 }))
        try {
          const res = await uploadWithProgress({
            url: '/api/upload',
            body: formData,
            onProgress: (pct) =>
              setUploadProgress((prev) => ({ ...prev, [tempId]: pct })),
          })
          const uploadData = res.json()
          if (uploadData?.success) {
            fileUrl = uploadData.url
            fileName = fileToUpload.name
          }
        } catch (err) {
          console.error('Comment file upload error:', err)
        } finally {
          setUploadProgress((prev) => {
            const next = { ...prev }
            delete next[tempId]
            return next
          })
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
            parentCommentId: replyToCommentId,
            timestampSeconds: annotation?.timestampSeconds ?? null,
            attachmentIndex: annotation?.attachmentIndex ?? null,
          }),
        })

        const apiData = await res.json()
        if (!apiData.success) {
          console.error('Send comment API error:', apiData.error)
          // Roll back the optimistic comment.
          setComments((prev) => prev.filter((c) => c.id !== tempId))
          if (optimisticPreviewUrl) URL.revokeObjectURL(optimisticPreviewUrl)
          alert('Failed to send comment')
          return
        }

        // Realtime usually refreshes within a tick, but reload as a fallback
        // so the temp comment is replaced by the real row.
        await loadComments()
        setComments((prev) => prev.filter((c) => c.id !== tempId))
        if (optimisticPreviewUrl) URL.revokeObjectURL(optimisticPreviewUrl)
      } catch (err) {
        console.error('Send comment exception', err)
        setComments((prev) => prev.filter((c) => c.id !== tempId))
        if (optimisticPreviewUrl) URL.revokeObjectURL(optimisticPreviewUrl)
        alert('Failed to send comment')
      }
    })()
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

    // Optimistic edit + rollback on failure.
    const id = editingCommentId
    const nextContent = editingCommentText.trim()
    const snapshot = comments
    setComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, content: nextContent } : c)),
    )
    cancelEditComment()

    try {
      const { error } = await supabase
        .from('approval_comments')
        .update({
          content: nextContent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) {
        console.error('Edit comment error:', error)
        setComments(snapshot)
        alert('Failed to save comment')
      }
    } catch (err) {
      console.error('Edit comment exception', err)
      setComments(snapshot)
      alert('Failed to save comment')
    }
  }

  const toggleResolveComment = async (comment: Comment) => {
    // Optimistic flip + rollback on failure.
    const nextResolved = !comment.resolved
    const snapshot = comments
    setResolvingCommentId(comment.id)
    setComments((prev) =>
      prev.map((c) => (c.id === comment.id ? { ...c, resolved: nextResolved } : c)),
    )
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
        setComments(snapshot)
        alert('Failed to update')
      }
    } catch (err) {
      console.error('Resolve comment exception', err)
      setComments(snapshot)
      alert('Failed to update')
    } finally {
      setResolvingCommentId(null)
    }
  }

  const deleteComment = async (comment: Comment) => {
    // Optimistic remove + rollback on failure. The user sees instant feedback;
    // the network call settles in the background.
    const snapshot = comments
    setDeletingCommentId(comment.id)
    setComments((prev) => prev.filter((c) => c.id !== comment.id))
    try {
      const { error } = await supabase
        .from('approval_comments')
        .delete()
        .eq('id', comment.id)

      if (error) {
        console.error('Delete comment error:', error)
        setComments(snapshot)
        alert('Failed to delete')
      }
    } catch (err) {
      console.error('Delete comment exception', err)
      setComments(snapshot)
      alert('Failed to delete')
    } finally {
      setDeletingCommentId(null)
    }
  }

  const normalizeMentionKey = (s: string) =>
    (s || '').toLowerCase().replace(/[^a-z0-9_]/g, '')

  // Map normalized first-name / full-name → user record so we can render
  // @-mentions as inline pills with avatar + display name.
  const mentionLookup = (() => {
    const map = new Map<
      string,
      { id: string; name: string; profile_picture_url: string | null }
    >()
    for (const u of mentionUsers) {
      const first = normalizeMentionKey(u.name.split(' ')[0] || '')
      const full = normalizeMentionKey(u.name.replace(/\s+/g, ''))
      if (first) map.set(first, u)
      if (full) map.set(full, u)
    }
    return map
  })()

  const renderMentionPill = (
    user: { id: string; name: string; profile_picture_url: string | null },
    key: string | number,
  ) => (
    <span
      key={key}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#E8F0FE] text-[#1E54B7] font-medium align-baseline"
    >
      {user.profile_picture_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={user.profile_picture_url}
          alt={user.name}
          className="h-3.5 w-3.5 rounded-full object-cover"
        />
      ) : (
        <span className="h-3.5 w-3.5 rounded-full bg-[#2B79F7] text-white flex items-center justify-center text-[8px] font-semibold">
          {user.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span>@{user.name}</span>
    </span>
  )

  const formatComment = (content: string) => {
    const parts = content.split(/(\s+)/)
    return parts.map((part, idx) => {
      if (part.startsWith('@') && part.length > 1) {
        const token = normalizeMentionKey(part.slice(1))
        const user = mentionLookup.get(token)
        if (user) return renderMentionPill(user, idx)
        return (
          <span key={idx} className="text-[#2563EB] font-medium">
            {part}
          </span>
        )
      }
      return <span key={idx}>{part}</span>
    })
  }

  // Resolved mentions in the *current draft* text — used to show a "Tagging:"
  // preview row under the input so the author sees who'll be notified.
  const resolveDraftMentions = (text: string) => {
    const seen = new Set<string>()
    const out: { id: string; name: string; profile_picture_url: string | null }[] = []
    const tokens = text.match(/@([a-zA-Z0-9_]+)/g) || []
    for (const t of tokens) {
      const u = mentionLookup.get(normalizeMentionKey(t.slice(1)))
      if (u && !seen.has(u.id)) {
        seen.add(u.id)
        out.push(u)
      }
    }
    return out
  }

  if (isLoading) {
    return (
      <>
        <Header title="Approval Detail" />
        <div className="p-4 md:p-8">
          <Card>
            <CardContent className="py-10 text-center text-gray-500">
              <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
              Loading approval...
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  if (!approval) {
    return (
      <>
        <Header title="Approval not found" />
        <div className="p-4 md:p-8 max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <p className="text-gray-700 font-medium">This approval can&rsquo;t be loaded.</p>
              <p className="text-sm text-gray-500">
                It may have been deleted, or you don&rsquo;t have access to it.
              </p>
              <a
                href="/approvals"
                className="inline-block mt-2 px-4 py-2 rounded-lg bg-[#2B79F7] text-white text-sm hover:bg-[#1E54B7]"
              >
                Back to approvals
              </a>
            </CardContent>
          </Card>
        </div>
      </>
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
    <>
      <Header
        title={approval.title}
        subtitle={`${clientName} · Created ${createdDate}`}
      />
      {toast && (
        <div className="fixed top-4 right-4 z-50 max-w-sm animate-in fade-in slide-in-from-top-2 duration-150">
          <div
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border ${
              toast.kind === 'success'
                ? 'bg-white border-green-200 text-green-700'
                : 'bg-white border-red-200 text-red-700'
            }`}
          >
            {toast.kind === 'success' ? (
              <CheckCircle className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="text-sm">{toast.text}</span>
          </div>
        </div>
      )}
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 overflow-x-hidden">
        <Link
          href="/approvals"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2B79F7]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to approvals
        </Link>
        {/* Top card */}
        <Card>
  <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 break-all">
    <div className="flex-1 min-w-0">
      {approval.description && (
        <p className="text-sm text-gray-700 mb-1 whitespace-pre-wrap break-all">
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
    <div className="flex items-center gap-2 shrink-0">
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
                <CardHeader className="flex flex-col gap-3">
                  {/* Action row — pulled above the title so the captions get
                      full width and aren't squeezed by the button cluster. */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        isApproved
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isApproved ? 'bg-green-500' : 'bg-yellow-500'
                        }`}
                      />
                      {isApproved ? 'Approved' : 'Pending'}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleItemStatus(item)}
                        isLoading={togglingItemIds.has(item.id)}
                        disabled={togglingItemIds.has(item.id)}
                      >
                        {isApproved ? 'Un-approve' : 'Approve'}
                      </Button>
                      {canEditItems && (
                        editingItemId === item.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => saveEditItem(item.id)}
                              disabled={editUploadInFlight}
                            >
                              <Save className="h-4 w-4 mr-1" />
                              {editUploadInFlight ? 'Uploading…' : 'Save'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={cancelEditItem}
                            >
                              <X className="h-4 w-4 mr-1" />
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEditItem(item)}
                          >
                            <Edit3 className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Title + caption, full width. */}
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 break-words [overflow-wrap:anywhere]">
                      {item.title || 'Untitled asset'}
                    </h3>
                    {item.initial_comment && (
                      <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {item.initial_comment}
                      </p>
                    )}
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
                          label="URL (optional if uploading)"
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

                        {/* Existing attachments — each is removable and replaceable. */}
                        {editItemAttachments.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="block text-sm font-medium text-gray-700">
                                Attachments ({editItemAttachments.length})
                              </label>
                              <label
                                htmlFor={`edit-replaceall-${item.id}`}
                                className="text-[11px] text-red-600 hover:underline cursor-pointer"
                              >
                                Replace all
                              </label>
                              <input
                                id={`edit-replaceall-${item.id}`}
                                type="file"
                                accept="image/*,video/*"
                                multiple
                                className="sr-only"
                                onChange={(e) => {
                                  if (e.target.files && e.target.files.length) {
                                    handleEditAttachmentReplaceAll(e.target.files)
                                  }
                                  e.target.value = ''
                                }}
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {editItemAttachments.map((a, j) => {
                                const thumb = cldThumb(a, { w: 600, h: 600, crop: 'fill' })
                                const replaceInputId = `edit-replace-${item.id}-${j}`
                                return (
                                  <div
                                    key={`${a.public_id}-${j}`}
                                    className="relative group aspect-square rounded-lg border border-gray-200 bg-gray-50 overflow-hidden"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={thumb}
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
                                    {/* Per-thumbnail action overlay */}
                                    <div className="absolute inset-0 flex items-end justify-center gap-1 p-1.5 bg-gradient-to-t from-black/60 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                      <label
                                        htmlFor={replaceInputId}
                                        title="Replace this asset"
                                        className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/90 hover:bg-white text-gray-700 cursor-pointer"
                                      >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() => handleEditAttachmentDelete(j)}
                                        title="Delete this asset"
                                        className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/90 hover:bg-red-50 text-red-600"
                                      >
                                        <TrashIcon className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                    <input
                                      id={replaceInputId}
                                      type="file"
                                      accept="image/*,video/*"
                                      className="sr-only"
                                      onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                          handleEditAttachmentUpload([e.target.files[0]], j)
                                        }
                                        e.target.value = ''
                                      }}
                                    />
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
                            {editItemAttachments.length > 1 && (
                              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none mt-2">
                                <input
                                  type="checkbox"
                                  checked={editItemIsCarousel}
                                  onChange={(e) => setEditItemIsCarousel(e.target.checked)}
                                  className="h-3.5 w-3.5 rounded border-gray-300 text-[#2B79F7] focus:ring-[#2B79F7]"
                                />
                                View as a carousel
                              </label>
                            )}
                          </div>
                        )}

                        {/* Add new files (appends to existing) */}
                        <div>
                          <label
                            htmlFor={`edit-add-${item.id}`}
                            className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-[#2B79F7] hover:bg-[#E8F1FF]/30 cursor-pointer transition-colors"
                          >
                            <UploadIcon className="h-4 w-4" />
                            <span>
                              {editItemAttachments.length === 0
                                ? 'Click to upload images / videos'
                                : 'Add more files'}
                            </span>
                          </label>
                          <input
                            id={`edit-add-${item.id}`}
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            className="sr-only"
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length) {
                                handleEditAttachmentUpload(e.target.files)
                              }
                              e.target.value = ''
                            }}
                          />
                        </div>

                        {/* Live upload progress (replace + add both flow through here) */}
                        {editItemUploads.length > 0 && (
                          <div className="space-y-1.5">
                            {editItemUploads.map((u) => (
                              <div key={u.id} className="text-[11px]">
                                <div className="flex items-center justify-between text-gray-600">
                                  <span className="truncate pr-2">
                                    {typeof u.replaceIndex === 'number'
                                      ? `Replacing #${u.replaceIndex + 1}: `
                                      : ''}
                                    {u.name}
                                  </span>
                                  <span>
                                    {u.error ? (
                                      <span className="text-red-500">{u.error}</span>
                                    ) : (
                                      `${u.pct}%`
                                    )}
                                  </span>
                                </div>
                                {!u.error && (
                                  <div className="h-1 bg-gray-200 rounded overflow-hidden mt-0.5">
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
                      </div>
                    ) : item.attachments && item.attachments.length > 0 ? (
                      <div className="p-3">
                        <AssetRenderer
                          ref={(handle) => {
                            assetRendererRefs.current[item.id] = handle
                          }}
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
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img
                                    src={c.users.profile_picture_url}
                                    alt={c.users.name || ''}
                                    className="h-6 w-6 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="h-6 w-6 rounded-full bg-brand-gradient flex items-center justify-center text-white text-[10px] font-semibold">
                                    {(c.users?.name || c.users?.email || c.reviewer_email || 'U')
                                      .charAt(0)
                                      .toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <p className="font-semibold text-gray-800 truncate">
                                    {c.users?.name ||
                                      c.users?.email ||
                                      c.reviewer_email ||
                                      'User'}
                                    {!c.user_id && c.reviewer_email && (
                                      <span className="ml-1 text-[10px] font-normal text-gray-400 uppercase tracking-wide">
                                        client
                                      </span>
                                    )}
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
          <span className="italic">&quot;{snippet}&quot;</span>
        </div>
      )
    })()}

    {c.timestamp_seconds !== null && c.timestamp_seconds !== undefined && (
      <button
        type="button"
        onClick={() =>
          handleFocusComment(c.approval_item_id, c.timestamp_seconds, c.attachment_index)
        }
        title="Jump to this moment"
        className="inline-flex items-center gap-1 mt-0.5 mr-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] text-[10px] font-medium hover:bg-[#D6E5FF] transition-colors"
      >
        <ClockIcon className="h-3 w-3" />
        {formatTimestamp(c.timestamp_seconds)}
      </button>
    )}
    <p className="mt-0.5 text-gray-700 break-all">
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
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
    {uploadProgress[c.id] !== undefined && (
      <div className="mt-1.5">
        <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
          <span>Uploading…</span>
          <span>{uploadProgress[c.id]}%</span>
        </div>
        <div className="h-1 bg-gray-200 rounded overflow-hidden">
          <div
            className="h-full bg-[#2B79F7] transition-all duration-150"
            style={{ width: `${uploadProgress[c.id]}%` }}
          />
        </div>
      </div>
    )}
    {c.attachments && c.attachments.length > 0 && (
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        {c.attachments.map((att, i) => {
          const isImage = /\.(png|jpe?g|gif|webp|svg|avif|heic)(\?|$)/i.test(
            att.name || att.url,
          )
          if (isImage) {
            return (
              <button
                key={`${att.url}-${i}`}
                type="button"
                onClick={() => {
                  setPreviewImageUrl(att.url)
                  setPreviewImageName(att.name || 'Image')
                }}
                className="block aspect-video rounded-lg border border-gray-200 overflow-hidden bg-gray-50 hover:border-[#2B79F7] focus:outline-none"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={att.url}
                  alt={att.name || 'Attachment'}
                  className="h-full w-full object-cover"
                />
              </button>
            )
          }
          return (
            <a
              key={`${att.url}-${i}`}
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-[11px] text-[#2B79F7] hover:border-[#2B79F7]"
            >
              <Paperclip className="h-3 w-3 shrink-0" />
              <span className="truncate">{att.name || 'Attachment'}</span>
            </a>
          )
        })}
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
  {(() => {
    const draft = resolveDraftMentions(newCommentText[item.id] || '')
    if (draft.length === 0) return null
    return (
      <div className="flex items-center gap-1 flex-wrap text-[10px] text-gray-500">
        <span>Tagging:</span>
        {draft.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded-full bg-[#E8F0FE] text-[#1E54B7] font-medium"
          >
            {u.profile_picture_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={u.profile_picture_url}
                alt={u.name}
                className="h-3.5 w-3.5 rounded-full object-cover"
              />
            ) : (
              <span className="h-3.5 w-3.5 rounded-full bg-[#2B79F7] text-white flex items-center justify-center text-[8px] font-semibold">
                {u.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-[10px]">@{u.name}</span>
          </span>
        ))}
      </div>
    )
  })()}
  {mentionTargetItemId === item.id && (() => {
    // When the query is empty (user just typed "@"), show top 3 users by
    // default. With a query, filter against the full list and show top 5.
    const filtered = mentionQuery
      ? mentionUsers.filter((u) => u.name.toLowerCase().includes(mentionQuery))
      : mentionUsers
    const visible = filtered.slice(0, mentionQuery ? 5 : 3)
    return (
      <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-lg text-[11px] max-h-40 overflow-y-auto">
        {visible.map((u) => (
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
              /* eslint-disable-next-line @next/next/no-img-element */
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
        {visible.length === 0 && (
          <p className="px-2 py-1 text-gray-400">No matches</p>
        )}
      </div>
    )
  })()}
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
  {pendingAnnotation[item.id] && (
    <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
      <span>Tagged at:</span>
      <button
        type="button"
        onClick={() => handleClearPending(item.id)}
        title="Remove timestamp"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] font-medium hover:bg-[#D6E5FF] transition-colors"
      >
        <ClockIcon className="h-3 w-3" />
        {formatTimestamp(pendingAnnotation[item.id].timestampSeconds)}
        <X className="h-3 w-3" />
      </button>
    </div>
  )}
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-3">
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
      {item.attachments && item.attachments.length > 0 && (
        <button
          type="button"
          onClick={() => handleGrabTime(item.id)}
          title="Grab the current playback time"
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-[#2B79F7] transition-colors"
        >
          <ClockIcon className="h-3 w-3" />
          <span>Grab time</span>
        </button>
      )}
    </div>
    <button
      type="button"
      onClick={() => sendComment(item.id)}
      disabled={
        !commentFile &&
        !(newCommentText[item.id] || '').trim()
      }
      title="Send comment"
      aria-label="Send comment"
      className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-[#2B79F7] text-white hover:bg-[#1E54B7] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
    >
      <SendIcon className="h-4 w-4" />
    </button>
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
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src={previewImageUrl}
      alt={previewImageName || 'Preview'}
      className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl"
    />
  </div>
)}
      </div>
    </>
  )
}