'use client'

import { useState } from 'react'
import {
  X,
  Lock,
  Sparkles,
  ChevronDown,
  Check,
  type LucideIcon,
} from 'lucide-react'

type FeatureName =
  | 'Dashboard'
  | 'Leads'
  | 'Revenue'
  | 'Meetings'
  | 'Team'
  | 'Capture Pages'

type LockedTab = { name: string; icon: LucideIcon }

interface FeatureDetail {
  pitch: string
  bullets: string[]
  preview: 'kpi' | 'pipeline' | 'revenue' | 'calendar' | 'team' | 'capture'
}

// Marketing copy is a separate concern from the modal layout, so it lives
// here rather than being threaded in through props. Each entry pairs a
// short pitch (always visible) with the bullets that drop down behind the
// "See more" affordance, plus the kind of preview to render.
const FEATURE_DETAIL: Record<FeatureName, FeatureDetail> = {
  Dashboard: {
    pitch:
      'A single live view of leads, meetings, revenue, and capture-page health.',
    bullets: [
      'Track lead inflow against the prior period at a glance.',
      'Monitor pending invoices, overdue payments, and revenue this month in one row.',
      'See which capture pages are pulling weight, sorted by submission count.',
      'Spot quiet weeks before they become quiet months.',
    ],
    preview: 'kpi',
  },
  Leads: {
    pitch:
      'Capture, sort, and qualify every lead with custom fields and a kanban board.',
    bullets: [
      'Create custom fields per pipeline stage - status, source, score, anything.',
      'Switch between table, board, and chart views without losing context.',
      'Drag leads through stages; the board updates in real time.',
      'Search across every field, including custom ones.',
    ],
    preview: 'pipeline',
  },
  Revenue: {
    pitch:
      'Invoice, track, and forecast every dollar tied to a client engagement.',
    bullets: [
      'Track total, this-month, pending, and overdue at the top of the page.',
      'Auto-flag overdue invoices and send reminders on a schedule.',
      'Mark payments paid in one click; the dashboard reflects it instantly.',
      'See the next invoice that needs to go out without digging.',
    ],
    preview: 'revenue',
  },
  Meetings: {
    pitch:
      'Schedule, log, and remind on every call without leaving the CRM.',
    bullets: [
      'Schedule with Zoom, Google Meet, or Jitsi in one form - no extension hopping.',
      'Auto-build join links and add the meeting to your calendar.',
      'Log status (scheduled, completed, cancelled) and see who scheduled it.',
      'Keep upcoming and past meetings cleanly separated.',
    ],
    preview: 'calendar',
  },
  Team: {
    pitch:
      'Invite teammates with the right level of access to this CRM workspace.',
    bullets: [
      'Invite by email - we send the link, they sign in, you both move on.',
      'Per-CRM roles (admin, manager, employee) - independent of agency role.',
      'See who accepted, who is pending, and remove access in one click.',
      'Profile pictures across the workspace so you know who is who.',
    ],
    preview: 'team',
  },
  'Capture Pages': {
    pitch:
      'Build branded lead-capture pages that drop submissions straight into Leads.',
    bullets: [
      'Drag-and-drop builder - text, dropdowns, meetings, file uploads, and embeds.',
      'Brand the page with your logo, banner, and colors per campaign.',
      'Submissions land in Leads with the source pre-tagged - no manual entry.',
      'Copy a share link, embed it on your site, or tie it to a specific campaign.',
    ],
    preview: 'capture',
  },
}

interface UpgradeFeaturesModalProps {
  lockedTabs: LockedTab[]
  onClose: () => void
}

