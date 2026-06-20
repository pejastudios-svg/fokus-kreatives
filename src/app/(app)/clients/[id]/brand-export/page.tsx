'use client'

/* eslint-disable @next/next/no-img-element */

// Agency-side "Brand Book" export. Renders a polished, print-ready dossier of
// everything stored on a client's brand profile, then leans on the browser's
// own "Save as PDF" for the export (best graphics: full CSS, web fonts, color
// swatches, meters - none of the Apps Script HTML->PDF limitations).
//
// Printing isolates #brand-dossier so the surrounding DashboardLayout chrome
// (sidebar / header) never bleeds into the PDF.

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/Loading'
import {
  normalizeBrandProfile,
  type BrandProfile,
  type CustomField,
} from '@/components/clients/brandProfile'

// ---------------------------------------------------------------- helpers

const has = (s: unknown): s is string => typeof s === 'string' && s.trim() !== ''

/** "mid_tier" -> "Mid Tier", "book_call" -> "Book Call". */
function titleize(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

interface ClientRow {
  id: string
  name: string | null
  business_name: string | null
  industry: string | null
  profile_picture_url: string | null
  website_url: string | null
  target_audience: string | null
  dos_and_donts: string | null
  topics_library: string | null
  key_stories: string | null
  unique_mechanisms: string | null
  social_proof: string | null
  competitor_insights: string | null
  content_tier: string | null
  package_tier: string | null
  brand_profile: BrandProfile | null
}

// ---------------------------------------------------------------- atoms

function Section({
  title,
  kicker,
  accent,
  children,
}: {
  title: string
  kicker?: string
  accent: string
  children: React.ReactNode
}) {
  return (
    <section className="dossier-section mt-10">
      <div className="flex items-center gap-3">
        <span className="h-6 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
        <div>
          {kicker && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
              {kicker}
            </p>
          )}
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!has(value)) return null
  return (
    <div className="dossier-card break-inside-avoid">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{value}</p>
    </div>
  )
}

function Pill({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
      style={{ backgroundColor: `${accent}14`, color: accent }}
    >
      {children}
    </span>
  )
}

/** 1-5 personality meter. */
function Meter({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="break-inside-avoid">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-xs text-gray-400">{value}/5</p>
      </div>
      <div className="mt-1.5 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className="h-2 flex-1 rounded-full"
            style={{ backgroundColor: n <= value ? accent : '#E5E7EB' }}
          />
        ))}
      </div>
    </div>
  )
}

function Swatch({ label, hex }: { label: string; hex: string }) {
  if (!has(hex)) return null
  return (
    <div className="break-inside-avoid overflow-hidden rounded-xl border border-gray-200">
      <div className="h-20 w-full" style={{ backgroundColor: hex }} />
      <div className="px-3 py-2">
        <p className="text-xs font-semibold text-gray-700">{label}</p>
        <p className="font-mono text-xs uppercase text-gray-400">{hex}</p>
      </div>
    </div>
  )
}

