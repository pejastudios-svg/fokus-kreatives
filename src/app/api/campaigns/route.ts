import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { TIER_CONFIG, type PackageTier } from '@/lib/campaignTiers'
import {
  clickupConfigured,
  createClickUpFolder,
  createClickUpList,
  createClickUpTask,
  createClickUpSubtask,
  deleteClickUpTask,
  fetchClickUpTaskStatus,
} from '@/app/api/clickup/helpers'

// ClickUp returns ACCESS_100 ("List deleted") or 404-style "not found" errors
// when our cached folder/list IDs point at resources that were deleted in
// ClickUp or live in a different workspace than the current token. We treat
// any of these as "stale cache - rebuild it" rather than a hard failure.
function isStaleClickupResourceError(err: string | undefined | null): boolean {
  if (!err) return false
  const lower = err.toLowerCase()
  return (
    lower.includes('access_100') ||
    lower.includes('deleted') ||
    lower.includes('not found') ||
    lower.includes('no access')
  )
}

// Generic guidelines that go on every campaign's main-task description. The
// per-deliverable instructions live on the subtasks themselves, and the
// asset URLs live in ClickUp custom fields the team fills in as they go.
const CAMPAIGN_BRIEF = `
Campaign brief:
- The long-form pillar drives this campaign. Produce that first.
- Short-form, engagement reels, carousels, stories are repurposed from the long-form. Keep visual and voice consistent.
- Drop links to each deliverable into the matching custom fields (Long Form Video, Short-Form Videos, Carousels, etc.) as you complete them.
- Move this main task across the board as the campaign progresses. Subtasks track each individual deliverable.
`.trim()

/**
 * Per-deliverable instructions. Each maps to ONE subtask covering all
 * deliverables of that kind for this campaign (e.g. "Create 4 short-form
 * videos") so the parent task stays readable. Phrasing assumes the count
 * is in the subtask name and the description carries the production rules.
 */
const SUBTASK_INSTRUCTIONS = {
  monthlyQuestions:
    'Open the agency dashboard, switch to the Questions Form generator, pick this client and the number of questions you want to ask this month, generate, and share the public form link with the client. Once the client submits, open the Past Forms list, click View Answers on this submission, copy the answers link from the copy button next to it, and paste that link into the ANSWERED QUESTIONS custom field on this task.',
  scriptCreation:
    'Pick one of the client\'s answers from the submitted Questions form as the seed for this month\'s script. On the dashboard, switch to Script Package and generate the package against that topic. When the script is ready, paste the link into the SCRIPTS & TOPICS custom field on this task.',
  longForm:
    'Pillar long-form video for this campaign. Produce this first. Every other deliverable is cut from it.',
  thumbnail:
    'YouTube thumbnail for the long-form. Test 2 to 3 variants if time allows. Drop the final into the Thumbnails custom field.',
  shortForm:
    'Cut from the long-form. 30 to 90 seconds each, vertical 9:16. Hook in the first 2 seconds. Drop links into the Short-Form Videos custom field.',
  engagementReel:
    'Punchy 15 to 30 second reels designed for shares and saves. Strong CTA in the caption. Drop links into the Engagement Reels custom field.',
  carousel:
    '8 to 10 slides each. Slide 1 is the hook. Last slide drives a save or a CTA. Drop links into the Carousels custom field.',
  story:
    'Native, not over-produced. Daily distribution. Drop links into the Stories custom field.',
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

/**
 * Map a ClickUp status display string ("⏳ WAITING FOR FEEDBACK", "TO DO",
 * "approved" - case + emojis vary by board config) to our snake_case enum.
 * Anything we don't recognise falls through as 'todo' so a stray ClickUp
 * status doesn't break the page.
 */
export function normaliseStatus(raw: string | null | undefined): string {
  if (!raw) return 'todo'
  const s = raw.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '')
  if (s.includes('completed') || s === 'complete') return 'completed'
  if (s.includes('approved')) return 'approved'
  if (s.includes('discontinued')) return 'discontinued'
  if (s.includes('waiting')) return 'waiting_for_feedback'
  if (s.includes('ready_for_review') || s.includes('ready')) return 'ready_for_review'
  if (s.includes('progress')) return 'in_progress'
  if (s.includes('to_do') || s.includes('todo') || s === 'open') return 'todo'
  return 'todo'
}

interface CreateBody {
  clientId?: string
  name?: string
  campaignNumber?: number
  monthNumber?: number
  // What to do if a campaign with the same name already exists for this
  // client. Omit on the first attempt - the server returns 409 with
  // requiresConfirmation:true and the UI re-sends with one of these.
  //   'create'  - create the new campaign anyway, accepting the duplicate
  //   'replace' - delete the existing same-name campaign(s) (and their
  //               ClickUp tasks) first, then create the new one
  onDuplicate?: 'create' | 'replace'
}

