'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  MoreVertical,
  Sparkles,
  Pencil,
  Archive as ArchiveIcon,
  Trash2,
  RefreshCw,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Briefcase,
  Crown,
  Users as UsersIcon,
  Target,
  Megaphone,
  Building2,
  Check,
  Mail,
  X as XIcon,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { useAgencyUser } from '@/components/auth/AgencyUserContext'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Loading'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ClientAssignees } from '@/components/clients/ClientAssignees'
import { TopicsBank } from '@/components/clients/TopicsBank'
import { createClient } from '@/lib/supabase/client'
import { normalizeBrandProfile, type BrandProfile } from '@/components/clients/brandProfile'

type ContentTier = 'beginner' | 'mid' | 'advanced'
type PackageTier = 'top' | 'middle' | 'lower'

interface ClientRow {
  id: string
  name: string | null
  business_name: string | null
  industry: string | null
  profile_picture_url: string | null
  target_audience: string | null
  brand_doc_url: string | null
  brand_doc_text: string | null
  dos_and_donts: string | null
  topics_library: string | null
  key_stories: string | null
  unique_mechanisms: string | null
  social_proof: string | null
  competitor_insights: string | null
  website_url: string | null
  content_tier: ContentTier | null
  package_tier: PackageTier | null
  brand_profile: BrandProfile | null
  archived_at: string | null
  brand_intake_token: string | null
  brand_intake_submitted_at: string | null
  created_at: string
}

const PACKAGE_TIER_LABEL: Record<PackageTier, string> = {
  top: 'Top (Authority Engine)',
  middle: 'Middle (Growth)',
  lower: 'Lower (Foundation)',
}

type TabKey = 'overview' | 'audience' | 'guidelines' | 'competitors' | 'team'

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: Briefcase },
  { key: 'audience', label: 'Audience', icon: Target },
  { key: 'guidelines', label: 'Brand guidelines', icon: FileText },
  { key: 'competitors', label: 'Competitors', icon: Megaphone },
  { key: 'team', label: 'Team', icon: UsersIcon },
]

