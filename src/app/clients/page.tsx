'use client'

import { useState, useEffect, useRef } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
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
  CheckCircle
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Client {
  id: string
  name: string
  business_name: string
  industry: string
  profile_picture_url: string | null
  created_at: string
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set())
  const menuRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
  fetchClients(showArchived)
}, [showArchived])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null)
      }
    }

    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openMenuId])

  const fetchClients = async (archived = false) => {
  setIsLoading(true)
  
  const query = supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })

  if (archived) {
    query.not('archived_at', 'is', null) // archived only
  } else {
    query.is('archived_at', null) // active only
  }

  const { data, error } = await query

  if (data) setClients(data)
  setIsLoading(false)
}

  const showNotification = (message: string) => {
    setNotification(message)
    setTimeout(() => setNotification(null), 3000)
  }

  const handleMenuToggle = (e: React.MouseEvent, clientId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setOpenMenuId(openMenuId === clientId ? null : clientId)
  }

  const handleViewProfile = (clientId: string) => {
    setOpenMenuId(null)
    router.push(`/clients/${clientId}`)
  }

  const handleOpenCRM = (clientId: string) => {
    setOpenMenuId(null)
    router.push(`/crm/${clientId}/dashboard`)
  }

  const handleUnarchive = async (clientId: string) => {
  const confirmed = window.confirm(
    'Unarchive this client and reopen their CRM?'
  )
  if (!confirmed) return

  const { error } = await supabase
    .from('clients')
    .update({ archived_at: null })
    .eq('id', clientId)

  if (error) {
    console.error('Unarchive error:', error)
    showNotification('Failed to unarchive client')
    return
  }

  showNotification('Client unarchived')
  fetchClients(true) // reload archived list
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

  const handleDelete = async (clientId: string) => {
    setOpenMenuId(null)
    
    const confirmed = window.confirm(
      'Are you sure you want to delete this client? This will also delete all associated data. This action cannot be undone.'
    )
    
    if (!confirmed) return

    // Optimistic update
    setPendingActions(prev => new Set([...prev, clientId]))
    const originalClients = [...clients]
    setClients(clients.filter(c => c.id !== clientId))

    try {
      await supabase.from('users').delete().eq('client_id', clientId)
      await supabase.from('leads').delete().eq('client_id', clientId)
      await supabase.from('content').delete().eq('client_id', clientId)
      await supabase.from('automations').delete().eq('client_id', clientId)
      await supabase.from('competitors').delete().eq('client_id', clientId)
      
      const { error } = await supabase.from('clients').delete().eq('id', clientId)

      if (error) throw error

      showNotification('Client deleted successfully')
    } catch (err) {
      console.error('Delete error:', err)
      setClients(originalClients)
      showNotification('Failed to delete client')
    } finally {
      setPendingActions(prev => {
        const next = new Set(prev)
        next.delete(clientId)
        return next
      })
    }
  }

  const filteredClients = clients.filter(client =>
    client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (client.industry && client.industry.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  return (
    <DashboardLayout>
      <Header 
        title="Clients" 
        subtitle="Manage your client accounts"
      />
      <div className="p-8">
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
        <div className="flex items-center justify-between mb-6">
  <div className="flex items-center gap-4">
    {/* View toggle */}
    <div className="inline-flex rounded-xl border border-theme-primary bg-theme-card">
      <button
        type="button"
        onClick={() => setShowArchived(false)}
        className={`px-3 py-1.5 text-xs font-medium rounded-l-xl ${
          !showArchived
            ? 'bg-theme-primary text-theme-inverse'
            : 'text-theme-secondary hover:bg-theme-tertiary'
        }`}
      >
        Active
      </button>
      <button
        type="button"
        onClick={() => setShowArchived(true)}
        className={`px-3 py-1.5 text-xs font-medium rounded-r-xl ${
          showArchived
            ? 'bg-theme-primary text-theme-inverse'
            : 'text-theme-secondary hover:bg-theme-tertiary'
        }`}
      >
        Archived
      </button>
    </div>

    {/* Search */}
    <div className="relative w-80">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-theme-tertiary" />
      <input
        type="text"
        placeholder="Search clients..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full pl-9 pr-4 py-2.5 input-premium"
      />
    </div>
  </div>

  {!showArchived && (
    <Link href="/clients/new">
      <Button className="btn-premium">
        <Plus className="h-5 w-5 mr-2" />
        Add Client
      </Button>
    </Link>
  )}
</div>

        {/* Clients Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loading size="lg" text="Loading clients..." />
          </div>
        ) : filteredClients.length === 0 ? (
          <Card className="card-premium">
            <CardContent className="py-12 text-center">
              <Building2 className="h-12 w-12 text-theme-tertiary mx-auto mb-4" />
              <h3 className="text-lg font-medium text-theme-primary mb-2">
                {searchQuery ? 'No clients found' : 'No clients yet'}
              </h3>
              <p className="text-theme-secondary mb-4">
                {searchQuery 
                  ? 'Try a different search term' 
                  : 'Add your first client to start creating content'
                }
              </p>
              {!searchQuery && (
                <Link href="/clients/new">
                  <Button className="btn-premium">
                    <Plus className="h-5 w-5 mr-2" />
                    Add Your First Client
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredClients.map((client) => (
              <Card 
                key={client.id} 
                className={`card-premium card-lift ${pendingActions.has(client.id) ? 'optimistic-pending' : ''}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {client.profile_picture_url ? (
                        <img 
                          src={client.profile_picture_url}
                          alt={client.name}
                          className="h-12 w-12 rounded-full object-cover ring-2 ring-theme-primary"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-brand-gradient flex items-center justify-center text-white font-semibold text-lg">
                          {client.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <h3 className="font-semibold text-theme-primary">{client.name}</h3>
                        <p className="text-sm text-theme-secondary">{client.business_name}</p>
                      </div>
                    </div>
                    
                    {/* 3-Dot Menu */}
                    <div className="relative" ref={openMenuId === client.id ? menuRef : null}>
                      <button 
                        onClick={(e) => handleMenuToggle(e, client.id)}
                        className="p-2 hover:bg-theme-tertiary rounded-lg transition-colors"
                        aria-label="Client options"
                      >
                        <MoreVertical className="h-5 w-5 text-theme-tertiary" />
                      </button>
                      
                      {openMenuId === client.id && (
                        <div className="absolute right-0 mt-2 w-52 bg-theme-card rounded-xl shadow-lg border border-theme-primary z-50 py-1 animate-in zoom-in fade-in duration-150">
                          <button 
                            onClick={() => handleViewProfile(client.id)}
                            className="w-full px-4 py-2.5 text-left text-sm text-theme-primary hover:bg-theme-tertiary flex items-center gap-3 transition-colors"
                          >
                            <Eye className="h-4 w-4 text-theme-tertiary" />
                            View Profile
                          </button>
                          
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
                          
                          <div className="my-1 border-t border-theme-primary"></div>
                          
                          <button 
                            onClick={() => handleDelete(client.id)}
                            className="w-full px-4 py-2.5 text-left text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-3 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete Client
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Client Info */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-theme-secondary">
                      <Building2 className="h-4 w-4" />
                      <span>{client.industry || 'No industry set'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-theme-secondary">
                      <Calendar className="h-4 w-4" />
                      <span>Added {new Date(client.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="mt-4 pt-4 border-t border-theme-primary flex gap-2">
  {!showArchived && (
    <>
      <Button 
        variant="outline" 
        size="sm" 
        className="flex-1"
        onClick={() => handleViewProfile(client.id)}
      >
        View Profile
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
  )}

  {showArchived && (
    <Button
      size="sm"
      className="flex-1"
      onClick={() => handleUnarchive(client.id)}
    >
      Unarchive
    </Button>
  )}
</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}