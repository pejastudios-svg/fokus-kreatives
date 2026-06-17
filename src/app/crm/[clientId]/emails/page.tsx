'use client'

// Emails: Mailchimp-style value-email campaigns. Recurring campaigns
// generate AI emails from the client's form answers on a customizable
// schedule; broadcasts send one email (AI or hand-written) to a group.
// Drafts wait for approval (unless auto-approve), every link is click
// tracked, and unsubscribes land in the suppression list.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { renderMarketingEmail } from '@/lib/emailMarketing/render'
import {
  parseScheduleRules,
  isValidTimezone,
  GROUP_RULE_OP_LABELS,
  VALUELESS_OPS,
  type GroupRuleOp,
} from '@/lib/emailMarketing/types'
import { upcomingSendDates, zonedNow } from '@/lib/emailMarketing/schedule'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { Skeleton } from '@/components/ui/Loading'
import { toast } from '@/components/ui/Toast'
import { useCrmRole } from '@/components/crm/CrmRoleContext'
import {
  Plus,
  Loader2,
  Mail,
  Users,
  BellOff,
  Settings as SettingsIcon,
  Sparkles,
  Send,
  Trash2,
  Pause,
  Play,
  Eye,
  PenLine,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Bold,
  Italic,
  Underline,
  Link2,
  RemoveFormatting,
  CalendarClock,
  GripVertical,
  Type,
  Highlighter,
  Image as ImageIcon,
  Film,
  MousePointerClick,
  FileDown,
  Info,
  ExternalLink,
} from 'lucide-react'

// ===== types mirrored from the API =====

interface Cta {
  id: string
  label: string
  text: string
  url: string
}

interface Social {
  platform: string
  url: string
}

interface MarketingSettings {
  ctas: Cta[]
  ps_pool: string[]
  socials: Social[]
  footer_address: string
  daily_send_cap: number
  monthly_generation_cap: number
}

interface Group {
  id: string
  name: string
  filters: { statuses?: string[]; rules?: { field: string; op: string; value: string }[] }
  lead_ids: string[]
  recipient_count: number
}

interface Campaign {
  id: string
  name: string
  kind: 'recurring' | 'broadcast'
  status: 'draft' | 'active' | 'paused' | 'completed'
  group_id: string | null
  group_name: string | null
  schedule_rules: {
    weekdays?: number[]
    send_time?: string
    timezone?: string | null
    date_from?: string | null
    date_to?: string | null
    specific_dates?: string[]
    cadence?: string
  }
  auto_approve: boolean
  cta_ids: string[]
  ps_mode: 'ai' | 'custom' | 'none'
  topic_focus: string | null
  paused_reason: string | null
  pending_drafts: number
  emails_sent: number
  approved_emails: number
  next_send_date: string | null
}

type Block =
  | { id: string; type: 'text'; content: string }
  | { id: string; type: 'callout'; content: string }
  | { id: string; type: 'image'; url: string; alt?: string }
  | { id: string; type: 'embed'; url: string; title?: string }
  | { id: string; type: 'button'; label: string; url: string }

function looksLikeHtml(content: string): boolean {
  return /<[a-z][^>]*>/i.test(content || '')
}

/** Older drafts (and AI output) store plain text - convert it to the HTML
 *  the rich editor works in, preserving paragraph breaks. */
