'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'

interface Approval {
  id: string
  title: string
  status: string
  created_at: string
  clients?: { name: string; business_name?: string | null } | null
}

// Approval v2 — list page.
//
// Reads from the same `approvals` table as v1 and links to the v2
// detail page. Intentionally minimal so the focus stays on whether
// the v2 renderer correctly handles your existing HandBrake clips.
export default function ApprovalV2ListPage() {
  const supabase = createClient()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('approvals')
        .select(
          'id, title, status, created_at, clients(name, business_name)',
        )
        .order('created_at', { ascending: false })
        .limit(100)
      if (cancelled) return
      if (error) {
        console.error('approval-v2: load list error', error)
      }
      const mapped = (data || []).map((r) => {
        const row = r as {
          id: string
          title: string
          status: string
          created_at: string
          clients:
            | { name: string; business_name?: string | null }
            | { name: string; business_name?: string | null }[]
            | null
        }
        return {
          id: row.id,
          title: row.title,
          status: row.status,
          created_at: row.created_at,
          clients: Array.isArray(row.clients) ? row.clients[0] : row.clients,
        }
      })
      setApprovals(mapped)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [supabase])

  return (
    <>
      <Header
        title="Approvals v2"
        subtitle="Rebuilt renderer: same data, fixed video pipeline"
      />

      <div className="p-4 md:p-8">
        <div className="mb-4 text-xs text-[var(--text-tertiary)]">
          This page reads the same data as <code>/approvals</code>. Click any
          row to open it in the v2 detail view, which uses the rebuilt
          VideoPlayer.
        </div>

        {loading ? (
          <div className="text-[var(--text-tertiary)]">Loading…</div>
        ) : approvals.length === 0 ? (
          <div className="text-[var(--text-tertiary)]">No approvals yet.</div>
        ) : (
          <div className="grid gap-2">
            {approvals.map((a) => (
              <Link
                key={a.id}
                href={`/approval-v2/${a.id}`}
                className="block p-3 rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
              >
                <div className="font-medium text-[var(--text-primary)]">
                  {a.title}
                </div>
                <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  {a.clients?.business_name ||
                    a.clients?.name ||
                    'Unknown client'}{' '}
                  · {a.status}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