interface CampaignRow {
  id: string
  status: string
  clickup_task_id: string | null
  client_id: string
  campaign_number: number
  month_number: number
  name: string
  tier_at_creation: PackageTier | null
  expected_long_form: number
  expected_short_form: number
  expected_engagement_reels: number
  expected_carousels: number
  expected_stories: number
  created_at: string
  updated_at: string
}

/**
 * List campaigns. Optionally filtered by ?clientId=X. Before returning,
 * sync the status of any row whose ClickUp task we know about - so the
 * page reflects board moves the agency made directly in ClickUp without
 * needing a separate refresh button. Sync is best-effort and bounded
 * (max 25 rows per request) to keep the response snappy.
 */
export async function GET(req: NextRequest) {
  try {
    const sb = admin()
    const url = new URL(req.url)
    const clientFilter = url.searchParams.get('clientId')

    let q = sb
      .from('campaigns')
      .select(
        'id, status, clickup_task_id, client_id, campaign_number, month_number, name, tier_at_creation, expected_long_form, expected_short_form, expected_engagement_reels, expected_carousels, expected_stories, created_at, updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(200)
    if (clientFilter) q = q.eq('client_id', clientFilter)

    const { data, error } = await q
    if (error) {
      console.error('GET /api/campaigns select error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    const rows = (data || []) as CampaignRow[]

    // ---- Status sync (best-effort, capped) --------------------------------
    if (clickupConfigured() && rows.length > 0) {
      const syncTargets = rows.filter((r) => !!r.clickup_task_id).slice(0, 25)
      const updates: { id: string; status: string }[] = []
      await Promise.all(
        syncTargets.map(async (r) => {
          const fetched = await fetchClickUpTaskStatus(r.clickup_task_id as string)
          if (!fetched.status) return
          const next = normaliseStatus(fetched.status)
          if (next !== r.status) updates.push({ id: r.id, status: next })
        }),
      )
      if (updates.length > 0) {
        // PostgREST has no batch-update; do them as parallel single updates.
        await Promise.all(
          updates.map((u) =>
            sb.from('campaigns').update({ status: u.status }).eq('id', u.id),
          ),
        )
        for (const u of updates) {
          const r = rows.find((x) => x.id === u.id)
          if (r) r.status = u.status
        }
      }
    }

    // Pull client names so the page can render "for Acme Co" without a
    // second round-trip. One query, in() on the unique client ids.
    const clientIds = Array.from(new Set(rows.map((r) => r.client_id))).filter(Boolean)
    let clientsById: Record<string, { name: string | null; business_name: string | null; package_tier: PackageTier | null }> = {}
    if (clientIds.length > 0) {
      const { data: cs } = await sb
        .from('clients')
        .select('id, name, business_name, package_tier')
        .in('id', clientIds)
      clientsById = Object.fromEntries(
        (cs || []).map((c) => [c.id as string, {
          name: (c as { name: string | null }).name,
          business_name: (c as { business_name: string | null }).business_name,
          package_tier: (c as { package_tier: PackageTier | null }).package_tier,
        }]),
      )
    }

    return NextResponse.json({ success: true, campaigns: rows, clients: clientsById })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('GET /api/campaigns exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

interface ClientRow {
  id: string
  name: string | null
  business_name: string | null
  package_tier: PackageTier | null
  clickup_folder_id: string | null
  clickup_list_id: string | null
}

/**
 * Ensure the client has a live ClickUp folder + list. If `forceRebuild` is
 * set, the cached IDs are ignored and a fresh folder/list pair is created;
 * this is the recovery path after a stale-resource error. Returns the IDs
 * (newly cached if we created them) or an error string.
 */
async function ensureClickupListForClient(
  sb: ReturnType<typeof admin>,
  client: ClientRow,
  opts: { forceRebuild?: boolean } = {},
): Promise<{ folderId?: string; listId?: string; error?: string }> {
  if (!opts.forceRebuild && client.clickup_folder_id && client.clickup_list_id) {
    return {
      folderId: client.clickup_folder_id,
      listId: client.clickup_list_id,
    }
  }

  const folderName = client.business_name || client.name || 'Untitled client'
  const folderRes = await createClickUpFolder(folderName)
  if (!folderRes.folderId) {
    return { error: folderRes.error || 'failed to create ClickUp folder' }
  }
  const listRes = await createClickUpList(folderRes.folderId, 'Campaigns')
  if (!listRes.listId) {
    return { error: listRes.error || 'failed to create ClickUp list' }
  }
  await sb
    .from('clients')
    .update({ clickup_folder_id: folderRes.folderId, clickup_list_id: listRes.listId })
    .eq('id', client.id)
  return { folderId: folderRes.folderId, listId: listRes.listId }
}

/**
 * Create a campaign for a client. Side-effects in ClickUp:
 *   - if the client doesn't have a folder yet, create one in CLICKUP_SPACE_ID
 *     and a default "Campaigns" list inside it; stamp both IDs on `clients`
 *   - if the cached folder/list pair was deleted in ClickUp (ACCESS_100 /
 *     "List deleted"), null the cache and rebuild it once before retrying
 *   - create a task in that list named after the campaign, with a description
 *     listing the deliverable counts the agency should produce
 *
 * The ClickUp side is best-effort - if anything fails we still return the
 * created campaign row so the agency can wire ClickUp manually later.
 *
 * Duplicate-name guard:
 *   - If a campaign with the same trimmed name already exists for this
 *     client, the first POST returns 409 with requiresConfirmation:true.
 *   - The UI then re-sends with onDuplicate='create' (allow duplicate) or
 *     onDuplicate='replace' (delete the existing same-name campaign(s) +
 *     their ClickUp tasks before creating the new one).
 */
export async function POST(req: NextRequest) {
  try {
    const sb = admin()
    const body = (await req.json().catch(() => ({}))) as CreateBody

    const clientId = (body.clientId || '').trim()
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const { data: clientRaw, error: clientErr } = await sb
      .from('clients')
      .select('id, name, business_name, package_tier, clickup_folder_id, clickup_list_id')
      .eq('id', clientId)
      .maybeSingle()
    if (clientErr || !clientRaw) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
    }
    const client = clientRaw as ClientRow

    // Per-tier deliverable counts; fall back to "lower" defaults if no tier
    // is set so we still create something sensible.
    const tierCfg = client.package_tier ? TIER_CONFIG[client.package_tier] : TIER_CONFIG.lower
    const expected = tierCfg.perCampaign

    const campaignNumber = Number.isFinite(body.campaignNumber) ? Number(body.campaignNumber) : 1
    const monthNumber = Number.isFinite(body.monthNumber) ? Number(body.monthNumber) : 1
    const name =
      (body.name || '').trim() || `Campaign ${campaignNumber} | Month ${monthNumber}`

    // ----- Duplicate-name guard --------------------------------------------
    // Same-name campaigns under the same client trigger a confirmation
    // round-trip. ClickUp itself accepts duplicate task names, but we want
    // the agency to make the call deliberately - usually the duplicate
    // means someone created the wrong month/number and wants to replace.
    const { data: existingDupes } = await sb
      .from('campaigns')
      .select('id, clickup_task_id, name')
      .eq('client_id', clientId)
      .ilike('name', name)
    const duplicates = (existingDupes || []).filter(
      (r) => (r.name as string).trim().toLowerCase() === name.toLowerCase(),
    )

    if (duplicates.length > 0 && !body.onDuplicate) {
      return NextResponse.json(
        {
          success: false,
          requiresConfirmation: true,
          duplicateName: name,
          existingCount: duplicates.length,
          error: `${duplicates.length} campaign(s) with this name already exist for this client.`,
        },
        { status: 409 },
      )
    }

    if (duplicates.length > 0 && body.onDuplicate === 'replace') {
      // Delete the existing same-name campaigns (and their ClickUp tasks)
      // before continuing. Best-effort on the ClickUp side - the row
      // deletion is what makes the duplicate-name check pass on the next
      // step, so we don't bail if ClickUp returns an error.
      for (const dupe of duplicates) {
        if (dupe.clickup_task_id && clickupConfigured()) {
          const res = await deleteClickUpTask(dupe.clickup_task_id as string)
          if (!res.ok) {
            console.warn('replace-duplicate ClickUp delete failed:', dupe.id, res.error)
          }
        }
        await sb.from('campaigns').delete().eq('id', dupe.id as string)
      }
    }

    // ----- ClickUp side (best-effort) ---------------------------------------
    let folderId = client.clickup_folder_id
    let listId = client.clickup_list_id
    let clickupTaskId: string | null = null
    let clickupError: string | null = null

    if (clickupConfigured()) {
      // Create the per-client folder + default list once, then reuse for
      // every later campaign. ensureClickupListForClient handles both the
      // first-time path (cached IDs null) and the recovery path (forceRebuild
      // after a stale-resource error from ClickUp).
      const ensured = await ensureClickupListForClient(sb, client)
      if (ensured.error) {
        clickupError = ensured.error
      } else {
        folderId = ensured.folderId || folderId
        listId = ensured.listId || listId
      }

      if (listId && !clickupError) {
        let taskRes = await createClickUpTask({
          listId,
          name,
          description: CAMPAIGN_BRIEF,
        })

        // Self-heal: if ClickUp says the list/folder is gone (deleted in the
        // UI, or living in a different workspace than the current token),
        // wipe the cache, recreate folder+list, retry the task once.
        if (!taskRes.taskId && isStaleClickupResourceError(taskRes.error)) {
          console.warn(
            'campaigns: stale ClickUp list detected, rebuilding folder+list',
            { clientId, error: taskRes.error },
          )
          const rebuilt = await ensureClickupListForClient(
            sb,
            { ...client, clickup_folder_id: null, clickup_list_id: null },
            { forceRebuild: true },
          )
          if (rebuilt.listId) {
            listId = rebuilt.listId
            folderId = rebuilt.folderId || folderId
            taskRes = await createClickUpTask({
              listId,
              name,
              description: CAMPAIGN_BRIEF,
            })
          } else if (rebuilt.error) {
            clickupError = rebuilt.error
          }
        }

        if (taskRes.taskId) {
          clickupTaskId = taskRes.taskId

          // One subtask per deliverable *type* (not per deliverable count) -
          // e.g. "Create 4 short-form videos" rather than four separate
          // subtasks. Keeps the parent task readable. Long-form + thumbnail
          // are always single-instance.
          //
          // The first two subtasks (monthly questions, script creation) come
          // before the deliverables because they're the upstream inputs:
          // questions feed the script, the script feeds the long-form, and
          // the long-form feeds everything else.
          const planned: { name: string; description: string }[] = []
          planned.push({
            name: 'Generate monthly questions',
            description: SUBTASK_INSTRUCTIONS.monthlyQuestions,
          })
          planned.push({
            name: 'Script creation',
            description: SUBTASK_INSTRUCTIONS.scriptCreation,
          })
          planned.push({
            name: 'Create the long-form video',
            description: SUBTASK_INSTRUCTIONS.longForm,
          })
          planned.push({
            name: 'Create the YouTube thumbnail',
            description: SUBTASK_INSTRUCTIONS.thumbnail,
          })

          const addBatch = (label: string, count: number, instruction: string) => {
            if (count <= 0) return
            planned.push({ name: `Create ${count} ${label}`, description: instruction })
          }
          addBatch(
            expected.shortForm === 1 ? 'short-form video' : 'short-form videos',
            expected.shortForm,
            SUBTASK_INSTRUCTIONS.shortForm,
          )
          addBatch(
            expected.engagementReels === 1 ? 'engagement reel' : 'engagement reels',
            expected.engagementReels,
            SUBTASK_INSTRUCTIONS.engagementReel,
          )
          addBatch(
            expected.carousels === 1 ? 'carousel' : 'carousels',
            expected.carousels,
            SUBTASK_INSTRUCTIONS.carousel,
          )
          addBatch(
            expected.stories === 1 ? 'story' : 'stories',
            expected.stories,
            SUBTASK_INSTRUCTIONS.story,
          )

          // Sequential creation so ClickUp's API doesn't rate-limit on a
          // burst of subtask requests. Best-effort: a single failure doesn't
          // kill the whole thing - the campaign still gets created and the
          // agency can hand-add any missing subtasks in ClickUp.
          for (const sub of planned) {
            const subRes = await createClickUpSubtask({
              listId,
              parentTaskId: clickupTaskId,
              name: sub.name,
              description: sub.description,
            })
            if (!subRes.taskId && subRes.error) {
              console.warn('campaign subtask create failed:', sub.name, subRes.error)
            }
          }
        } else {
          clickupError = taskRes.error || 'failed to create ClickUp task'
        }
      }
    }

    // ----- Persist the campaign row -----------------------------------------
    const { data: created, error: insertErr } = await sb
      .from('campaigns')
      .insert({
        client_id: clientId,
        campaign_number: campaignNumber,
        month_number: monthNumber,
        name,
        tier_at_creation: client.package_tier,
        expected_long_form: expected.longForm,
        expected_short_form: expected.shortForm,
        expected_engagement_reels: expected.engagementReels,
        expected_carousels: expected.carousels,
        expected_stories: expected.stories,
        clickup_task_id: clickupTaskId,
        // If we just created the ClickUp task, pull its initial status back
        // so the row's status field reflects whatever ClickUp's list default
        // is. Best-effort - failures keep the default 'todo'.
        status: clickupTaskId
          ? normaliseStatus((await fetchClickUpTaskStatus(clickupTaskId)).status)
          : 'todo',
      })
      .select('*')
      .single()

    if (insertErr || !created) {
      console.error('campaign insert error:', insertErr)
      return NextResponse.json(
        { success: false, error: insertErr?.message || 'Failed to create campaign' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      campaign: created,
      clickupError,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/campaigns exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
