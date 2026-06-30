'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'
import { AssetRenderer, type AssetRendererHandle } from '@/components/approvals/AssetRenderer'
import { formatTimestamp } from '@/lib/types/annotations'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import {
  CheckCircle,
  Loader2,
  Mail,
  AlertCircle,
  Send,
  LogOut,
  FileText,
  Paperclip,
  X as XIcon,
  Image as ImageIcon,
  Film,
  Download,
  Clock as ClockIcon,
  Pen as PenIcon,
} from 'lucide-react'

interface ApprovalSummary {
  approvalId: string
  title: string
  description: string | null
  status: string
  clientName: string
  clientPicture: string | null
}

interface CloudinaryItemAttachment {
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
  title: string | null
  url: string
  initial_comment: string | null
  status: 'pending' | 'approved'
  position: number
  attachments?: CloudinaryItemAttachment[]
  is_carousel?: boolean
  kind?: 'url' | 'image' | 'video' | 'mixed'
}

interface CommentAttachment {
  url: string
  name: string
  size: number | null
}

interface CommentRow {
  id: string
  approval_item_id: string | null
  content: string
  created_at: string
  updated_at?: string | null
  user_id: string | null
  reviewer_email: string | null
  attachments: CommentAttachment[] | null
  resolved?: boolean | null
  file_url: string | null
  file_name: string | null
  timestamp_seconds: number | null
  region: import('@/lib/types/annotations').CommentRegion | null
  attachment_index: number | null
  parent_comment_id: string | null
  users: { name: string | null; email: string; profile_picture_url: string | null } | null
}

interface AssigneeOption {
  id: string
  name: string
  profile_picture_url: string | null
}

const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB per file
const MAX_FILES = 10

type Phase = 'loading' | 'email' | 'review' | 'invalid'

