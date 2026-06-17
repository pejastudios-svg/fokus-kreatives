'use client'

// Self-playing, captioned mini-demos for the "Unlock more" upgrade modal.
// Each locked feature card expands into one of these: a short loop of
// realistic, animated UI frames (built from the same design tokens as the
// real pages) that walks a mid-tier client through how the feature works -
// a fake cursor clicks buttons, results appear, bars grow, charts draw.
//
// All coded animation: no recording, no hosting, never goes stale.

import { useEffect, useRef, useState } from 'react'
import {
  Sparkles,
  Check,
  Lock,
  FileSignature,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

interface DemoStep {
  caption: string
  /** Hold time before auto-advancing. Action slides need longer. */
  ms?: number
  render: () => React.ReactNode
}

// Animation kit. `both` fill-mode means an element sits in its start state
// during its delay, then animates once - so staggered delays read as a
// sequence. Injected once per player instance.
const DEMO_CSS = `
@keyframes fk-shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
@keyframes fk-draw { from { stroke-dashoffset: var(--len, 240) } to { stroke-dashoffset: 0 } }
@keyframes fk-grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes fk-rise { from { opacity: 0; transform: translateY(9px) } to { opacity: 1; transform: translateY(0) } }
@keyframes fk-pop { 0% { opacity: 0; transform: scale(.7) } 70% { transform: scale(1.08) } 100% { opacity: 1; transform: scale(1) } }
@keyframes fk-slidein { from { opacity: 0; transform: translateX(16px) } to { opacity: 1; transform: translateX(0) } }
@keyframes fk-fade { to { opacity: 0 } }
@keyframes fk-cursor {
  0% { transform: translate(var(--fx), var(--fy)) scale(1) }
  55% { transform: translate(var(--tx), var(--ty)) scale(1) }
  64% { transform: translate(var(--tx), var(--ty)) scale(.8) }
  78% { transform: translate(var(--tx), var(--ty)) scale(1) }
  100% { transform: translate(var(--tx), var(--ty)) scale(1) }
}
@keyframes fk-ripple { 0% { opacity: .55; transform: scale(.3) } 100% { opacity: 0; transform: scale(2.6) } }
.fk-rise { animation: fk-rise .55s ease both }
.fk-pop { animation: fk-pop .5s ease both }
.fk-grow { transform-origin: left; animation: fk-grow .85s ease both }
.fk-draw { stroke-dasharray: 240; animation: fk-draw 1.7s ease both }
.fk-slidein { animation: fk-slidein .55s ease both }
.fk-fade { animation: fk-fade .35s ease both }
.fk-cursor { animation: fk-cursor 1.5s ease both }
.fk-ripple { animation: fk-ripple .6s ease both }
.fk-shimmer {
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-card-hover) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: fk-shimmer 1.4s linear infinite;
}
`

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="h-full w-full flex items-center justify-center p-4">{children}</div>
}

function MockCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`w-full max-w-[300px] rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)] p-3.5 ${className}`}
    >
      {children}
    </div>
  )
}

/** Staggered reveal wrapper. */
function R({
  d = 0,
  anim = 'fk-rise',
  className = '',
  children,
}: {
  d?: number
  anim?: 'fk-rise' | 'fk-pop' | 'fk-slidein'
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={`${anim} ${className}`} style={{ animationDelay: `${d}s` }}>
      {children}
    </div>
  )
}

/** A 280x150 stage for slides that position a cursor at known coordinates. */
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full flex items-center justify-center p-3">
      <div className="relative w-[280px] h-[150px]">{children}</div>
    </div>
  )
}

/** Fake pointer that glides from `from` to `to` (px within a Stage) and
 *  clicks - a ripple pops at the target as it lands. */
