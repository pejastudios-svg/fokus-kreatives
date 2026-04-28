'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loading'
import Image from 'next/image'
import {
  Plus,
  Search,
  MoreVertical,
  Building2,
  Calendar,
  Sparkles,
  Eye,
  Trash2,
  Copy,
  LayoutDashboard,
  CheckCircle,
  LayoutGrid,
  List as ListIcon,
  Archive,
  ArchiveRestore,
  Inbox,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

interface Client {
  id: string
  name: string
  business_name: string
  industry: string
  profile_picture_url: string | null
  created_at: string
}

type ViewMode = 'grid' | 'list'

export default function ClientsPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [clients, setClients] = useState<Client[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set())
  const [activeCount, setActiveCount] = useState<number>(0)
  const [archivedCount, setArchivedCount] = useState<number>(0)
  const [confirmAction, setConfirmAction] = useState<
    | null
    | { kind: 'archive' | 'unarchive' | 'delete'; clientId: string; clientName: string }
  >(null)

  const menuRef = useRef<HTMLDivElement>(null)

  const canCreateClients = userRole === 'admin' || userRole === 'manager'
  const canArchiveClients = userRole === 'admin' || userRole === 'manager'
  const canDeleteClients = userRole === 'admin'

  useEffect(() => {
    const loadUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
      setUserRole(data?.role || null)
    }
    loadUserRole()

    const savedView = typeof window !== 'undefined' ? localStorage.getItem('clientsViewMode') : null
    if (savedView === 'grid' || savedView === 'list') setViewMode(savedView)
  }, [supabase])

  const refreshCounts = useCallback(async () => {
    const [{ count: active }, { count: archived }] = await Promise.all([
      supabase.from('clients').select('*', { count: 'exact', head: true }).is('archived_at', null),
      supabase.from('clients').select('*', { count: 'exact', head: true }).not('archived_at', 'is', null),
    ])
    setActiveCount(active || 0)
    setArchivedCount(archived || 0)
  }, [supabase])

  const fetchClients = useCallback(
    async (archived = false) => {
      setIsLoading(true)

      const query = supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false })

      if (archived) {
        query.not('archived_at', 'is', null)
      } else {
        query.is('archived_at', null)
      }

      const { data } = await query
      if (data) setClients(data)
      setIsLoading(false)
    },
    [supabase],
  )

  useEffect(() => {
    fetchClients(showArchived)
    refreshCounts()
  }, [showArchived, fetchClients, refreshCounts])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current && menuRef.current.contains(target)) return
      if ((event.target as HTMLElement)?.closest?.('[data-menu-trigger]')) return
      setOpenMenuId(null)
      setMenuPos(null)
    }
    const handleReposition = () => {
      setOpenMenuId(null)
      setMenuPos(null)
    }
    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside)
      window.addEventListener('scroll', handleReposition, true)
      window.addEventListener('resize', handleReposition)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleReposition, true)
      window.removeEventListener('resize', handleReposition)
    }
  }, [openMenuId])

  const setView = (mode: ViewMode) => {
    setViewMode(mode)
    if (typeof window !== 'undefined') localStorage.setItem('clientsViewMode', mode)
  }

  const showNotification = (message: string) => {
    setNotification(message)
    setTimeout(() => setNotification(null), 3000)
  }

  const MENU_WIDTH = 208
  const MENU_EST_HEIGHT = 320

  const handleMenuToggle = (e: React.MouseEvent<HTMLButtonElement>, clientId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (openMenuId === clientId) {
      setOpenMenuId(null)
      setMenuPos(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    let left = rect.right - MENU_WIDTH
    if (left < 8) left = 8
    if (left + MENU_WIDTH > viewportW - 8) left = viewportW - MENU_WIDTH - 8
    let top = rect.bottom + 8
    if (top + MENU_EST_HEIGHT > viewportH - 8) {
      top = Math.max(8, rect.top - MENU_EST_HEIGHT - 8)
    }
    setMenuPos({ top, left })
    setOpenMenuId(clientId)
  }

  const handleViewProfile = (clientId: string) => {
    setOpenMenuId(null)
    router.push(`/clients/${clientId}`)
  }

  const handleOpenCRM = (clientId: string) => {
    setOpenMenuId(null)
    router.push(`/crm/${clientId}/dashboard`)
  }

  const handleArchive = async (clientId: string) => {
    setPendingActions((prev) => new Set([...prev, clientId]))
    const originalClients = clients
    setClients((prev) => prev.filter((c) => c.id !== clientId))

    const { error } = await supabase
      .from('clients')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', clientId)

    setPendingActions((prev) => {
      const next = new Set(prev)
      next.delete(clientId)
      return next
    })

    if (error) {
      console.error('Archive error:', error)
      setClients(originalClients)
      showNotification('Failed to archive client')
      return
    }

    showNotification('Client archived')
    refreshCounts()
  }

  const handleUnarchive = async (clientId: string) => {
    setPendingActions((prev) => new Set([...prev, clientId]))
    const originalClients = clients
    setClients((prev) => prev.filter((c) => c.id !== clientId))

    const { error } = await supabase.from('clients').update({ archived_at: null }).eq('id', clientId)

    setPendingActions((prev) => {
      const next = new Set(prev)
      next.delete(clientId)
      return next
    })

    if (error) {
      console.error('Unarchive error:', error)
      setClients(originalClients)
      showNotification('Failed to unarchive client')
      return
    }

    showNotification('Client unarchived')
    refreshCounts()
  }

  const handleCopyCRMLink = async (clientId: string) => {
    const link = `${window.location.origin}/crm/${clientId}/dashboard`
    await navigator.clipboard.writeText(link)
    showNotification('CRM link copied to clipboard!')
    setOpenMenuId(null)
  }

  const handleCreateContent = (clientId: string) => {
    sessionStorage.setItem('selectedClientId', clientId)
    setOpenMenuId(null)
    router.push('/dashboard')
  }

  const handleDelete = async (clientId: string, password?: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) throw new Error('Could not verify session')
    const { error: pwErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password ?? '',
    })
    if (pwErr) throw new Error('Incorrect password')

    setPendingActions((prev) => new Set([...prev, clientId]))
    const originalClients = [...clients]
    setClients(clients.filter((c) => c.id !== clientId))

    try {
      await supabase.from('users').delete().eq('client_id', clientId)
      await supabase.from('leads').delete().eq('client_id', clientId)
      await supabase.from('content').delete().eq('client_id', clientId)
      await supabase.from('automations').delete().eq('client_id', clientId)
      await supabase.from('competitors').delete().eq('client_id', clientId)

      const { error } = await supabase.from('clients').delete().eq('id', clientId)
      if (error) throw error

      showNotification('Client deleted successfully')
      refreshCounts()
    } catch (err) {
      console.error('Delete error:', err)
      setClients(originalClients)
      showNotification('Failed to delete client')
      throw err instanceof Error ? err : new Error('Failed to delete client')
    } finally {
      setPendingActions((prev) => {
        const next = new Set(prev)
        next.delete(clientId)
        return next
      })
    }
  }

  const filteredClients = clients.filter(
    (client) =>
      client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (client.industry && client.industry.toLowerCase().includes(searchQuery.toLowerCase())),
  )

  const renderMenu = (client: Client) => {
    if (typeof window === 'undefined' || !menuPos) return null
    return createPortal(
    <div
      ref={menuRef}
      style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
      className="bg-theme-card rounded-xl shadow-lg border border-theme-primary z-[100] py-1 animate-in zoom-in fade-in duration-150"
    >
      <button
        onClick={() => handleViewProfile(client.id)}
        className="w-full px-4 py-2.5 text-left text-sm text-theme-primary hover:bg-theme-tertiary flex items-center gap-3 transition-colors"
      >
        <Eye className="h-4 w-4 text-theme-tertiary" />
        View Profile
      </button>

      {!showArchived && (
        <>
          <button
            onClick={() => handleOpenCRM(client.id)}
            className="w-full px-4 py-2.5 text-left text-sm text-theme-primary hover:bg-theme-tertiary flex items-center gap-3 transition-colors"
          >
            <LayoutDashboard className="h-4 w-4 text-theme-tertiary" />
            Open CRM
          </button>

          <button
            onClick={() => handleCopyCRMLink(client.id)}
            className="w-full px-4 py-2.5 text-left text-sm text-theme-primary hover:bg-theme-tertiary flex items-center gap-3 transition-colors"
          >
            <Copy className="h-4 w-4 text-theme-tertiary" />
            Copy CRM Link
          </button>

          <button
            onClick={() => handleCreateContent(client.id)}
            className="w-full px-4 py-2.5 text-left text-sm text-theme-primary hover:bg-theme-tertiary flex items-center gap-3 transition-colors"
          >
            <Sparkles className="h-4 w-4 text-theme-tertiary" />
            Create Content
          </button>
        </>
      )}

      {canArchiveClients && (
        <>
          <div className="my-1 border-t border-theme-primary" />
          {showArchived ? (
            <button
              onClick={() => {
                setOpenMenuId(null)
                setConfirmAction({ kind: 'unarchive', clientId: client.id, clientName: client.name })
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-theme-primary hover:bg-theme-tertiary flex items-center gap-3 transition-colors"
            >
              <ArchiveRestore className="h-4 w-4 text-theme-tertiary" />
              Unarchive
            </button>
          ) : (
            <button
              onClick={() => {
                setOpenMenuId(null)
                setConfirmAction({ kind: 'archive', clientId: client.id, clientName: client.name })
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-theme-primary hover:bg-theme-tertiary flex items-center gap-3 transition-colors"
            >
              <Archive className="h-4 w-4 text-theme-tertiary" />
              Archive
            </button>
          )}
        </>
      )}

      {canDeleteClients && (
        <>
          <div className="my-1 border-t border-theme-primary" />
          <button
            onClick={() => {
              setOpenMenuId(null)
              setConfirmAction({ kind: 'delete', clientId: client.id, clientName: client.name })
            }}
            className="w-full px-4 py-2.5 text-left text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-3 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Delete Client
          </button>
        </>
      )}
    </div>,
    document.body,
    )
  }

  return (
    <>
      <Header title="Clients" subtitle="Manage your client accounts" />
      <div className="p-4 md:p-8 animate-in fade-in">
        {/* Notification Toast */}
        {notification && (
          <div className="fixed top-4 right-4 z-50 animate-in fade-in-up duration-300">
            <div className="bg-theme-tertiary text-theme-primary px-4 py-3 rounded-xl shadow-lg border border-theme-primary flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span>{notification}</span>
            </div>
          </div>
        )}

        {/* Actions Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedToggle
              showArchived={showArchived}
              onChange={setShowArchived}
              activeCount={activeCount}
              archivedCount={archivedCount}
            />

            <ViewModeToggle mode={viewMode} onChange={setView} />

            <div className="relative flex-1 min-w-[200px] md:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-tertiary pointer-events-none" />
              <input
                type="text"
                placeholder="Search clients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 input-premium"
              />
            </div>
          </div>

          {!showArchived && canCreateClients && (
            <Link href="/clients/new">
              <Button className="btn-premium w-full lg:w-auto">
                <Plus className="h-5 w-5 mr-2" />
                Add Client
              </Button>
            </Link>
          )}
        </div>

        {/* Clients content */}
        {isLoading ? (
          viewMode === 'grid' ? (
            <GridSkeleton />
          ) : (
            <ListSkeleton />
          )
        ) : filteredClients.length === 0 ? (
          <EmptyState
            searchQuery={searchQuery}
            showArchived={showArchived}
            canCreateClients={canCreateClients}
          />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredClients.map((client) => (
              <Card
                key={client.id}
                className={`card-premium card-lift ${
                  pendingActions.has(client.id) ? 'optimistic-pending' : ''
                } ${showArchived ? 'opacity-70' : ''}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <ClientAvatar client={client} size={48} />
                      <div className="min-w-0">
                        <h3 className="font-semibold text-theme-primary truncate">
                          {client.name}
                        </h3>
                        <p className="text-sm text-theme-secondary truncate">
                          {client.business_name}
                        </p>
                      </div>
                    </div>

                    <div className="relative shrink-0">
                      <button
                        data-menu-trigger
                        onClick={(e) => handleMenuToggle(e, client.id)}
                        className="p-2 hover:bg-theme-tertiary rounded-lg transition-colors"
                        aria-label="Client options"
                      >
                        <MoreVertical className="h-5 w-5 text-theme-tertiary" />
                      </button>
                      {openMenuId === client.id && renderMenu(client)}
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-theme-secondary">
                      <Building2 className="h-4 w-4" />
                      <span className="truncate">
                        {client.industry || 'No industry set'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-theme-secondary">
                      <Calendar className="h-4 w-4" />
                      <span>Added {new Date(client.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-theme-primary flex gap-2">
                    {!showArchived ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleViewProfile(client.id)}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 btn-premium"
                          onClick={() => handleCreateContent(client.id)}
                        >
                          <Sparkles className="h-4 w-4 mr-1" />
                          Create
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleViewProfile(client.id)}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => handleUnarchive(client.id)}
                        >
                          <ArchiveRestore className="h-4 w-4 mr-1" />
                          Unarchive
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="card-premium overflow-hidden">
            <ul className="divide-y divide-gray-200">
              {filteredClients.map((client) => (
                <li
                  key={client.id}
                  className={`px-4 py-4 md:px-6 flex items-center gap-4 hover:bg-theme-tertiary/40 transition-colors ${
                    pendingActions.has(client.id) ? 'optimistic-pending' : ''
                  } ${showArchived ? 'opacity-70' : ''}`}
                >
                  <ClientAvatar client={client} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <h3 className="font-semibold text-theme-primary truncate">
                        {client.name}
                      </h3>
                      <span className="text-sm text-theme-secondary truncate">
                        · {client.business_name}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-xs text-theme-secondary">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        {client.industry || 'No industry'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(client.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="hidden md:flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewProfile(client.id)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View Profile
                    </Button>
                    {!showArchived ? (
                      <Button
                        size="sm"
                        className="btn-premium"
                        onClick={() => handleCreateContent(client.id)}
                      >
                        <Sparkles className="h-4 w-4 mr-1" />
                        Create
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => handleUnarchive(client.id)}>
                        <ArchiveRestore className="h-4 w-4 mr-1" />
                        Unarchive
                      </Button>
                    )}
                  </div>

                  <div className="relative shrink-0">
                    <button
                      data-menu-trigger
                      onClick={(e) => handleMenuToggle(e, client.id)}
                      className="p-2 hover:bg-theme-tertiary rounded-lg transition-colors"
                      aria-label="Client options"
                    >
                      <MoreVertical className="h-5 w-5 text-theme-tertiary" />
                    </button>
                    {openMenuId === client.id && renderMenu(client)}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <ConfirmModal
        open={confirmAction?.kind === 'archive'}
        title="Archive client?"
        message={
          confirmAction?.kind === 'archive'
            ? `${confirmAction.clientName} and their CRM will be archived. You can unarchive them later.`
            : ''
        }
        confirmLabel="Archive"
        tone="warning"
        onConfirm={async () => {
          if (confirmAction?.kind !== 'archive') return
          await handleArchive(confirmAction.clientId)
          setConfirmAction(null)
        }}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmModal
        open={confirmAction?.kind === 'unarchive'}
        title="Unarchive client?"
        message={
          confirmAction?.kind === 'unarchive'
            ? `${confirmAction.clientName} will be reopened and visible in your active clients.`
            : ''
        }
        confirmLabel="Unarchive"
        onConfirm={async () => {
          if (confirmAction?.kind !== 'unarchive') return
          await handleUnarchive(confirmAction.clientId)
          setConfirmAction(null)
        }}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmModal
        open={confirmAction?.kind === 'delete'}
        title="Delete client?"
        message={
          confirmAction?.kind === 'delete'
            ? `This permanently deletes ${confirmAction.clientName} and all associated CRM data. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        tone="danger"
        requirePassword
        onConfirm={async (password) => {
          if (confirmAction?.kind !== 'delete') return
          await handleDelete(confirmAction.clientId, password)
          setConfirmAction(null)
        }}
        onClose={() => setConfirmAction(null)}
      />
    </>
  )
}

function ClientAvatar({ client, size }: { client: Client; size: number }) {
  if (client.profile_picture_url) {
    return (
      <Image
        src={client.profile_picture_url}
        alt={client.name}
        width={size}
        height={size}
        unoptimized
        className="rounded-full object-cover ring-2 ring-theme-primary shrink-0"
      />
    )
  }
  return (
    <div
      className="rounded-full bg-brand-gradient flex items-center justify-center text-white font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {client.name.charAt(0).toUpperCase()}
    </div>
  )
}

function SegmentedToggle({
  showArchived,
  onChange,
  activeCount,
  archivedCount,
}: {
  showArchived: boolean
  onChange: (archived: boolean) => void
  activeCount: number
  archivedCount: number
}) {
  return (
    <div className="relative inline-flex items-center bg-theme-tertiary rounded-full p-1 border border-theme-primary">
      <span
        className="absolute top-1 bottom-1 rounded-full bg-theme-card shadow-sm transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{
          left: showArchived ? '50%' : '4px',
          right: showArchived ? '4px' : '50%',
        }}
      />
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`relative z-10 px-4 py-1.5 text-xs font-semibold rounded-full transition-colors flex items-center gap-1.5 ${
          !showArchived ? 'text-[#2B79F7]' : 'text-theme-secondary hover:text-theme-primary'
        }`}
      >
        Active
        <span
          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
            !showArchived ? 'bg-[#E8F1FF] text-[#2B79F7]' : 'bg-theme-primary/10 text-theme-secondary'
          }`}
        >
          {activeCount}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`relative z-10 px-4 py-1.5 text-xs font-semibold rounded-full transition-colors flex items-center gap-1.5 ${
          showArchived ? 'text-[#2B79F7]' : 'text-theme-secondary hover:text-theme-primary'
        }`}
      >
        Archived
        <span
          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
            showArchived ? 'bg-[#E8F1FF] text-[#2B79F7]' : 'bg-theme-primary/10 text-theme-secondary'
          }`}
        >
          {archivedCount}
        </span>
      </button>
    </div>
  )
}

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex items-center bg-theme-tertiary rounded-xl p-1 border border-theme-primary">
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={`p-1.5 rounded-lg transition-colors ${
          mode === 'grid'
            ? 'bg-theme-card text-[#2B79F7] shadow-sm'
            : 'text-theme-secondary hover:text-theme-primary'
        }`}
        aria-label="Grid view"
        title="Grid view"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`p-1.5 rounded-lg transition-colors ${
          mode === 'list'
            ? 'bg-theme-card text-[#2B79F7] shadow-sm'
            : 'text-theme-secondary hover:text-theme-primary'
        }`}
        aria-label="List view"
        title="List view"
      >
        <ListIcon className="h-4 w-4" />
      </button>
    </div>
  )
}