export default function ClientProfilePage() {
  const params = useParams()
  const router = useRouter()
  const clientId = (params?.id as string) ?? ''

  const supabase = useMemo(() => createClient(), [])

  // Role-derived capabilities come from AuthGuard's context. No
  // per-page fetch = no loading flicker on Archive / Delete buttons.
  const { canArchiveClients: canArchive, canDeleteClients: canDelete } =
    useAgencyUser()

  const [client, setClient] = useState<ClientRow | null>(null)
  const [clientEmails, setClientEmails] = useState<
    {
      id: string
      email: string
      name: string | null
      role?: string | null
      invitation_accepted: boolean | null
    }[]
  >([])
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('overview')

  const [confirmKind, setConfirmKind] = useState<null | 'archive' | 'delete'>(null)
  const [isGeneratingIntake, setIsGeneratingIntake] = useState(false)

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const flash = useCallback((type: 'success' | 'error', message: string, ms = 2500) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), ms)
  }, [])

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const refresh = useCallback(async () => {
    if (!clientId) return
    setIsLoading(true)
    const [{ data, error }, { data: directUsers }, { data: members }] =
      await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).single(),
        // Portal user(s) for this client (role='client') + any user whose
        // client_id points here for legacy reasons. Don't gate on role - if a
        // client was created without a portal email, this returns nothing and
        // we fall back to CRM team membership emails below.
        supabase
          .from('users')
          .select('id, email, name, role, invitation_accepted, created_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: true }),
        // CRM team members assigned to this client (managers/employees whose
        // client_id may be null but who have a row in client_memberships).
        supabase
          .from('client_memberships')
          .select('users:user_id (id, email, name, role)')
          .eq('client_id', clientId),
      ])
    if (error) {
      console.error('load client error:', error)
      setClient(null)
    } else {
      setClient(data as ClientRow)
    }
    type EmailRow = {
      id: string
      email: string
      name: string | null
      role?: string | null
      invitation_accepted: boolean | null
    }
    const seen = new Set<string>()
    const merged: EmailRow[] = []
    for (const u of (directUsers || []) as EmailRow[]) {
      if (!u?.email || seen.has(u.id)) continue
      seen.add(u.id)
      merged.push(u)
    }
    type MemberRow = {
      users:
        | { id: string; email: string; name: string | null; role: string | null }
        | { id: string; email: string; name: string | null; role: string | null }[]
        | null
    }
    for (const m of (members || []) as MemberRow[]) {
      const u = Array.isArray(m.users) ? m.users[0] : m.users
      if (!u?.email || seen.has(u.id)) continue
      seen.add(u.id)
      merged.push({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        invitation_accepted: null,
      })
    }
    setClientEmails(merged)
    setIsLoading(false)
  }, [supabase, clientId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // ---- Action handlers ---------------------------------------------------
  const handleCreateContent = () => {
    if (!clientId) return
    try {
      sessionStorage.setItem('selectedClientId', clientId)
    } catch {}
    router.push('/dashboard')
  }

  const intakeLink = client?.brand_intake_token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/intake/${client.brand_intake_token}`
    : null

  const handleCopyIntake = async () => {
    if (!intakeLink) {
      flash('error', 'Generate an intake link first')
      return
    }
    await navigator.clipboard.writeText(intakeLink)
    flash('success', 'Intake link copied')
  }

  const handleRegenerateIntake = async () => {
    if (!clientId) return
    setIsGeneratingIntake(true)
    try {
      const res = await fetch('/api/clients/brand-intake/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const data = await res.json()
      if (!data.success) {
        flash('error', data.error || 'Failed to regenerate link')
      } else {
        flash('success', 'New intake link generated')
        await refresh()
      }
    } finally {
      setIsGeneratingIntake(false)
    }
  }

  const handleArchive = async () => {
    if (!clientId) return
    const { error } = await supabase
      .from('clients')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', clientId)
    if (error) throw new Error('Failed to archive client')
    router.push('/clients')
  }

  const handleDelete = async (password?: string) => {
    if (!clientId) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email) throw new Error('Could not verify session')
    const { error: pwErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password ?? '',
    })
    if (pwErr) throw new Error('Incorrect password')

    await supabase.from('users').delete().eq('client_id', clientId)
    const { error } = await supabase.from('clients').delete().eq('id', clientId)
    if (error) throw new Error('Failed to delete client')

    router.push('/clients')
  }

  // ---- Render ------------------------------------------------------------
  if (isLoading) {
    return (
      <>
        <Header title="Client profile" />
        <ClientProfileSkeleton />
      </>
    )
  }

  if (!client) {
    return (
      <>
        <Header title="Client" />
        <div className="p-4 md:p-8 text-center">
          <p className="text-[var(--text-tertiary)] mb-4">Client not found</p>
          <Link href="/clients" className="text-[#2B79F7] hover:underline">
            Back to clients
          </Link>
        </div>
      </>
    )
  }

  const profile = normalizeBrandProfile(client.brand_profile)
  const submittedAt = client.brand_intake_submitted_at
    ? new Date(client.brand_intake_submitted_at)
    : null

  return (
    <>
      <Header title="Client profile" subtitle={client.business_name || client.name || ''} />
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        {/* Back + notification */}
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/clients"
            className="inline-flex items-center text-[#2B79F7] hover:underline text-sm"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to clients
          </Link>
          {client.archived_at && (
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-50 text-yellow-700 text-xs font-medium">
              <ArchiveIcon className="h-3.5 w-3.5" />
              Archived
            </span>
          )}
        </div>

        {notification && (
          <div
            className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
              notification.type === 'success'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle className="h-5 w-5" />
            ) : (
              <AlertCircle className="h-5 w-5" />
            )}
            {notification.message}
          </div>
        )}

        {/* Hero card */}
        <Card className="mb-6">
          <CardContent className="relative p-6 md:p-8">
            {/* Centered content - avatar, name, business, meta row. */}
            <div className="flex flex-col items-center text-center">
              {client.profile_picture_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={client.profile_picture_url}
                  alt={client.name || ''}
                  className="h-24 w-24 md:h-28 md:w-28 rounded-full object-cover ring-4 ring-[#E8F1FF] mb-4"
                />
              ) : (
                <div className="h-24 w-24 md:h-28 md:w-28 rounded-full bg-brand-gradient flex items-center justify-center text-white text-3xl md:text-4xl font-bold ring-4 ring-[#E8F1FF] mb-4">
                  {(client.name || 'U').charAt(0).toUpperCase()}
                </div>
              )}

              <h1 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)]">
                {client.name || 'Unnamed client'}
              </h1>
              {client.business_name && (
                <p className="text-[var(--text-secondary)] mt-1">{client.business_name}</p>
              )}

              <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-[var(--text-tertiary)]">
                {client.industry && (
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {client.industry}
                  </span>
                )}
                {client.content_tier && (
                  <span className="inline-flex items-center gap-1 capitalize">
                    <Crown className="h-3.5 w-3.5" />
                    {client.content_tier} tier
                  </span>
                )}
                {client.package_tier && (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5" />
                    {PACKAGE_TIER_LABEL[client.package_tier]}
                  </span>
                )}
                {client.website_url && (
                  <a
                    href={client.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#2B79F7] hover:underline"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Website
                  </a>
                )}
              </div>

              {clientEmails.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  {clientEmails.map((u) => {
                    const isClient = !u.role || u.role === 'client'
                    const tag = isClient
                      ? null
                      : u.role === 'admin' || u.role === 'manager'
                        ? 'manager'
                        : 'team'
                    const titleText = u.invitation_accepted === false
                      ? 'Invitation pending'
                      : tag
                        ? `${u.name || u.email} · ${tag}`
                        : u.name || u.email
                    return (
                      <a
                        key={u.id}
                        href={`mailto:${u.email}`}
                        title={titleText}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-medium hover:bg-[#5A9AFF]/20 transition-colors"
                      >
                        <Mail className="h-3 w-3" />
                        <span className="truncate max-w-[220px]">{u.email}</span>
                        {u.invitation_accepted === false && (
                          <span className="text-[10px] opacity-70">(pending)</span>
                        )}
                        {tag && (
                          <span className="text-[10px] opacity-70">· {tag}</span>
                        )}
                      </a>
                    )
                  })}
                </div>
              )}

              {submittedAt && (
                <p className="mt-3 text-xs text-[var(--text-tertiary)]">
                  Brand intake submitted {submittedAt.toLocaleDateString()}
                </p>
              )}
            </div>

            {/* 3-dot menu - anchored top-right so it doesn't push the hero
                content off-center. */}
            <div className="absolute top-3 right-3 md:top-4 md:right-4" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                  aria-label="Client actions"
                  aria-expanded={menuOpen}
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-xl shadow-lg z-20 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                    <MenuItem
                      icon={Sparkles}
                      label="Create content"
                      onClick={() => {
                        setMenuOpen(false)
                        handleCreateContent()
                      }}
                    />
                    <MenuItem
                      icon={Pencil}
                      label="Edit profile"
                      onClick={() => {
                        setMenuOpen(false)
                        router.push(`/clients/${clientId}/edit`)
                      }}
                    />
                    <MenuItem
                      icon={Copy}
                      label={intakeLink ? 'Copy intake link' : 'Generate intake link'}
                      onClick={async () => {
                        setMenuOpen(false)
                        if (intakeLink) await handleCopyIntake()
                        else await handleRegenerateIntake()
                      }}
                    />
                    <MenuItem
                      icon={RefreshCw}
                      label="Regenerate intake link"
                      disabled={isGeneratingIntake}
                      onClick={async () => {
                        setMenuOpen(false)
                        await handleRegenerateIntake()
                      }}
                    />
                    {canArchive && !client.archived_at && (
                      <MenuItem
                        icon={ArchiveIcon}
                        label="Archive client"
                        onClick={() => {
                          setMenuOpen(false)
                          setConfirmKind('archive')
                        }}
                      />
                    )}
                    {canDelete && (
                      <MenuItem
                        icon={Trash2}
                        label="Delete client"
                        tone="danger"
                        onClick={() => {
                          setMenuOpen(false)
                          setConfirmKind('delete')
                        }}
                      />
                    )}
                  </div>
                )}
            </div>
          </CardContent>
        </Card>

        {/* Brand intake link - mirror of the edit-page banner so the agency
            can grab the link without going into edit mode. Generate button
            shown when no token exists yet. */}
        <Card className="mb-6 border-blue-200 bg-blue-50 dark:border-transparent dark:bg-[#1E3A6F]">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-blue-700 dark:text-[#93C5FD]">Brand intake link</p>
                {intakeLink ? (
                  <p className="text-sm text-blue-600/70 dark:text-[#93C5FD]/80 truncate">{intakeLink}</p>
                ) : (
                  <p className="text-sm text-blue-600/70 dark:text-[#93C5FD]/80">No intake link generated yet.</p>
                )}
              </div>
              {intakeLink ? (
                <button
                  type="button"
                  onClick={handleCopyIntake}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2B79F7] text-white text-sm font-medium hover:bg-[#1E54B7] transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy link
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRegenerateIntake}
                  disabled={isGeneratingIntake}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2B79F7] text-white text-sm font-medium hover:bg-[#1E54B7] transition-colors disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {isGeneratingIntake ? 'Generating…' : 'Generate'}
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tabs - icons only on mobile so the strip never overflows. */}
        <div className="mb-4 flex justify-center">
          <div className="inline-flex bg-[var(--bg-card)] rounded-xl border border-[var(--border-primary)] p-1 gap-1">
            {TABS.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  title={t.label}
                  aria-label={t.label}
                  className={`inline-flex items-center gap-2 px-2.5 md:px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#2B79F7] text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <t.icon className="h-4 w-4 shrink-0" />
                  <span className="hidden md:inline">{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content */}
        {tab === 'overview' && <OverviewTab client={client} profile={profile} />}
        {tab === 'audience' && <AudienceTab client={client} profile={profile} />}
        {tab === 'guidelines' && <GuidelinesTab client={client} profile={profile} flash={flash} />}
        {tab === 'competitors' && <CompetitorsTab client={client} profile={profile} />}
        {tab === 'team' && <ClientAssignees clientId={clientId} />}
      </div>

      <ConfirmModal
        open={confirmKind === 'archive'}
        title="Archive client?"
        message="Archived clients are hidden from the main list and won't appear in dashboards. You can unarchive later from the archive view."
        confirmLabel="Archive"
        tone="warning"
        onClose={() => setConfirmKind(null)}
        onConfirm={async () => {
          await handleArchive()
        }}
      />
      <ConfirmModal
        open={confirmKind === 'delete'}
        title="Delete client?"
        message={
          <span>
            This permanently deletes <span className="font-medium">{client.name}</span>, all related
            users, and the brand profile. This cannot be undone.
          </span>
        }
        confirmLabel="Delete client"
        tone="danger"
        requirePassword
        onClose={() => setConfirmKind(null)}
        onConfirm={async (password) => {
          await handleDelete(password)
        }}
      />

    </>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

function ClientProfileSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto animate-in fade-in">
      {/* Back link + archived chip row */}
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>

      {/* Hero card: centered avatar + name + business + meta */}
      <Card className="mb-6">
        <CardContent className="relative p-6 md:p-8">
          <div className="absolute top-3 right-3 md:top-4 md:right-4">
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
          <div className="flex flex-col items-center">
            <Skeleton className="h-24 w-24 md:h-28 md:w-28 rounded-full mb-4" />
            <Skeleton className="h-7 w-44 mb-2" />
            <Skeleton className="h-4 w-32 mb-3" />
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs row */}
      <div className="mb-4 flex justify-center">
        <div className="inline-flex bg-[var(--bg-card)] rounded-xl border border-[var(--border-primary)] p-1 gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-9 w-9 md:w-32 rounded-lg" />
          ))}
        </div>
      </div>

      {/* Two stacked section cards */}
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="p-5 md:p-6 space-y-4">
              <div>
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-3 w-64" />
              </div>
              <div className="space-y-3">
                <div>
                  <Skeleton className="h-3 w-20 mb-2" />
                  <Skeleton className="h-4 w-full" />
                </div>
                <div>
                  <Skeleton className="h-3 w-20 mb-2" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
                <div>
                  <Skeleton className="h-3 w-20 mb-2" />
                  <Skeleton className="h-4 w-4/6" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  tone,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void | Promise<void>
  tone?: 'danger'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
        tone === 'danger'
          ? 'text-red-600 hover:bg-red-500/10'
          : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-5 md:p-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
          {description && <p className="text-sm text-[var(--text-tertiary)] mt-0.5">{description}</p>}
        </div>
        <div className="space-y-4">{children}</div>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string
  value: string | null | undefined
  multiline?: boolean
}) {
  const empty = !value || !String(value).trim()
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1">{label}</p>
      {empty ? (
        <p className="text-sm text-[var(--text-tertiary)] italic">Not specified</p>
      ) : (
        <p
          className={`text-sm text-[var(--text-primary)] break-words [overflow-wrap:anywhere] ${
            multiline ? 'whitespace-pre-wrap' : ''
          }`}
        >
          {value}
        </p>
      )}
    </div>
  )
}

