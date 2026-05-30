'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'info'

// Toasts are isolated by app area: a toast raised on the CRM side must never
// pop while you're viewing the agency/admin side, and vice versa. We tag each
// toast with the area it was raised in (derived from the URL at call time),
// and the single global <Toaster/> only renders toasts matching the area
// currently on screen. So a CRM toast that's still alive when you navigate to
// admin simply stops showing.
export type ToastScope = 'crm' | 'agency'

interface ToastItem {
  id: number
  message: string
  type: ToastType
  duration: number
  scope: ToastScope
}

/** CRM routes live under /crm/...; everything else is the agency/admin side. */
function scopeForPath(pathname: string | null | undefined): ToastScope {
  return pathname && pathname.startsWith('/crm') ? 'crm' : 'agency'
}

function currentScope(): ToastScope {
  if (typeof window === 'undefined') return 'agency'
  return scopeForPath(window.location.pathname)
}

// Module-level store: any component can call toast() imperatively; the mounted
// <Toaster/> subscribes and renders.
let counter = 0
let items: ToastItem[] = []
const listeners = new Set<(items: ToastItem[]) => void>()

function emit() {
  for (const l of listeners) l(items)
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

interface ToastOpts {
  type?: ToastType
  /** ms before auto-dismiss. Default 5000. */
  duration?: number
  /** Override the auto-detected area. Rarely needed. */
  scope?: ToastScope
}

export function toast(message: string, opts: ToastOpts = {}): number {
  const item: ToastItem = {
    id: ++counter,
    message,
    type: opts.type ?? 'info',
    duration: opts.duration ?? 5000,
    scope: opts.scope ?? currentScope(),
  }
  items = [...items, item]
  emit()
  if (item.duration > 0) {
    setTimeout(() => dismiss(item.id), item.duration)
  }
  return item.id
}

toast.success = (message: string, duration?: number) => toast(message, { type: 'success', duration })
toast.error = (message: string, duration?: number) => toast(message, { type: 'error', duration })
toast.info = (message: string, duration?: number) => toast(message, { type: 'info', duration })

const STYLES: Record<ToastType, { ring: string; icon: typeof Info; iconColor: string }> = {
  success: { ring: 'border-emerald-500/30', icon: CheckCircle, iconColor: 'text-emerald-500' },
  error: { ring: 'border-red-500/30', icon: AlertCircle, iconColor: 'text-red-500' },
  info: { ring: 'border-[#2B79F7]/30', icon: Info, iconColor: 'text-[#2B79F7]' },
}

// Stack tuning.
const MAX_RENDERED = 6 // beyond this, older toasts wait their turn
const COLLAPSED_PEEK = 12 // px each older card peeks above the front one
const COLLAPSED_SCALE = 0.05 // scale lost per depth when collapsed
const GAP = 12 // px between cards when expanded
const FALLBACK_H = 64 // height assumed before a card is measured

/** Mount once at the app root. Renders only the toasts whose area matches the
 *  page currently on screen, so CRM and agency toasts stay isolated. They
 *  pile into a stacked deck (newest in front, older peeking behind) and
 *  expand into a readable column on hover. New toasts slide in from below. */
export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(() => items)
  const [expanded, setExpanded] = useState(false)
  const [heights, setHeights] = useState<Record<number, number>>({})
  const pathname = usePathname()
  const area = scopeForPath(pathname)

  const nodes = useRef<Map<number, HTMLElement>>(new Map())
  const ro = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    const l = (next: ToastItem[]) => setList(next)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  // One ResizeObserver, created once. The ref callback observes/unobserves
  // each card so the expanded layout can offset by real card heights. Setting
  // state happens inside the observer callback (an async event), so it doesn't
  // trip the synchronous-setState-in-effect rule.
  useEffect(() => {
    ro.current = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let changed = false
        const next = { ...prev }
        for (const e of entries) {
          const id = Number((e.target as HTMLElement).dataset.tid)
          const h = Math.round(e.contentRect.height)
          if (next[id] !== h) {
            next[id] = h
            changed = true
          }
        }
        return changed ? next : prev
      })
    })
    nodes.current.forEach((el) => ro.current?.observe(el))
    return () => ro.current?.disconnect()
  }, [])

  const visible = list.filter((t) => t.scope === area)
  if (!visible.length) return null

  // Front of the stack is the NEWEST. visible is oldest..newest, so reverse.
  const stack = [...visible].reverse().slice(0, MAX_RENDERED)

  // Expanded: each card sits above the nearer (newer) ones by their heights.
  const expandedOffsets: number[] = []
  let acc = 0
  for (let i = 0; i < stack.length; i++) {
    expandedOffsets[i] = acc
    acc += (heights[stack[i].id] ?? FALLBACK_H) + GAP
  }
  const frontH = heights[stack[0]?.id] ?? FALLBACK_H
  const containerHeight = expanded ? acc - GAP : frontH

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] w-[min(92vw,380px)]"
      style={{ height: containerHeight }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {stack.map((t, depth) => {
        const s = STYLES[t.type]
        const Icon = s.icon
        const ty = expanded ? -expandedOffsets[depth] : -(depth * COLLAPSED_PEEK)
        const scale = expanded ? 1 : Math.max(0, 1 - depth * COLLAPSED_SCALE)
        const opacity = expanded ? 1 : depth > 2 ? 0 : 1 - depth * 0.15
        const interactive = expanded || depth === 0
        return (
          <div
            key={t.id}
            data-tid={t.id}
            ref={(el) => {
              if (el) {
                nodes.current.set(t.id, el)
                ro.current?.observe(el)
              } else {
                const old = nodes.current.get(t.id)
                if (old) ro.current?.unobserve(old)
                nodes.current.delete(t.id)
              }
            }}
            className="absolute bottom-0 right-0 w-full transition-all duration-300 ease-out"
            style={{
              transform: `translateY(${ty}px) scale(${scale})`,
              transformOrigin: 'bottom center',
              opacity,
              zIndex: 100 - depth,
              pointerEvents: interactive ? 'auto' : 'none',
            }}
          >
            <div
              className={`flex items-start gap-2.5 rounded-xl border ${s.ring} bg-[var(--bg-card)] shadow-2xl px-4 py-3 animate-in slide-in-from-bottom-3 fade-in`}
            >
              <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${s.iconColor}`} />
              <p className="flex-1 text-sm text-[var(--text-primary)] leading-snug">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                title="Dismiss"
                className="shrink-0 rounded-md p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