function Cursor({
  from,
  to,
  delay = 0.25,
}: {
  from: [number, number]
  to: [number, number]
  delay?: number
}) {
  const cursorStyle = {
    '--fx': `${from[0]}px`,
    '--fy': `${from[1]}px`,
    '--tx': `${to[0]}px`,
    '--ty': `${to[1]}px`,
    animationDelay: `${delay}s`,
  } as React.CSSProperties
  const rippleStyle = {
    left: `${to[0]}px`,
    top: `${to[1]}px`,
    animationDelay: `${delay + 0.85}s`,
  } as React.CSSProperties
  return (
    <>
      <div className="absolute left-0 top-0 z-30 fk-cursor" style={cursorStyle}>
        <svg width="15" height="15" viewBox="0 0 24 24" className="drop-shadow-sm">
          <path
            d="M4,2 L4,20 L9,15.5 L12,22 L15,20.5 L12,14 L19,14 Z"
            fill="#111827"
            stroke="#ffffff"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div
        className="absolute z-20 h-5 w-5 -ml-2.5 -mt-2.5 rounded-full bg-[#2B79F7]/50 fk-ripple"
        style={rippleStyle}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// EMAILS
// ---------------------------------------------------------------------------

const EMAILS_DEMO: DemoStep[] = [
  {
    caption: 'Group the leads you want to reach',
    render: () => (
      <Frame>
        <MockCard>
          <R d={0} className="text-[11px] font-semibold text-[var(--text-secondary)] mb-2">
            Lead status is any of
          </R>
          <div className="flex flex-wrap gap-1.5">
            {['New', 'Hot', 'Qualified', 'Cold'].map((s, i) => (
              <R key={s} anim="fk-pop" d={0.25 + i * 0.18}>
                <span
                  className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-medium border ${
                    i === 1 || i === 2
                      ? 'bg-[#2B79F7] text-white border-[#2B79F7]'
                      : 'border-[var(--border-primary)] text-[var(--text-tertiary)]'
                  }`}
                >
                  {s}
                </span>
              </R>
            ))}
          </div>
          <R
            d={1.2}
            className="mt-3 flex items-center justify-between border-t border-[var(--border-primary)] pt-2.5"
          >
            <span className="text-[11px] text-[var(--text-tertiary)]">Recipients</span>
            <span className="text-sm font-bold text-[#2B79F7]">42</span>
          </R>
        </MockCard>
      </Frame>
    ),
  },
  {
    caption: 'We draft the email from your real answers',
    ms: 4500,
    render: () => (
      <Frame>
        <MockCard className="space-y-2">
          <R d={0} className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-[#2B79F7]" />
            <span className="text-[10px] font-semibold text-[#2B79F7]">
              Writing from your answers
            </span>
          </R>
          <R d={0.5} className="text-[11px] font-semibold text-[var(--text-primary)]">
            The mistake that cost me 6 months
          </R>
          <div className="space-y-1.5 pt-0.5">
            <div className="h-1.5 rounded-full fk-shimmer" />
            <div className="h-1.5 rounded-full fk-shimmer" />
            <div className="h-1.5 w-2/3 rounded-full fk-shimmer" />
          </div>
          <R
            d={1.6}
            anim="fk-pop"
            className="inline-flex items-center gap-1 text-[9px] font-semibold text-green-600"
          >
            <Check className="h-3 w-3" /> Draft ready
          </R>
        </MockCard>
      </Frame>
    ),
  },
  {
    caption: 'Review it, then approve in a click',
    ms: 5200,
    render: () => (
      <div className="h-full w-full flex items-center justify-center p-3">
        {/* Card + button share one centered flex column, so the button is
            always dead-centered under the card regardless of label width. */}
        <div className="relative flex flex-col items-center gap-3 w-[220px]">
          {/* Branded email - white canvas, like the real send. */}
          <div className="w-[210px] rounded-xl bg-white border border-[#E7E5E0] p-3 shadow-sm">
            <div className="text-[8px] font-semibold tracking-wider uppercase text-gray-400">
              Fokus Kreativez
            </div>
            <div className="mt-1.5 text-[10px] font-bold text-gray-900 leading-snug">
              My scripts used to sound like everyone else&rsquo;s
            </div>
            <div className="mt-2 space-y-1">
              <div className="h-1 rounded-full bg-gray-200" />
              <div className="h-1 rounded-full bg-gray-200" />
              <div className="h-1 w-3/4 rounded-full bg-gray-200" />
            </div>
          </div>
          {/* Approve -> Approved, stacked in one grid cell so each pill sizes
              to its OWN content (with proper padding) while staying centered
              on the same point. */}
          <div className="inline-grid items-center justify-items-center">
            <span
              className="fk-fade [grid-area:1/1] inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold"
              style={{ animationDelay: '1.25s' }}
            >
              Approve
            </span>
            <R
              d={1.4}
              anim="fk-pop"
              className="[grid-area:1/1] inline-flex items-center justify-center gap-1 px-3.5 py-1.5 rounded-full bg-green-500 text-white text-[10px] font-semibold whitespace-nowrap"
            >
              <Check className="h-3 w-3" /> Approved
            </R>
          </div>
          <Cursor from={[24, 18]} to={[104, 120]} delay={0.3} />
        </div>
      </div>
    ),
  },
  {
    caption: 'It sends under your brand - track every click',
    ms: 4500,
    render: () => (
      <Frame>
        <MockCard className="space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            {[
              ['40', 'Delivered'],
              ['31%', 'Clicked'],
              ['1', 'Unsubscribed'],
            ].map(([v, l], i) => (
              <R key={l} d={i * 0.2} className="text-center">
                <div className="text-sm font-bold text-[var(--text-primary)]">{v}</div>
                <div className="text-[9px] text-[var(--text-tertiary)]">{l}</div>
              </R>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-[var(--border-primary)] pt-2">
            {[
              ['CTA 1', '55%', '12', 0.7],
              ['CTA 2', '85%', '19', 0.95],
            ].map(([label, w, n, d]) => (
              <div key={label as string} className="flex items-center gap-2">
                <span className="text-[9px] text-[var(--text-tertiary)] w-9 shrink-0">{label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#2B79F7] fk-grow"
                    style={{ width: w as string, animationDelay: `${d}s` }}
                  />
                </div>
                <span className="text-[9px] font-semibold text-[var(--text-primary)] w-4 text-right">
                  {n}
                </span>
              </div>
            ))}
          </div>
        </MockCard>
      </Frame>
    ),
  },
]

// ---------------------------------------------------------------------------
// AGREEMENTS
// ---------------------------------------------------------------------------

const AGREEMENTS_DEMO: DemoStep[] = [
  {
    caption: 'Draft from a reusable template',
    render: () => (
      <Frame>
        <MockCard className="space-y-2">
          <R d={0} className="h-2 w-1/2 rounded-full bg-[var(--text-tertiary)]/40" />
          <R d={0.3} className="flex items-center gap-1.5">
            <span className="h-1.5 rounded-full bg-[var(--bg-tertiary)]" style={{ width: '30%' }} />
            <span className="px-1.5 py-0.5 rounded bg-[#2B79F7]/15 text-[#2B79F7] text-[8px] font-medium">
              client name
            </span>
            <span className="h-1.5 rounded-full bg-[var(--bg-tertiary)]" style={{ width: '20%' }} />
          </R>
          <R d={0.55} className="h-1.5 w-full rounded-full bg-[var(--bg-tertiary)]" />
          <R d={0.75} className="flex items-center gap-1.5">
            <span className="h-1.5 rounded-full bg-[var(--bg-tertiary)]" style={{ width: '40%' }} />
            <span className="px-1.5 py-0.5 rounded bg-[#2B79F7]/15 text-[#2B79F7] text-[8px] font-medium">
              date
            </span>
            <span className="h-1.5 rounded-full bg-[var(--bg-tertiary)]" style={{ width: '25%' }} />
          </R>
          <R d={0.95} className="h-1.5 w-4/5 rounded-full bg-[var(--bg-tertiary)]" />
        </MockCard>
      </Frame>
    ),
  },
  {
    caption: 'Fill it from a lead in one click',
    ms: 5200,
    render: () => (
      <Stage>
        <div className="absolute left-1/2 -translate-x-1/2 top-1 w-[220px] rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)] p-3 space-y-2">
          {/* placeholder chips fade out, real values pop in */}
          <div className="relative h-3">
            <span
              className="fk-fade absolute left-0 px-1.5 py-0.5 rounded bg-[#2B79F7]/15 text-[#2B79F7] text-[8px] font-medium"
              style={{ animationDelay: '1.3s' }}
            >
              client name
            </span>
            <R d={1.45} anim="fk-pop" className="absolute left-0 text-[10px] font-semibold text-[var(--text-primary)]">
              Alex Morgan
            </R>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--bg-tertiary)]" />
          <div className="relative h-3">
            <span
              className="fk-fade absolute left-0 px-1.5 py-0.5 rounded bg-[#2B79F7]/15 text-[#2B79F7] text-[8px] font-medium"
              style={{ animationDelay: '1.3s' }}
            >
              date
            </span>
            <R d={1.45} anim="fk-pop" className="absolute left-0 text-[10px] font-semibold text-[var(--text-primary)]">
              June 15, 2026
            </R>
          </div>
          <div className="h-1.5 w-4/5 rounded-full bg-[var(--bg-tertiary)]" />
        </div>
        <div className="absolute left-1/2 -translate-x-1/2" style={{ top: 120 }}>
          <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold">
            Fill from lead
          </span>
        </div>
        <Cursor from={[30, 25]} to={[150, 130]} delay={0.3} />
      </Stage>
    ),
  },
  {
    caption: 'Send for signature - they sign online',
    ms: 4800,
    render: () => (
      <Frame>
        <MockCard className="space-y-2.5">
          <div className="flex items-center gap-2">
            {[
              ['#2B79F7', 'A'],
              ['#10B981', 'M'],
            ].map(([c, ltr], i) => (
              <R key={ltr} anim="fk-pop" d={i * 0.2}>
                <span
                  className="h-7 w-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ backgroundColor: c }}
                >
                  {ltr}
                </span>
              </R>
            ))}
            <span className="ml-auto text-[9px] text-[var(--text-tertiary)]">Sent to 2 signers</span>
          </div>
          <div className="border-t border-dashed border-[var(--border-primary)] pt-2">
            <svg viewBox="0 0 120 36" className="w-28 h-8">
              <path
                className="fk-draw"
                style={{ animationDelay: '0.6s' } as React.CSSProperties}
                d="M4,28 C16,6 24,32 36,16 C46,4 56,30 70,13 C82,2 96,30 116,9"
                fill="none"
                stroke="#2B79F7"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <R d={2.1} className="text-[8px] text-[var(--text-tertiary)]">
              Signed by Alex Morgan
            </R>
          </div>
        </MockCard>
      </Frame>
    ),
  },
  {
    caption: 'Attach an invoice and get paid on signing',
    render: () => (
      <Frame>
        <MockCard className="space-y-2.5">
          <R d={0} className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-primary)]">
            <FileSignature className="h-3.5 w-3.5 text-[#2B79F7]" />
            Agreement signed
            <Check className="h-3.5 w-3.5 text-green-500 ml-auto" />
          </R>
          <R
            d={0.5}
            className="flex items-center justify-between rounded-lg bg-[var(--bg-tertiary)] px-2.5 py-2"
          >
            <span className="text-[10px] text-[var(--text-tertiary)]">Invoice · USD 1,200</span>
            <R d={1.1} anim="fk-pop">
              <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 text-[9px] font-semibold">
                Paid
              </span>
            </R>
          </R>
        </MockCard>
      </Frame>
    ),
  },
]

// ---------------------------------------------------------------------------
// REVENUE
// ---------------------------------------------------------------------------

const REVENUE_DEMO: DemoStep[] = [
  {
    caption: 'Build an invoice with line items',
    render: () => (
      <Frame>
        <MockCard className="space-y-2">
          {[
            ['Strategy session', '400'],
            ['Content package', '800'],
          ].map(([d, a], i) => (
            <R key={d} d={i * 0.25} className="flex items-center justify-between">
              <span className="text-[10px] text-[var(--text-secondary)]">{d}</span>
              <span className="text-[10px] font-medium text-[var(--text-primary)]">USD {a}</span>
            </R>
          ))}
          <R
            d={0.7}
            className="flex items-center justify-between border-t border-[var(--border-primary)] pt-2"
          >
            <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">Total</span>
            <span className="text-sm font-bold text-[var(--text-primary)]">USD 1,200</span>
          </R>
        </MockCard>
      </Frame>
    ),
  },
  {
    caption: 'Send it to your client in a click',
    ms: 5000,
    render: () => (
      <Stage>
        <div className="absolute left-1/2 -translate-x-1/2 top-2 w-[220px] rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)] p-3">
          <div className="text-[9px] text-[var(--text-tertiary)]">Invoice #1042</div>
          <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">USD 1,200</div>
          <div className="mt-2 h-1.5 w-2/3 rounded-full bg-[var(--bg-tertiary)]" />
        </div>
        <div className="absolute left-1/2 -translate-x-1/2" style={{ top: 118 }}>
          <span
            className="fk-fade inline-flex items-center px-3 py-1.5 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold"
            style={{ animationDelay: '1.25s' }}
          >
            Send invoice
          </span>
          <R
            d={1.4}
            anim="fk-pop"
            className="absolute inset-0 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full bg-green-500 text-white text-[10px] font-semibold whitespace-nowrap"
          >
            <Check className="h-3 w-3" /> Sent
          </R>
        </div>
        <Cursor from={[36, 28]} to={[150, 128]} delay={0.3} />
      </Stage>
    ),
  },
  {
    caption: 'They pay online through a secure link',
    ms: 4600,
    render: () => (
      <Frame>
        <MockCard className="space-y-2.5">
          <R d={0} className="text-[10px] text-[var(--text-tertiary)]">
            Invoice #1042 · USD 1,200
          </R>
          <div className="flex items-center justify-between">
            <R d={0.3}>
              <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold">
                Pay now
              </span>
            </R>
            <R d={1.2} anim="fk-pop">
              <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 text-[9px] font-semibold">
                Paid
              </span>
            </R>
          </div>
        </MockCard>
      </Frame>
    ),
  },
  {
    caption: 'Track totals, pending, and overdue',
    render: () => (
      <Frame>
        <MockCard>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['$8.4k', 'Total', 'text-[var(--text-primary)]'],
              ['$1.2k', 'Pending', 'text-amber-500'],
              ['$400', 'Overdue', 'text-red-500'],
            ].map(([v, l, c], i) => (
              <R key={l} d={i * 0.2} className="text-center">
                <div className={`text-sm font-bold ${c}`}>{v}</div>
                <div className="text-[9px] text-[var(--text-tertiary)]">{l}</div>
              </R>
            ))}
          </div>
        </MockCard>
      </Frame>
    ),
  },
]

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------

const DASHBOARD_DEMO: DemoStep[] = [
  {
    caption: 'Your whole CRM at a glance',
    render: () => (
      <Frame>
        <MockCard>
          <div className="grid grid-cols-4 gap-2">
            {[
              ['42', 'Leads'],
              ['7', 'Meetings'],
              ['$2.4k', 'Revenue'],
              ['3', 'Pages'],
            ].map(([v, l], i) => (
              <R key={l} anim="fk-pop" d={i * 0.15}>
                <div className="rounded-lg bg-[var(--bg-tertiary)] p-1.5 flex flex-col gap-0.5">
                  <div className="text-[10px] font-bold text-[var(--text-primary)]">{v}</div>
                  <div className="text-[8px] text-[var(--text-tertiary)]">{l}</div>
                </div>
              </R>
            ))}
          </div>
        </MockCard>
      </Frame>
    ),
  },
  {
    caption: 'See how this month compares to last',
    ms: 4800,
    render: () => (
      <Frame>
        <MockCard className="space-y-2">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[9px] text-[var(--text-tertiary)]">Leads this month</div>
              <R d={0.1} className="text-base font-bold text-[var(--text-primary)] leading-none mt-0.5">
                42
              </R>
            </div>
            <R d={0.5} anim="fk-pop">
              <span className="px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600 text-[9px] font-semibold">
                +18% vs last month
              </span>
            </R>
          </div>
          <div className="relative">
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-14">
              {/* last period - faint dashed baseline */}
              <polyline
                fill="none"
                stroke="var(--text-tertiary)"
                strokeOpacity="0.35"
                strokeWidth="1.2"
                strokeDasharray="3 3"
                points="0,34 25,30 50,31 75,26 100,24"
              />
              {/* this period - solid blue, draws in */}
              <polyline
                className="fk-draw"
                style={{ animationDelay: '0.4s', '--len': 200 } as React.CSSProperties}
                fill="none"
                stroke="#2B79F7"
                strokeWidth="2"
                points="0,33 25,26 50,28 75,15 100,6"
              />
            </svg>
            <div className="flex justify-between text-[7px] text-[var(--text-tertiary)] px-0.5">
              <span>W1</span>
              <span>W2</span>
              <span>W3</span>
              <span>W4</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[8px] text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-[#2B79F7] rounded" /> This month
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-[var(--text-tertiary)]/40 rounded" /> Last month
            </span>
          </div>
        </MockCard>
      </Frame>
    ),
  },
  {
    caption: 'Watch new leads land in real time',
    ms: 4200,
    render: () => (
      <Frame>
        <MockCard className="space-y-1.5">
          <R d={0} anim="fk-slidein" className="flex items-center gap-2 rounded-lg bg-[#2B79F7]/10 px-2.5 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2B79F7]" />
            <span className="text-[10px] font-medium text-[var(--text-primary)]">New lead · Jordan B.</span>
            <span className="ml-auto text-[8px] text-[var(--text-tertiary)]">just now</span>
          </R>
          <R d={0.4} className="flex items-center gap-2 rounded-lg bg-[var(--bg-tertiary)] px-2.5 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]/50" />
            <span className="text-[10px] text-[var(--text-secondary)]">Capture · Free guide</span>
            <span className="ml-auto text-[8px] text-[var(--text-tertiary)]">2m</span>
          </R>
          <R d={0.6} className="flex items-center gap-2 rounded-lg bg-[var(--bg-tertiary)] px-2.5 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]/50" />
            <span className="text-[10px] text-[var(--text-secondary)]">Meeting booked · Sam K.</span>
            <span className="ml-auto text-[8px] text-[var(--text-tertiary)]">11m</span>
          </R>
        </MockCard>
      </Frame>
    ),
  },
  {
    caption: 'Catch what needs attention',
    render: () => (
      <Frame>
        <MockCard className="space-y-1.5">
          <R d={0} className="flex items-center justify-between rounded-lg bg-red-500/10 px-2.5 py-1.5">
            <span className="text-[10px] text-[var(--text-secondary)]">Invoice #1039</span>
            <span className="text-[9px] font-semibold text-red-500">Overdue</span>
          </R>
          <R d={0.3} className="flex items-center justify-between rounded-lg bg-amber-500/10 px-2.5 py-1.5">
            <span className="text-[10px] text-[var(--text-secondary)]">Proposal · Dana R.</span>
            <span className="text-[9px] font-semibold text-amber-600">Awaiting reply</span>
          </R>
          <R d={0.6} className="flex items-center justify-between rounded-lg bg-[var(--bg-tertiary)] px-2.5 py-1.5">
            <span className="text-[10px] text-[var(--text-secondary)]">Call with Alex</span>
            <span className="text-[9px] font-semibold text-[#2B79F7]">Tomorrow</span>
          </R>
        </MockCard>
      </Frame>
    ),
  },
]

export const FEATURE_DEMOS: Record<string, DemoStep[]> = {
  Emails: EMAILS_DEMO,
  Agreements: AGREEMENTS_DEMO,
  Revenue: REVENUE_DEMO,
  Dashboard: DASHBOARD_DEMO,
}

export function hasFeatureDemo(name: string): boolean {
  return Boolean(FEATURE_DEMOS[name])
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const DEFAULT_MS = 4000

export function FeatureDemo({ feature }: { feature: string }) {
  const steps = FEATURE_DEMOS[feature]
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const touchX = useRef<number | null>(null)

  const count = steps?.length ?? 0
  const go = (n: number) => setStep((n + count) % count)
  const manual = (n: number) => {
    setPlaying(false)
    go(n)
  }

  useEffect(() => {
    if (!playing || !steps) return
    const ms = steps[step]?.ms ?? DEFAULT_MS
    const t = setTimeout(() => setStep((s) => (s + 1) % steps.length), ms)
    return () => clearTimeout(t)
  }, [playing, step, steps])

  if (!steps) return null
  const current = steps[step]

  return (
    <div onMouseEnter={() => setPlaying(false)} onMouseLeave={() => setPlaying(true)}>
      <style dangerouslySetInnerHTML={{ __html: DEMO_CSS }} />
      <div
        className="relative h-44 rounded-xl bg-[var(--bg-tertiary)] overflow-hidden select-none"
        onTouchStart={(e) => {
          touchX.current = e.touches[0].clientX
        }}
        onTouchEnd={(e) => {
          if (touchX.current == null) return
          const dx = e.changedTouches[0].clientX - touchX.current
          if (dx > 40) manual(step - 1)
          else if (dx < -40) manual(step + 1)
          touchX.current = null
        }}
      >
        {/* Frame remounts per step (key) so its staged animations replay. */}
        <div key={step} className="absolute inset-0 animate-in fade-in duration-500">
          {current.render()}
        </div>

        <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-card)]/90 border border-[var(--border-primary)] text-[var(--text-tertiary)] text-[9px] font-semibold z-40">
          <Lock className="h-2.5 w-2.5 text-[#2B79F7]" /> Top tier
        </span>

        {/* Minimalist arrows */}
        <button
          type="button"
          aria-label="Previous"
          onClick={() => manual(step - 1)}
          className="absolute left-1.5 top-1/2 -translate-y-1/2 z-40 h-6 w-6 flex items-center justify-center rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => manual(step + 1)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 z-40 h-6 w-6 flex items-center justify-center rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Caption */}
      <p className="mt-2.5 text-center text-xs font-medium text-[var(--text-secondary)] min-h-[2rem] px-6">
        {current.caption}
      </p>

      {/* Step dots */}
      <div className="mt-1 flex items-center justify-center gap-1.5">
        {steps.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Step ${i + 1}`}
            onClick={() => manual(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === step ? 'w-5 bg-[#2B79F7]' : 'w-1.5 bg-[var(--border-primary)]'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