function ScoreField({ label, score }: { label: string; score: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1">{label}</p>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={`h-2 w-6 rounded-full ${n <= score ? 'bg-[#2B79F7]' : 'bg-[var(--border-primary)]'}`}
          />
        ))}
        <span className="ml-2 text-xs text-[var(--text-tertiary)]">{score}/5</span>
      </div>
    </div>
  )
}

function ChipList({ items }: { items: string[] }) {
  const filtered = items.filter((x) => x && x.trim())
  if (!filtered.length) {
    return <p className="text-sm text-[var(--text-tertiary)] italic">Not specified</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {filtered.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs"
        >
          {item}
        </span>
      ))}
    </div>
  )
}

// ============================================================================
// Tabs
// ============================================================================

function OverviewTab({ client, profile }: { client: ClientRow; profile: BrandProfile }) {
  return (
    <div className="space-y-4">
      <Section title="About" description="Mission, vision, and the problem this brand solves.">
        <Field label="Mission" value={profile.business.mission} multiline />
        <Field label="Vision" value={profile.business.vision} multiline />
        <Field label="Problem solved" value={profile.business.problem_solved} multiline />
        <Field label="What sets them apart" value={profile.business.differentiation} multiline />
        <Field label="Signature offer" value={profile.business.signature_offer} multiline />
      </Section>

      <Section
        title="Voice & tone"
        description="How the brand sounds when it speaks."
      >
        <Field label="Voice traits" value={profile.voice.traits} multiline />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ScoreField label="Casualness" score={profile.voice.casualness} />
          <ScoreField label="Funny" score={profile.voice.funny} />
          <ScoreField label="Enthusiastic" score={profile.voice.enthusiastic} />
          <ScoreField label="Emotional" score={profile.voice.emotional} />
          <ScoreField label="Irreverent" score={profile.voice.irreverent} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <Field label="Uses jargon" value={titleCase(profile.voice.uses_jargon)} />
          <Field
            label="Personal stories"
            value={titleCase(profile.voice.shares_personal_stories)}
          />
          <Field label="Profanity level" value={titleCase(profile.voice.profanity_level)} />
        </div>
      </Section>

      <Section title="Strategy">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Primary content goal"
            value={titleCase(profile.content_strategy.primary_content_goal)}
          />
          <Field
            label="Desired action"
            value={titleCase(profile.content_strategy.desired_action.replace(/_/g, ' '))}
          />
          <Field
            label="Market position"
            value={titleCase(profile.positioning.market_position.replace(/_/g, ' '))}
          />
          <Field
            label="Brand perception"
            value={titleCase(profile.positioning.perception.replace(/_/g, ' '))}
          />
        </div>
      </Section>

      <Section title="Content pillars" description="Topical pillars the brand publishes around.">
        {profile.content_strategy.content_pillars.every(
          (p) => !p.name && !p.covers && !p.why_it_matters,
        ) ? (
          <p className="text-sm text-[var(--text-tertiary)] italic">No pillars defined yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {profile.content_strategy.content_pillars.map((p, i) => (
              <div
                key={i}
                className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] space-y-2"
              >
                <p className="font-semibold text-sm text-[var(--text-primary)]">
                  {p.name || `Pillar ${i + 1}`}
                </p>
                {p.covers && (
                  <p className="text-xs text-[var(--text-secondary)]">
                    <span className="text-[var(--text-tertiary)]">Covers: </span>
                    {p.covers}
                  </p>
                )}
                {p.why_it_matters && (
                  <p className="text-xs text-[var(--text-secondary)]">
                    <span className="text-[var(--text-tertiary)]">Why: </span>
                    {p.why_it_matters}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Final reflections">
        <Field label="What they're excited about" value={profile.final.excited} multiline />
        <Field label="What makes them nervous" value={profile.final.nervous} multiline />
        <Field label="Anything else" value={profile.final.anything_else} multiline />
        <Field
          label="Collaboration style"
          value={titleCase(profile.final.collaboration_style.replace(/_/g, ' '))}
        />
      </Section>

      {client.brand_intake_submitted_at && (
        <p className="text-xs text-[var(--text-tertiary)] text-center">
          Brand intake last submitted{' '}
          {new Date(client.brand_intake_submitted_at).toLocaleString()}
        </p>
      )}
    </div>
  )
}

function AudienceTab({ client, profile }: { client: ClientRow; profile: BrandProfile }) {
  return (
    <div className="space-y-4">
      <Section
        title="Target audience"
        description="Free-form description from the brief."
      >
        <Field label="Audience description" value={client.target_audience} multiline />
        <Field
          label="Address them as"
          value={profile.voice.address_audience_as}
        />
      </Section>

      <Section title="Demographics">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Age range" value={profile.audience.age_range} />
          <Field label="Gender" value={titleCase(profile.audience.gender)} />
          <Field label="Location" value={profile.audience.location} />
          <Field label="Work / roles" value={profile.audience.work_roles} />
          <Field label="Family situation" value={profile.audience.family_situation} />
          <Field label="Where they hang out" value={profile.audience.hangouts} />
        </div>
      </Section>

      <Section title="Psychographics">
        <Field label="Core values" value={profile.audience.core_values} multiline />
        <Field label="Fears" value={profile.audience.fears} multiline />
        <Field label="Desires" value={profile.audience.desires} multiline />
      </Section>

      <Section title="Pain points" description="Top 5 problems they're trying to solve.">
        {profile.audience.pain_points.every((p) => !p?.trim()) ? (
          <p className="text-sm text-[var(--text-tertiary)] italic">No pain points listed.</p>
        ) : (
          <ol className="space-y-2 list-decimal list-inside marker:text-[var(--text-tertiary)]">
            {profile.audience.pain_points
              .filter((p) => p && p.trim())
              .map((p, i) => (
                <li key={i} className="text-sm text-[var(--text-primary)]">
                  {p}
                </li>
              ))}
          </ol>
        )}
      </Section>

      <Section title="Triggers & objections">
        <Field
          label="What they've tried & why it failed"
          value={profile.audience.tried_failed}
          multiline
        />
        <Field label="Common objections" value={profile.audience.objections} multiline />
        <Field label="What makes them say yes" value={profile.audience.yes_triggers} multiline />
      </Section>
    </div>
  )
}

function GuidelinesTab({
  client,
  profile,
  flash,
}: {
  client: ClientRow
  profile: BrandProfile
  flash: (type: 'success' | 'error', message: string, ms?: number) => void
}) {
  return (
    <div className="space-y-4">
      {/* Brand doc */}
      <Section
        title="Brand document"
        description="The official brand guidelines file or page."
      >
        {client.brand_doc_url ? (
          <BrandDocBlock url={client.brand_doc_url} clientName={client.name || 'brand'} flash={flash} />
        ) : (
          <p className="text-sm text-[var(--text-tertiary)] italic">No brand document uploaded.</p>
        )}
        {client.brand_doc_text && (
          <Field label="Notes" value={client.brand_doc_text} multiline />
        )}
      </Section>

      <Section title="Do's and don'ts">
        <Field label="Guidelines" value={client.dos_and_donts} multiline />
      </Section>

      <Section title="Topics">
        <Field label="Topics library" value={client.topics_library} multiline />
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1">
            Evergreen topics
          </p>
          <ChipList items={profile.content_strategy.evergreen_topics} />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1">
            Off-limits topics
          </p>
          <ChipList items={profile.content_strategy.off_limits_topics} />
        </div>
        <div className="pt-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-2">
            Topics bank
          </p>
          <TopicsBank clientId={client.id} />
        </div>
      </Section>

      <Section title="Stories & differentiation">
        <Field label="Key stories" value={client.key_stories} multiline />
        <Field label="Unique mechanisms" value={client.unique_mechanisms} multiline />
        <Field label="Social proof" value={client.social_proof} multiline />
      </Section>

      <Section title="Voice details">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1">
            Signature phrases
          </p>
          <ChipList items={profile.voice.signature_phrases} />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1">
            Forbidden words
          </p>
          <ChipList items={profile.voice.forbidden_words} />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1">
            Banned phrases
          </p>
          <ChipList items={profile.voice.banned_phrases} />
        </div>
        <Field label="Common enemy" value={profile.voice.common_enemy} multiline />
      </Section>

      <Section title="Visual identity">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ColorSwatch label="Primary" hex={profile.visual.colors.primary} />
          <ColorSwatch label="Secondary" hex={profile.visual.colors.secondary} />
          <ColorSwatch label="Accent" hex={profile.visual.colors.accent} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <Field label="Vibe" value={titleCase(profile.visual.colors.vibe)} />
          <Field
            label="Typography personality"
            value={titleCase(profile.visual.typography.personality)}
          />
          <Field label="Primary font" value={profile.visual.typography.primary_font} />
          <Field label="Secondary font" value={profile.visual.typography.secondary_font} />
          <Field
            label="Photo / video style"
            value={titleCase(profile.visual.style.photo_video_style.replace(/_/g, ' '))}
          />
          <Field
            label="Graphic style"
            value={titleCase(profile.visual.style.graphic_style)}
          />
          <Field
            label="Color treatment"
            value={titleCase(profile.visual.style.editing_color_treatment.replace(/_/g, ' '))}
          />
        </div>
      </Section>

      <Section title="Content rules">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChecklistBlock
            title="Must include"
            tone="positive"
            items={Object.entries(profile.content_strategy.must_include).map(([key, on]) => ({
              key,
              label: titleCase(key.replace(/_/g, ' ')),
              on,
            }))}
          />
          <ChecklistBlock
            title="Never do"
            tone="negative"
            items={Object.entries(profile.content_strategy.never_do).map(([key, on]) => ({
              key,
              label: titleCase(key.replace(/_/g, ' ')),
              on,
            }))}
          />
        </div>
      </Section>

      <Section title="Myths & hot takes">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-2">
            Myths vs truth
          </p>
          {profile.content_strategy.myths.every((m) => !m.myth && !m.truth) ? (
            <p className="text-sm text-[var(--text-tertiary)] italic">No myths captured.</p>
          ) : (
            <div className="space-y-2">
              {profile.content_strategy.myths
                .filter((m) => m.myth || m.truth)
                .map((m, i) => (
                  <div key={i} className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                    <p className="text-xs text-[var(--text-tertiary)]">
                      <span className="font-semibold">Myth:</span> {m.myth || '-'}
                    </p>
                    <p className="text-xs text-[var(--text-primary)] mt-1">
                      <span className="font-semibold">Truth:</span> {m.truth || '-'}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium mb-1">
            Hot takes
          </p>
          <ChipList items={profile.content_strategy.hot_takes} />
        </div>
      </Section>

      <Section title="Legal">
        <Field label="Disclaimers" value={profile.legal.disclaimers} multiline />
        <Field
          label="Compliance requirements"
          value={profile.legal.compliance_requirements}
          multiline
        />
      </Section>
    </div>
  )
}

function CompetitorsTab({ client, profile }: { client: ClientRow; profile: BrandProfile }) {
  const intakeCompetitors = profile.competitors.filter(
    (c) => c.name_or_handle || c.does_well || c.does_poorly || c.differentiate,
  )

  return (
    <div className="space-y-4">
      <Section
        title="Competitor insights"
        description="Saved from the competitor analysis tool."
      >
        {client.competitor_insights ? (
          <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed break-words [overflow-wrap:anywhere]">
            {client.competitor_insights}
          </p>
        ) : (
          <p className="text-sm text-[var(--text-tertiary)] italic">
            No competitor insights yet. Run a competitor analysis to populate this.
          </p>
        )}
      </Section>

      {intakeCompetitors.length > 0 && (
        <Section
          title="Competitors from brand intake"
          description="Competitors the client called out in their brand intake form."
        >
          <div className="space-y-3">
            {intakeCompetitors.map((c, i) => (
              <div
                key={i}
                className="p-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] space-y-2"
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="font-semibold text-sm text-[var(--text-primary)]">
                    {c.name_or_handle || `Competitor ${i + 1}`}
                  </p>
                  {c.follower_count && (
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {c.follower_count} followers
                    </span>
                  )}
                </div>
                <Field label="Does well" value={c.does_well} multiline />
                <Field label="Does poorly" value={c.does_poorly} multiline />
                <Field
                  label="How we differentiate"
                  value={c.differentiate}
                  multiline
                />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// ============================================================================
// Smaller components
// ============================================================================

function BrandDocBlock({
  url,
  clientName,
  flash,
}: {
  url: string
  clientName: string
  flash: (type: 'success' | 'error', message: string, ms?: number) => void
}) {
  const [downloading, setDownloading] = useState(false)
  const filename = useMemo(() => {
    try {
      const u = new URL(url)
      const last = u.pathname.split('/').filter(Boolean).pop()
      if (last) return decodeURIComponent(last)
    } catch {}
    return `${clientName.replace(/\s+/g, '-').toLowerCase()}-brand-doc`
  }, [url, clientName])

  const onDownload = async () => {
    setDownloading(true)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('fetch failed')
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename || 'brand-doc'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (e) {
      // CORS or non-file URL - fall back to opening in a new tab
      console.error('brand doc download failed; opening in new tab', e)
      window.open(url, '_blank', 'noopener,noreferrer')
      flash('error', 'Could not download - opened in a new tab instead', 3500)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-[#1E3A6F] rounded-lg flex-wrap">
      <FileText className="h-5 w-5 text-blue-600 dark:text-[#93C5FD] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-blue-800 dark:text-[#93C5FD] truncate">{filename}</p>
        <p className="text-xs text-blue-700/80 dark:text-[#93C5FD]/80 truncate">{url}</p>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[var(--bg-card)] border border-blue-200 dark:border-transparent text-blue-700 dark:text-[#93C5FD] text-xs font-medium hover:bg-blue-100 dark:hover:bg-[#2B79F7]/20 transition"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Preview
      </a>
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[var(--bg-card)] border border-blue-200 dark:border-transparent text-blue-700 dark:text-[#93C5FD] text-xs font-medium hover:bg-blue-100 dark:hover:bg-[#2B79F7]/20 transition disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {downloading ? 'Downloading…' : 'Download'}
      </button>
    </div>
  )
}

function ColorSwatch({ label, hex }: { label: string; hex: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-10 w-10 rounded-lg border border-[var(--border-primary)] shrink-0"
        style={{ backgroundColor: hex || '#ffffff' }}
        aria-label={`${label} color`}
      />
      <div>
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium">{label}</p>
        <p className="text-sm font-mono text-[var(--text-primary)]">{hex || '-'}</p>
      </div>
    </div>
  )
}

function ChecklistBlock({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'positive' | 'negative'
  items: { key: string; label: string; on: boolean }[]
}) {
  return (
    <div className="rounded-lg border border-[var(--border-primary)] p-4">
      <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</p>
      <ul className="space-y-1.5">
        {items.map((it) => {
          const active = it.on
          return (
            <li key={it.key} className="flex items-center gap-2 text-sm">
              {active ? (
                <Check
                  className={`h-4 w-4 shrink-0 ${
                    tone === 'positive' ? 'text-green-600' : 'text-red-600'
                  }`}
                />
              ) : (
                <XIcon className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
              )}
              <span className={active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] line-through'}>
                {it.label}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function titleCase(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .split(' ')
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : ''))
    .join(' ')
}