/** Checklist of the `true` keys of a boolean map, humanized. */
function CheckList({
  map,
  accent,
  tone,
}: {
  map: Record<string, boolean>
  accent: string
  tone: 'do' | 'dont'
}) {
  const on = Object.entries(map).filter(([, v]) => v)
  if (on.length === 0) return null
  const color = tone === 'do' ? accent : '#DC2626'
  return (
    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {on.map(([k]) => (
        <li key={k} className="flex items-start gap-2 text-sm text-gray-700">
          <span className="mt-0.5 font-bold" style={{ color }}>
            {tone === 'do' ? '✓' : '✕'}
          </span>
          <span>{titleize(k)}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- page

export default function BrandExportPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = (params?.id as string) ?? ''
  const supabase = useMemo(() => createClient(), [])

  const [client, setClient] = useState<ClientRow | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('clients')
        .select(
          'id, name, business_name, industry, profile_picture_url, website_url, target_audience, dos_and_donts, topics_library, key_stories, unique_mechanisms, social_proof, competitor_insights, content_tier, package_tier, brand_profile',
        )
        .eq('id', clientId)
        .single()
      if (!active) return
      if (error || !data) {
        setNotFound(true)
      } else {
        setClient(data as ClientRow)
      }
      setIsLoading(false)
    }
    if (clientId) load()
    return () => {
      active = false
    }
  }, [clientId, supabase])

  const bp = useMemo(() => normalizeBrandProfile(client?.brand_profile ?? null), [client])

  const accent = has(bp.visual.colors.primary) ? bp.visual.colors.primary : '#2B79F7'
  const accent2 = has(bp.visual.colors.accent) ? bp.visual.colors.accent : '#143A80'

  const displayName =
    client?.business_name?.trim() || client?.name?.trim() || 'Client'

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-8">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (notFound || !client) {
    return (
      <div className="p-8">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <p className="mt-6 text-gray-700">This client could not be found.</p>
      </div>
    )
  }

  const v = bp.voice
  const a = bp.audience
  const cs = bp.content_strategy
  const pillars = (cs.content_pillars || []).filter((p) => has(p.name) || has(p.covers))
  const competitors = (bp.competitors || []).filter((c) => has(c.name_or_handle))
  const myths = (cs.myths || []).filter((m) => has(m.myth) || has(m.truth))
  const customFields = (bp.custom_fields || []).filter(
    (f: CustomField) => has(f.label) || has(f.content),
  )

  return (
    <>
      {/* Print isolation: only #brand-dossier reaches the PDF, free of the
          DashboardLayout sidebar / header chrome. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            #brand-dossier .dossier-card {
              border: 1px solid #E5E7EB;
              background: #FAFAFA;
              border-radius: 12px;
              padding: 12px 14px;
            }
            @media print {
              body * { visibility: hidden !important; }
              #brand-dossier, #brand-dossier * { visibility: visible !important; }
              #brand-dossier { position: absolute; inset: 0; margin: 0; width: 100%; max-width: none; }
              .no-print { display: none !important; }
              .dossier-section { break-inside: avoid; }
              /* Force background colors (swatches, hero) to actually print. */
              #brand-dossier * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            }
            @page { margin: 14mm; }
          `,
        }}
      />

      {/* Toolbar (screen only). */}
      <div className="no-print sticky top-0 z-10 mb-6 flex items-center justify-between border-b border-gray-200 bg-white/90 px-6 py-3 backdrop-blur">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-gray-400 sm:inline">
            Choose &ldquo;Save as PDF&rdquo; in the print dialog
          </span>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: accent }}
          >
            <Download className="h-4 w-4" /> Download PDF
          </button>
        </div>
      </div>

      <div
        id="brand-dossier"
        className="mx-auto max-w-3xl bg-white px-6 pb-16 text-gray-900"
        style={{ ['--accent' as string]: accent }}
      >
        {/* Cover */}
        <header
          className="overflow-hidden rounded-2xl px-8 py-10 text-white"
          style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})` }}
        >
          <div className="flex items-center gap-5">
            {has(client.profile_picture_url) && (
              <img
                src={client.profile_picture_url as string}
                alt={displayName}
                className="h-20 w-20 rounded-2xl border-2 border-white/40 object-cover"
              />
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                Brand Book
              </p>
              <h1 className="mt-1 text-3xl font-extrabold leading-tight">{displayName}</h1>
              {has(client.industry) && (
                <p className="mt-1 text-sm text-white/80">{client.industry}</p>
              )}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {has(client.website_url) && (
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
                {client.website_url}
              </span>
            )}
            {has(client.package_tier) && (
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
                {titleize(client.package_tier as string)} package
              </span>
            )}
            {has(client.content_tier) && (
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
                {titleize(client.content_tier as string)} content
              </span>
            )}
          </div>
        </header>

        {/* Business */}
        {(has(bp.business.mission) ||
          has(bp.business.vision) ||
          has(bp.business.problem_solved) ||
          has(bp.business.differentiation) ||
          has(bp.business.signature_offer)) && (
          <Section title="The Business" kicker="Who they are" accent={accent}>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Mission" value={bp.business.mission} />
              <Field label="Vision" value={bp.business.vision} />
              <Field label="Problem solved" value={bp.business.problem_solved} />
              <Field label="What makes them different" value={bp.business.differentiation} />
              <Field label="Signature offer" value={bp.business.signature_offer} />
            </div>
          </Section>
        )}

        {/* Positioning */}
        <Section title="Positioning" kicker="Market stance" accent={accent}>
          <div className="flex flex-wrap gap-2">
            <Pill accent={accent}>{titleize(bp.positioning.market_position)}</Pill>
            <Pill accent={accent}>{titleize(bp.positioning.perception)}</Pill>
            {has(cs.primary_content_goal) && (
              <Pill accent={accent}>Goal: {titleize(cs.primary_content_goal)}</Pill>
            )}
            {has(cs.desired_action) && (
              <Pill accent={accent}>Desired action: {titleize(cs.desired_action)}</Pill>
            )}
          </div>
        </Section>

        {/* Audience */}
        {(has(a.work_roles) ||
          has(a.location) ||
          has(a.desires) ||
          has(a.fears) ||
          a.pain_points.some(has)) && (
          <Section title="Target Audience" kicker="Who we speak to" accent={accent}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Who they are" value={a.work_roles} />
              <Field label="Location" value={a.location} />
              <Field
                label="Age & gender"
                value={
                  [has(a.age_range) ? a.age_range : '', a.gender !== 'unspecified' ? titleize(a.gender) : '']
                    .filter(Boolean)
                    .join(' · ') || null
                }
              />
              <Field label="Family situation" value={a.family_situation} />
              <Field label="Core values" value={a.core_values} />
              <Field label="Where they hang out" value={a.hangouts} />
              <Field label="Their desires" value={a.desires} />
              <Field label="Their fears" value={a.fears} />
              <Field label="What they've tried & failed" value={a.tried_failed} />
              <Field label="Objections" value={a.objections} />
              <Field label="Yes triggers" value={a.yes_triggers} />
            </div>
            {a.pain_points.some(has) && (
              <div className="dossier-card mt-3 break-inside-avoid">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Pain points
                </p>
                <ul className="mt-2 space-y-1.5">
                  {a.pain_points.filter(has).map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                      <span className="font-bold" style={{ color: accent }}>
                        {i + 1}.
                      </span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        )}

        {/* Brand voice */}
        <Section title="Brand Voice" kicker="How we sound" accent={accent}>
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <Meter label="Casual" value={v.casualness} accent={accent} />
            <Meter label="Funny" value={v.funny} accent={accent} />
            <Meter label="Enthusiastic" value={v.enthusiastic} accent={accent} />
            <Meter label="Emotional" value={v.emotional} accent={accent} />
            <Meter label="Irreverent" value={v.irreverent} accent={accent} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Pill accent={accent}>Jargon: {titleize(v.uses_jargon)}</Pill>
            <Pill accent={accent}>Personal stories: {titleize(v.shares_personal_stories)}</Pill>
            <Pill accent={accent}>Profanity: {titleize(v.profanity_level)}</Pill>
            {has(v.address_audience_as) && (
              <Pill accent={accent}>Addresses audience as &ldquo;{v.address_audience_as}&rdquo;</Pill>
            )}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Voice traits" value={v.traits} />
            <Field label="Common enemy" value={v.common_enemy} />
          </div>
          {v.signature_phrases.some(has) && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Signature phrases
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {v.signature_phrases.filter(has).map((p, i) => (
                  <Pill key={i} accent={accent}>
                    {p}
                  </Pill>
                ))}
              </div>
            </div>
          )}
          {(v.forbidden_words.some(has) || v.banned_phrases.some(has)) && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Never say
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...v.forbidden_words, ...v.banned_phrases].filter(has).map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-600"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
          {v.samples.filter(has).length > 0 && (
            <div className="dossier-card mt-3 break-inside-avoid">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Voice samples
              </p>
              <div className="mt-2 space-y-2">
                {v.samples.filter(has).map((s, i) => (
                  <p
                    key={i}
                    className="border-l-2 pl-3 text-sm italic leading-relaxed text-gray-700"
                    style={{ borderColor: accent }}
                  >
                    {s}
                  </p>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Visual identity */}
        <Section title="Visual Identity" kicker="How we look" accent={accent}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Swatch label="Primary" hex={bp.visual.colors.primary} />
            <Swatch label="Secondary" hex={bp.visual.colors.secondary} />
            <Swatch label="Accent" hex={bp.visual.colors.accent} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Pill accent={accent}>Vibe: {titleize(bp.visual.colors.vibe)}</Pill>
            <Pill accent={accent}>Photo/video: {titleize(bp.visual.style.photo_video_style)}</Pill>
            <Pill accent={accent}>Graphics: {titleize(bp.visual.style.graphic_style)}</Pill>
            <Pill accent={accent}>Color treatment: {titleize(bp.visual.style.editing_color_treatment)}</Pill>
            <Pill accent={accent}>Type personality: {titleize(bp.visual.typography.personality)}</Pill>
          </div>
          {(has(bp.visual.typography.primary_font) || has(bp.visual.typography.secondary_font)) && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Primary font" value={bp.visual.typography.primary_font} />
              <Field label="Secondary font" value={bp.visual.typography.secondary_font} />
            </div>
          )}
        </Section>

        {/* Content strategy */}
        {(pillars.length > 0 ||
          cs.evergreen_topics.some(has) ||
          myths.length > 0 ||
          cs.hot_takes.some(has)) && (
          <Section title="Content Strategy" kicker="What we make" accent={accent}>
            {pillars.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {pillars.map((p, i) => (
                  <div key={i} className="dossier-card break-inside-avoid">
                    <p className="text-sm font-bold text-gray-900">{p.name || `Pillar ${i + 1}`}</p>
                    {has(p.covers) && <p className="mt-1 text-sm text-gray-700">{p.covers}</p>}
                    {has(p.why_it_matters) && (
                      <p className="mt-1.5 text-xs text-gray-500">Why: {p.why_it_matters}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {cs.evergreen_topics.some(has) && (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Evergreen topics
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {cs.evergreen_topics.filter(has).map((t, i) => (
                    <Pill key={i} accent={accent}>
                      {t}
                    </Pill>
                  ))}
                </div>
              </div>
            )}
            {myths.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Myths we bust
                </p>
                {myths.map((m, i) => (
                  <div key={i} className="dossier-card break-inside-avoid">
                    {has(m.myth) && (
                      <p className="text-sm text-gray-500 line-through">{m.myth}</p>
                    )}
                    {has(m.truth) && (
                      <p className="mt-1 text-sm font-medium text-gray-900">{m.truth}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {cs.hot_takes.some(has) && (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Hot takes
                </p>
                <div className="mt-2 space-y-1.5">
                  {cs.hot_takes.filter(has).map((t, i) => (
                    <p key={i} className="text-sm text-gray-800">
                      &ldquo;{t}&rdquo;
                    </p>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-900">Always include</p>
                <CheckList map={cs.must_include} accent={accent} tone="do" />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-900">Never do</p>
                <CheckList map={cs.never_do} accent={accent} tone="dont" />
              </div>
            </div>
            {cs.off_limits_topics.some(has) && (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Off-limits topics
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {cs.off_limits_topics.filter(has).map((t, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-600"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Competitors */}
        {competitors.length > 0 && (
          <Section title="Competitors" kicker="The landscape" accent={accent}>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Following</th>
                    <th className="px-3 py-2 font-semibold">Does well</th>
                    <th className="px-3 py-2 font-semibold">Does poorly</th>
                    <th className="px-3 py-2 font-semibold">We differ by</th>
                  </tr>
                </thead>
                <tbody>
                  {competitors.map((c, i) => (
                    <tr key={i} className="break-inside-avoid border-t border-gray-100 align-top">
                      <td className="px-3 py-2 font-medium text-gray-900">{c.name_or_handle}</td>
                      <td className="px-3 py-2 text-gray-600">{c.follower_count || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{c.does_well || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{c.does_poorly || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{c.differentiate || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Stories & proof (clients-row guidelines) */}
        {(has(client.key_stories) ||
          has(client.unique_mechanisms) ||
          has(client.social_proof) ||
          has(client.dos_and_donts) ||
          has(client.competitor_insights) ||
          has(client.target_audience)) && (
          <Section title="Stories, Proof & Guidelines" kicker="The playbook" accent={accent}>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Audience notes" value={client.target_audience} />
              <Field label="Key stories" value={client.key_stories} />
              <Field label="Unique mechanisms" value={client.unique_mechanisms} />
              <Field label="Social proof" value={client.social_proof} />
              <Field label="Dos & don'ts" value={client.dos_and_donts} />
              <Field label="Competitor insights" value={client.competitor_insights} />
              <Field label="Topics library" value={client.topics_library} />
            </div>
          </Section>
        )}

        {/* Legal */}
        {(has(bp.legal.disclaimers) || has(bp.legal.compliance_requirements)) && (
          <Section title="Legal & Compliance" kicker="Guardrails" accent={accent}>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Disclaimers" value={bp.legal.disclaimers} />
              <Field label="Compliance requirements" value={bp.legal.compliance_requirements} />
            </div>
          </Section>
        )}

        {/* Custom fields */}
        {customFields.length > 0 && (
          <Section title="Additional Notes" kicker="Everything else" accent={accent}>
            <div className="grid grid-cols-1 gap-3">
              {customFields.map((f) => (
                <Field key={f.id} label={f.label || 'Note'} value={f.content} />
              ))}
            </div>
          </Section>
        )}

        <footer className="mt-12 flex items-center gap-2 border-t border-gray-200 pt-4 text-xs text-gray-400">
          <Printer className="h-3.5 w-3.5" />
          Brand book for {displayName}
        </footer>
      </div>
    </>
  )
}
