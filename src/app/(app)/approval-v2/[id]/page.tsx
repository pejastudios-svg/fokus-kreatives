'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'
import { AssetRenderer } from '@/components/approval-v2/AssetRenderer'
import type { CloudinaryAsset } from '@/lib/cloudinary'

interface Approval {
  id: string
  title: string
  description: string | null
  status: string
  clients?: { name: string; business_name?: string | null } | null
}

interface ApprovalItem {
  id: string
  title: string | null
  url: string
  initial_comment: string | null
  attachments: CloudinaryAsset[] | null
  status: string
  position: number
}

// Approval v2 - detail page.
//
// Reads `approvals` + `approval_items` from the same Supabase tables as
// v1 and renders each item with the v2 AssetRenderer (which in turn
// uses the v2 VideoPlayer). Edit/comments/annotations/approval actions
// from v1 are intentionally omitted - this page exists to verify the
// renderer works on real data.
export default function ApprovalV2DetailPage() {
  const params = useParams() as { id: string }
  const supabase = createClient()
  const [approval, setApproval] = useState<Approval | null>(null)
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data: ap, error: apErr } = await supabase
        .from('approvals')
        .select(
          'id, title, description, status, clients(name, business_name)',
        )
        .eq('id', params.id)
        .maybeSingle()
      if (cancelled) return
      if (apErr) {
        console.error('approval-v2: load approval error', apErr)
      }
      if (ap) {
        const row = ap as {
          id: string
          title: string
          description: string | null
          status: string
          clients:
            | { name: string; business_name?: string | null }
            | { name: string; business_name?: string | null }[]
            | null
        }
        setApproval({
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          clients: Array.isArray(row.clients) ? row.clients[0] : row.clients,
        })
      }

      const { data: itemRows, error: itemsErr } = await supabase
        .from('approval_items')
        .select(
          'id, title, url, initial_comment, attachments, status, position',
        )
        .eq('approval_id', params.id)
        .order('position', { ascending: true })
      if (cancelled) return
      if (itemsErr) {
        console.error('approval-v2: load items error', itemsErr)
      }
      setItems((itemRows || []) as ApprovalItem[])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [params.id, supabase])

  return (
    <>
      <Header title="Approval v2" subtitle="Rebuilt renderer" />

      <div className="p-4 md:p-8 space-y-6">
        <Link
          href="/approval-v2"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to v2 list
        </Link>

        {loading ? (
          <div className="text-[var(--text-tertiary)]">Loading…</div>
        ) : !approval ? (
          <div className="text-[var(--text-tertiary)]">
            Approval not found or you don&rsquo;t have access.
          </div>
        ) : (
          <>
            <header>
              <h1 className="text-2xl font-bold text-[var(--text-primary)]">
                {approval.title}
              </h1>
              <div className="text-sm text-[var(--text-tertiary)] mt-1">
                {approval.clients?.business_name ||
                  approval.clients?.name ||
                  'Unknown client'}{' '}
                · {approval.status}
              </div>
              {approval.description && (
                <p className="mt-3 text-sm text-[var(--text-secondary)] max-w-prose">
                  {approval.description}
                </p>
              )}
            </header>

            <div className="space-y-6">
              {items.length === 0 ? (
                <div className="text-sm text-[var(--text-tertiary)]">
                  No assets on this approval.
                </div>
              ) : (
                items.map((item, idx) => (
                  <section
                    key={item.id}
                    className="rounded-lg border border-[var(--border-primary)] p-4 space-y-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="font-semibold text-[var(--text-primary)]">
                        {item.title || `Asset #${idx + 1}`}
                      </h2>
                      <span className="text-xs text-[var(--text-tertiary)]">
                        {item.status}
                      </span>
                    </div>

                    {item.initial_comment && (
                      <p className="text-sm text-[var(--text-secondary)]">
                        {item.initial_comment}
                      </p>
                    )}

                    {item.attachments && item.attachments.length > 0 ? (
                      <AssetRenderer attachments={item.attachments} />
                    ) : item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-[#2B79F7] underline break-all"
                      >
                        {item.url}
                      </a>
                    ) : null}
                  </section>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