export function UpgradeFeaturesModal({
  lockedTabs,
  onClose,
}: UpgradeFeaturesModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-3xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[var(--border-primary)] shrink-0">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#2B79F7]/10 text-[#2B79F7]">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Available on the Top tier
            </span>
          </div>
          <h3 className="mt-3 text-xl font-semibold text-[var(--text-primary)]">
            Unlock the full CRM
          </h3>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">
            A peek at what your workspace looks like with everything turned on.
          </p>
        </div>

        {/* Feature cards */}
        <div className="overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
          {lockedTabs.map((t) => {
            const detail = FEATURE_DETAIL[t.name as FeatureName]
            if (!detail) return null
            return (
              <FeatureCard
                key={t.name}
                name={t.name}
                Icon={t.icon}
                detail={detail}
              />
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-primary)] shrink-0">
          <p className="text-[11px] text-[var(--text-tertiary)] text-center">
            Reach out to your account manager to upgrade.
          </p>
        </div>
      </div>
    </div>
  )
}

function FeatureCard({
  name,
  Icon,
  detail,
}: {
  name: string
  Icon: LucideIcon
  detail: FeatureDetail
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
      {/* Blurred preview strip */}
      <div className="relative h-28 bg-[var(--bg-tertiary)] overflow-hidden">
        <div className="absolute inset-0 blur-[3px] opacity-70 pointer-events-none">
          <Preview kind={detail.preview} />
        </div>
        {/* Lock chip dead-center over the blurred preview */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-card)]/95 backdrop-blur-sm border border-[var(--border-primary)] text-[var(--text-secondary)] shadow-lg">
            <Lock className="h-3.5 w-3.5 text-[#2B79F7]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Locked
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3.5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-[#2B79F7]/10 text-[#2B79F7] flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{name}</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{detail.pitch}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-xs font-medium text-[#2B79F7] hover:text-[#1E54B7] transition-colors"
          aria-expanded={open}
        >
          <span>{open ? 'Hide details' : 'See more'}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <ul className="space-y-1.5 pt-1 animate-in fade-in slide-in-from-top-1 duration-150">
            {detail.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                <Check className="h-3.5 w-3.5 text-[#2B79F7] shrink-0 mt-0.5" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview faux-UIs
//
// These are intentionally crude SVG sketches - they get blurred in the
// parent so they only need to *look like the right shape*. Their purpose is
// to hint at the feature visually, not to be pixel-accurate.
// ---------------------------------------------------------------------------

function Preview({ kind }: { kind: FeatureDetail['preview'] }) {
  switch (kind) {
    case 'kpi':
      return <KpiPreview />
    case 'pipeline':
      return <PipelinePreview />
    case 'revenue':
      return <RevenuePreview />
    case 'calendar':
      return <CalendarPreview />
    case 'team':
      return <TeamPreview />
    case 'capture':
      return <CapturePreview />
  }
}

function KpiPreview() {
  return (
    <div className="absolute inset-0 p-3 grid grid-cols-4 gap-2">
      {[42, 18, '$2.4k', 7].map((v, i) => (
        <div key={i} className="rounded-lg bg-[var(--bg-card)] border border-[var(--border-primary)] p-2 flex flex-col gap-1">
          <div className="h-1.5 w-8 rounded-full bg-[var(--bg-tertiary)]" />
          <div className="text-[10px] font-bold text-[var(--text-primary)]">{v}</div>
        </div>
      ))}
    </div>
  )
}

function PipelinePreview() {
  const cols = ['#2B79F7', '#F59E0B', '#10B981']
  return (
    <div className="absolute inset-0 p-3 flex gap-2">
      {cols.map((c, i) => (
        <div key={i} className="flex-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border-primary)] p-1.5 space-y-1">
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
            <div className="h-1 flex-1 rounded-full bg-[var(--bg-tertiary)]" />
          </div>
          {Array.from({ length: 2 }).map((_, j) => (
            <div key={j} className="h-3 rounded-md bg-[var(--bg-tertiary)]" />
          ))}
        </div>
      ))}
    </div>
  )
}

function RevenuePreview() {
  // Crude line chart sketch
  return (
    <div className="absolute inset-0 p-3">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="w-full h-full">
        <polyline
          fill="none"
          stroke="#2B79F7"
          strokeWidth="1.5"
          points="0,45 12,38 24,40 36,28 48,30 60,18 72,22 84,12 100,8"
        />
        <polyline
          fill="rgba(43,121,247,0.18)"
          stroke="none"
          points="0,45 12,38 24,40 36,28 48,30 60,18 72,22 84,12 100,8 100,60 0,60"
        />
      </svg>
    </div>
  )
}

function CalendarPreview() {
  return (
    <div className="absolute inset-0 p-3 grid grid-cols-7 gap-1">
      {Array.from({ length: 21 }).map((_, i) => (
        <div
          key={i}
          className={`rounded-sm ${
            i === 5 || i === 11 || i === 16
              ? 'bg-[#2B79F7]/40'
              : 'bg-[var(--bg-card)] border border-[var(--border-primary)]'
          }`}
        />
      ))}
    </div>
  )
}

function TeamPreview() {
  return (
    <div className="absolute inset-0 p-3 flex items-center justify-center gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-9 w-9 rounded-full bg-gradient-to-br from-[#2B79F7] to-[#1E54B7] border-2 border-[var(--bg-tertiary)]"
          style={{ marginLeft: i === 0 ? 0 : -8 }}
        />
      ))}
    </div>
  )
}

function CapturePreview() {
  return (
    <div className="absolute inset-0 p-3 flex flex-col gap-1.5">
      <div className="h-2.5 w-1/3 rounded-full bg-[var(--bg-card)]" />
      <div className="h-5 rounded-md bg-[var(--bg-card)] border border-[var(--border-primary)]" />
      <div className="h-5 rounded-md bg-[var(--bg-card)] border border-[var(--border-primary)]" />
      <div className="h-5 rounded-md bg-[#2B79F7]/40 self-end w-1/3" />
    </div>
  )
}
