// POST /api/planner/export/[clientId]
//
// Exports the client's plan to a Google Doc via Apps Script (or a .docx
// fallback). Tier-aware per M4 section 12.7.
//
// Body params (all optional):
//   - campaignId: a single topic_group_id to export only that campaign.
//                 When omitted, ALL campaigns are exported, each on its
//                 own Google Doc tab.
//   - month:      'YYYY-MM' to scope the export to a single month.
//
// Returns either:
//   { success: true, mode: 'gdoc', docUrl, docId, ... }
//   { success: true, mode: 'docx', docxBase64, filename, ... }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { resolveTierConfig, type CustomConfig, type TierKey } from '@/lib/campaignTiers'
import { exportDoc, getGlobalShareList, type DocSegment, type CampaignSection, type AssetSubTab } from '@/lib/google/docExport'
import { normalizeFrame, type NormalizedFrame } from '@/components/planner/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Multi-campaign exports create one Google Doc per campaign via Apps
// Script - slow enough on big plans to outlive the platform default.
export const maxDuration = 300

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type SlotStream = 'long_form' | 'short_form' | 'engagement_reel' | 'carousel' | 'story'

interface SlotRow {
  id: string
  stream: SlotStream
  format_id: string | null
  scheduled_date: string
  status: string
  topic_group_id: string | null
  generation_meta: Record<string, unknown> | null
}

/** Strip em-dashes (and en-dashes) from any string heading into the doc.
 *  Defense-in-depth - the script sanitizer already does this for spoken
 *  content, but boilerplate text the export adds is generated here and
 *  needs its own scrub. */
function killDashes(s: string): string {
  return s.replace(/[—–]/g, '-')
}

// Stories live in story_queue_items (NOT content_plan_slots) and carry their
// content as a `frames` jsonb array (v2 StoryFrameV2 or legacy beats).
interface StoryRow {
  id: string
  frames: unknown
  intent: string | null
  prompt_text: string | null
  raw_material_refs: string[] | null
  pinned_to_date: string | null
  created_at: string
}

// Placement directions for asset-slot frames - wording matches the planner UI
// so the editor reads the same instruction in the doc and the app.
const ASSET_SLOT_LABEL: Record<string, string> = {
  'screenshot-proof': 'Drop the proof screenshot here',
  'dm-testimonial': 'Paste the client DM / testimonial here',
  'result-graphic': 'Drop the result graphic here',
}

/** A production direction (what to place / film / add, and where). Bracketed +
 *  bold so it stands out from the overlay text the editor actually posts. The
 *  brackets keep it legible even if a renderer drops the bold styling. */
function directionSegment(text: string): DocSegment {
  return { text: killDashes(`[ ${text} ]`), style: 'bold' }
}

/** Render a story's frames into doc segments. Uses normalizeFrame so legacy
 *  beats and v2 frames both render uniformly. Every directional marker on a
 *  frame (asset slot, visual/capture, sticker) is surfaced as a [ ... ]
 *  direction so the team knows exactly what to place where. */
