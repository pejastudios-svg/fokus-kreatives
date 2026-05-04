'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MessageSquare, Send, X, AtSign } from 'lucide-react'

interface MentionableUser {
  id: string
  name: string | null
  email: string
  profile_picture_url: string | null
}

interface TaskMessage {
  id: string
  body: string
  created_at: string
  user_id: string | null
  users: {
    id: string
    name: string | null
    email: string
    profile_picture_url: string | null
  } | null
}

interface Props {
  taskId: string
  /** Agency members eligible for @mention. */
  members: MentionableUser[]
}

/**
 * Floating per-task chat panel. Anchored bottom-right on mobile, side panel on
 * desktop. Each task owns its own thread (via task_id), so messages don't
 * leak across subtasks. @mentions pop a member picker as you type.
 */
export function TaskChat({ taskId, members }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<TaskMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [mentionState, setMentionState] = useState<{
    query: string
    start: number
  } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load + subscribe whenever the panel is opened or the task changes.
  useEffect(() => {
    if (!open || !taskId) return
    let cancelled = false
    setIsLoading(true)

    void (async () => {
      const res = await fetch(`/api/tasks/${taskId}/messages`)
      const data = await res.json()
      if (!cancelled && data.success) {
        setMessages(data.messages)
      }
      if (!cancelled) setIsLoading(false)
    })()

    const channel = supabase
      .channel(`task-messages-${taskId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'task_messages',
          filter: `task_id=eq.${taskId}`,
        },
        async (payload) => {
          const inserted = payload.new as { id: string }
          // Re-fetch the joined row so we have user info.
          const { data: row } = await supabase
            .from('task_messages')
            .select('id, body, created_at, user_id, users:user_id (id, name, email, profile_picture_url)')
            .eq('id', inserted.id)
            .maybeSingle()
          if (!cancelled && row) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev
              return [...prev, row as unknown as TaskMessage]
            })
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'task_messages',
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          const deleted = payload.old as { id: string }
          if (!cancelled) {
            setMessages((prev) => prev.filter((m) => m.id !== deleted.id))
          }
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [open, taskId, supabase])

  // Auto-scroll to bottom on new messages or on first open.
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, messages.length])

  const filteredMentions = useMemo(() => {
    if (!mentionState) return []
    const q = mentionState.query.toLowerCase()
    return members
      .filter((m) => {
        const name = (m.name || '').toLowerCase()
        const email = (m.email || '').toLowerCase()
        return !q || name.includes(q) || email.includes(q)
      })
      .slice(0, 6)
  }, [members, mentionState])

  const onChangeDraft = (next: string, caret: number) => {
    setDraft(next)
    // Detect an active @mention: look back from the caret for a '@' that's
    // either at the start of the message or preceded by whitespace.
    let i = caret - 1
    let foundAt = -1
    while (i >= 0) {
      const ch = next[i]
      if (ch === '@') {
        if (i === 0 || /\s/.test(next[i - 1])) foundAt = i
        break
      }
      if (/\s/.test(ch)) break
      i--
    }
    if (foundAt === -1) {
      setMentionState(null)
    } else {
      setMentionState({ start: foundAt, query: next.slice(foundAt + 1, caret) })
    }
  }

  const insertMention = (member: MentionableUser) => {
    if (!mentionState || !inputRef.current) return
    const display = (member.name || member.email).split(' ')[0]
    const before = draft.slice(0, mentionState.start)
    const after = draft.slice(mentionState.start + 1 + mentionState.query.length)
    const next = `${before}@${display} ${after}`
    setDraft(next)
    setMentionState(null)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      const caret = (before + '@' + display + ' ').length
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const handleSend = useCallback(async () => {
    const body = draft.trim()
    if (!body || isSending) return
    setIsSending(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const data = await res.json()
      if (data.success) {
        setDraft('')
        setMentionState(null)
        // Realtime subscription will push the new message in; if it's already
        // there from the optimistic side, that's fine - we dedupe by id.
        setMessages((prev) =>
          prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
        )
      }
    } finally {
      setIsSending(false)
    }
  }, [draft, isSending, taskId])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionState && (e.key === 'Enter' || e.key === 'Tab')) {
      if (filteredMentions.length > 0) {
        e.preventDefault()
        insertMention(filteredMentions[0])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <>
      {/* Toggle button: floating bottom-right when closed. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-3 rounded-full bg-[#2B79F7] text-white shadow-lg hover:bg-[#1E54B7] transition-colors"
          aria-label="Open task chat"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="text-sm font-medium">Chat</span>
          {messages.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--bg-card)] text-[#2B79F7] text-[10px] font-semibold">
              {messages.length}
            </span>
          )}
        </button>
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-30 w-full sm:w-96 bg-[var(--bg-card)] border-l border-[var(--border-primary)] shadow-xl flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between px-4 h-14 border-b border-[var(--border-primary)] shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[#2B79F7]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Task chat</h3>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[var(--bg-tertiary)]">
          {isLoading ? (
            <p className="text-xs text-[var(--text-tertiary)] text-center py-4">Loading messages…</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)] text-center py-8">
              No messages yet. Start the conversation.
            </p>
          ) : (
            messages.map((m) => {
              const author = m.users
              const initial = ((author?.name || author?.email || '?').charAt(0) || '?').toUpperCase()
              return (
                <div key={m.id} className="flex items-start gap-2">
                  {author?.profile_picture_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={author.profile_picture_url}
                      alt={author.name || author.email}
                      className="h-8 w-8 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-brand-gradient text-white text-xs font-semibold flex items-center justify-center shrink-0">
                      {initial}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {author?.name || author?.email || 'Unknown'}
                      </span>
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        {new Date(m.created_at).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words [overflow-wrap:anywhere] mt-0.5">
                      {m.body}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="relative border-t border-[var(--border-primary)] p-3 bg-[var(--bg-card)] shrink-0">
          {mentionState && filteredMentions.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-2 bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-lg shadow-lg overflow-hidden z-10">
              {filteredMentions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => insertMention(m)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)]"
                >
                  {m.profile_picture_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={m.profile_picture_url}
                      alt={m.name || m.email}
                      className="h-6 w-6 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                      {((m.name || m.email).charAt(0) || '?').toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {m.name || 'Unnamed'}
                    </p>
                    <p className="text-[10px] text-[var(--text-tertiary)] truncate">{m.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) =>
                  onChangeDraft(e.target.value, e.target.selectionStart ?? e.target.value.length)
                }
                onKeyDown={onKeyDown}
                placeholder="Message… use @ to mention"
                rows={2}
                className="w-full resize-none px-3 py-2 pr-9 rounded-lg border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] placeholder:text-[var(--text-tertiary)]"
              />
              <button
                type="button"
                onClick={() => {
                  setDraft((d) => `${d}@`)
                  inputRef.current?.focus()
                }}
                className="absolute right-2 bottom-2 p-1 rounded text-[var(--text-tertiary)] hover:text-[#2B79F7]"
                aria-label="Insert mention"
                tabIndex={-1}
              >
                <AtSign className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!draft.trim() || isSending}
              className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-[#2B79F7] text-white hover:bg-[#1E54B7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
