'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { CRMLayout } from '@/components/crm/CRMLayout'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
import { 
  Plus, Hash, Lock, Send, Smile, Paperclip, Mic, Image as ImageIcon,
  Pin, Reply, X, Users, Search, Bold, Italic, List, ListOrdered,
  Link as LinkIcon, AtSign, Trash2, UserPlus, Archive, MessageCircle,
  ChevronLeft, ChevronRight, Volume2, StopCircle, PlusCircle, ZoomIn,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// Types
interface Channel {
  id: string
  name: string
  description: string | null
  is_private: boolean
  is_dm?: boolean
  archived_at?: string | null
  created_by: string
  created_at: string
}

interface Message {
  id: string
  channel_id: string
  user_id: string
  content: string
  content_html?: string | null
  message_type: string
  file_url?: string | null
  file_name?: string | null
  reply_to?: string | null
  is_pinned?: boolean
  reactions?: Record<string, string[]>
  created_at: string
  edited_at?: string | null
  user?: User | null
}

interface User {
  id: string
  name: string
  email: string
  bio?: string | null
  profile_picture_url?: string | null
  role?: string
}

const emojiList = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇',
  '🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔',
  '🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐',
  '😯','😪','😫','🥱','😴','😌','😛','🤤','😷','🤒',
  '🔥','✨','💥','💯','✅','❌','⚠️','⭐','🌟','🚀',
  '👍','👎','👏','🙌','💪','🙏','🤝','👀','💀','🥳'
]
export default function CRMInbox() {
  const params = useParams()
  const clientId = params.clientId as string
  const supabase = createClient()

  // Core state
  const [isLoading, setIsLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [userRole, setUserRole] = useState('employee')
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  
  // UI state
  const [messageInput, setMessageInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  
  // Modals
  const [showChannelModal, setShowChannelModal] = useState(false)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [showPinnedModal, setShowPinnedModal] = useState(false)
  const [showUserProfile, setShowUserProfile] = useState<User | null>(null)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null)
  const [showImageViewer, setShowImageViewer] = useState<string | null>(null)
  
  // Link modal state
  const [linkText, setLinkText] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkSelectionRange, setLinkSelectionRange] = useState<{start: number, end: number} | null>(null)
  
  // Mentions
  const [showMentions, setShowMentions] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  
  // New channel
  const [newChannel, setNewChannel] = useState({ name: '', description: '', isPrivate: false })
  
  // Recording
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load initial data
  useEffect(() => {
    if (clientId) loadInitialData()
  }, [clientId])

  // Realtime subscription
  useEffect(() => {
    if (!selectedChannel) return
    const sub = supabase
      .channel(`inbox-${selectedChannel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${selectedChannel.id}` }, () => loadMessages(selectedChannel.id))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${selectedChannel.id}` }, () => loadMessages(selectedChannel.id))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `channel_id=eq.${selectedChannel.id}` }, () => loadMessages(selectedChannel.id))
      .subscribe()
    return () => { sub.unsubscribe() }
  }, [selectedChannel])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Recording timer
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isRecording) {
      interval = setInterval(() => setRecordingTime(p => p + 1), 1000)
    }
    return () => clearInterval(interval)
  }, [isRecording])

  const loadInitialData = async () => {
    setIsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).single()
      if (userData) {
        setCurrentUser(userData)
        setUserRole(userData.role || 'employee')
      }

      const { data: usersData } = await supabase.from('users').select('*').order('name')
      setAllUsers(usersData || [])

      await loadChannels()
    } finally {
      setIsLoading(false)
    }
  }

  const loadChannels = async () => {
    const { data, error } = await supabase
      .from('channels')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at')

    if (error) {
      console.error('Load channels error:', error.message)
      return
    }

    const active = (data || []).filter(c => !c.archived_at)
    setChannels(active)

    if (active.length > 0 && !selectedChannel) {
      setSelectedChannel(active[0])
      loadMessages(active[0].id)
    } else if (active.length === 0) {
      createDefaultChannel()
    }
  }

  const createDefaultChannel = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase
      .from('channels')
      .insert({ client_id: clientId, name: 'general', description: 'General discussion', is_private: false, created_by: user?.id })
      .select()
      .single()
    if (data) {
      setChannels([data])
      setSelectedChannel(data)
    }
  }

  const loadMessages = async (channelId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(100)

    if (error) {
      console.error('Load messages error:', error.message)
      return
    }

    // Fetch user data for messages
      const msgs = await Promise.all(
  (data || []).map(async (m) => {
    const reactions = m.reactions || {}
    const safeHtml = m.content_html || parseToHtml(m.content || '', currentUser?.name)

    if (m.user_id) {
      const { data: u } = await supabase
        .from('users')
        .select('*')
        .eq('id', m.user_id)
        .single()

      return { ...m, user: u, reactions, content_html: safeHtml }
    }

    return { ...m, reactions, content_html: safeHtml }
  })
)
setMessages(msgs)
  }

  const handleSelectChannel = (channel: Channel) => {
    setSelectedChannel(channel)
    loadMessages(channel.id)
    setReplyTo(null)
    setShowEmojiPicker(null)
  }

  const handleCreateChannel = async () => {
    if (!newChannel.name.trim() || !currentUser) return
    const name = newChannel.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const { data } = await supabase
      .from('channels')
      .insert({ client_id: clientId, name, description: newChannel.description || null, is_private: newChannel.isPrivate, created_by: currentUser.id })
      .select()
      .single()
    if (data) {
      setChannels(p => [...p, data])
      setSelectedChannel(data)
      loadMessages(data.id)
      setShowChannelModal(false)
      setNewChannel({ name: '', description: '', isPrivate: false })
    }
  }

  // Send message
  const handleSendMessage = async () => {
  if (!messageHtml.trim() || !selectedChannel || !currentUser || isSending) return
  setIsSending(true)

  // Plain text for data/search; HTML for display
  const contentHtml = messageHtml.trim()
  const plainText = messageInput.trim() || (inputRef.current as any)?.innerText?.trim() || ''
  const tempId = `temp-${Date.now()}`

  const tempMsg: Message = {
    id: tempId,
    channel_id: selectedChannel.id,
    user_id: currentUser.id,
    content: plainText,
    content_html: contentHtml,
    message_type: 'text',
    is_pinned: false,
    reactions: {},
    created_at: new Date().toISOString(),
    user: currentUser,
  }

  setMessages((prev) => [...prev, tempMsg])
  setMessageInput('')
  setMessageHtml('')
  setReplyTo(null)
  // Clear editor visually
  if (inputRef.current) {
    ;(inputRef.current as any).innerHTML = ''
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        channel_id: selectedChannel.id,
        user_id: currentUser.id,
        content: plainText,
        content_html: contentHtml,
        message_type: 'text',
        reply_to: replyTo?.id || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Send error:', error.message)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      // restore editor content
      setMessageHtml(contentHtml)
      setMessageInput(plainText)
      if (inputRef.current) {
        ;(inputRef.current as any).innerHTML = contentHtml
      }
    } else if (data) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? {
                ...m,
                ...data,
                content_html: data.content_html || contentHtml,
                user: currentUser,
                reactions: m.reactions || {},
              }
            : m
        )
      )
    }
  } catch (e) {
    console.error('Send exception:', e)
    setMessages((prev) => prev.filter((m) => m.id !== tempId))
    setMessageHtml(contentHtml)
    setMessageInput(plainText)
    if (inputRef.current) {
      ;(inputRef.current as any).innerHTML = contentHtml
    }
  } finally {
    setIsSending(false)
  }
}

  // Parse markdown-like syntax to HTML (bold, italic, links, mentions)
const parseToHtml = (text: string, currentUserName?: string): string => {
  if (!text) return ''

  let html = text

  // Escape HTML entities
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="text-[#2B79F7] underline hover:text-[#1E54B7]">$1</a>'
  )

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>')

  // Italic: *text*
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em class="italic">$1</em>')

  // Underline: __text__
  html = html.replace(/__(.+?)__/g, '<span class="underline">$1</span>')

  // @channel
  html = html.replace(
    /@channel\b/g,
    '<span class="bg-[#2B79F7]/20 text-[#2B79F7] px-1 rounded font-medium">@channel</span>'
  )

  // Mentions: @username
  html = html.replace(/@([a-zA-Z0-9_]+)/g, (match, name) => {
    // If it's the current user, use green
    if (currentUserName && name.toLowerCase() === currentUserName.toLowerCase()) {
      return `<span class="bg-green-500/20 text-green-400 px-1 rounded font-medium">@${name}</span>`
    }
    return `<span class="bg-[#2B79F7]/20 text-[#2B79F7] px-1 rounded font-medium">@${name}</span>`
  })

  // New lines
  html = html.replace(/\n/g, '<br>')

  return html
}

  const handleKeyDown = (e: React.KeyboardEvent) => {
  const editor = inputRef.current as any

  // Enter sends message
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSendMessage()
    return
  }

  // Shift+Enter: new line and continue bullet/number if present
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault()
    if (!editor) return

    const text = editor.innerText || ''
    // Get current caret (approximate by length of text for now)
    const caretPos = text.length

    // Find current line
    const lineStart = text.lastIndexOf('\n', caretPos - 1) + 1
    const lineEndIdx = text.indexOf('\n', lineStart)
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
    const line = text.slice(lineStart, lineEnd).trim()

    let prefix = ''
    const numberMatch = line.match(/^(\d+)\.\s/)
    if (numberMatch) {
      const currentNum = parseInt(numberMatch[1], 10)
      prefix = `${currentNum + 1}. `
    } else if (line.startsWith('• ')) {
      prefix = '• '
    }

    // If no bullet or number, just insert newline
    const insertText = prefix ? `\n${prefix}` : '\n'

    const newText = text + insertText
    const newHtml = plainTextToHtml(newText)

    editor.innerHTML = newHtml
    setMessageInput(newText)
    setMessageHtml(newHtml)

    // move caret to end
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection.addRange(range)
    }
  }
}

  // Formatting using contentEditable execCommand-like behavior
const applyFormat = (type: 'bold' | 'italic' | 'bullet' | 'number') => {
  const editor = inputRef.current as any
  if (!editor) return

  editor.focus()

  const selection = window.getSelection()
  if (!selection) return

  if (type === 'bold') {
    document.execCommand('bold')
    // Sync state
    setMessageHtml(editor.innerHTML)
    setMessageInput(editor.innerText || '')
    return
  }

  if (type === 'italic') {
    document.execCommand('italic')
    setMessageHtml(editor.innerHTML)
    setMessageInput(editor.innerText || '')
    return
  }

  // For bullet/number we keep your existing text-based behavior,
  // but apply it to messageInput + then re-render HTML
  const text = editor.innerText || ''
  const start = selection.anchorOffset
  const end = selection.focusOffset
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  let newText = text

  if (type === 'bullet' || type === 'number') {
    // Simple approach: prefix current line
    const lineStart = text.lastIndexOf('\n', from - 1) + 1
    const lineEndIdx = text.indexOf('\n', lineStart)
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
    const line = text.slice(lineStart, lineEnd)

    if (type === 'bullet') {
      if (line.trim().match(/^\d+\.\s/)) {
        // number -> bullet
        const stripped = line.replace(/^\s*\d+\.\s/, '')
        newText = text.slice(0, lineStart) + `• ${stripped}` + text.slice(lineEnd)
      } else if (line.trim().startsWith('• ')) {
        // already bullet -> leave
        newText = text
      } else {
        newText = text.slice(0, lineStart) + '• ' + text.slice(lineStart)
      }
    } else if (type === 'number') {
      if (line.trim().startsWith('• ')) {
        const stripped = line.replace(/^\s*•\s/, '')
        newText = text.slice(0, lineStart) + `1. ${stripped}` + text.slice(lineEnd)
      } else if (line.trim().match(/^\d+\.\s/)) {
        newText = text
      } else {
        newText = text.slice(0, lineStart) + '1. ' + text.slice(lineStart)
      }
    }
  }

  // Update editor HTML from newText (simple conversion with <br>)
  const html = newText.split('\n').map(line => line || '<br>').join('<br>')
  editor.innerHTML = html
  setMessageHtml(html)
  setMessageInput(newText)
}

  const openLinkModal = () => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    setLinkText('')
  } else {
    setLinkText(selection.toString())
  }
  setLinkUrl('')
  setShowLinkModal(true)
}

  const insertLink = () => {
  if (!linkUrl) return
  const editor = inputRef.current as any
  if (!editor) return

  editor.focus()

  const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`

  // Use execCommand to wrap the current selection
  document.execCommand('createLink', false, url)

  // Sync state
  const html = editor.innerHTML
  const text = editor.innerText || ''
  setMessageHtml(html)
  setMessageInput(text)

  setShowLinkModal(false)
  setLinkUrl('')
  setLinkText('')
}

// Convert plain text (with \n) into simple HTML with <br>
// This keeps bullets/numbers chars visible.
const plainTextToHtml = (text: string) => {
  if (!text) return ''
  return text
    .split('\n')
    .map((line) => (line === '' ? '<br>' : line.replace(/ /g, '&nbsp;')))
    .join('<br>')
}

  const handlePinMessage = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId)
    if (!msg) return
    const pinned = !msg.is_pinned
    setMessages(p => p.map(m => m.id === msgId ? { ...m, is_pinned: pinned } : m))
    await supabase.from('messages').update({ is_pinned: pinned }).eq('id', msgId)
  }

  const handleDeleteMessage = async (msgId: string) => {
    setMessages(p => p.filter(m => m.id !== msgId))
    await supabase.from('messages').delete().eq('id', msgId)
  }

  // Scroll to pinned message
  const scrollToMessage = (msgId: string) => {
    const el = messageRefs.current.get(msgId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('bg-yellow-500/20')
      setTimeout(() => el.classList.remove('bg-yellow-500/20'), 2000)
    }
    setShowPinnedModal(false)
  }

  // File upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedChannel || !currentUser) return

    const tempId = `temp-${Date.now()}`
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'
    
    // Optimistic
    const tempMsg: Message = {
      id: tempId,
      channel_id: selectedChannel.id,
      user_id: currentUser.id,
      content: file.name,
      message_type: type,
      file_url: URL.createObjectURL(file),
      file_name: file.name,
      is_pinned: false,
      reactions: {},
      created_at: new Date().toISOString(),
      user: currentUser,
    }
    setMessages(p => [...p, tempMsg])

    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', `inbox/${clientId}`)

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        const { data: msgData } = await supabase
          .from('messages')
          .insert({ channel_id: selectedChannel.id, user_id: currentUser.id, content: file.name, message_type: type, file_url: data.url, file_name: file.name })
          .select()
          .single()
        if (msgData) setMessages(p => p.map(m => m.id === tempId ? { ...msgData, user: currentUser, reactions: {} } : m))
      } else {
        setMessages(p => p.filter(m => m.id !== tempId))
      }
    } catch {
      setMessages(p => p.filter(m => m.id !== tempId))
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      recorder.ondataavailable = e => audioChunksRef.current.push(e.data)
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach(t => t.stop())
        await uploadVoice(blob)
      }
      recorder.start()
      setIsRecording(true)
      setRecordingTime(0)
    } catch (e) {
      console.error('Recording error:', e)
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  const uploadVoice = async (blob: Blob) => {
    if (!selectedChannel || !currentUser) return
    const formData = new FormData()
    formData.append('file', blob, `voice-${Date.now()}.webm`)
    formData.append('folder', `inbox/${clientId}/voice`)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        await supabase.from('messages').insert({ channel_id: selectedChannel.id, user_id: currentUser.id, content: 'Voice message', message_type: 'voice', file_url: data.url })
        loadMessages(selectedChannel.id)
      }
    } catch (e) {
      console.error('Voice upload error:', e)
    }
  }

  // DM
  const startDM = async (targetUser: User) => {
    if (!currentUser) return
    const { data: existing } = await supabase
      .from('channels')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_dm', true)
      .or(`name.eq.dm-${currentUser.id}-${targetUser.id},name.eq.dm-${targetUser.id}-${currentUser.id}`)
      .single()

    if (existing) {
      setSelectedChannel(existing)
      loadMessages(existing.id)
      setShowUserProfile(null)
      return
    }

    const { data: newDM } = await supabase
      .from('channels')
      .insert({ client_id: clientId, name: `dm-${currentUser.id}-${targetUser.id}`, is_private: true, is_dm: true, created_by: currentUser.id })
      .select()
      .single()

    if (newDM) {
      setChannels(p => [...p, newDM])
      setSelectedChannel(newDM)
      loadMessages(newDM.id)
    }
    setShowUserProfile(null)
  }

  const archiveChannel = async (id: string) => {
    if (!confirm('Archive this channel?')) return
    await supabase.from('channels').update({ archived_at: new Date().toISOString() }).eq('id', id)
    setChannels(p => p.filter(c => c.id !== id))
    if (selectedChannel?.id === id) {
      const rest = channels.filter(c => c.id !== id)
      setSelectedChannel(rest[0] || null)
      if (rest[0]) loadMessages(rest[0].id)
    }
  }

  // Helpers
  const getChannelName = (ch: Channel) => {
    if (ch.is_dm) {
      const otherId = ch.name.replace('dm-', '').split('-').find(id => id !== currentUser?.id)
      const other = allUsers.find(u => u.id === otherId)
      return other?.name || 'Direct Message'
    }
    return ch.name
  }

  const getTime = (msg: Message) => {
    const d = new Date(msg.created_at)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const canManage = userRole === 'admin' || userRole === 'manager' || userRole === 'owner'
  const canSend = userRole !== 'viewer'
  const filteredChannels = channels.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const pinnedMessages = messages.filter(m => m.is_pinned)

  if (isLoading) {
    return <CRMLayout><div className="flex items-center justify-center h-full"><Loading size="lg" text="Loading..." /></div></CRMLayout>
  }

  return (
  <CRMLayout>
    <div className="flex h-full min-h-0">
        {/* SIDEBAR */}
        <div className={`${sidebarCollapsed ? 'w-16' : 'w-64'} flex-shrink-0 flex flex-col bg-[#0F172A] border-r border-[#334155] transition-all duration-200`}>
          {/* Sidebar Header */}
          <div className="h-14 px-3 flex items-center justify-between border-b border-[#334155]">
            {!sidebarCollapsed && <span className="text-white font-semibold">Inbox</span>}
            <div className="flex gap-1">
              {canManage && !sidebarCollapsed && (
                <button onClick={() => setShowChannelModal(true)} className="p-2 hover:bg-[#1E293B] rounded-lg text-gray-400 hover:text-white"><Plus className="h-4 w-4" /></button>
              )}
              <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-2 hover:bg-[#1E293B] rounded-lg text-gray-400 hover:text-white">
                {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Search */}
          {!sidebarCollapsed && (
            <div className="p-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-3 py-1.5 bg-[#1E293B] border border-[#334155] rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#2B79F7]"
                />
              </div>
            </div>
          )}

          {/* Channels list - SCROLLABLE INDEPENDENTLY */}
<div className="flex-1 min-h-0">
  <div className="h-full overflow-y-auto p-2">
    {!sidebarCollapsed && (
      <p className="px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase">
        Channels
      </p>
    )}

    {filteredChannels
      .filter(c => !c.is_dm)
      .map((ch) => (
        <button
          key={ch.id}
          onClick={() => handleSelectChannel(ch)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left mb-0.5 transition-colors ${
            selectedChannel?.id === ch.id
              ? 'bg-[#2B79F7] text-white'
              : 'text-gray-400 hover:bg-[#1E293B] hover:text-white'
          }`}
        >
          {ch.is_private ? (
            <Lock className="h-4 w-4 flex-shrink-0" />
          ) : (
            <Hash className="h-4 w-4 flex-shrink-0" />
          )}
          {!sidebarCollapsed && <span className="truncate text-sm">{ch.name}</span>}
        </button>
      ))}

    {filteredChannels.filter(c => c.is_dm).length > 0 && !sidebarCollapsed && (
      <>
        <p className="px-2 py-1 mt-3 text-[10px] font-semibold text-gray-500 uppercase">
          Direct Messages
        </p>
        {filteredChannels
          .filter(c => c.is_dm)
          .map((ch) => (
            <button
              key={ch.id}
              onClick={() => handleSelectChannel(ch)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left mb-0.5 transition-colors ${
                selectedChannel?.id === ch.id
                  ? 'bg-[#2B79F7] text-white'
                  : 'text-gray-400 hover:bg-[#1E293B] hover:text-white'
              }`}
            >
              <MessageCircle className="h-4 w-4 flex-shrink-0" />
              <span className="truncate text-sm">{getChannelName(ch)}</span>
            </button>
          ))}
      </>
    )}
  </div>
</div>

          {/* Members link */}
          {!sidebarCollapsed && (
            <div className="p-3 border-t border-[#334155]">
              <button onClick={() => setShowMembersModal(true)} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white w-full">
                <Users className="h-4 w-4" />
                <span>{allUsers.length} members</span>
              </button>
            </div>
          )}
        </div>

        {/* MAIN CHAT - Flex column with fixed header and input */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#0F172A]">
          {selectedChannel ? (
            <>
              {/* Channel Header - FIXED */}
              <div className="h-14 px-4 flex items-center justify-between border-b border-[#334155] bg-[#1E293B] flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  {selectedChannel.is_dm ? <MessageCircle className="h-5 w-5 text-gray-400" /> : selectedChannel.is_private ? <Lock className="h-5 w-5 text-gray-400" /> : <Hash className="h-5 w-5 text-gray-400" />}
                  <span className="font-semibold text-white truncate">{getChannelName(selectedChannel)}</span>
                </div>
                <div className="flex items-center gap-1">
                  {pinnedMessages.length > 0 && (
                    <button onClick={() => setShowPinnedModal(true)} className="relative p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white">
                      <Pin className="h-5 w-5" />
                      <span className="absolute -top-0.5 -right-0.5 bg-[#2B79F7] text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">{pinnedMessages.length}</span>
                    </button>
                  )}
                  <button onClick={() => setShowMembersModal(true)} className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white"><Users className="h-5 w-5" /></button>
                  {canManage && !selectedChannel.is_dm && (
                    <button onClick={() => archiveChannel(selectedChannel.id)} className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-yellow-400"><Archive className="h-5 w-5" /></button>
                  )}
                </div>
              </div>

              {/* Messages - SCROLLABLE INDEPENDENTLY */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Hash className="h-12 w-12 text-gray-600 mb-3" />
                    <h3 className="text-lg font-semibold text-white mb-1">Welcome to #{getChannelName(selectedChannel)}</h3>
                    <p className="text-gray-400 text-sm">Start the conversation</p>
                  </div>
                ) : (
                  messages.map((msg, i) => {
                    const showAvatar = i === 0 || messages[i - 1]?.user_id !== msg.user_id || msg.message_type === 'system'
                    const isOwn = msg.user_id === currentUser?.id

                    if (msg.message_type === 'system') {
                      return (
                        <div key={msg.id} className="flex justify-center py-1">
                          <span className="text-xs text-gray-500 bg-[#1E293B] px-3 py-1 rounded-full">{msg.content}</span>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={msg.id}
                        ref={el => { if (el) messageRefs.current.set(msg.id, el) }}
                        className={`group flex gap-2 transition-colors rounded-lg ${msg.is_pinned ? 'bg-yellow-500/10 border-l-2 border-yellow-500 pl-2' : ''}`}
                      >
                        {showAvatar ? (
  <button
    onClick={() => setShowUserProfile(msg.user || null)}
    className="flex-shrink-0 mt-0.5 group/avatar"
  >
    {msg.user?.profile_picture_url ? (
      <div className="relative">
        <img
          src={msg.user.profile_picture_url}
          className="h-8 w-8 rounded-full object-cover ring-2 ring-transparent group-hover/avatar:ring-[#2B79F7] transition-all"
        />
      </div>
    ) : (
      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#2B79F7] to-[#1E54B7] flex items-center justify-center text-white text-sm font-medium ring-2 ring-transparent group-hover/avatar:ring-[#2B79F7] transition-all">
        {(msg.user?.name || 'U')[0].toUpperCase()}
      </div>
    )}
  </button>
) : (
  <div className="w-8 flex-shrink-0" />
)}

                        <div className="flex-1 min-w-0">
                          {showAvatar && (
                            <div className="flex items-baseline gap-2 mb-0.5">
                              <span className="text-white font-medium text-sm">{msg.user?.name || 'Unknown'}</span>
                              <span className="text-[10px] text-gray-500">{getTime(msg)}</span>
                              {msg.is_pinned && <Pin className="h-3 w-3 text-yellow-500" />}
                            </div>
                          )}

                          {/* Content */}
                          {msg.message_type === 'voice' ? (
                            <div className="flex items-center gap-2 p-2 bg-[#1E293B] rounded-lg w-fit">
                              <Volume2 className="h-4 w-4 text-[#2B79F7]" />
                              <audio src={msg.file_url || ''} controls className="h-8" />
                            </div>
                          ) : msg.message_type === 'image' ? (
                            <img
                              src={msg.file_url || ''}
                              alt=""
                              className="max-w-xs rounded-lg cursor-pointer hover:opacity-90"
                              onClick={() => setShowImageViewer(msg.file_url || null)}
                            />
                          ) : msg.message_type === 'video' ? (
                            <video src={msg.file_url || ''} controls className="max-w-xs rounded-lg" />
                          ) : msg.message_type === 'file' ? (
                            <a href={msg.file_url || ''} target="_blank" className="flex items-center gap-2 p-2 bg-[#1E293B] rounded-lg text-[#2B79F7] hover:underline text-sm">
                              <Paperclip className="h-4 w-4" />{msg.file_name || 'File'}
                            </a>
                          ) : (
  <div
    className="text-gray-200 text-sm break-words"
    dangerouslySetInnerHTML={{
      __html: msg.content_html || parseToHtml(msg.content || '', currentUser?.name),
    }}
  />
)
}

                          {/* Reactions */}
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(msg.reactions).map(([emoji, uids]) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleReaction(msg.id, emoji)}
                                  title={(uids as string[]).map(uid => allUsers.find(u => u.id === uid)?.name || 'Unknown').join(', ')}
                                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                                    (uids as string[]).includes(currentUser?.id || '') ? 'bg-[#2B79F7]/30 text-[#2B79F7]' : 'bg-[#334155] text-gray-300'
                                  }`}
                                >
                                  {emoji} {(uids as string[]).length}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-start gap-0.5 transition-opacity">
                          <div className="relative">
                            <button onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)} className="p-1 hover:bg-[#334155] rounded text-gray-400 hover:text-white"><Smile className="h-4 w-4" /></button>
                            {showEmojiPicker === msg.id && (
                              <div className="absolute right-0 top-7 bg-[#1E293B] border border-[#334155] rounded-lg p-1.5 shadow-xl z-20 w-[200px]">
                                <div className="grid grid-cols-8 gap-0.5">
                                  {emojiList.map(e => <button key={e} onClick={() => handleReaction(msg.id, e)} className="p-1 hover:bg-[#334155] rounded text-sm">{e}</button>)}
                                </div>
                              </div>
                            )}
                          </div>
                          <button onClick={() => setReplyTo(msg)} className="p-1 hover:bg-[#334155] rounded text-gray-400 hover:text-white"><Reply className="h-4 w-4" /></button>
                          <button onClick={() => handlePinMessage(msg.id)} className={`p-1 hover:bg-[#334155] rounded ${msg.is_pinned ? 'text-yellow-500' : 'text-gray-400 hover:text-white'}`}><Pin className="h-4 w-4" /></button>
                          {isOwn && <button onClick={() => handleDeleteMessage(msg.id)} className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>}
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply preview */}
              {replyTo && (
                <div className="px-4 py-2 bg-[#1E293B] border-t border-[#334155] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-gray-400 min-w-0">
                    <Reply className="h-4 w-4 flex-shrink-0" />
                    <span>Replying to <strong className="text-white">{replyTo.user?.name}</strong></span>
                  </div>
                  <button onClick={() => setReplyTo(null)} className="p-1 hover:bg-[#334155] rounded text-gray-400"><X className="h-4 w-4" /></button>
                </div>
              )}

              {/* Mentions dropdown */}
              {showMentions && (
  <div className="px-4 py-2 bg-[#1E293B] border-t border-[#334155]">
    <div className="flex flex-wrap gap-1">
      <button
        onClick={() => {
          setMessageInput((prev) => {
            const idx = prev.lastIndexOf('@')
            if (idx === -1) return prev + '@channel '
            const before = prev.slice(0, idx)
            const after = prev.slice(idx + 1 + mentionSearch.length)
            const next = `${before}@channel ${after}`
            setMessageHtml(plainTextToHtml(next))
            if (inputRef.current) {
              ;(inputRef.current as any).innerHTML = plainTextToHtml(next)
            }
            return next
          })
          setShowMentions(false)
        }}
        className="px-2 py-1 bg-[#2B79F7]/20 text-[#2B79F7] rounded text-xs"
      >
        @channel
      </button>
      {allUsers
        .filter((u) => u.name.toLowerCase().includes(mentionSearch))
        .slice(0, 5)
        .map((u) => (
          <button
            key={u.id}
            onClick={() => {
              const username = u.name.split(' ')[0]
              setMessageInput((prev) => {
                const idx = prev.lastIndexOf('@')
                if (idx === -1) {
                  const next = prev + `@${username} `
                  setMessageHtml(plainTextToHtml(next))
                  if (inputRef.current) {
                    ;(inputRef.current as any).innerHTML = plainTextToHtml(next)
                  }
                  return next
                }
                const before = prev.slice(0, idx)
                const after = prev.slice(idx + 1 + mentionSearch.length)
                const next = `${before}@${username} ${after}`
                setMessageHtml(plainTextToHtml(next))
                if (inputRef.current) {
                  ;(inputRef.current as any).innerHTML = plainTextToHtml(next)
                }
                return next
              })
              setShowMentions(false)
            }}
            className="px-2 py-1 bg-[#334155] text-white rounded text-xs"
          >
            {u.name}
          </button>
        ))}
    </div>
  </div>
)}

              {/* Input - FIXED at bottom */}
              {canSend && (
                <div className="p-3 border-t border-[#334155] bg-[#1E293B] flex-shrink-0">
                  <div className="bg-[#0F172A] border border-[#334155] rounded-xl">
                    {/* Toolbar */}
                    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-[#334155]">
                      <button onClick={() => applyFormat('bold')} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white" title="Bold"><Bold className="h-4 w-4" /></button>
                      <button onClick={() => applyFormat('italic')} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white" title="Italic"><Italic className="h-4 w-4" /></button>
                      <button onClick={() => applyFormat('bullet')} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white" title="Bullet list"><List className="h-4 w-4" /></button>
                      <button onClick={() => applyFormat('number')} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white" title="Numbered list"><ListOrdered className="h-4 w-4" /></button>
                      <button onClick={openLinkModal} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white" title="Link"><LinkIcon className="h-4 w-4" /></button>
                      <div className="w-px h-4 bg-[#334155] mx-1" />
                      <button onClick={() => setShowMentions(!showMentions)} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white" title="Mention"><AtSign className="h-4 w-4" /></button>
                    </div>

                    {/* Textarea */}
<textarea
  ref={inputRef}
  value={messageInput}
  onChange={(e) => {
    const val = e.target.value
    setMessageInput(val)

    if (val.includes('@')) {
      setShowMentions(true)
      setMentionSearch(val.split('@').pop() || '')
    } else {
      setShowMentions(false)
    }
  }}
  onKeyDown={handleKeyDown}
  placeholder={`Message #${getChannelName(selectedChannel)}`}
  rows={2}
  className="w-full px-3 py-2 bg-transparent text-white placeholder-gray-500 text-sm focus:outline-none resize-none"
/>

                    {/* Bottom toolbar */}
                    <div className="flex items-center justify-between px-2 py-1.5 border-t border-[#334155]">
                      <div className="flex items-center gap-0.5">
                        <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
                        <button onClick={() => fileInputRef.current?.click()} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white"><Paperclip className="h-4 w-4" /></button>
                        <button onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = 'image/*,video/*'; fileInputRef.current.click() } }} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white"><ImageIcon className="h-4 w-4" /></button>
                        {isRecording ? (
                          <button onClick={stopRecording} className="p-1.5 bg-red-500 rounded text-white flex items-center gap-1"><StopCircle className="h-4 w-4" /><span className="text-xs">{Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span></button>
                        ) : (
                          <button onClick={startRecording} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white"><Mic className="h-4 w-4" /></button>
                        )}
                        <div className="relative">
                          <button onClick={() => setShowEmojiPicker(showEmojiPicker === 'input' ? null : 'input')} className="p-1.5 hover:bg-[#334155] rounded text-gray-400 hover:text-white"><Smile className="h-4 w-4" /></button>
                          {showEmojiPicker === 'input' && (
                            <div className="absolute bottom-10 left-0 bg-[#1E293B] border border-[#334155] rounded-lg p-1.5 shadow-xl z-20 w-[200px]">
                              <div className="grid grid-cols-8 gap-0.5">
                                {emojiList.map(e => <button key={e} onClick={() => { setMessageInput(p => p + e); setShowEmojiPicker(null) }} className="p-1 hover:bg-[#334155] rounded text-sm">{e}</button>)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <Button onClick={handleSendMessage} disabled={!messageInput.trim() || isSending} size="sm" isLoading={isSending}><Send className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Hash className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-white">Select a channel</h3>
                <p className="text-gray-400 text-sm">Choose a channel to start</p>
              </div>
            </div>
          )}
        </div>

        {/* MODALS */}
        {showChannelModal && (
          <Modal onClose={() => setShowChannelModal(false)} title="Create Channel">
            <div className="space-y-3">
              <input type="text" value={newChannel.name} onChange={e => setNewChannel({ ...newChannel, name: e.target.value })} placeholder="Channel name" className="w-full px-3 py-2 bg-[#0F172A] border border-[#334155] rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#2B79F7]" />
              <input type="text" value={newChannel.description} onChange={e => setNewChannel({ ...newChannel, description: e.target.value })} placeholder="Description (optional)" className="w-full px-3 py-2 bg-[#0F172A] border border-[#334155] rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#2B79F7]" />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newChannel.isPrivate} onChange={e => setNewChannel({ ...newChannel, isPrivate: e.target.checked })} className="rounded bg-[#0F172A] border-[#334155] text-[#2B79F7]" />
                <span className="text-white text-sm">Private channel</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#334155]">
              <Button variant="outline" onClick={() => setShowChannelModal(false)} size="sm">Cancel</Button>
              <Button onClick={handleCreateChannel} disabled={!newChannel.name.trim()} size="sm">Create</Button>
            </div>
          </Modal>
        )}

        {showMembersModal && (
          <Modal onClose={() => setShowMembersModal(false)} title="Members">
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {allUsers.map(u => (
                <div key={u.id} onClick={() => { setShowMembersModal(false); setShowUserProfile(u) }} className="flex items-center gap-2 p-2 bg-[#0F172A] rounded-lg hover:bg-[#1E293B] cursor-pointer">
                  {u.profile_picture_url ? <img src={u.profile_picture_url} className="h-8 w-8 rounded-full" /> : <div className="h-8 w-8 rounded-full bg-[#2B79F7] flex items-center justify-center text-white text-sm">{u.name[0]}</div>}
                  <div>
                    <p className="text-white text-sm font-medium">{u.name}</p>
                    <p className="text-gray-400 text-xs">{u.email}</p>
                  </div>
                </div>
              ))}
            </div>
          </Modal>
        )}

        {showPinnedModal && (
          <Modal onClose={() => setShowPinnedModal(false)} title="Pinned Messages">
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {pinnedMessages.length === 0 ? <p className="text-gray-400 text-center py-6">No pinned messages</p> : pinnedMessages.map(m => (
                <div key={m.id} onClick={() => scrollToMessage(m.id)} className="p-3 bg-[#0F172A] rounded-lg border-l-2 border-yellow-500 cursor-pointer hover:bg-[#1E293B]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white text-sm font-medium">{m.user?.name}</span>
                    <span className="text-gray-500 text-xs">{getTime(m)}</span>
                  </div>
                  <p className="text-gray-300 text-sm">{m.content}</p>
                </div>
              ))}
            </div>
          </Modal>
        )}

        {showUserProfile && (
          <Modal onClose={() => setShowUserProfile(null)} title="Profile">
  <div className="text-center">
    {showUserProfile.profile_picture_url ? (
      <img
        src={showUserProfile.profile_picture_url}
        className="h-20 w-20 rounded-full mx-auto mb-3 ring-2 ring-[#2B79F7]"
      />
    ) : (
      <div className="h-20 w-20 rounded-full bg-gradient-to-br from-[#2B79F7] to-[#1E54B7] flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3">
        {showUserProfile.name[0]}
      </div>
    )}
    <h3 className="text-white font-semibold text-lg">{showUserProfile.name}</h3>
    <p className="text-gray-400 text-sm">{showUserProfile.email}</p>
    {showUserProfile.role && (
      <p className="mt-1 text-xs text-gray-500 uppercase tracking-wide">
        {showUserProfile.role}
      </p>
    )}
    {showUserProfile.bio && (
      <p className="text-gray-300 text-sm mt-3 p-3 bg-[#0F172A] rounded-lg text-left">
        {showUserProfile.bio}
      </p>
    )}
    {showUserProfile.id !== currentUser?.id && (
      <Button onClick={() => startDM(showUserProfile)} className="mt-4 w-full" size="sm">
        <MessageCircle className="h-4 w-4 mr-2" />
        Message
      </Button>
    )}
  </div>
</Modal>
        )}

        {showLinkModal && (
          <Modal onClose={() => setShowLinkModal(false)} title="Insert Link">
            <div className="space-y-3">
              <input type="text" value={linkText} onChange={e => setLinkText(e.target.value)} placeholder="Display text" className="w-full px-3 py-2 bg-[#0F172A] border border-[#334155] rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#2B79F7]" />
              <input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." className="w-full px-3 py-2 bg-[#0F172A] border border-[#334155] rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#2B79F7]" autoFocus />
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#334155]">
              <Button variant="outline" onClick={() => setShowLinkModal(false)} size="sm">Cancel</Button>
              <Button onClick={insertLink} disabled={!linkUrl} size="sm">Insert</Button>
            </div>
          </Modal>
        )}

        {/* Image Viewer Modal */}
        {showImageViewer && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50" onClick={() => setShowImageViewer(null)}>
            <button className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white hover:bg-white/20"><X className="h-6 w-6" /></button>
            <img src={showImageViewer} alt="" className="max-w-[90vw] max-h-[90vh] object-contain" onClick={e => e.stopPropagation()} />
          </div>
        )}
      </div>
    </CRMLayout>
  )
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#1E293B] rounded-xl border border-[#334155] w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#334155]">
          <h3 className="text-white font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-[#334155] rounded text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}