function plainToEditorHtml(text: string): string {
  const esc = (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return esc
    .split(/\n{2,}/)
    .map((p) => `<div>${p.replace(/\n/g, '<br>')}</div>`)
    .join('<div><br></div>')
}

interface CampaignEmail {
  id: string
  campaign_id: string
  scheduled_for: string | null
  send_time: string | null
  subject: string
  preheader: string
  hook_title: string
  blocks: Block[]
  ps: string
  cta_snapshot: Cta[]
  status: 'draft' | 'approved' | 'sending' | 'sent' | 'failed' | 'canceled'
  sent_at: string | null
  error: string | null
}

interface CampaignStats {
  campaign_id: string
  recipients: number
  delivered: number
  failed: number
  unsubscribed: number
  clickers: number
  clicks: number
  ctr: number
}

interface EmailStats {
  recipients: number
  delivered: number
  failed: number
  unsubscribed: number
  unique_clicks: number
  total_clicks: number
  ctr: number
  links: { url: string; label: string; clicks: number }[]
}

interface Suppression {
  id: string
  email: string
  reason: string
  created_at: string
  source_subject: string
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtDate(d: string | null): string {
  if (!d) return ''
  try {
    return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return d
  }
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** True when the HTML contains visible text (not just empty tags). */
function htmlHasText(html: string): boolean {
  return (html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim() !== ''
}

/** Insertable block kinds - drives the grip-dots menu and the "/" command. */
const BLOCK_DEFS: Array<{
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  make: () => Block
}> = [
  { label: 'Text', hint: 'Paragraphs with formatting', icon: Type, make: () => ({ id: uid(), type: 'text', content: '' }) },
  { label: 'Highlight', hint: 'Text in its own box', icon: Highlighter, make: () => ({ id: uid(), type: 'callout', content: '' }) },
  { label: 'Image', hint: 'Inline picture', icon: ImageIcon, make: () => ({ id: uid(), type: 'image', url: '' }) },
  { label: 'Video / embed', hint: 'YouTube, Loom, Drive...', icon: Film, make: () => ({ id: uid(), type: 'embed', url: '', title: '' }) },
  { label: 'Button', hint: 'A pill link button', icon: MousePointerClick, make: () => ({ id: uid(), type: 'button', label: '', url: '' }) },
]

const statusTone: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-blue-50 text-blue-700 border-blue-200',
  sending: 'bg-blue-50 text-blue-700 border-blue-200',
  sent: 'bg-green-50 text-green-700 border-green-200',
  active: 'bg-green-50 text-green-700 border-green-200',
  paused: 'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-gray-50 text-gray-600 border-gray-200',
  failed: 'bg-red-50 text-red-600 border-red-200',
  canceled: 'bg-gray-50 text-gray-500 border-gray-200',
}

function Pill({ value }: { value: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusTone[value] || 'bg-gray-50 text-gray-600 border-gray-200'}`}
    >
      {value}
    </span>
  )
}

export default function EmailsPage() {
  const params = useParams()
  const clientId = (params?.clientId as string) || (params?.clientid as string) || ''
  const { isManagerOrAdmin: canManage, workspaceName } = useCrmRole()
  const supabase = useMemo(() => createClient(), [])

  const [view, setView] = useState<'campaigns' | 'groups' | 'unsubscribed' | 'settings'>('campaigns')
  const [loading, setLoading] = useState(true)

  const [settings, setSettings] = useState<MarketingSettings | null>(null)
  const [senderName, setSenderName] = useState('')
  // Sending plan, inferred from the connected email account. Drives the
  // free-plan cap notice + upgrade prompt; hidden entirely on Workspace.
  const [plan, setPlan] = useState<'gmail_free' | 'workspace' | 'shared'>('shared')
  const [planDailyMax, setPlanDailyMax] = useState(120)
  const [showPlanInfo, setShowPlanInfo] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [statsByCampaign, setStatsByCampaign] = useState<Map<string, CampaignStats>>(new Map())
  const [reviewQueue, setReviewQueue] = useState<CampaignEmail[]>([])
  const [suppressions, setSuppressions] = useState<Suppression[]>([])
  const [statusOptions, setStatusOptions] = useState<string[]>([])
  const [leadFieldKeys, setLeadFieldKeys] = useState<string[]>([])

  // Campaign detail expansion
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null)
  const [campaignEmails, setCampaignEmails] = useState<CampaignEmail[]>([])
  const [emailsLoading, setEmailsLoading] = useState(false)
  const [emailStats, setEmailStats] = useState<Map<string, EmailStats>>(new Map())

  // Modals
  const [campaignModal, setCampaignModal] = useState<{ editing: Campaign | null } | null>(null)
  const [groupModal, setGroupModal] = useState<{ editing: Group | null } | null>(null)
  const [composer, setComposer] = useState<{ email: CampaignEmail | null; campaignId: string } | null>(null)
  const [confirm, setConfirm] = useState<{
    title: string
    message: string
    danger?: boolean
    onConfirm: () => void
  } | null>(null)

  // ===== loading =====

  const loadAll = useCallback(async () => {
    const qs = `clientId=${encodeURIComponent(clientId)}`
    try {
      const [settingsRes, groupsRes, campaignsRes, emailsRes, statsRes, suppRes] = await Promise.all([
        fetch(`/api/crm/email-marketing/settings?${qs}`).then((r) => r.json()),
        fetch(`/api/crm/email-marketing/groups?${qs}`).then((r) => r.json()),
        fetch(`/api/crm/email-marketing/campaigns?${qs}`).then((r) => r.json()),
        fetch(`/api/crm/email-marketing/emails?${qs}&status=draft`).then((r) => r.json()),
        fetch(`/api/crm/email-marketing/stats?${qs}`).then((r) => r.json()),
        fetch(`/api/crm/email-marketing/suppressions?${qs}`).then((r) => r.json()),
      ])
      if (settingsRes.success) {
        setSettings(settingsRes.settings)
        setSenderName(settingsRes.senderName || '')
        setPlan(settingsRes.plan || 'shared')
        setPlanDailyMax(settingsRes.dailyMax || 120)
      }
      if (groupsRes.success) setGroups(groupsRes.groups)
      if (campaignsRes.success) setCampaigns(campaignsRes.campaigns)
      if (emailsRes.success) {
        setReviewQueue(
          (emailsRes.emails as CampaignEmail[]).filter((e) => e.status === 'draft'),
        )
      }
      if (statsRes.success) {
        setStatsByCampaign(
          new Map((statsRes.stats as CampaignStats[]).map((s) => [s.campaign_id, s])),
        )
      }
      if (suppRes.success) setSuppressions(suppRes.suppressions)
    } catch (e) {
      console.error(e)
      toast.error('Could not load the Emails tab')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    if (!clientId) return
    loadAll()
    // Lead status options for the group builder. Options are stored as
    // {value, label, color} objects (older fields may have plain strings) -
    // the group filter matches leads.data.status against the VALUE.
    ;(async () => {
      const { data } = await supabase
        .from('custom_fields')
        .select('field_key, options')
        .eq('client_id', clientId)
      const statusField = (data || []).find((f) => f.field_key === 'status')
      const raw = Array.isArray(statusField?.options) ? (statusField!.options as unknown[]) : []
      setStatusOptions(
        raw
          .map((o) => {
            if (typeof o === 'string') return o
            const obj = o as { value?: unknown; label?: unknown } | null
            return String(obj?.value ?? obj?.label ?? '')
          })
          .filter(Boolean),
      )
      // All other lead fields feed the rule-builder dropdown ("source is
      // webinar"). Status has its own chips, so it's excluded here.
      setLeadFieldKeys(
        (data || [])
          .map((f) => String(f.field_key || ''))
          .filter((k) => k && k !== 'status'),
      )
    })()
  }, [clientId, loadAll, supabase])

  const loadCampaignEmails = useCallback(
    async (campaignId: string) => {
      setEmailsLoading(true)
      try {
        const res = await fetch(
          `/api/crm/email-marketing/emails?clientId=${encodeURIComponent(clientId)}&campaignId=${campaignId}`,
        ).then((r) => r.json())
        if (res.success) setCampaignEmails(res.emails)
      } finally {
        setEmailsLoading(false)
      }
    },
    [clientId],
  )

  const loadEmailStats = useCallback(
    async (emailId: string) => {
      const res = await fetch(
        `/api/crm/email-marketing/stats?clientId=${encodeURIComponent(clientId)}&emailId=${emailId}`,
      ).then((r) => r.json())
      if (res.success) {
        setEmailStats((prev) => new Map(prev).set(emailId, res.email))
      }
    },
    [clientId],
  )

  // ===== actions =====

  const emailAction = async (action: string, body: Record<string, unknown>) => {
    const res = await fetch('/api/crm/email-marketing/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, action, ...body }),
    }).then((r) => r.json())
    if (!res.success) {
      toast.error(res.error || 'Something went wrong')
      return null
    }
    return res
  }

  // Branded PDF export, same pipeline as the other CRM page reports.
  const [isExporting, setIsExporting] = useState(false)
  const handleExportPdf = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const [{ pdf }, { EmailsReport }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/EmailsReport'),
      ])
      const campaignRows = campaigns.map((c) => {
        const s = statsByCampaign.get(c.id)
        return {
          name: c.name,
          kind: c.kind,
          status: c.status,
          emailsSent: c.emails_sent,
          recipients: s?.recipients || 0,
          delivered: s?.delivered || 0,
          failed: s?.failed || 0,
          uniqueClicks: s?.clickers || 0,
          totalClicks: s?.clicks || 0,
          ctr: s?.ctr || 0,
          unsubscribed: s?.unsubscribed || 0,
        }
      })
      const groupRows = groups.map((g) => ({
        name: g.name,
        definition:
          [
            g.filters.statuses?.length ? `Status: ${g.filters.statuses.join(', ')}` : '',
            ...(g.filters.rules || []).map(
              (r) =>
                `${r.field} ${GROUP_RULE_OP_LABELS[r.op as GroupRuleOp] || r.op}${r.value ? ` "${r.value}"` : ''}`,
            ),
            g.lead_ids.length ? `${g.lead_ids.length} hand-picked` : '',
          ]
            .filter(Boolean)
            .join(' · ') || 'All leads with an email',
        recipients: g.recipient_count,
      }))
      const blob = await pdf(
        <EmailsReport
          workspaceName={workspaceName}
          campaigns={campaignRows}
          groups={groupRows}
          suppressedCount={suppressions.length}
        />,
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().split('T')[0]
      a.href = url
      a.download = `${workspaceName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-emails-${stamp}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Emails PDF export failed:', err)
      toast.error('Could not generate the PDF')
    } finally {
      setIsExporting(false)
    }
  }

  const patchCampaign = async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch('/api/crm/email-marketing/campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, id, ...patch }),
    }).then((r) => r.json())
    if (!res.success) toast.error(res.error || 'Could not update campaign')
    await loadAll()
  }

  const approveEmail = async (email: CampaignEmail) => {
    const ok = await emailAction('approve', { id: email.id })
    if (ok) {
      toast.success('Approved - it sends on schedule')
      await loadAll()
      if (openCampaignId) await loadCampaignEmails(openCampaignId)
    }
  }

  const sendNow = (email: CampaignEmail) => {
    setConfirm({
      title: 'Send now?',
      message: 'This email goes out to its audience within the next few minutes.',
      onConfirm: async () => {
        setConfirm(null)
        const ok = await emailAction('send_now', { id: email.id })
        if (ok) {
          toast.success('Sending shortly')
          await loadAll()
          if (openCampaignId) await loadCampaignEmails(openCampaignId)
        }
      },
    })
  }

  // ===== render =====

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <Skeleton className="h-4 w-72 mb-6" />
        <div className="flex gap-5 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5 w-24" />
          ))}
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const navItems = [
    { key: 'campaigns' as const, label: 'Campaigns', icon: Mail },
    { key: 'groups' as const, label: 'Groups', icon: Users },
    { key: 'unsubscribed' as const, label: 'Unsubscribed', icon: BellOff },
    { key: 'settings' as const, label: 'Email settings', icon: SettingsIcon },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-[var(--text-tertiary)]">
              Value emails for your leads, sent as {senderName || 'your brand'}
            </p>
            {plan !== 'workspace' && (
              <div className="relative">
                <button
                  title="Email sending limit"
                  onClick={() => setShowPlanInfo((v) => !v)}
                  className="flex text-[var(--text-tertiary)] hover:text-[#2B79F7]"
                >
                  <Info className="h-4 w-4" />
                </button>
                {showPlanInfo && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowPlanInfo(false)} />
                    <div className="absolute left-0 top-7 z-40 w-80 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-xl p-4">
                      <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                        Sending on the free Google plan
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        {workspaceName ? `${workspaceName}’s email` : 'Your email'} can safely send
                        about <b>{planDailyMax} emails a day</b>. Larger sends spread across several
                        days so the account isn’t flagged.
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-2">
                        Google Workspace lifts this to roughly <b>2,000 a day</b> and sends from a
                        professional address on your own domain. After upgrading, reconnect the email
                        in your workspace settings.
                      </p>
                      <a
                        href="https://workspace.google.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#2B79F7] px-4 py-2 text-xs font-semibold text-white"
                      >
                        Upgrade to Google Workspace <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {(view === 'campaigns' || view === 'groups') && (
          <KebabMenu
            items={[
              { type: 'section', label: 'Actions' },
              ...(canManage
                ? [
                    {
                      label: view === 'campaigns' ? 'New campaign…' : 'New group…',
                      icon: <Plus className="h-4 w-4" />,
                      onClick: () =>
                        view === 'campaigns'
                          ? setCampaignModal({ editing: null })
                          : setGroupModal({ editing: null }),
                    },
                  ]
                : []),
              {
                label: isExporting ? 'Generating PDF…' : 'Export report as PDF',
                icon: <FileDown className="h-4 w-4" />,
                disabled: isExporting,
                onClick: handleExportPdf,
              },
            ]}
          />
        )}
      </div>

      <div className="flex gap-5 mb-6 border-b border-[var(--border-primary)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setView(item.key)}
            className={`flex items-center gap-1.5 pb-2.5 -mb-px text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              view === item.key
                ? 'border-[#2B79F7] text-[#2B79F7]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
            {item.key === 'unsubscribed' && suppressions.length > 0 && (
              <span className="text-[10px] opacity-75">({suppressions.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* ===== Review queue ===== */}
      {view === 'campaigns' && reviewQueue.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 mb-2">
            <AlertTriangle className="h-4 w-4" />
            {reviewQueue.length} email{reviewQueue.length === 1 ? '' : 's'} waiting for review
          </div>
          <div className="space-y-2">
            {reviewQueue.map((e) => {
              const campaign = campaigns.find((c) => c.id === e.campaign_id)
              return (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white border border-amber-100 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {e.subject || (e.error ? 'Generation failed' : 'Untitled draft')}
                    </div>
                    <div className="text-xs text-gray-500">
                      {campaign?.name || 'Campaign'}
                      {e.scheduled_for ? ` - sends ${fmtDate(e.scheduled_for)}` : ''}
                      {e.error ? ` - ${e.error}` : ''}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setComposer({ email: e, campaignId: e.campaign_id })}
                      >
                        <PenLine className="h-3.5 w-3.5 mr-1" /> Review
                      </Button>
                      {!e.error && e.subject && (
                        <Button size="sm" onClick={() => approveEmail(e)}>
                          Approve
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ===== Campaigns ===== */}
      {view === 'campaigns' && (
        <div className="space-y-3">
          {campaigns.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border-primary)] p-10 text-center">
              <Mail className="h-8 w-8 mx-auto text-[var(--text-tertiary)] mb-3" />
              <p className="text-sm text-[var(--text-secondary)]">
                No campaigns yet. Create one to send value emails to your leads on a schedule.
              </p>
              {canManage && (
                <Button className="mt-4" onClick={() => setCampaignModal({ editing: null })}>
                  <Plus className="h-4 w-4 mr-1.5" /> New campaign
                </Button>
              )}
            </div>
          )}
          {campaigns.map((c) => {
            const stats = statsByCampaign.get(c.id)
            const open = openCampaignId === c.id
            return (
              <div
                key={c.id}
                className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden"
              >
                <button
                  className="w-full flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--bg-card-hover)]"
                  onClick={() => {
                    const next = open ? null : c.id
                    setOpenCampaignId(next)
                    setCampaignEmails([])
                    if (next) loadCampaignEmails(next)
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[var(--text-primary)]">{c.name}</span>
                      <Pill value={c.status} />
                      <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide">
                        {c.kind}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {c.group_name || 'All leads'}
                      {c.next_send_date ? ` - next: ${fmtDate(c.next_send_date)}` : ''}
                      {c.paused_reason ? ` - ${c.paused_reason}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                    <div className="text-center">
                      <div className="font-semibold text-[var(--text-primary)]">{c.emails_sent}</div>
                      <div>sent</div>
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-[var(--text-primary)]">
                        {stats ? `${stats.ctr}%` : '0%'}
                      </div>
                      <div>CTR</div>
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-[var(--text-primary)]">
                        {stats?.unsubscribed ?? 0}
                      </div>
                      <div>unsubs</div>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {open && (
                  <div className="border-t border-[var(--border-primary)] px-4 py-3">
                    {canManage && (
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        {c.status === 'active' ? (
                          <Button size="sm" variant="outline" onClick={() => patchCampaign(c.id, { status: 'paused' })}>
                            <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                          </Button>
                        ) : c.status !== 'completed' ? (
                          <Button
                            size="sm"
                            className={c.approved_emails === 0 ? 'opacity-40' : ''}
                            title={
                              c.approved_emails === 0
                                ? 'Approve an email first - generate one, review it, then activate'
                                : 'Start sending on schedule'
                            }
                            onClick={() => {
                              if (c.approved_emails === 0) {
                                toast.error(
                                  'An email needs to be approved before this campaign can be activated. Generate one, review it, then come back.',
                                )
                                return
                              }
                              patchCampaign(c.id, { status: 'active' })
                            }}
                          >
                            <Play className="h-3.5 w-3.5 mr-1" /> Activate
                          </Button>
                        ) : null}
                        {c.kind === 'recurring' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              toast.success('Generating a draft from the form answers...')
                              const ok = await emailAction('generate', { campaignId: c.id })
                              if (ok) {
                                toast.success('Draft ready for review')
                                await loadAll()
                                await loadCampaignEmails(c.id)
                              }
                            }}
                          >
                            <Sparkles className="h-3.5 w-3.5 mr-1" /> Generate now
                          </Button>
                        )}
                        {c.kind === 'broadcast' && campaignEmails.length === 0 && !emailsLoading && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                toast.success('Generating from the form answers...')
                                const ok = await emailAction('generate', { campaignId: c.id })
                                if (ok) {
                                  await loadCampaignEmails(c.id)
                                  await loadAll()
                                }
                              }}
                            >
                              <Sparkles className="h-3.5 w-3.5 mr-1" /> AI draft
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setComposer({ email: null, campaignId: c.id })}
                            >
                              <PenLine className="h-3.5 w-3.5 mr-1" /> Write it yourself
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setCampaignModal({ editing: c })}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:bg-red-50"
                          onClick={() =>
                            setConfirm({
                              title: 'Delete campaign?',
                              message: `"${c.name}" and its emails and stats are removed. Sent emails cannot be unsent.`,
                              danger: true,
                              onConfirm: async () => {
                                setConfirm(null)
                                await fetch('/api/crm/email-marketing/campaigns', {
                                  method: 'DELETE',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ clientId, id: c.id }),
                                })
                                setOpenCampaignId(null)
                                await loadAll()
                              },
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}

                    {emailsLoading ? (
                      <div className="py-6 text-center">
                        <Loader2 className="h-4 w-4 animate-spin mx-auto text-[var(--text-tertiary)]" />
                      </div>
                    ) : campaignEmails.length === 0 ? (
                      <p className="text-sm text-[var(--text-tertiary)] py-2">
                        No emails yet.
                        {c.kind === 'recurring' && c.status !== 'active'
                          ? ' Activate the campaign and drafts generate ahead of each send date.'
                          : ''}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {campaignEmails.map((e) => {
                          const es = emailStats.get(e.id)
                          return (
                            <div key={e.id} className="rounded-lg border border-[var(--border-primary)] px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Pill value={e.status} />
                                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                                      {e.subject || (e.error ? 'Generation failed' : 'Untitled')}
                                    </span>
                                  </div>
                                  <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                                    {e.scheduled_for ? `${fmtDate(e.scheduled_for)}${e.send_time ? ` at ${e.send_time}` : ''}` : 'No date set'}
                                    {e.error ? ` - ${e.error}` : ''}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {e.status === 'sent' && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => (es ? setEmailStats((p) => { const n = new Map(p); n.delete(e.id); return n }) : loadEmailStats(e.id))}
                                    >
                                      <Eye className="h-3.5 w-3.5 mr-1" /> Stats
                                    </Button>
                                  )}
                                  {canManage && (e.status === 'draft' || e.status === 'approved') && (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setComposer({ email: e, campaignId: c.id })}
                                      >
                                        <PenLine className="h-3.5 w-3.5" />
                                      </Button>
                                      {e.status === 'draft' && e.subject && (
                                        <Button size="sm" variant="ghost" onClick={() => approveEmail(e)}>
                                          Approve
                                        </Button>
                                      )}
                                      <Button size="sm" variant="ghost" onClick={() => sendNow(e)}>
                                        <Send className="h-3.5 w-3.5" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {es && (
                                <div className="mt-2 pt-2 border-t border-[var(--border-primary)] grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                                  <div><span className="font-semibold">{es.delivered}</span> delivered</div>
                                  <div><span className="font-semibold">{es.unique_clicks}</span> clicked ({es.ctr}% CTR)</div>
                                  <div><span className="font-semibold">{es.total_clicks}</span> total clicks</div>
                                  <div><span className="font-semibold">{es.failed}</span> failed</div>
                                  <div><span className="font-semibold">{es.unsubscribed}</span> unsubscribed</div>
                                  {es.links.length > 0 && (
                                    <div className="col-span-full mt-1 space-y-0.5">
                                      {es.links.map((l, i) => (
                                        <div key={i} className="flex justify-between text-[var(--text-secondary)]">
                                          <span className="truncate mr-3">{l.label || l.url}</span>
                                          <span className="font-semibold">{l.clicks}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ===== Groups ===== */}
      {view === 'groups' && (
        <div className="space-y-3">
          {groups.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border-primary)] p-10 text-center">
              <Users className="h-8 w-8 mx-auto text-[var(--text-tertiary)] mb-3" />
              <p className="text-sm text-[var(--text-secondary)]">
                Groups choose who receives a campaign: filter by status or any lead field, or pick leads by name.
              </p>
              {canManage && (
                <Button className="mt-4" onClick={() => setGroupModal({ editing: null })}>
                  <Plus className="h-4 w-4 mr-1.5" /> New group
                </Button>
              )}
            </div>
          )}
          {groups.map((g) => (
            <div
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] px-4 py-3"
            >
              <div>
                <div className="font-medium text-[var(--text-primary)]">{g.name}</div>
                <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  {(g.filters.statuses?.length || 0) > 0 && `Status: ${g.filters.statuses!.join(', ')}`}
                  {(g.filters.rules?.length || 0) > 0 &&
                    ` ${g.filters
                      .rules!.map(
                        (r) =>
                          `${r.field} ${GROUP_RULE_OP_LABELS[r.op as GroupRuleOp] || r.op}${r.value ? ` "${r.value}"` : ''}`,
                      )
                      .join(', ')}`}
                  {g.lead_ids.length > 0 && ` +${g.lead_ids.length} picked`}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--text-secondary)]">
                  <b>{g.recipient_count}</b> recipient{g.recipient_count === 1 ? '' : 's'}
                </span>
                {canManage && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setGroupModal({ editing: g })}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:bg-red-50"
                      onClick={() =>
                        setConfirm({
                          title: 'Delete group?',
                          message: `Campaigns using "${g.name}" fall back to all leads.`,
                          danger: true,
                          onConfirm: async () => {
                            setConfirm(null)
                            await fetch('/api/crm/email-marketing/groups', {
                              method: 'DELETE',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ clientId, id: g.id }),
                            })
                            await loadAll()
                          },
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== Unsubscribed ===== */}
      {view === 'unsubscribed' && (
        <UnsubscribedView
          clientId={clientId}
          suppressions={suppressions}
          canManage={canManage}
          onChanged={loadAll}
          setConfirm={setConfirm}
        />
      )}

      {/* ===== Settings ===== */}
      {view === 'settings' && settings && (
        <SettingsView
          clientId={clientId}
          settings={settings}
          planDailyMax={planDailyMax}
          canManage={canManage}
          onSaved={(s) => setSettings(s)}
        />
      )}

      {/* ===== Modals ===== */}
      {campaignModal && settings && (
        <CampaignModal
          clientId={clientId}
          editing={campaignModal.editing}
          groups={groups}
          settings={settings}
          onClose={() => setCampaignModal(null)}
          onSaved={async () => {
            setCampaignModal(null)
            await loadAll()
          }}
        />
      )}
      {groupModal && (
        <GroupModal
          clientId={clientId}
          editing={groupModal.editing}
          statusOptions={statusOptions}
          fieldKeys={leadFieldKeys}
          onClose={() => setGroupModal(null)}
          onSaved={async () => {
            setGroupModal(null)
            await loadAll()
          }}
        />
      )}
      {composer && settings && (
        <ComposerModal
          clientId={clientId}
          campaignId={composer.campaignId}
          email={composer.email}
          settings={settings}
          senderName={senderName}
          campaignRules={campaigns.find((c) => c.id === composer.campaignId)?.schedule_rules}
          onClose={() => setComposer(null)}
          onSaved={async () => {
            setComposer(null)
            await loadAll()
            if (openCampaignId) await loadCampaignEmails(openCampaignId)
          }}
        />
      )}
      {confirm && (
        <ConfirmModal
          open
          title={confirm.title}
          message={confirm.message}
          tone={confirm.danger ? 'danger' : 'default'}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Unsubscribed view
// ============================================================================

function UnsubscribedView({
  clientId,
  suppressions,
  canManage,
  onChanged,
  setConfirm,
}: {
  clientId: string
  suppressions: Suppression[]
  canManage: boolean
  onChanged: () => Promise<void>
  setConfirm: (c: { title: string; message: string; danger?: boolean; onConfirm: () => void } | null) => void
}) {
  const [manualEmail, setManualEmail] = useState('')

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex gap-2 max-w-md">
          <Input
            placeholder="Add an address to never email"
            value={manualEmail}
            onChange={(e) => setManualEmail(e.target.value)}
          />
          <Button
            variant="outline"
            onClick={async () => {
              const res = await fetch('/api/crm/email-marketing/suppressions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, email: manualEmail }),
              }).then((r) => r.json())
              if (res.success) {
                setManualEmail('')
                toast.success('Added')
                await onChanged()
              } else toast.error(res.error || 'Could not add')
            }}
          >
            Add
          </Button>
        </div>
      )}
      {suppressions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-primary)] p-10 text-center">
          <BellOff className="h-8 w-8 mx-auto text-[var(--text-tertiary)] mb-3" />
          <p className="text-sm text-[var(--text-secondary)]">
            Nobody has unsubscribed. When someone does, they show up here and stop receiving campaigns automatically.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-primary)] divide-y divide-[var(--border-primary)]">
          {suppressions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div>
                <div className="text-sm font-medium text-[var(--text-primary)]">{s.email}</div>
                <div className="text-xs text-[var(--text-tertiary)]">
                  {s.reason === 'manual' ? 'Added manually' : s.reason === 'unsubscribed' ? 'Unsubscribed' : s.reason}
                  {s.source_subject ? ` from "${s.source_subject}"` : ''} - {fmtDate(s.created_at)}
                </div>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setConfirm({
                      title: 'Resubscribe this address?',
                      message: `${s.email} starts receiving campaign emails again. Only do this if they asked to be added back.`,
                      onConfirm: async () => {
                        setConfirm(null)
                        await fetch('/api/crm/email-marketing/suppressions', {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ clientId, id: s.id }),
                        })
                        await onChanged()
                      },
                    })
                  }
                >
                  Resubscribe
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Settings view
// ============================================================================

function SettingsView({
  clientId,
  settings,
  planDailyMax,
  canManage,
  onSaved,
}: {
  clientId: string
  settings: MarketingSettings
  planDailyMax: number
  canManage: boolean
  onSaved: (s: MarketingSettings) => void
}) {
  const [draft, setDraft] = useState<MarketingSettings>(settings)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/crm/email-marketing/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, settings: draft }),
      }).then((r) => r.json())
      if (res.success) {
        toast.success('Settings saved')
        onSaved(res.settings)
      } else toast.error(res.error || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const sectionCls = 'rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4'

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className={sectionCls}>
        <div className="font-medium text-[var(--text-primary)] mb-1">CTA library</div>
        <p className="text-xs text-[var(--text-tertiary)] mb-3">
          Each CTA is a sentence plus a link. Campaigns rotate through the CTAs you assign them, two per email.
        </p>
        <div className="space-y-3">
          {draft.ctas.map((cta, i) => (
            <div key={cta.id} className="rounded-lg border border-[var(--border-primary)] p-3 space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Short label (e.g. Business owners)"
                  value={cta.label}
                  onChange={(e) => {
                    const next = [...draft.ctas]
                    next[i] = { ...cta, label: e.target.value }
                    setDraft({ ...draft, ctas: next })
                  }}
                />
                <button
                  className="text-red-400 hover:text-red-600 shrink-0"
                  onClick={() => setDraft({ ...draft, ctas: draft.ctas.filter((c) => c.id !== cta.id) })}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Input
                placeholder='CTA sentence (e.g. "If you run a business and want to stay consistent on social media")'
                value={cta.text}
                onChange={(e) => {
                  const next = [...draft.ctas]
                  next[i] = { ...cta, text: e.target.value }
                  setDraft({ ...draft, ctas: next })
                }}
              />
              <Input
                placeholder="https://link-for-this-cta.com"
                value={cta.url}
                onChange={(e) => {
                  const next = [...draft.ctas]
                  next[i] = { ...cta, url: e.target.value }
                  setDraft({ ...draft, ctas: next })
                }}
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDraft({ ...draft, ctas: [...draft.ctas, { id: uid(), label: '', text: '', url: '' }] })
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add CTA
          </Button>
        </div>
      </div>

      <div className={sectionCls}>
        <div className="font-medium text-[var(--text-primary)] mb-1">PS lines</div>
        <p className="text-xs text-[var(--text-tertiary)] mb-3">
          Used when a campaign is set to custom PS mode; the emails rotate through them. AI mode writes a fresh one each time.
        </p>
        <div className="space-y-2">
          {draft.ps_pool.map((ps, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="PS: if you want the behind-the-scenes of how this works, watch this: LINK"
                value={ps}
                onChange={(e) => {
                  const next = [...draft.ps_pool]
                  next[i] = e.target.value
                  setDraft({ ...draft, ps_pool: next })
                }}
              />
              <button
                className="text-red-400 hover:text-red-600 shrink-0"
                onClick={() => setDraft({ ...draft, ps_pool: draft.ps_pool.filter((_, j) => j !== i) })}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, ps_pool: [...draft.ps_pool, ''] })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add PS line
          </Button>
        </div>
      </div>

      <div className={sectionCls}>
        <div className="font-medium text-[var(--text-primary)] mb-1">Social icons</div>
        <p className="text-xs text-[var(--text-tertiary)] mb-3">Tiny icons under every email. Clicks are tracked.</p>
        <div className="space-y-2">
          {draft.socials.map((s, i) => (
            <div key={i} className="flex gap-2">
              <select
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] px-3 py-2 text-sm"
                value={s.platform}
                onChange={(e) => {
                  const next = [...draft.socials]
                  next[i] = { ...s, platform: e.target.value }
                  setDraft({ ...draft, socials: next })
                }}
              >
                {['instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'website'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <Input
                placeholder="https://instagram.com/yourbrand"
                value={s.url}
                onChange={(e) => {
                  const next = [...draft.socials]
                  next[i] = { ...s, url: e.target.value }
                  setDraft({ ...draft, socials: next })
                }}
              />
              <button
                className="text-red-400 hover:text-red-600 shrink-0"
                onClick={() => setDraft({ ...draft, socials: draft.socials.filter((_, j) => j !== i) })}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDraft({ ...draft, socials: [...draft.socials, { platform: 'instagram', url: '' }] })}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add social
          </Button>
        </div>
      </div>

      <div className={sectionCls}>
        <div className="font-medium text-[var(--text-primary)] mb-1">Footer and limits</div>
        <div className="space-y-3 mt-3">
          <Input
            label="Business address (shown in the email footer)"
            placeholder="Your Business LLC, 123 Main St, City, Country"
            value={draft.footer_address}
            onChange={(e) => setDraft({ ...draft, footer_address: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Daily send limit"
              type="number"
              value={String(draft.daily_send_cap)}
              onChange={(e) => setDraft({ ...draft, daily_send_cap: Number(e.target.value) || 100 })}
            />
            <Input
              label="AI generations per month"
              type="number"
              value={String(draft.monthly_generation_cap)}
              onChange={(e) => setDraft({ ...draft, monthly_generation_cap: Number(e.target.value) || 60 })}
            />
          </div>
          <p className="text-xs text-[var(--text-tertiary)]">
            Sends above the daily limit roll over to the next day automatically. The connected email
            account can safely send about <b>{planDailyMax}/day</b> - anything you set above that is
            capped to it. The sender address and reply-to are managed in Settings under Email branding
            and Gmail.
          </p>
        </div>
      </div>

      {canManage && (
        <div className="sticky bottom-4 z-10 flex justify-end pointer-events-none">
          <Button onClick={save} isLoading={saving} className="pointer-events-auto shadow-lg">
            Save settings
          </Button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Campaign create/edit modal
// ============================================================================

function CampaignModal({
  clientId,
  editing,
  groups,
  settings,
  onClose,
  onSaved,
}: {
  clientId: string
  editing: Campaign | null
  groups: Group[]
  settings: MarketingSettings
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const rules = editing?.schedule_rules || {}
  const [name, setName] = useState(editing?.name || '')
  const [kind, setKind] = useState<'recurring' | 'broadcast'>(editing?.kind || 'recurring')
  const [groupId, setGroupId] = useState(editing?.group_id || '')
  const [weekdays, setWeekdays] = useState<number[]>(rules.weekdays || [2])
  const [sendTime, setSendTime] = useState(rules.send_time || '09:00')
  // Default to the browser's zone - the person setting up the campaign is
  // usually in (or aware of) the audience's region.
  const [timezone, setTimezone] = useState<string>(
    rules.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  )
  const timezoneOptions = useMemo(() => {
    try {
      const all = Intl.supportedValuesOf('timeZone')
      return all.includes(timezone) ? all : [timezone, ...all]
    } catch {
      return [timezone, 'UTC', 'Africa/Lagos', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai']
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [cadence, setCadence] = useState<string>(rules.cadence || 'weekly')
  const [dateFrom, setDateFrom] = useState(rules.date_from || '')
  const [dateTo, setDateTo] = useState(rules.date_to || '')
  const [specificDates, setSpecificDates] = useState((rules.specific_dates || []).join(', '))
  const [autoApprove, setAutoApprove] = useState(editing?.auto_approve || false)
  const [ctaIds, setCtaIds] = useState<string[]>(editing?.cta_ids || [])
  const [psMode, setPsMode] = useState<'ai' | 'custom' | 'none'>(editing?.ps_mode || 'ai')
  const [topicFocus, setTopicFocus] = useState(editing?.topic_focus || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) {
      toast.error('Give the campaign a name')
      return
    }
    if (timezone && !isValidTimezone(timezone)) {
      toast.error('Pick a timezone from the list (e.g. America/New_York)')
      return
    }
    setSaving(true)
    try {
      const payload = {
        clientId,
        name,
        kind,
        groupId: groupId || null,
        scheduleRules: {
          weekdays,
          send_time: sendTime,
          timezone,
          cadence,
          date_from: dateFrom || null,
          date_to: dateTo || null,
          specific_dates: specificDates
            .split(',')
            .map((s) => s.trim())
            .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
        },
        autoApprove,
        ctaIds,
        psMode,
        topicFocus,
      }
      const res = await fetch('/api/crm/email-marketing/campaigns', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { ...payload, id: editing.id } : payload),
      }).then((r) => r.json())
      if (!res.success) {
        toast.error(res.error || 'Could not save campaign')
        return
      }
      toast.success(editing ? 'Campaign updated' : 'Campaign created - activate it when ready')
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={editing ? 'Edit campaign' : 'New campaign'} onClose={onClose}>
      <div className="space-y-4">
        <Input label="Name" placeholder="Weekly value email" value={name} onChange={(e) => setName(e.target.value)} />

        {!editing && (
          <div>
            <div className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">Type</div>
            <div className="flex gap-2">
              {(
                [
                  ['recurring', 'Recurring', 'AI writes an email for every scheduled date'],
                  ['broadcast', 'One-time', 'A single email, AI-drafted or written by you'],
                ] as const
              ).map(([value, label, desc]) => (
                <button
                  key={value}
                  onClick={() => setKind(value)}
                  className={`flex-1 rounded-lg border p-3 text-left ${
                    kind === value
                      ? 'border-[#2B79F7] bg-[#2B79F7]/5'
                      : 'border-[var(--border-primary)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">Send to</div>
          <select
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] px-3 py-2.5 text-sm"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
          >
            <option value="">All leads with an email</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.recipient_count})
              </option>
            ))}
          </select>
        </div>

        <div>
          <Input
            label="Audience timezone"
            list="tz-options"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Type to search: America/New_York, Africa/Lagos..."
          />
          <datalist id="tz-options">
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Send dates and times are in this timezone, where the leads are.
          </p>
        </div>

        {kind === 'recurring' && (
          <>
            <div>
              <div className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">Send days</div>
              <div className="flex gap-1.5 flex-wrap">
                {WEEKDAY_LABELS.map((label, day) => (
                  <button
                    key={day}
                    onClick={() =>
                      setWeekdays((prev) =>
                        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                      weekdays.includes(day)
                        ? 'bg-[#2B79F7] text-white border-[#2B79F7]'
                        : 'border-[var(--border-primary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <button className="text-xs text-[#2B79F7]" onClick={() => setWeekdays([1, 2, 3, 4, 5])}>
                  Weekdays
                </button>
                <button className="text-xs text-[#2B79F7]" onClick={() => setWeekdays([0, 6])}>
                  Weekends
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium text-[var(--text-secondary)] mb-1">Frequency</div>
                <select
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] px-3 py-2.5 text-sm"
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value)}
                >
                  <option value="weekly">Once a week (first selected day)</option>
                  <option value="every_eligible_day">Every selected day</option>
                </select>
              </div>
              <Input label="Send time" type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Start date (optional)" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input label="End date (optional)" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <Input
              label="Extra specific dates (optional, comma separated)"
              placeholder="2026-07-04, 2026-07-18"
              value={specificDates}
              onChange={(e) => setSpecificDates(e.target.value)}
            />
            <Input
              label="Topic focus for the AI (optional)"
              placeholder="e.g. lessons about staying consistent"
              value={topicFocus}
              onChange={(e) => setTopicFocus(e.target.value)}
            />
          </>
        )}

        {settings.ctas.length > 0 && (
          <div>
            <div className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">
              CTAs to rotate (none selected = rotate all)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {settings.ctas.map((cta) => (
                <button
                  key={cta.id}
                  onClick={() =>
                    setCtaIds((prev) =>
                      prev.includes(cta.id) ? prev.filter((id) => id !== cta.id) : [...prev, cta.id],
                    )
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    ctaIds.includes(cta.id)
                      ? 'bg-[#2B79F7] text-white border-[#2B79F7]'
                      : 'border-[var(--border-primary)] text-[var(--text-secondary)]'
                  }`}
                >
                  {cta.label || cta.text.slice(0, 30)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-sm font-medium text-[var(--text-secondary)] mb-1">PS line</div>
            <select
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] px-3 py-2.5 text-sm"
              value={psMode}
              onChange={(e) => setPsMode(e.target.value as 'ai' | 'custom' | 'none')}
            >
              <option value="ai">AI writes a witty PS</option>
              <option value="custom">Rotate my PS lines</option>
              <option value="none">No PS</option>
            </select>
          </div>
          <div className="flex items-end pb-1">
            <Toggle
              checked={autoApprove}
              onChange={setAutoApprove}
              label="Auto-approve"
              description="Skip review; emails send on schedule"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={saving}>
            {editing ? 'Save changes' : 'Create campaign'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ============================================================================
// Group create/edit modal
// ============================================================================

interface LeadOption {
  id: string
  name: string
  email: string
}

function GroupModal({
  clientId,
  editing,
  statusOptions,
  fieldKeys,
  onClose,
  onSaved,
}: {
  clientId: string
  editing: Group | null
  statusOptions: string[]
  fieldKeys: string[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const supabase = useMemo(() => createClient(), [])
  const [name, setName] = useState(editing?.name || '')
  const [statuses, setStatuses] = useState<string[]>(editing?.filters.statuses || [])
  const [rules, setRules] = useState<{ field: string; op: GroupRuleOp; value: string }[]>(
    (editing?.filters.rules as { field: string; op: GroupRuleOp; value: string }[]) || [],
  )
  const [leadIds, setLeadIds] = useState<string[]>(editing?.lead_ids || [])
  const [leads, setLeads] = useState<LeadOption[]>([])
  // Raw lead data drives the rule-builder dropdowns: fields the leads
  // actually carry (source, capture answers...) and the distinct values
  // seen per field, so building a rule is pick + pick, not guesswork.
  const [leadDataRows, setLeadDataRows] = useState<Record<string, unknown>[]>([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('leads')
        .select('id, data')
        .eq('client_id', clientId)
      setLeadDataRows(((data || []).map((l) => l.data) as Record<string, unknown>[]) || [])
      setLeads(
        (data || [])
          .map((l) => {
            const d = (l.data as Record<string, unknown>) || {}
            return {
              id: l.id as string,
              name: String(d.name ?? '').trim(),
              email: String(d.email ?? '').trim(),
            }
          })
          .filter((l) => l.email),
      )
    })()
  }, [clientId, supabase])

  const HIDDEN_RULE_FIELDS = useMemo(
    () => new Set(['status', '__notes', 'meeting_date', 'meeting_time']),
    [],
  )
  const ruleFieldOptions = useMemo(() => {
    const keys = new Set<string>(fieldKeys)
    for (const d of leadDataRows) {
      for (const k of Object.keys(d || {})) keys.add(k)
    }
    return Array.from(keys)
      .filter(
        (k) =>
          k &&
          !HIDDEN_RULE_FIELDS.has(k) &&
          // Raw capture field ids ("field-1766430496663") are unreadable
          // noise - capture answers worth filtering on get a named column
          // via the "Save answer to the lead profile" toggle.
          !/^field[-_]?\d{6,}$/.test(k),
      )
      .sort()
  }, [fieldKeys, leadDataRows, HIDDEN_RULE_FIELDS])

  const valueSuggestions = useCallback(
    (field: string): string[] => {
      if (!field) return []
      const seen = new Set<string>()
      for (const d of leadDataRows) {
        const v = String((d || {})[field] ?? '').trim()
        if (v) seen.add(v)
        if (seen.size >= 30) break
      }
      return Array.from(seen).sort()
    },
    [leadDataRows],
  )

  const filteredLeads = leads.filter(
    (l) =>
      !search ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.email.toLowerCase().includes(search.toLowerCase()),
  )

  const save = async () => {
    if (!name.trim()) {
      toast.error('Give the group a name')
      return
    }
    setSaving(true)
    try {
      const payload = {
        clientId,
        name,
        filters: {
          statuses,
          rules: rules.filter((r) => r.field && (r.value || VALUELESS_OPS.includes(r.op))),
        },
        leadIds,
      }
      const res = await fetch('/api/crm/email-marketing/groups', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { ...payload, id: editing.id } : payload),
      }).then((r) => r.json())
      if (!res.success) {
        toast.error(res.error || 'Could not save group')
        return
      }
      toast.success(editing ? 'Group updated' : 'Group created')
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={editing ? 'Edit group' : 'New group'} onClose={onClose}>
      <div className="space-y-4">
        <Input label="Name" placeholder="Hot leads" value={name} onChange={(e) => setName(e.target.value)} />

        {statusOptions.length > 0 && (
          <div>
            <div className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">
              Lead status is any of
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statusOptions.map((s) => (
                <button
                  key={s}
                  onClick={() =>
                    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    statuses.includes(s)
                      ? 'bg-[#2B79F7] text-white border-[#2B79F7]'
                      : 'border-[var(--border-primary)] text-[var(--text-secondary)]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">Field rules</div>
          <div className="space-y-2">
            {rules.map((r, i) => (
              <div key={i} className="flex gap-2">
                <select
                  className="flex-1 min-w-0 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] px-2 py-2 text-sm"
                  value={r.field}
                  onChange={(e) => {
                    const next = [...rules]
                    next[i] = { ...r, field: e.target.value }
                    setRules(next)
                  }}
                >
                  <option value="">Pick a field…</option>
                  {ruleFieldOptions.map((k) => (
                    <option key={k} value={k}>
                      {k.replace(/[_-]/g, ' ')}
                    </option>
                  ))}
                </select>
                <select
                  className="shrink-0 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] px-2 py-2 text-sm"
                  value={r.op}
                  onChange={(e) => {
                    const next = [...rules]
                    next[i] = { ...r, op: e.target.value as GroupRuleOp }
                    setRules(next)
                  }}
                >
                  {(Object.keys(GROUP_RULE_OP_LABELS) as GroupRuleOp[]).map((op) => (
                    <option key={op} value={op}>
                      {GROUP_RULE_OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                {!VALUELESS_OPS.includes(r.op) && (
                  <>
                    <Input
                      placeholder="value"
                      list={`rule-values-${i}`}
                      value={r.value}
                      onChange={(e) => {
                        const next = [...rules]
                        next[i] = { ...r, value: e.target.value }
                        setRules(next)
                      }}
                    />
                    <datalist id={`rule-values-${i}`}>
                      {valueSuggestions(r.field).map((v) => (
                        <option key={v} value={v} />
                      ))}
                    </datalist>
                  </>
                )}
                <button
                  className="text-red-400 hover:text-red-600 shrink-0"
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setRules([...rules, { field: '', op: 'eq', value: '' }])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add rule
            </Button>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            Hand-picked leads ({leadIds.length})
          </div>
          <Input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-[var(--border-primary)] divide-y divide-[var(--border-primary)]">
            {filteredLeads.slice(0, 50).map((l) => (
              <label key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--bg-tertiary)]">
                <input
                  type="checkbox"
                  checked={leadIds.includes(l.id)}
                  onChange={(e) =>
                    setLeadIds((prev) => (e.target.checked ? [...prev, l.id] : prev.filter((id) => id !== l.id)))
                  }
                  className="h-4 w-4 rounded border-[var(--border-primary)] text-[#2B79F7]"
                />
                <span className="text-[var(--text-primary)]">{l.name || l.email}</span>
                {l.name && <span className="text-xs text-[var(--text-tertiary)]">{l.email}</span>}
              </label>
            ))}
            {filteredLeads.length === 0 && (
              <div className="px-3 py-3 text-sm text-[var(--text-tertiary)]">No leads with an email found</div>
            )}
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
            A lead is in the group when it matches the rules above OR is hand-picked here.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={saving}>
            {editing ? 'Save changes' : 'Create group'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ============================================================================
// Composer (edit draft / write custom email) with live preview
// ============================================================================

function ComposerModal({
  clientId,
  campaignId,
  email,
  settings,
  senderName,
  campaignRules,
  onClose,
  onSaved,
}: {
  clientId: string
  campaignId: string
  email: CampaignEmail | null
  settings: MarketingSettings
  senderName: string
  campaignRules: Campaign['schedule_rules'] | undefined
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const rules = useMemo(() => parseScheduleRules(campaignRules || {}), [campaignRules])
  const [subject, setSubject] = useState(email?.subject || '')
  const [preheader, setPreheader] = useState(email?.preheader || '')
  const [hookTitle, setHookTitle] = useState(email?.hook_title || '')
  const [blocks, setBlocks] = useState<Block[]>(() =>
    (email?.blocks?.length ? email.blocks : [{ id: uid(), type: 'text' as const, content: '' }]).map(
      (b) =>
        (b.type === 'text' || b.type === 'callout') && b.content && !looksLikeHtml(b.content)
          ? { ...b, content: plainToEditorHtml(b.content) }
          : b,
    ),
  )
  const [ps, setPs] = useState(() =>
    email?.ps && !looksLikeHtml(email.ps) ? plainToEditorHtml(email.ps) : email?.ps || '',
  )
  const [ctaIds, setCtaIds] = useState<string[]>(
    email?.cta_snapshot?.map((c) => c.id) || [],
  )
  // Prefill from the campaign schedule: drafts created before scheduling
  // existed (or with no date yet) show the campaign's next eligible date
  // instead of an empty field.
  const [scheduledFor, setScheduledFor] = useState(
    () =>
      email?.scheduled_for ||
      upcomingSendDates(
        parseScheduleRules(campaignRules || {}),
        zonedNow(parseScheduleRules(campaignRules || {}).timezone).ymd,
        60,
      )[0] ||
      '',
  )
  const [sendTime, setSendTime] = useState(email?.send_time || rules.send_time || '09:00')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [testTo, setTestTo] = useState('')

  // Reviewing an existing unapproved draft: surface the schedule and an
  // Approve action so review happens in one place.
  const isReview = email?.status === 'draft'
  const selectedCtas = settings.ctas.filter((c) => ctaIds.includes(c.id))

  // Instant preview: the render function is pure, so it runs right here in
  // the browser on every keystroke - no server round-trip, no debounce.
  // The send path uses the exact same function server-side, so what you see
  // is what goes out.
  const previewHtml = useMemo(() => {
    try {
      return renderMarketingEmail({
        subject,
        preheader,
        hookTitle,
        blocks,
        ps,
        ctas: selectedCtas,
        settings,
        fromName: senderName || 'Your brand',
        appUrl: typeof window !== 'undefined' ? window.location.origin : '',
        recipient: null,
      }).html
    } catch {
      return ''
    }
  }, [subject, preheader, hookTitle, blocks, ps, selectedCtas, settings, senderName])

  const save = async (): Promise<string | null> => {
    setSaving(true)
    try {
      const common = {
        clientId,
        subject,
        preheader,
        hookTitle,
        blocks,
        ps,
        ctaSnapshot: selectedCtas,
        scheduledFor: scheduledFor || undefined,
        sendTime,
      }
      if (email) {
        const res = await fetch('/api/crm/email-marketing/emails', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...common, id: email.id }),
        }).then((r) => r.json())
        if (!res.success) {
          toast.error(res.error || 'Could not save')
          return null
        }
        return email.id
      }
      const res = await fetch('/api/crm/email-marketing/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...common, action: 'create', campaignId, ctaIds }),
      }).then((r) => r.json())
      if (!res.success) {
        toast.error(res.error || 'Could not create')
        return null
      }
      return res.id as string
    } finally {
      setSaving(false)
    }
  }

  const updateBlock = (id: string, patch: Partial<Block>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)))
  }

  // Grip-dots / slash-command insert menu. The split is captured at the
  // moment the menu OPENS (the selection dies once the user clicks a menu
  // item), so picking "Highlight" can turn the selected text into its own
  // box right where it sits, with the surrounding text flowing around it.
  const editorRefs = useRef<Record<string, RichTextHandle | null>>({})
  const [insertMenu, setInsertMenu] = useState<{
    anchor: string // block id, or 'end' to append
    split: { before: string; selected: string; after: string } | null
  } | null>(null)

  const openInsertMenu = (anchor: string) => {
    if (insertMenu?.anchor === anchor) {
      setInsertMenu(null)
      return
    }
    const split = anchor === 'end' ? null : editorRefs.current[anchor]?.getSplit() || null
    setInsertMenu({ anchor, split })
  }

  const chooseBlock = (def: (typeof BLOCK_DEFS)[number]) => {
    if (!insertMenu) return
    const { anchor, split } = insertMenu
    setBlocks((prev) => {
      const block = def.make()
      if (anchor === 'end') return [...prev, block]
      const i = prev.findIndex((b) => b.id === anchor)
      if (i === -1) return [...prev, block]

      const anchorBlock = prev[i]
      const isRich = anchorBlock.type === 'text' || anchorBlock.type === 'callout'
      if (!isRich || !split) {
        return [...prev.slice(0, i + 1), block, ...prev.slice(i + 1)]
      }

      // Split the text where the cursor/selection was. Text and highlight
      // blocks CONSUME the selection (it becomes their content); media
      // blocks leave the selected text in place and slot in after it.
      const consumesSelection = block.type === 'text' || block.type === 'callout'
      let beforeHtml = split.before
      const afterHtml = split.after
      if (consumesSelection && htmlHasText(split.selected)) {
        ;(block as { content: string }).content = split.selected
      } else if (!consumesSelection) {
        beforeHtml = split.before + split.selected
      }

      // New ids on the pieces force the editors to remount with the split
      // content (they only read initialHtml on mount).
      const pieces: Block[] = []
      if (htmlHasText(beforeHtml)) {
        pieces.push({ ...anchorBlock, id: uid(), content: beforeHtml } as Block)
      }
      pieces.push(block)
      if (htmlHasText(afterHtml)) {
        pieces.push({ id: uid(), type: anchorBlock.type, content: afterHtml } as Block)
      }
      const next = [...prev]
      next.splice(i, 1, ...pieces)
      return next
    })
    setInsertMenu(null)
  }

  const insertMenuEl = () => (
    <>
      <div className="fixed inset-0 z-10" onClick={() => setInsertMenu(null)} />
      <div className="absolute left-0 top-7 z-20 w-60 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-xl py-1">
        <div className="px-3 py-1 text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
          {insertMenu?.split && htmlHasText(insertMenu.split.selected)
            ? 'Turn selection into / insert here'
            : insertMenu?.split
              ? 'Insert at cursor'
              : 'Add block'}
        </div>
        {BLOCK_DEFS.map((def) => (
          <button
            key={def.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chooseBlock(def)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--bg-tertiary)]"
          >
            <def.icon className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
            <span>
              <span className="block text-sm text-[var(--text-primary)]">{def.label}</span>
              <span className="block text-[11px] text-[var(--text-tertiary)]">{def.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  )

  return (
    <Modal title={isReview ? 'Review email' : email ? 'Edit email' : 'Write email'} onClose={onClose} wide>
      <div className="grid lg:grid-cols-2 gap-5 lg:h-[72vh]">
        {/* ===== editor column: scrolls internally so it never grows past
             the preview and leaves dead space under it. The inner padding
             keeps focus rings from being clipped by the overflow edge. ===== */}
        <div className="space-y-3 lg:h-full lg:overflow-y-auto lg:px-1.5 lg:py-1">
          <Input
            label={`Subject (${subject.length}/45 recommended)`}
            placeholder="The mistake that cost me 6 months"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <Input
            label="Preview text (shows after the subject in the inbox)"
            placeholder="And the 10-minute habit that fixed it"
            value={preheader}
            onChange={(e) => setPreheader(e.target.value)}
          />
          <Input
            label="Hook title (top of the email)"
            placeholder="A quick hook on what this email is about"
            value={hookTitle}
            onChange={(e) => setHookTitle(e.target.value)}
          />

          <div>
            <div className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">Content</div>
            <div className="space-y-2">
              {blocks.map((b, blockIndex) => (
                <div key={b.id} className="rounded-lg border border-[var(--border-primary)] p-2.5">
                  <div className="relative flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        title="Insert a block (at your cursor or selection)"
                        className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => openInsertMenu(b.id)}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-tertiary)]">
                        {b.type === 'callout' ? 'highlight' : b.type}
                      </span>
                    </div>
                    {insertMenu?.anchor === b.id && insertMenuEl()}
                    <div className="flex items-center gap-1">
                      <button
                        title="Move up"
                        disabled={blockIndex === 0}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                        onClick={() =>
                          setBlocks((prev) => {
                            const next = [...prev]
                            ;[next[blockIndex - 1], next[blockIndex]] = [next[blockIndex], next[blockIndex - 1]]
                            return next
                          })
                        }
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Move down"
                        disabled={blockIndex === blocks.length - 1}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                        onClick={() =>
                          setBlocks((prev) => {
                            const next = [...prev]
                            ;[next[blockIndex], next[blockIndex + 1]] = [next[blockIndex + 1], next[blockIndex]]
                            return next
                          })
                        }
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      {blocks.length > 1 && (
                        <button
                          className="text-red-400 hover:text-red-600 ml-1"
                          onClick={() => setBlocks((prev) => prev.filter((x) => x.id !== b.id))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {b.type === 'text' && (
                    <RichTextArea
                      ref={(h) => {
                        editorRefs.current[b.id] = h
                      }}
                      initialHtml={b.content}
                      onChange={(html) => updateBlock(b.id, { content: html } as Partial<Block>)}
                      placeholder={'The teaching part. Use {{first_name}} to personalize.\nSelect text for bold, italic, links, or hit / to insert a block right there.'}
                      onSlashCommand={() => openInsertMenu(b.id)}
                    />
                  )}
                  {b.type === 'callout' && (
                    <RichTextArea
                      ref={(h) => {
                        editorRefs.current[b.id] = h
                      }}
                      initialHtml={b.content}
                      onChange={(html) => updateBlock(b.id, { content: html } as Partial<Block>)}
                      placeholder="Text that stands out in its own box, like an aside or key takeaway."
                      minHeight={70}
                      onSlashCommand={() => openInsertMenu(b.id)}
                    />
                  )}
                  {b.type === 'image' && (
                    <Input
                      placeholder="Paste an image URL"
                      value={b.url}
                      onChange={(e) => updateBlock(b.id, { url: e.target.value } as Partial<Block>)}
                    />
                  )}
                  {b.type === 'embed' && (
                    <div className="space-y-2">
                      <Input
                        placeholder="Paste any link: YouTube, Loom, Vimeo, image, video file"
                        value={b.url}
                        onChange={(e) => updateBlock(b.id, { url: e.target.value } as Partial<Block>)}
                      />
                      <Input
                        placeholder="Caption (e.g. Watch the 2-minute walkthrough)"
                        value={b.title || ''}
                        onChange={(e) => updateBlock(b.id, { title: e.target.value } as Partial<Block>)}
                      />
                    </div>
                  )}
                  {b.type === 'button' && (
                    <div className="space-y-2">
                      <Input
                        placeholder="Button label"
                        value={b.label}
                        onChange={(e) => updateBlock(b.id, { label: e.target.value } as Partial<Block>)}
                      />
                      <Input
                        placeholder="https://destination.com"
                        value={b.url}
                        onChange={(e) => updateBlock(b.id, { url: e.target.value } as Partial<Block>)}
                      />
                    </div>
                  )}
                </div>
              ))}
              <div className="relative">
                <button
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-primary)] py-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                  onClick={() => openInsertMenu('end')}
                >
                  <Plus className="h-3.5 w-3.5" /> Add block
                  <span className="text-[11px] opacity-60">(or type / in the text)</span>
                </button>
                {insertMenu?.anchor === 'end' && insertMenuEl()}
              </div>
            </div>
          </div>

          {settings.ctas.length > 0 && (
            <div>
              <div className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">CTAs in this email</div>
              <div className="flex flex-wrap gap-1.5">
                {settings.ctas.map((cta) => (
                  <button
                    key={cta.id}
                    onClick={() =>
                      setCtaIds((prev) =>
                        prev.includes(cta.id) ? prev.filter((id) => id !== cta.id) : [...prev, cta.id],
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                      ctaIds.includes(cta.id)
                        ? 'bg-[#2B79F7] text-white border-[#2B79F7]'
                        : 'border-[var(--border-primary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {cta.label || cta.text.slice(0, 30)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-sm font-medium text-[var(--text-secondary)] mb-1">PS line</div>
            <RichTextArea
              initialHtml={ps}
              onChange={setPs}
              placeholder="One witty line. Select text to link it: if you want the full story, watch this."
              minHeight={44}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Send date" type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
            <Input label="Send time" type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Input
              placeholder="you@email.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              className="max-w-[200px]"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const id = await save()
                if (!id) return
                const res = await fetch('/api/crm/email-marketing/emails', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ clientId, action: 'test_send', id, to: testTo }),
                }).then((r) => r.json())
                if (res.success) toast.success('Test email on its way')
                else toast.error(res.error || 'Could not send test')
              }}
            >
              Send test
            </Button>
          </div>
        </div>

        {/* ===== preview column: fills the modal height ===== */}
        <div className="flex flex-col min-h-[400px] lg:h-full">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium text-[var(--text-secondary)]">Preview</span>
            <span className="text-xs text-[var(--text-tertiary)]">updates as you type</span>
          </div>
          <iframe
            title="Email preview"
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"/></head><body style="margin:0;background:#F6F5F4;">${previewHtml}</body></html>`}
            className="w-full flex-1 min-h-[400px] rounded-lg border border-[var(--border-primary)] bg-[#F6F5F4]"
            sandbox=""
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-2 border-t border-[var(--border-primary)]">
        <div className="flex items-center gap-1.5 text-sm">
          <CalendarClock className="h-4 w-4 text-[var(--text-tertiary)]" />
          {scheduledFor ? (
            <span className="text-[var(--text-secondary)]">
              Sends{' '}
              <b className="text-[var(--text-primary)]">
                {fmtDate(scheduledFor)}
                {sendTime ? ` at ${sendTime}` : ''}
              </b>
              {email?.status === 'approved' ? ' - approved' : ' - once approved'}
            </span>
          ) : (
            <span className="text-amber-600 font-medium">No send date set</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isReview ? 'outline' : 'primary'}
            isLoading={saving}
            onClick={async () => {
              const id = await save()
              if (id) {
                toast.success('Saved as draft')
                await onSaved()
              }
            }}
          >
            Save draft
          </Button>
          {isReview && (
            <Button
              isLoading={approving}
              onClick={async () => {
                if (!scheduledFor) {
                  toast.error('Set a send date first')
                  return
                }
                setApproving(true)
                try {
                  const id = await save()
                  if (!id) return
                  const res = await fetch('/api/crm/email-marketing/emails', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId, action: 'approve', id }),
                  }).then((r) => r.json())
                  if (!res.success) {
                    toast.error(res.error || 'Could not approve')
                    return
                  }
                  toast.success(`Approved - sends ${fmtDate(scheduledFor)} at ${sendTime}`)
                  await onSaved()
                } finally {
                  setApproving(false)
                }
              }}
            >
              Approve
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ============================================================================
// Rich text editor for text/callout blocks: bold, italic, underline, links.
// contentEditable + execCommand keeps it dependency-free; the server
// sanitizes the HTML down to email-safe tags at render time.
// ============================================================================

/** What the editor hands back when a block is inserted mid-text: the HTML
 *  before the selection, the selection itself, and the HTML after it. */
interface RichTextSplit {
  before: string
  selected: string
  after: string
}

export interface RichTextHandle {
  /** Split the content at the current selection/caret, or null when the
   *  selection isn't inside this editor. */
  getSplit: () => RichTextSplit | null
}

interface RichTextAreaProps {
  initialHtml: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  /** Fired when "/" is typed at the start of a line or with text selected -
   *  opens the block menu so blocks can be inserted right there. */
  onSlashCommand?: () => void
}

const RichTextArea = forwardRef<RichTextHandle, RichTextAreaProps>(function RichTextArea(
  { initialHtml, onChange, placeholder, minHeight = 130, onSlashCommand },
  fwdRef,
) {
  const ref = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [linkMode, setLinkMode] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [empty, setEmpty] = useState(!initialHtml || initialHtml === '<div><br></div>')

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml
    // Mount-only by design: the block id is the key, so a different block
    // remounts; we never push value back in while the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = () => {
    const html = ref.current?.innerHTML || ''
    setEmpty(!ref.current?.textContent?.trim())
    onChange(html)
  }

  useImperativeHandle(fwdRef, () => ({
    getSplit: () => {
      const root = ref.current
      const sel = window.getSelection()
      if (!root || !sel || sel.rangeCount === 0) return null
      const range = sel.getRangeAt(0)
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
      const toHtml = (r: Range) => {
        const div = document.createElement('div')
        div.appendChild(r.cloneContents())
        return div.innerHTML
      }
      const beforeRange = document.createRange()
      beforeRange.selectNodeContents(root)
      beforeRange.setEnd(range.startContainer, range.startOffset)
      const afterRange = document.createRange()
      afterRange.selectNodeContents(root)
      afterRange.setStart(range.endContainer, range.endOffset)
      return { before: toHtml(beforeRange), selected: toHtml(range), after: toHtml(afterRange) }
    },
  }))

  const exec = (command: string) => {
    ref.current?.focus()
    document.execCommand(command)
    emit()
  }

  const startLink = () => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      toast.error('Select the text to turn into a link first')
      return
    }
    savedRange.current = sel.getRangeAt(0).cloneRange()
    setLinkUrl('')
    setLinkMode(true)
  }

  const applyLink = () => {
    let url = linkUrl.trim()
    if (!url) {
      setLinkMode(false)
      return
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    const sel = window.getSelection()
    if (sel && savedRange.current) {
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
      document.execCommand('createLink', false, url)
      emit()
    }
    setLinkMode(false)
  }

  const toolBtn = (onClick: () => void, title: string, children: React.ReactNode) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
    >
      {children}
    </button>
  )

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] focus-within:ring-2 focus-within:ring-[#2B79F7]">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-[var(--border-primary)]">
        {toolBtn(() => exec('bold'), 'Bold', <Bold className="h-3.5 w-3.5" />)}
        {toolBtn(() => exec('italic'), 'Italic', <Italic className="h-3.5 w-3.5" />)}
        {toolBtn(() => exec('underline'), 'Underline', <Underline className="h-3.5 w-3.5" />)}
        {toolBtn(startLink, 'Link', <Link2 className="h-3.5 w-3.5" />)}
        {toolBtn(
          () => {
            exec('removeFormat')
            exec('unlink')
          },
          'Clear formatting',
          <RemoveFormatting className="h-3.5 w-3.5" />,
        )}
        {linkMode && (
          <div className="flex items-center gap-1 ml-2 flex-1">
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyLink()
                }
                if (e.key === 'Escape') setLinkMode(false)
              }}
              placeholder="https://link.com"
              className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyLink}
              className="text-xs font-medium text-[#2B79F7] px-1.5"
            >
              Add
            </button>
          </div>
        )}
      </div>
      <div className="relative">
        {empty && placeholder && (
          <div className="pointer-events-none absolute left-3 top-2 text-sm text-[var(--text-tertiary)] whitespace-pre-line">
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          onKeyDown={(e) => {
            if (e.key !== '/' || !onSlashCommand) return
            const sel = window.getSelection()
            const root = ref.current
            if (!sel || !root || !sel.anchorNode || !root.contains(sel.anchorNode)) return
            // Text selected: "/" opens the menu so the selection can become
            // a highlight (or have a block dropped in its place).
            if (!sel.isCollapsed) {
              e.preventDefault()
              onSlashCommand()
              return
            }
            // Caret only: trigger at the start of an empty line, so URLs and
            // mid-sentence slashes still type normally.
            const node = sel.anchorNode
            const beforeText =
              node.nodeType === Node.TEXT_NODE
                ? (node.textContent || '').slice(0, sel.anchorOffset)
                : ''
            if (!beforeText.trim()) {
              e.preventDefault()
              onSlashCommand()
            }
          }}
          className="px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none [&_a]:text-[#2B79F7] [&_a]:underline"
          style={{ minHeight }}
        />
      </div>
    </div>
  )
})

// ============================================================================
// Shared modal shell
// ============================================================================

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto p-4">
      <div
        className={`w-full ${wide ? 'max-w-4xl mt-16' : 'max-w-lg mt-28'} mb-8 rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)] shadow-xl`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <h2 className="font-semibold text-[var(--text-primary)]">{title}</h2>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Body caps at the viewport and scrolls internally (no visible
            scrollbar) so long forms never push the modal off-screen. */}
        <div className="p-5 max-h-[calc(100vh-230px)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {children}
        </div>
      </div>
    </div>
  )
}