function storyToSegments(story: StoryRow): DocSegment[] {
  const out: DocSegment[] = []
  if (story.intent) out.push({ text: killDashes(`Intent: ${story.intent}`), style: 'plain' })
  out.push({ text: '', style: 'plain' })

  const rawFrames = Array.isArray(story.frames) ? (story.frames as unknown[]) : []
  const frames = rawFrames
    .map(normalizeFrame)
    .filter((f): f is NormalizedFrame => f !== null)

  if (frames.length === 0) {
    out.push({
      text: killDashes(story.prompt_text || 'No story content generated yet.'),
      style: 'plain',
    })
    return out
  }

  frames.forEach((f, i) => {
    out.push({ text: `Frame ${i + 1} - ${f.role}`, style: 'h3' })
    // The overlay text the viewer actually reads.
    for (const b of f.textBlocks) {
      if (b.text.trim()) out.push({ text: killDashes(b.text.trim()), style: 'plain' })
    }
    // Directions: where to place what / what to film / what sticker to add.
    if (f.assetSlot) {
      out.push(directionSegment(ASSET_SLOT_LABEL[f.assetSlot] ?? f.assetSlot))
    } else if (f.visual) {
      out.push(directionSegment(`Visual: ${f.visual}`))
    }
    if (f.sticker) {
      const opts = f.sticker.options?.length ? ` - ${f.sticker.options.join(' / ')}` : ''
      out.push(directionSegment(`Add ${f.sticker.type} sticker${opts}`))
    }
    out.push({ text: '', style: 'plain' })
  })
  return out
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing client id' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }
    const clickerEmail = user.email
    if (!clickerEmail && !getGlobalShareList()) {
      return NextResponse.json(
        { success: false, error: 'Cannot determine share recipient: caller has no email and no GOOGLE_DOCS_SHARE_WITH is configured' },
        { status: 400 },
      )
    }

    let body: { month?: string; campaignId?: string } = {}
    try {
      body = await req.json()
    } catch {
      // empty body is fine
    }

    const { data: client, error: clientErr } = await admin
      .from('clients')
      .select('id, business_name, name, package_tier, custom_config')
      .eq('id', clientId)
      .maybeSingle()
    if (clientErr || !client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
    }

    const tier = client.package_tier as TierKey | null
    if (!tier) {
      return NextResponse.json(
        { success: false, error: 'Client has no package_tier set. Set it before exporting.' },
        { status: 400 },
      )
    }
    const tierCfg = resolveTierConfig({
      package_tier: tier,
      custom_config: (client.custom_config as CustomConfig | null) ?? null,
    })
    const brandName = killDashes(
      (client.business_name as string | null) || (client.name as string | null) || 'Brand',
    )

    let q = admin
      .from('content_plan_slots')
      .select('id, stream, format_id, scheduled_date, status, topic_group_id, generation_meta')
      .eq('client_id', clientId)
      .order('scheduled_date', { ascending: true })

    if (body.month && /^\d{4}-\d{2}$/.test(body.month)) {
      const start = `${body.month}-01`
      const [y, m] = body.month.split('-').map((s) => parseInt(s, 10))
      const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
      q = q.gte('scheduled_date', start).lt('scheduled_date', nextMonth)
    }

    if (body.campaignId) {
      q = q.eq('topic_group_id', body.campaignId)
    }

    const { data: slotRows, error: slotErr } = await q
    if (slotErr) {
      return NextResponse.json({ success: false, error: `Failed to load slots: ${slotErr.message}` }, { status: 500 })
    }
    const slots = (slotRows ?? []) as SlotRow[]
    if (slots.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No slots found for this export selection' },
        { status: 400 },
      )
    }

    // Group by topic_group_id. Each unique group = one campaign.
    const byCampaign = new Map<string, SlotRow[]>()
    for (const s of slots) {
      const key = s.topic_group_id ?? `untyped:${s.id}`
      const cur = byCampaign.get(key) ?? []
      cur.push(s)
      byCampaign.set(key, cur)
    }

    const campaigns = Array.from(byCampaign.entries())
      .map(([id, rows]) => ({
        id,
        rows,
        firstDate: rows.map((r) => r.scheduled_date).sort()[0],
      }))
      .sort((a, b) => a.firstDate.localeCompare(b.firstDate))

    // ---- Stories ----
    // Stories aren't in content_plan_slots, so load them from story_queue_items
    // and attach to campaigns. A story's campaign is resolved from its first
    // raw_material_ref -> topics.topic_group_id.
    const campaignIds = new Set(campaigns.map((c) => c.id))
    const storiesByGroup = new Map<string, StoryRow[]>()
    {
      const { data: storyRows } = await admin
        .from('story_queue_items')
        .select('id, frames, intent, prompt_text, raw_material_refs, pinned_to_date, created_at')
        .eq('client_id', clientId)
        .order('pinned_to_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
      const stories = (storyRows ?? []) as StoryRow[]

      const allRefs = Array.from(
        new Set(stories.flatMap((s) => (Array.isArray(s.raw_material_refs) ? s.raw_material_refs : []))),
      )
      const refToGroup = new Map<string, string>()
      if (allRefs.length > 0) {
        const { data: topicRows } = await admin
          .from('topics')
          .select('id, topic_group_id')
          .in('id', allRefs)
        for (const t of topicRows ?? []) {
          if (t.topic_group_id) refToGroup.set(t.id as string, t.topic_group_id as string)
        }
      }

      for (const story of stories) {
        const refs = Array.isArray(story.raw_material_refs) ? story.raw_material_refs : []
        const groupId = refs.map((r) => refToGroup.get(r)).find(Boolean)
        if (!groupId) continue
        if (body.campaignId && groupId !== body.campaignId) continue
        if (!campaignIds.has(groupId)) continue
        // Match the slot month filter: drop pinned stories outside the month;
        // keep unpinned ones (they belong to the campaign regardless of date).
        if (body.month && story.pinned_to_date && !story.pinned_to_date.startsWith(body.month)) continue
        const arr = storiesByGroup.get(groupId) ?? []
        arr.push(story)
        storiesByGroup.set(groupId, arr)
      }
    }

    // Build per-campaign sections in the new shape:
    //   - top-level tab body = long-form script
    //   - child tabs = each non-long-form asset
    const SUBTAB_LABEL: Record<Exclude<SlotStream, 'long_form'>, string> = {
      short_form: 'Short-form',
      engagement_reel: 'Engagement Reel',
      carousel: 'Carousel',
      story: 'Story',
    }

    function scriptToSegments(script: string): DocSegment[] {
      const out: DocSegment[] = []
      // Step 1: preprocess so EVERY bracket tag sits on its own line.
      // The AI sometimes generates "...expression. [OUTLINE]" with the
      // tag inline at the end of a sentence, which makes my line-based
      // detector miss it. This regex inserts a blank line before any
      // bracket tag that has non-whitespace content before it on the
      // same line.
      const normalized = killDashes(script).replace(
        /([^\n\s])\s*(\[[A-Z][A-Z0-9 \-]*\])/g,
        '$1\n\n$2',
      )

      // Step 2: split into paragraph blocks on blank-line boundaries.
      const paras = normalized.split(/\n\s*\n+/)

      // Bracket section tags as their own line: [TITLE], [HOOK], [BODY],
      // [POINT 1], [REHOOK 1], etc. Uppercase / digits / spaces / dashes.
      const bracketTagRe = /^\[[A-Z][A-Z0-9 \-]*\]$/

      for (const p of paras) {
        if (!p.trim()) {
          out.push({ text: '', style: 'plain' })
          continue
        }

        const lines = p.split('\n')
        let buf: string[] = []
        const flushBuf = () => {
          if (buf.length > 0) {
            const joined = buf.join('\n').trim()
            if (joined) out.push({ text: joined, style: 'plain' })
            buf = []
          }
        }
        for (const line of lines) {
          if (bracketTagRe.test(line.trim())) {
            flushBuf()
            // Bracket tags get emitted as H3 - visually distinct AND
            // they appear in the doc outline for navigation. H3 stays
            // smaller than the asset name H2 above it (Short-form #1)
            // so the outline hierarchy reads clean.
            out.push({ text: line.trim(), style: 'h3' })
          } else {
            buf.push(line)
          }
        }
        flushBuf()
        out.push({ text: '', style: 'plain' })
      }
      return out
    }

    const campaignSections: CampaignSection[] = campaigns.map((campaign, idx) => {
      const byStream: Record<SlotStream, SlotRow[]> = {
        long_form: [],
        short_form: [],
        engagement_reel: [],
        carousel: [],
        story: [],
      }
      for (const slot of campaign.rows) byStream[slot.stream].push(slot)
      for (const stream of Object.keys(byStream) as SlotStream[]) {
        byStream[stream].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
      }

      const expected: Record<SlotStream, number> = {
        long_form: tierCfg.perCampaign.longForm,
        short_form: tierCfg.perCampaign.shortForm,
        engagement_reel: tierCfg.perCampaign.engagementReels,
        carousel: tierCfg.perCampaign.carousels,
        story: tierCfg.perCampaign.stories,
      }

      // ---- Header segments (campaign metadata at top of main tab) ----
      // The tab title already labels the campaign ("Campaign 1 (DATE)"),
      // so we don't repeat that as H1 inside the body. Just emit the
      // metadata line (brand + start date + tier + cadence).
      const longFormSlot = byStream.long_form[0] ?? null
      const headerSegments: DocSegment[] = []
      headerSegments.push({
        text: killDashes(`${brandName} - starting ${campaign.firstDate} - tier ${tier} (${tierCfg.cadence})`),
        style: 'plain',
      })
      headerSegments.push({ text: '', style: 'plain' })

      // ---- Long-form body of the main tab ----
      const longFormSegments: DocSegment[] = []
      if (!longFormSlot) {
        // Only warn when the tier actually expects a long-form. Tiers like
        // 'top' run 0 long-form per campaign - a warning there is noise
        // that reads like something went wrong.
        if (expected.long_form > 0) {
          longFormSegments.push({
            text: killDashes('WARNING: No long-form slot in this campaign. Generate before exporting.'),
            style: 'plain',
          })
        }
      } else {
        const meta = (longFormSlot.generation_meta ?? {}) as Record<string, unknown>
        const script = typeof meta.script === 'string' ? meta.script.trim() : ''
        if (!script) {
          longFormSegments.push({
            text: killDashes(`Status: ${longFormSlot.status} - long-form script not generated yet.`),
            style: 'plain',
          })
        } else {
          // The campaign's top-level tab title (or fallback H1) already
          // labels this as the campaign and the long-form is the
          // expected first content of the tab. We don't add another
          // label here - the bracket tags inside the script ([TITLE],
          // [THUMBNAIL IDEA], etc.) already structure the content
          // visually and they're bolded by scriptToSegments.
          longFormSegments.push(...scriptToSegments(script))
        }
      }

      // ---- Child tabs - one per non-long-form asset ----
      // Stories are handled separately (below) because their content lives in
      // story_queue_items, not in content_plan_slots.
      const childTabs: AssetSubTab[] = []
      const otherStreams: Exclude<SlotStream, 'long_form' | 'story'>[] = [
        'short_form',
        'engagement_reel',
        'carousel',
      ]
      for (const stream of otherStreams) {
        const actual = byStream[stream]
        const exp = expected[stream]
        if (actual.length === 0 && exp === 0) continue

        for (let i = 0; i < Math.max(actual.length, exp); i++) {
          const suffix = exp > 1 ? ` #${i + 1}` : ''
          // Tab name (or fallback H2 heading) provides the asset label.
          // We include the scheduled date in the tab name so the user
          // can tell them apart in the sidebar.
          const slot = actual[i]
          const tabName = killDashes(
            `${SUBTAB_LABEL[stream]}${suffix}${slot ? ` - ${slot.scheduled_date}` : ''}`,
          )
          const segments: DocSegment[] = []

          // NO redundant H2 header inside the segments - the tab title
          // (or the fallback H2 the Apps Script appends from sub.name)
          // already labels the section. Adding another H2 here produced
          // the duplicate "Short-form #1" / "Short-form #1 - DATE"
          // entries we saw in the doc outline.

          if (!slot) {
            segments.push({
              text: killDashes('WARNING: Slot missing for this campaign position. Generate before exporting.'),
              style: 'plain',
            })
          } else {
            const meta = (slot.generation_meta ?? {}) as Record<string, unknown>
            const script = typeof meta.script === 'string' ? meta.script.trim() : ''
            if (!script) {
              segments.push({
                text: killDashes(`Status: ${slot.status} - no script generated yet.`),
                style: 'plain',
              })
            } else {
              segments.push({
                text: killDashes(`Status: ${slot.status}`),
                style: 'plain',
              })
              segments.push({ text: '', style: 'plain' })
              segments.push(...scriptToSegments(script))
            }
          }

          childTabs.push({ name: tabName, stream, segments })
        }
      }

      // ---- Story sub-tabs (from story_queue_items, grouped by campaign) ----
      const campaignStories = storiesByGroup.get(campaign.id) ?? []
      campaignStories.forEach((story, i) => {
        const dateLabel = story.pinned_to_date ?? story.created_at?.slice(0, 10) ?? ''
        const tabName = killDashes(`Story #${i + 1}${dateLabel ? ` - ${dateLabel}` : ''}`)
        childTabs.push({ name: tabName, stream: 'story', segments: storyToSegments(story) })
      })

      return {
        name: killDashes(`Campaign ${idx + 1} (${campaign.firstDate})`),
        topicGroupId: campaign.id,
        headerSegments,
        longFormSegments,
        childTabs,
      }
    })

    // Count exported slots that have no script - these render as
    // "no script generated yet" placeholders in the doc. Returned to the
    // UI so the export banner can flag the gap instead of the user
    // discovering it inside the doc.
    const missingScriptCount = slots.filter((s) => {
      const meta = (s.generation_meta ?? {}) as Record<string, unknown>
      const script = typeof meta.script === 'string' ? meta.script.trim() : ''
      return !script
    }).length

    const globalShareList = getGlobalShareList()
    const shareWith = globalShareList ?? (clickerEmail ? [clickerEmail] : [])

    const docTitle = killDashes(
      `${brandName} - Content Plan${body.month ? ` ${body.month}` : ''}${body.campaignId ? ' (single campaign)' : ''}`,
    )

    const result = await exportDoc({
      title: docTitle,
      campaigns: campaignSections,
      shareWith,
    })

    if (result.mode === 'gdoc') {
      return NextResponse.json({
        success: true,
        mode: 'gdoc',
        docs: result.docs,
        campaignCount: campaigns.length,
        missingScriptCount,
        appsScriptDiagnostics: result.appsScriptDiagnostics,
      })
    }

    return NextResponse.json({
      success: true,
      mode: 'docx',
      docxBase64: result.docxBase64,
      filename: result.filename,
      fallbackReason: result.fallbackReason,
      campaignCount: campaigns.length,
      missingScriptCount,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('planner/export error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