function EmptyState({
  searchQuery,
  showArchived,
  canCreateClients,
}: {
  searchQuery: string
  showArchived: boolean
  canCreateClients: boolean
}) {
  if (showArchived) {
    return (
      <Card className="card-premium animate-in fade-in-up duration-300">
        <CardContent className="py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-theme-tertiary mx-auto mb-4 flex items-center justify-center">
            <Inbox className="h-8 w-8 text-theme-tertiary" />
          </div>
          <h3 className="text-lg font-semibold text-theme-primary mb-2">
            {searchQuery ? 'No archived clients match' : 'Nothing archived'}
          </h3>
          <p className="text-theme-secondary max-w-sm mx-auto">
            {searchQuery
              ? 'Try a different search term or switch back to Active.'
              : 'Archived clients show up here. Archive a client from their card menu when you want to keep their data but hide them from the main list.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="card-premium animate-in fade-in-up duration-300">
      <CardContent className="py-16 text-center">
        <div className="h-16 w-16 rounded-full bg-[#E8F1FF] mx-auto mb-4 flex items-center justify-center">
          <Building2 className="h-8 w-8 text-[#2B79F7]" />
        </div>
        <h3 className="text-lg font-semibold text-theme-primary mb-2">
          {searchQuery ? 'No clients found' : 'No clients yet'}
        </h3>
        <p className="text-theme-secondary mb-4 max-w-sm mx-auto">
          {searchQuery
            ? 'Try a different search term'
            : 'Add your first client to start creating content'}
        </p>
        {!searchQuery && canCreateClients && (
          <Link href="/clients/new">
            <Button className="btn-premium">
              <Plus className="h-5 w-5 mr-2" />
              Add Your First Client
            </Button>
          </Link>
        )}
      </CardContent>
    </Card>
  )
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} className="card-premium h-48">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-8 w-8 rounded" />
            </div>
            <div className="space-y-2 mt-4">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <div className="mt-6 flex gap-2">
              <Skeleton className="h-9 flex-1 rounded-lg" />
              <Skeleton className="h-9 flex-1 rounded-lg" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ListSkeleton() {
  return (
    <Card className="card-premium overflow-hidden animate-in fade-in">
      <ul className="divide-y divide-gray-200">
        {[1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="px-6 py-4 flex items-center gap-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-9 w-24 rounded-lg hidden md:block" />
            <Skeleton className="h-9 w-24 rounded-lg hidden md:block" />
            <Skeleton className="h-8 w-8 rounded" />
          </li>
        ))}
      </ul>
    </Card>
  )
}