export default function ReviewPage() {
  const params = useParams()
  const token = (params?.token as string) ?? ''

  const [phase, setPhase] = useState<Phase>('loading')
  const [approval, setApproval] = useState<ApprovalSummary | null>(null)
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [comments, setComments] = useState<CommentRow[]>([])
  const [assignees, setAssignees] = useState<AssigneeOption[]>([])
  const [signedInAs, setSignedInAs] = useState<string | null>(null)
  // In-app media viewer for image/video comment attachments. Clicking an
  // image/video opens a fullscreen preview instead of bouncing the user out
  // to a new tab.
  const [mediaPreview, setMediaPreview] = useState<{
    url: string
    name: string
    kind: 'image' | 'video'
  } | null>(null)

  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [statusBanner, setStatusBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const flash = useCallback((kind: 'success' | 'error', text: string, ms = 2400) => {
    setStatusBanner({ kind, text })
    setTimeout(() => setStatusBanner((b) => (b?.text === text ? null : b)), ms)
  }, [])

  const loadState = useCallback(async () => {
    if (!token) return
    const res = await fetch(`/api/review/state?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!data.success) {
      setPhase('invalid')
      return
    }
    setApproval(data.approval)
    if (data.authed) {
      setItems(data.items || [])
      setComments(data.comments || [])
      setAssignees((data.assignees || []) as AssigneeOption[])
      setSignedInAs(data.email)
      setPhase('review')
    } else {
      setPhase('email')
    }
  }, [token])

  useEffect(() => {
    void loadState()
  }, [loadState])

  // Soft polling - the review session is anonymous (cookie-only), so we
  // can't subscribe to Supabase realtime. Re-fetch every 5s while the tab is
  // visible. We *only* swap state when content actually changed, otherwise
  // React re-renders and iframe-based asset embeds briefly flash empty,
  // which the reviewer perceives as text disappearing then snapping back.
  useEffect(() => {
    if (phase !== 'review') return
    let cancelled = false

    const itemsKey = (arr: ApprovalItem[]) =>
      arr.map((i) => `${i.id}:${i.status}:${i.url}:${i.title}:${i.position}`).join('|')

    const commentsKey = (arr: CommentRow[]) =>
      arr
        .map(
          (c) =>
            `${c.id}:${c.content}:${c.approval_item_id ?? ''}:${
              c.attachments ? c.attachments.length : 0
            }:${c.file_url ?? ''}:${c.resolved ? 1 : 0}`,
        )
        .join('|')

    const tick = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const res = await fetch(
          `/api/review/state?token=${encodeURIComponent(token)}`,
          { cache: 'no-store' },
        )
        const data = await res.json().catch(() => null)
        // Don't disturb the page on a transient failure - the user will keep
        // seeing the last good state until the next tick succeeds.
        if (!data?.success || !data.authed) return
        if (cancelled) return

        setItems((prev) => {
          const next = (data.items || []) as ApprovalItem[]
          return itemsKey(prev) === itemsKey(next) ? prev : next
        })
        setComments((prev) => {
          const next = (data.comments || []) as CommentRow[]
          return commentsKey(prev) === commentsKey(next) ? prev : next
        })
      } catch (err) {
        console.warn('review poll error:', err)
      }
    }

    // 2-second poll keeps resolve flips + new agency comments showing up
    // close to real time. The state route only returns when something
    // actually changed (the keys above gate setState), so a tighter interval
    // is cheap on the client.
    const id = window.setInterval(() => void tick(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [phase, token])

  // Per-item lock so a double-tap can't fire two requests.
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    setErrorMsg(null)
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/review/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: email.trim().toLowerCase() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data.success) {
        setErrorMsg(data.error || 'Something went wrong')
        return
      }
      if (!data.authed) {
        // Email isn't on file. We don't say "this email isn't allowed" because
        // we don't want to leak who's on the approval; the agency can re-send
        // the link to the right address.
        setErrorMsg(
          "We couldn't verify that email. Make sure you're using the address this approval was sent to.",
        )
        return
      }
      // Authed - pull the assets.
      await loadState()
    } catch (err) {
      console.error('review start error:', err)
      setErrorMsg('Network error. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/review/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
    } finally {
      setSignedInAs(null)
      setItems([])
      setComments([])
      setAssignees([])
      setEmail('')
      setPhase('email')
    }
  }

  const handleToggleApprove = async (item: ApprovalItem) => {
    if (togglingIds.has(item.id)) return
    const next = item.status === 'approved' ? 'pending' : 'approved'
    setTogglingIds((prev) => new Set(prev).add(item.id))
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)))
    try {
      const res = await fetch('/api/review/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, itemId: item.id, approved: next === 'approved' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data.success) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)))
        flash('error', data.error || "Couldn't update - please try again.")
      } else {
        flash('success', next === 'approved' ? 'Asset approved' : 'Marked as pending')
      }
    } catch (err) {
      console.error('review approve error:', err)
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)))
      flash('error', 'Network hiccup - please try again.')
    } finally {
      setTogglingIds((prev) => {
        const n = new Set(prev)
        n.delete(item.id)
        return n
      })
    }
  }

  const allApproved = items.length > 0 && items.every((i) => i.status === 'approved')

  const commentsByItem = useMemo(() => {
    const m: Record<string, CommentRow[]> = {}
    for (const c of comments) {
      const key = c.approval_item_id || ''
      if (!m[key]) m[key] = []
      m[key].push(c)
    }
    return m
  }, [comments])

  if (phase === 'loading') {
    return (
      <div className="form-canvas min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#2B79F7]" />
      </div>
    )
  }

  if (phase === 'invalid') {
    return (
      <div className="form-canvas min-h-screen flex items-center justify-center p-4">
        <div className="glass-card max-w-sm w-full rounded-2xl p-6 text-center space-y-3">
          <AlertCircle className="h-8 w-8 mx-auto text-red-500" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">This link isn&rsquo;t valid</h1>
          <p className="text-sm text-[var(--text-tertiary)]">
            The review link has expired or doesn&rsquo;t match an approval. Ask whoever shared it
            with you to send a new one.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="form-canvas min-h-screen">
      <header className="glass-card rounded-none border-x-0 border-t-0 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {approval?.clientPicture ? (
              <Image
                src={approval.clientPicture}
                alt={approval.clientName}
                width={32}
                height={32}
                unoptimized
                className="h-8 w-8 rounded-full object-cover ring-2 ring-[#E8F1FF]"
              />
            ) : (
              <div className="h-8 w-8 rounded-full bg-brand-gradient text-white text-xs font-semibold flex items-center justify-center">
                {(approval?.clientName || 'C').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">Review</p>
              <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{approval?.title}</p>
            </div>
          </div>
          {signedInAs && (
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-2 py-1 rounded-md hover:bg-white/5"
              title="Sign out of this review"
            >
              <LogOut className="h-3.5 w-3.5" />
              {signedInAs}
            </button>
          )}
        </div>
      </header>

      {statusBanner && (
        <div className="fixed top-16 right-4 z-30 max-w-sm animate-in fade-in slide-in-from-top-2 duration-150">
          <div
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] ${
              statusBanner.kind === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            {statusBanner.kind === 'success' ? (
              <CheckCircle className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="text-sm">{statusBanner.text}</span>
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {phase === 'email' && (
          <EmailGate
            clientName={approval?.clientName || 'Client'}
            email={email}
            setEmail={setEmail}
            errorMsg={errorMsg}
            isSubmitting={isSubmitting}
            onSubmit={handleStart}
          />
        )}

        {phase === 'review' && (
          <div className="space-y-4">
            {approval?.description && (
              <div className="glass-card rounded-xl p-4 text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {approval.description}
              </div>
            )}

            {allApproved && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-sm text-emerald-700 inline-flex items-center gap-2 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]">
                <CheckCircle className="h-4 w-4" />
                Every asset has been approved. You&rsquo;re done. Thanks!
              </div>
            )}

            {items.length === 0 ? (
              <div className="glass-card rounded-xl p-6 text-center text-sm text-[var(--text-tertiary)]">
                No assets attached yet.
              </div>
            ) : (
              items.map((item) => (
                <ReviewItemCard
                  key={item.id}
                  item={item}
                  comments={commentsByItem[item.id] || []}
                  isToggling={togglingIds.has(item.id)}
                  signedInAs={signedInAs}
                  token={token}
                  assignees={assignees}
                  onToggleApprove={() => void handleToggleApprove(item)}
                  onCommentPosted={(c) => setComments((prev) => [...prev, c as CommentRow])}
                  onCommentEdited={(c) =>
                    setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...c } : x)))
                  }
                  onCommentDeleted={(id) =>
                    setComments((prev) => prev.filter((x) => x.id !== id))
                  }
                  onError={(msg) => flash('error', msg)}
                  onPreviewMedia={(att, kind) =>
                    setMediaPreview({ url: att.url, name: att.name, kind })
                  }
                />
              ))
            )}
          </div>
        )}
      </main>

      {mediaPreview && (
        <MediaLightbox
          url={mediaPreview.url}
          name={mediaPreview.name}
          kind={mediaPreview.kind}
          onClose={() => setMediaPreview(null)}
        />
      )}
    </div>
  )
}

function MediaLightbox({
  url,
  name,
  kind,
  onClose,
}: {
  url: string
  name: string
  kind: 'image' | 'video'
  onClose: () => void
}) {
  const [isDownloading, setIsDownloading] = useState(false)

  // Esc closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Cross-origin downloads (Supabase Storage) ignore the <a download="">
  // attribute, so the browser just opens the file in a new tab. To force a
  // real download we fetch the bytes ourselves and trigger a synthetic click
  // on a blob URL.
  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDownloading) return
    setIsDownloading(true)
    try {
      const res = await fetch(url, { mode: 'cors' })
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = name || 'attachment'
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Give the browser a tick to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch (err) {
      console.error('Lightbox download error:', err)
      // Fallback: open in a new tab so the user can still save it manually.
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
        aria-label="Close"
      >
        <XIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={handleDownload}
        disabled={isDownloading}
        className="absolute top-4 right-16 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-50"
        aria-label="Download"
        title="Download"
      >
        {isDownloading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Download className="h-5 w-5" />
        )}
      </button>
      <div
        className="max-w-[95vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === 'image' ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt={name}
            className="max-w-[95vw] max-h-[90vh] rounded-xl shadow-2xl object-contain"
          />
        ) : (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            className="max-w-[95vw] max-h-[90vh] rounded-xl shadow-2xl bg-black"
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Email gate
// ---------------------------------------------------------------------------

function EmailGate({
  clientName,
  email,
  setEmail,
  errorMsg,
  isSubmitting,
  onSubmit,
}: {
  clientName: string
  email: string
  setEmail: (v: string) => void
  errorMsg: string | null
  isSubmitting: boolean
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <div className="glass-card max-w-md mx-auto rounded-2xl p-6 space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Review for {clientName}</h1>
        <p className="text-sm text-[var(--text-tertiary)]">
          Enter the email this approval was sent to. We&rsquo;ll check it&rsquo;s on the account
          and let you straight in.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
            className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
        </div>
        {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
        <button
          type="submit"
          disabled={isSubmitting || !email.trim()}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#2B79F7] text-white text-sm font-medium hover:bg-[#1E54B7] disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Continue
        </button>
        <p className="text-[11px] text-[var(--text-tertiary)] text-center">
          You&rsquo;ll stay signed in on this device for 30 days.
        </p>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-asset card
// ---------------------------------------------------------------------------

function ReviewItemCard({
  item,
  comments,
  isToggling,
  signedInAs,
  token,
  assignees,
  onToggleApprove,
  onCommentPosted,
  onCommentEdited,
  onCommentDeleted,
  onError,
  onPreviewMedia,
}: {
  item: ApprovalItem
  comments: CommentRow[]
  isToggling: boolean
  signedInAs: string | null
  token: string
  assignees: AssigneeOption[]
  onToggleApprove: () => void
  onCommentPosted: (c: CommentRow) => void
  onCommentEdited: (c: CommentRow) => void
  onCommentDeleted: (id: string) => void
  onError: (msg: string) => void
  onPreviewMedia: (att: CommentAttachment, kind: 'image' | 'video') => void
}) {
  const [draft, setDraft] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isPosting, setIsPosting] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const assetRendererRef = useRef<AssetRendererHandle | null>(null)
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    timestampSeconds?: number | null
    region?: import('@/lib/types/annotations').CommentRegion | null
    attachmentIndex: number | null
  } | null>(null)
  const isApproved = item.status === 'approved'

  // Scrollable chat + new-comment preview, mirroring the agency/portal flow
  // so a long thread on a phone-shaped review screen doesn't push the
  // composer below the fold.
  const commentsListRef = useRef<HTMLUListElement | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [unreadPreview, setUnreadPreview] = useState<{
    id: string
    name: string
    preview: string
    avatar: string | null
  } | null>(null)
  const seenCommentIdsRef = useRef<Set<string>>(new Set())
  const seenInitialisedRef = useRef(false)
  const pendingScrollAfterSendRef = useRef(false)

  // Reply / edit state. Replies attach via parent_comment_id; edits go
  // through /api/review/comment/edit which only allows the reviewer to
  // change their own rows (matched server-side by reviewer_email).
  const [replyTo, setReplyTo] = useState<{ commentId: string; authorName: string } | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  const startEdit = (c: CommentRow) => {
    setEditingCommentId(c.id)
    setEditingDraft(c.content)
  }
  const cancelEdit = () => {
    setEditingCommentId(null)
    setEditingDraft('')
  }
  const saveEdit = async () => {
    if (!editingCommentId) return
    const next = editingDraft.trim()
    if (!next) return
    setIsEditing(true)
    try {
      const res = await fetch('/api/review/comment/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, commentId: editingCommentId, body: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data.success) {
        onError(data.error || "Couldn't save the edit")
        return
      }
      onCommentEdited(data.comment as CommentRow)
      cancelEdit()
    } finally {
      setIsEditing(false)
    }
  }

  // Delete-own-comment flow. The Delete button just stages a pending id;
  // the ConfirmModal does the actual POST. The server runs the same
  // reviewer_email ownership check the edit route does.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const confirmDelete = async () => {
    if (!pendingDeleteId) return
    const res = await fetch('/api/review/comment/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, commentId: pendingDeleteId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!data.success) {
      throw new Error(data.error || "Couldn't delete the comment")
    }
    onCommentDeleted(pendingDeleteId)
    setPendingDeleteId(null)
  }

  // Anyone in the conversation can flip a comment's resolved flag - same as
  // the agency + portal sides. We optimistically update the bubble and roll
  // back if the API call fails.
  const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(null)
  const toggleResolve = async (c: CommentRow) => {
    const next = !c.resolved
    setResolvingCommentId(c.id)
    onCommentEdited({ ...c, resolved: next })
    try {
      const res = await fetch('/api/review/comment/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, commentId: c.id, resolved: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data.success) {
        onCommentEdited({ ...c, resolved: c.resolved })
        onError(data.error || "Couldn't update the comment")
      }
    } finally {
      setResolvingCommentId(null)
    }
  }

  const handleCommentsScroll = () => {
    const el = commentsListRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
    const atBottom = distanceFromBottom < 40
    setIsAtBottom((prev) => (prev === atBottom ? prev : atBottom))
    if (atBottom && unreadPreview) setUnreadPreview(null)
  }
  const scrollCommentsToBottom = () => {
    const el = commentsListRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  // Detect new comments arriving while scrolled away. Skips the initial
  // batch + anything posted by this reviewer.
  useEffect(() => {
    if (!seenInitialisedRef.current) {
      for (const c of comments) {
        seenCommentIdsRef.current.add(c.id)
      }
      seenInitialisedRef.current = true
      return
    }
    for (const c of comments) {
      if (seenCommentIdsRef.current.has(c.id)) continue
      seenCommentIdsRef.current.add(c.id)
      // Did THIS reviewer post it? (No user_id; matched by reviewer_email.)
      if (signedInAs && c.reviewer_email === signedInAs) continue
      if (isAtBottom) continue
      setUnreadPreview({
        id: c.id,
        name: c.users?.name || c.users?.email || c.reviewer_email || 'Someone',
        preview: (c.content || '').slice(0, 60),
        avatar: c.users?.profile_picture_url || null,
      })
    }
  }, [comments, isAtBottom, signedInAs])

  // After this reviewer sends a comment, scroll the list to the bottom
  // once the new bubble actually renders.
  useEffect(() => {
    if (!pendingScrollAfterSendRef.current) return
    pendingScrollAfterSendRef.current = false
    requestAnimationFrame(() => scrollCommentsToBottom())
  }, [comments])

  // First-paint: jump the comments list to the bottom so the latest message
  // is visible without manual scrolling. Runs once per card per session.
  const initialScrollDoneRef = useRef(false)
  useEffect(() => {
    if (initialScrollDoneRef.current) return
    if (comments.length === 0) return
    const el = commentsListRef.current
    if (!el) return
    initialScrollDoneRef.current = true
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [comments])

  const handleGrabTime = () => {
    const handle = assetRendererRef.current
    if (!handle) return
    const time = handle.getCurrentTime()
    if (time === null) {
      handle.scrollIntoView()
      onError('Play or seek the video first, then click Grab time.')
      return
    }
    handle.scrollIntoView()
    setPendingAnnotation((prev) => ({
      ...(prev ?? { attachmentIndex: null }),
      timestampSeconds: time,
      attachmentIndex: handle.getActiveIndex(),
    }))
  }

  const handleAnnotate = async (shape: 'circle' | 'freeform') => {
    const handle = assetRendererRef.current
    if (!handle) return
    handle.scrollIntoView()
    const result = await handle.enterDrawMode(shape)
    if (!result) return
    setPendingAnnotation((prev) => ({
      // Drawing on a video implicitly tags the playback time as well.
      timestampSeconds: prev?.timestampSeconds ?? result.timestampSeconds ?? null,
      region: result.region,
      attachmentIndex: handle.getActiveIndex(),
    }))
    if (textareaRef.current) {
      textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      textareaRef.current.focus({ preventScroll: true })
    }
  }

  const handleClearPendingField = (field: 'timestampSeconds' | 'region') => {
    setPendingAnnotation((prev) => {
      if (!prev) return prev
      const next = { ...prev, [field]: null }
      if (!next.timestampSeconds && !next.region) return null
      return next
    })
  }

  const handleFocusComment = (
    timestampSeconds: number | null,
    attachmentIndex: number | null,
    region: import('@/lib/types/annotations').CommentRegion | null = null,
  ) => {
    assetRendererRef.current?.focusAnnotation({
      attachmentIndex,
      timestampSeconds,
      region,
    })
  }

  const onDraftChange = (value: string) => {
    setDraft(value)
    // Detect a trailing @-token so we can pop the picker.
    const parts = value.split(/\s/)
    const last = parts[parts.length - 1] || ''
    if (last.startsWith('@') && last.length >= 1) {
      setMentionQuery(last.slice(1).toLowerCase())
    } else {
      setMentionQuery(null)
    }
  }

  const insertMention = (assignee: AssigneeOption) => {
    const parts = draft.split(/\s/)
    const firstName = assignee.name.split(' ')[0] || assignee.name
    parts[parts.length - 1] = '@' + firstName
    setDraft(parts.join(' ') + ' ')
    setMentionQuery(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const filteredAssignees =
    mentionQuery === null
      ? []
      : Array.from(
          new Map(
            assignees
              .filter((a) => a.name.toLowerCase().includes(mentionQuery))
              .map((a) => [a.id, a]),
          ).values(),
        )

  // Token → assignee. Matches both first-name (@alex) and full-name (@alexsmith).
  const normalizeMentionKey = (s: string) =>
    (s || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  const mentionLookup = (() => {
    const map = new Map<string, AssigneeOption>()
    for (const a of assignees) {
      const first = normalizeMentionKey(a.name.split(' ')[0] || '')
      const full = normalizeMentionKey(a.name.replace(/\s+/g, ''))
      if (first) map.set(first, a)
      if (full) map.set(full, a)
    }
    return map
  })()

  const renderMentionPill = (a: AssigneeOption, key: string | number) => (
    <span
      key={key}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#E8F0FE] text-[#1E54B7] font-medium align-baseline"
    >
      {a.profile_picture_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={a.profile_picture_url}
          alt={a.name}
          className="h-3.5 w-3.5 rounded-full object-cover"
        />
      ) : (
        <span className="h-3.5 w-3.5 rounded-full bg-[#2B79F7] text-white flex items-center justify-center text-[8px] font-semibold">
          {a.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span>@{a.name}</span>
    </span>
  )

  const formatCommentBody = (text: string) => {
    const parts = text.split(/(\s+)/)
    return parts.map((part, idx) => {
      if (part.startsWith('@') && part.length > 1) {
        const a = mentionLookup.get(normalizeMentionKey(part.slice(1)))
        if (a) return renderMentionPill(a, idx)
        return (
          <span key={idx} className="text-[#1E54B7] font-medium">
            {part}
          </span>
        )
      }
      return <span key={idx}>{part}</span>
    })
  }

  const draftMentionedAssignees = (() => {
    const seen = new Set<string>()
    const out: AssigneeOption[] = []
    const tokens = draft.match(/@([a-zA-Z0-9_]+)/g) || []
    for (const t of tokens) {
      const a = mentionLookup.get(normalizeMentionKey(t.slice(1)))
      if (a && !seen.has(a.id)) {
        seen.add(a.id)
        out.push(a)
      }
    }
    return out
  })()

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files)
    const accepted: File[] = []
    for (const f of arr) {
      if (f.size > MAX_FILE_BYTES) {
        onError(`"${f.name}" is over 5MB and was skipped.`)
        continue
      }
      accepted.push(f)
    }
    setPendingFiles((prev) => {
      const next = [...prev, ...accepted].slice(0, MAX_FILES)
      if (prev.length + accepted.length > MAX_FILES) {
        onError(`Up to ${MAX_FILES} files per comment.`)
      }
      return next
    })
  }

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  const uploadOne = async (file: File): Promise<{ url: string; name: string; size: number } | null> => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('folder', 'review-comments')
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!data.success) {
        onError(`Upload failed for "${file.name}": ${data.error || 'unknown error'}`)
        return null
      }
      return { url: data.url as string, name: file.name, size: file.size }
    } catch (err) {
      console.error('review comment upload error:', err)
      onError(`Upload failed for "${file.name}".`)
      return null
    }
  }

  const postComment = async () => {
    const text = draft.trim()
    if ((!text && pendingFiles.length === 0) || isPosting) return
    setIsPosting(true)
    try {
      // Upload first so we attach URLs to the comment in one shot. Sequential
      // (not Promise.all) so size errors surface in order rather than racing.
      const uploaded: { url: string; name: string; size: number }[] = []
      for (const f of pendingFiles) {
        const result = await uploadOne(f)
        if (result) uploaded.push(result)
      }

      // If the user only attached files and they all failed to upload, bail.
      if (!text && uploaded.length === 0) {
        return
      }

      const res = await fetch('/api/review/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          itemId: item.id,
          body: text,
          attachments: uploaded,
          timestampSeconds: pendingAnnotation?.timestampSeconds ?? null,
          region: pendingAnnotation?.region ?? null,
          attachmentIndex: pendingAnnotation?.attachmentIndex ?? null,
          parentCommentId: replyTo?.commentId ?? null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data.success) {
        onError(data.error || "Couldn't post - please try again.")
        return
      }
      onCommentPosted({
        ...data.comment,
        // The reviewer flow always writes user_id=null and reviewer_email=session.email,
        // so backstop those here in case the API select is ever stripped down.
        user_id: data.comment?.user_id ?? null,
        reviewer_email: data.comment?.reviewer_email ?? signedInAs,
        resolved: data.comment?.resolved ?? false,
        attachments: uploaded.length ? uploaded : data.comment?.attachments ?? null,
        users: null,
      })
      setDraft('')
      setPendingFiles([])
      setPendingAnnotation(null)
      setReplyTo(null)
      // Tell the comments-list effect to scroll to the bottom once the
      // new bubble lands in the DOM. Avoids the user feeling like their
      // message scrolled off when the chat is long.
      pendingScrollAfterSendRef.current = true
    } finally {
      setIsPosting(false)
    }
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-[var(--glass-border)] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] ${
              isApproved ? 'bg-emerald-50 text-emerald-700' : 'bg-yellow-50 text-yellow-700'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isApproved ? 'bg-emerald-500' : 'bg-yellow-500'}`} />
            {isApproved ? 'Approved' : 'Pending'}
          </span>
          <button
            type="button"
            onClick={onToggleApprove}
            disabled={isToggling}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isApproved
                ? 'glass-chip text-[var(--text-secondary)]'
                : 'bg-[#2B79F7] text-white hover:bg-[#1E54B7]'
            } disabled:opacity-50`}
          >
            {isToggling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isApproved ? 'Un-approve' : 'Approve this asset'}
          </button>
        </div>

        <h2 className="text-base font-semibold text-[var(--text-primary)] break-words [overflow-wrap:anywhere]">
          {item.title || 'Untitled asset'}
        </h2>

        {item.attachments && item.attachments.length > 0 ? (
          <div className="rounded-lg overflow-hidden border border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
            <AssetRenderer
              ref={assetRendererRef}
              attachments={item.attachments}
              isCarousel={!!item.is_carousel}
            />
          </div>
        ) : (
          <AssetEmbed url={item.url} title={item.title || 'Asset'} />
        )}

        {item.initial_comment && (
          <CollapsibleText text={item.initial_comment} previewChars={220} />
        )}
      </div>

      <div className="p-4 sm:p-5 space-y-3">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium">Comments</p>
        {comments.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)] italic">No comments yet.</p>
        ) : (
          <ul
            ref={commentsListRef}
            onScroll={handleCommentsScroll}
            className="space-y-3 max-h-72 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y pr-1"
          >
            {comments.map((c) => {
              const author =
                c.users?.name ||
                c.users?.email ||
                c.reviewer_email ||
                extractEmailPrefix(c.content) ||
                'Reviewer'
              // Strip any old `[email] ` prefix on legacy rows so we don't
              // double-render the email.
              const body = stripEmailPrefix(c.content)
              return (
                <li
                  key={c.id}
                  className={`flex items-start gap-2 rounded-lg p-2 transition-colors ${
                    // Match the agency-side comment card: every comment
                    // sits in a bordered, rounded card with a subtle
                    // background. Resolved swaps the bg to a 10% green
                    // tint (legible in both themes) but keeps the same
                    // shape so the rounding stays visible regardless of
                    // resolution state.
                    c.resolved
                      ? 'border border-emerald-500/40 bg-green-50 dark:bg-emerald-500/10 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]'
                      : 'glass-inset'
                  }`}
                >
                  {c.users?.profile_picture_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={c.users.profile_picture_url}
                      alt={author}
                      className="h-7 w-7 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-[10px] font-semibold flex items-center justify-center shrink-0">
                      {(author || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate">{author}</span>
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        {new Date(c.created_at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {c.updated_at && c.updated_at !== c.created_at && (
                        <span className="text-[10px] text-[var(--text-tertiary)] italic">(edited)</span>
                      )}
                    </div>
                    {c.parent_comment_id && (() => {
                      const parent = comments.find((p) => p.id === c.parent_comment_id)
                      if (!parent) return null
                      const parentAuthor =
                        parent.users?.name ||
                        parent.users?.email ||
                        parent.reviewer_email ||
                        'Reviewer'
                      const snippet =
                        parent.content.length > 80
                          ? parent.content.slice(0, 80) + '…'
                          : parent.content
                      return (
                        <div className="mt-1 px-2 py-1 bg-white/[0.03] border-l-2 border-[var(--glass-border)] rounded text-[10px] text-[var(--text-tertiary)]">
                          Replying to <span className="font-semibold">{parentAuthor}</span>:{' '}
                          <span className="italic">&ldquo;{snippet}&rdquo;</span>
                        </div>
                      )
                    })()}
                    {(c.timestamp_seconds != null || c.region) && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {c.timestamp_seconds != null && (
                          <button
                            type="button"
                            onClick={() =>
                              handleFocusComment(c.timestamp_seconds, c.attachment_index, c.region)
                            }
                            title="Jump to this moment"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] text-[10px] font-medium hover:bg-[#D6E5FF] transition-colors shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]"
                          >
                            <ClockIcon className="h-3 w-3" />
                            {formatTimestamp(c.timestamp_seconds)}
                          </button>
                        )}
                        {c.region && (
                          <button
                            type="button"
                            onClick={() =>
                              handleFocusComment(c.timestamp_seconds, c.attachment_index, c.region)
                            }
                            title="Show the highlighted region"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] text-[10px] font-medium hover:bg-[#D6E5FF] transition-colors shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]"
                          >
                            <PenIcon className="h-3 w-3" />
                            View highlight
                          </button>
                        )}
                      </div>
                    )}
                    {editingCommentId === c.id ? (
                      <div className="mt-1 space-y-1.5">
                        <textarea
                          value={editingDraft}
                          onChange={(e) => setEditingDraft(e.target.value)}
                          rows={2}
                          className="w-full px-2.5 py-1.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-2.5 py-1 rounded text-xs text-[var(--text-secondary)] hover:bg-white/5"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveEdit()}
                            disabled={isEditing || !editingDraft.trim()}
                            className="px-2.5 py-1 rounded bg-[#2B79F7] text-white text-xs hover:bg-[#1E54B7] disabled:opacity-50"
                          >
                            {isEditing ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      body && (
                        <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words [overflow-wrap:anywhere] mt-0.5">
                          {formatCommentBody(body)}
                        </p>
                      )
                    )}
                    {(() => {
                      // Coalesce legacy file_url/file_name (single-file comments
                      // posted from the agency side) into the attachments grid
                      // so the reviewer sees images regardless of where they
                      // came from.
                      const merged: CommentAttachment[] = []
                      if (c.attachments && c.attachments.length > 0) {
                        merged.push(...c.attachments)
                      }
                      if (c.file_url) {
                        merged.push({
                          url: c.file_url,
                          name: c.file_name || 'Attachment',
                          size: null,
                        })
                      }
                      return merged.length > 0 ? (
                        <CommentAttachments
                          attachments={merged}
                          onPreview={onPreviewMedia}
                        />
                      ) : null
                    })()}
                    {editingCommentId !== c.id && (
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--text-tertiary)]">
                        <button
                          type="button"
                          onClick={() => void toggleResolve(c)}
                          disabled={resolvingCommentId === c.id}
                          className={`px-2 py-0.5 rounded-full border transition-colors ${
                            c.resolved
                              ? 'border-green-500 text-green-600 dark:text-emerald-400 bg-green-50 dark:bg-emerald-500/15 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]'
                              : 'border-[var(--glass-border)] text-[var(--text-tertiary)] hover:border-[#2B79F7] hover:bg-white/5'
                          } disabled:opacity-50`}
                        >
                          {c.resolved ? 'Resolved' : 'Mark resolved'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTo({ commentId: c.id, authorName: author })
                            // Bring the textbox into view so the user knows
                            // their next message will land as a reply.
                            requestAnimationFrame(() => {
                              textareaRef.current?.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                              })
                              textareaRef.current?.focus({ preventScroll: true })
                            })
                          }}
                          className="hover:text-[#2B79F7] transition-colors"
                        >
                          Reply
                        </button>
                        {c.user_id === null &&
                          signedInAs &&
                          (c.reviewer_email || '').toLowerCase() ===
                            signedInAs.toLowerCase() && (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(c)}
                                className="hover:text-[#2B79F7] transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteId(c.id)}
                                className="hover:text-red-600 transition-colors"
                              >
                                Delete
                              </button>
                            </>
                          )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* New-comment preview bubble - same UX as agency/portal. Animates
            in when a comment from someone else arrives while the reviewer
            is scrolled away. Tap to jump to the bottom of the thread. */}
        {unreadPreview && (
          <button
            type="button"
            onClick={() => {
              scrollCommentsToBottom()
              setUnreadPreview(null)
            }}
            aria-label={`Jump to new comment from ${unreadPreview.name}`}
            className="group glass-card flex items-center gap-2 mt-1 pl-1 pr-3 py-1 rounded-full shadow-md text-[11px] text-[var(--text-secondary)] hover:border-[#2B79F7] hover:shadow-lg transition-all animate-in fade-in slide-in-from-bottom-1 duration-200"
          >
            {unreadPreview.avatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={unreadPreview.avatar}
                alt=""
                className="h-6 w-6 rounded-full object-cover shrink-0"
              />
            ) : (
              <span className="h-6 w-6 rounded-full bg-[var(--bg-card-hover)] text-[var(--text-secondary)] text-[10px] font-semibold flex items-center justify-center shrink-0">
                {(unreadPreview.name || 'U').charAt(0).toUpperCase()}
              </span>
            )}
            <span className="font-semibold truncate max-w-[80px]">
              {unreadPreview.name.split(' ')[0]}
            </span>
            <span className="text-[var(--text-tertiary)] truncate max-w-[180px]">
              {unreadPreview.preview || 'sent an attachment'}
            </span>
          </button>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void postComment()
          }}
          className="space-y-2"
        >
          {pendingFiles.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {pendingFiles.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="glass-chip inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-[var(--text-secondary)] max-w-full"
                >
                  <FileIconForName name={f.name} className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                  <span className="truncate max-w-[180px]">{f.name}</span>
                  <span className="text-[10px] text-[var(--text-tertiary)]">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => removePendingFile(i)}
                    className="text-[var(--text-tertiary)] hover:text-red-600"
                    aria-label={`Remove ${f.name}`}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pendingAnnotation && (pendingAnnotation.timestampSeconds || pendingAnnotation.region) && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] flex-wrap">
              <span>Tagged:</span>
              {pendingAnnotation.timestampSeconds != null && (
                <button
                  type="button"
                  onClick={() => handleClearPendingField('timestampSeconds')}
                  title="Remove timestamp"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] font-medium hover:bg-[#D6E5FF] transition-colors shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]"
                >
                  <ClockIcon className="h-3 w-3" />
                  {formatTimestamp(pendingAnnotation.timestampSeconds!)}
                  <XIcon className="h-3 w-3" />
                </button>
              )}
              {pendingAnnotation.region && (
                <button
                  type="button"
                  onClick={() => handleClearPendingField('region')}
                  title="Remove highlight"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8F1FF] text-[#1E54B7] font-medium hover:bg-[#D6E5FF] transition-colors shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]"
                >
                  <PenIcon className="h-3 w-3" />
                  {pendingAnnotation.region.shape === 'circle' ? 'Circle' : 'Highlight'}
                  <XIcon className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {replyTo && (
            <div className="glass-inset flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11px] text-[var(--text-secondary)]">
              <span className="truncate">
                Replying to <span className="font-semibold">{replyTo.authorName}</span>
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="text-red-500 hover:underline shrink-0"
              >
                Cancel
              </button>
            </div>
          )}

          {item.attachments && item.attachments.length > 0 && (
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={handleGrabTime}
                title="Grab the current playback time"
                className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[#2B79F7] transition-colors"
              >
                <ClockIcon className="h-3 w-3" />
                <span>Grab time</span>
              </button>
              <button
                type="button"
                onClick={() => handleAnnotate('circle')}
                title="Draw a region on the asset"
                className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[#2B79F7] transition-colors"
              >
                <PenIcon className="h-3 w-3" />
                <span>Annotate</span>
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 relative">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="glass-chip inline-flex items-center justify-center h-10 w-10 rounded-lg text-[var(--text-tertiary)] hover:text-[#2B79F7] transition-colors"
              aria-label="Attach files"
              title="Attach files (5MB max each)"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                rows={2}
                placeholder={
                  signedInAs ? `Comment as ${signedInAs}… use @name to tag` : 'Leave a comment…'
                }
                onFocus={() => {
                  // Mobile keyboard fix: when the keyboard slides up, the
                  // textarea can end up hidden behind it. Re-scroll the
                  // composer into view after the keyboard finishes animating
                  // (~300ms on iOS) so the user can see what they're typing.
                  setTimeout(() => {
                    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }, 300)
                }}
                className="w-full resize-none px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] placeholder:text-[var(--text-tertiary)]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && mentionQuery === null) {
                    e.preventDefault()
                    void postComment()
                  }
                  if (e.key === 'Escape' && mentionQuery !== null) {
                    setMentionQuery(null)
                  }
                }}
              />
              {mentionQuery !== null && filteredAssignees.length > 0 && (
                <div className="glass-pop absolute z-10 left-0 right-0 bottom-full mb-1 max-h-48 overflow-y-auto rounded-lg text-xs">
                  {filteredAssignees.slice(0, 6).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => insertMention(a)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 text-left"
                    >
                      {a.profile_picture_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={a.profile_picture_url}
                          alt={a.name}
                          className="h-5 w-5 rounded-full object-cover"
                        />
                      ) : (
                        <span className="h-5 w-5 rounded-full bg-[#2B79F7] text-white flex items-center justify-center text-[9px] font-semibold">
                          {a.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="truncate">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {mentionQuery !== null && filteredAssignees.length === 0 && (
                <div className="glass-pop absolute z-10 left-0 right-0 bottom-full mb-1 rounded-lg text-xs px-2.5 py-1.5 text-[var(--text-tertiary)]">
                  No team members match.
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={(!draft.trim() && pendingFiles.length === 0) || isPosting}
              className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-[#2B79F7] text-white hover:bg-[#1E54B7] disabled:opacity-50"
              aria-label="Post comment"
            >
              {isPosting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          {draftMentionedAssignees.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap text-[10px] text-[var(--text-tertiary)]">
              <span>Tagging:</span>
              {draftMentionedAssignees.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded-full bg-[#E8F0FE] text-[#1E54B7] font-medium shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)]"
                >
                  {a.profile_picture_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={a.profile_picture_url}
                      alt={a.name}
                      className="h-3.5 w-3.5 rounded-full object-cover"
                    />
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full bg-[#2B79F7] text-white flex items-center justify-center text-[8px] font-semibold">
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="text-[10px]">@{a.name}</span>
                </span>
              ))}
            </div>
          )}
        </form>
      </div>
      <ConfirmModal
        open={!!pendingDeleteId}
        title="Delete this comment?"
        message="This will permanently remove your comment for everyone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={confirmDelete}
        onClose={() => setPendingDeleteId(null)}
      />
    </div>
  )
}

function CommentAttachments({
  attachments,
  onPreview,
}: {
  attachments: CommentAttachment[]
  onPreview?: (att: CommentAttachment, kind: 'image' | 'video') => void
}) {
  return (
    <ul className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
      {attachments.map((att, i) => {
        const isImg = /\.(png|jpe?g|gif|webp|avif|heic)(\?|$)/i.test(
          att.name || att.url,
        )
        const isVideo = /\.(mp4|mov|webm|m4v)(\?|$)/i.test(
          att.name || att.url,
        )
        const inAppKind = isImg ? 'image' : isVideo ? 'video' : null

        const inner = (
          <>
            {isImg ? (
              <div className="relative aspect-square bg-black/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={att.url}
                  alt={att.name}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            ) : isVideo ? (
              <div className="relative aspect-square bg-black flex items-center justify-center text-white/90">
                <Film className="h-8 w-8" />
                <div className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-full bg-black/60 flex items-center justify-center">
                  <svg className="h-3 w-3 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="aspect-square flex items-center justify-center text-[var(--text-tertiary)]">
                <FileIconForName name={att.name} className="h-6 w-6" />
              </div>
            )}
            <div className="px-2 py-1 border-t border-[var(--glass-border)]">
              <p className="text-[11px] text-[var(--text-secondary)] truncate">{att.name}</p>
              {att.size != null && (
                <p className="text-[10px] text-[var(--text-tertiary)]">{formatBytes(att.size)}</p>
              )}
            </div>
          </>
        )

        return (
          <li key={`${att.url}-${i}`}>
            {inAppKind && onPreview ? (
              <button
                type="button"
                onClick={() => onPreview(att, inAppKind)}
                className="glass-inset block w-full text-left rounded-lg hover:border-[#2B79F7] overflow-hidden focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                title={att.name}
              >
                {inner}
              </button>
            ) : (
              <a
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-inset block rounded-lg hover:border-[#2B79F7] overflow-hidden"
                title={att.name}
              >
                {inner}
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function FileIconForName({ name, className }: { name: string; className?: string }) {
  const lower = name.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|avif|heic)$/.test(lower)) {
    return <ImageIcon className={className} />
  }
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/.test(lower)) {
    return <Film className={className} />
  }
  return <FileText className={className} />
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Truncates text once it exceeds `previewChars`. Anything above that shows a
 * "Show more" toggle. Below the threshold, the toggle is suppressed entirely
 * so short captions look the same as before.
 *
 * We split at the nearest whitespace before the cap so we don't slice a word
 * in half, then ellipsize.
 */
function CollapsibleText({
  text,
  previewChars,
}: {
  text: string
  previewChars: number
}) {
  const [expanded, setExpanded] = useState(false)
  const trimmed = text.trim()
  const needsCollapse = trimmed.length > previewChars
  if (!needsCollapse) {
    return (
      <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {trimmed}
      </p>
    )
  }
  let cut = previewChars
  // Walk back to the nearest whitespace so we don't sever words.
  while (cut > 80 && !/\s/.test(trimmed.charAt(cut))) cut -= 1
  const preview = trimmed.slice(0, cut).trimEnd()
  return (
    <div className="text-sm text-[var(--text-secondary)]">
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {expanded ? trimmed : `${preview}…`}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-xs font-medium text-[#2B79F7] hover:underline"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}

function extractEmailPrefix(content: string): string | null {
  const m = content.match(/^\[([^\]]+)\]\s/)
  return m ? m[1] : null
}

function stripEmailPrefix(content: string): string {
  return content.replace(/^\[[^\]]+\]\s/, '')
}

// ---------------------------------------------------------------------------
// AssetEmbed - full-size inline player / image / preview iframe.
// ---------------------------------------------------------------------------

function AssetEmbed({ url, title }: { url: string; title: string }) {
  const lower = url.toLowerCase()
  const isImage = /\.(png|jpe?g|gif|webp|svg|avif|heic)(\?|$)/.test(lower)
  const isVideo = /\.(mp4|mov|webm|m4v|ogg)(\?|$)/.test(lower)
  const yt = extractYouTubeId(url)
  const vimeoId = extractVimeoId(url)
  const driveEmbed = toDriveEmbed(url)
  const dropboxEmbed = toDropboxEmbed(url)

  if (isImage) {
    return (
      <div className="rounded-xl overflow-hidden border border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={title}
          className="w-full h-auto max-h-[70vh] object-contain bg-black/5"
        />
      </div>
    )
  }

  if (isVideo) {
    // Center the video and let its natural aspect ratio drive the size.
    // - max-h-[70vh] keeps it from dominating the viewport on landscape clips
    // - max-w-full keeps it from overflowing the container on portrait clips
    //   at very tall viewports
    // - the wrapping flex centers portrait clips so 9:16 videos sit in the
    //   middle with letterbox space on the sides instead of stretching
    //   across the whole card width
    return (
      <div className="flex justify-center rounded-xl overflow-hidden border border-[var(--border-primary)] bg-black">
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          className="max-h-[70vh] max-w-full h-auto"
        >
          Your browser doesn&rsquo;t support inline video. Use &ldquo;Open in new tab&rdquo;.
        </video>
      </div>
    )
  }

  if (yt) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-[var(--border-primary)] bg-black aspect-video">
        <iframe
          src={`https://www.youtube.com/embed/${yt}?rel=0&modestbranding=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    )
  }

  if (vimeoId) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-[var(--border-primary)] bg-black aspect-video">
        <iframe
          src={`https://player.vimeo.com/video/${vimeoId}`}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    )
  }

  if (driveEmbed) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-[var(--border-primary)] bg-black aspect-video">
        <iframe
          src={driveEmbed}
          title={title}
          allow="autoplay; fullscreen"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    )
  }

  if (dropboxEmbed) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-[var(--border-primary)] bg-black aspect-video">
        <iframe src={dropboxEmbed} title={title} allowFullScreen className="absolute inset-0 h-full w-full" />
      </div>
    )
  }

  // Anything else (Notion docs, Figma, raw zip files, etc.) - fall back to
  // a clickable card. We deliberately don't try to iframe arbitrary URLs;
  // most of them break with X-Frame-Options anyway.
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-[var(--border-primary)] bg-[var(--bg-tertiary)] hover:border-[#2B79F7] hover:bg-[#E8F1FF] transition-colors p-6 text-center"
    >
      <FileText className="h-8 w-8 mx-auto text-[var(--text-tertiary)] mb-2" />
      <p className="text-sm font-medium text-[var(--text-secondary)]">Open asset in a new tab</p>
      <p className="text-[11px] text-[var(--text-tertiary)] mt-1 break-all [overflow-wrap:anywhere]">{url}</p>
    </a>
  )
}

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
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]+)/)
      if (m) return m[2]
    }
    return null
  } catch {
    return null
  }
}

function extractVimeoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('vimeo.com') && !u.hostname.endsWith('player.vimeo.com')) return null
    const m = u.pathname.match(/\/(?:video\/)?(\d+)/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * Turn a Google Drive viewer URL into the matching `/preview` URL that
 * Drive lets you iframe. Handles `file/d/<id>/view` and `?id=<id>` shapes.
 */
function toDriveEmbed(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('drive.google.com') && !u.hostname.endsWith('docs.google.com')) {
      return null
    }
    let id: string | null = null
    const m = u.pathname.match(/\/file\/d\/([^/]+)/)
    if (m) id = m[1]
    if (!id) id = u.searchParams.get('id')
    if (!id) return null
    return `https://drive.google.com/file/d/${id}/preview`
  } catch {
    return null
  }
}

/**
 * Dropbox shared file URLs end with ?dl=0; switching to ?raw=1 streams the
 * file inline, which an iframe can render for browser-native types.
 */
function toDropboxEmbed(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('dropbox.com')) return null
    u.searchParams.set('raw', '1')
    u.searchParams.delete('dl')
    return u.toString()
  } catch {
    return null
  }
}
