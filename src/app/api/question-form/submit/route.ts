import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import type {
  FormQuestion,
  FormTopic,
  TopicInputType,
} from '@/lib/types/questionForm'
import type { TopicPillar } from '@/lib/types/topics'
import { getAgencyRecipientsForClient } from '@/lib/clientRecipients'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const AGENCY_NOTIFY_EMAIL = 'fokuskreatives@gmail.com'

interface Body {
  token?: string
  // Legacy flat-answer shape: { [questionId]: answerText }
  answers?: Record<string, string>
  // M2 shape: { [topicId]: { [questionId]: answerText } }
  topicAnswers?: Record<string, Record<string, string>>
  // Optional client-supplied thin-flag map keyed by question id, parallel
  // to the answer maps above. Trust the client check - server-side word
  // counting on every submit isn't worth the cost.
  thinFlags?: Record<string, boolean>
}

const INPUT_TYPE_TO_POSITION: Record<TopicInputType, number> = {
  scene: 1,
  failed_attempt: 2,
  turning_point: 3,
  framework: 4,
  proof: 5,
  // Optional types - position is informational only, the planner cares about
  // input_type. Place after the locked 5 so a topic with extras stays sortable.
  opinion: 6,
  named_mentor: 7,
  win_moment: 8,
}

interface AnswerRow {
  client_id: string
  question: string
  answer: string
  pillar: TopicPillar
  source: 'form'
  input_type: TopicInputType | 'untyped'
  thin_flag: boolean
  topic_group_id: string | null
  group_position: number | null
}

async function notifyAgency(
  req: NextRequest,
  clientId: string,
  clientName: string,
  businessName: string | null,
  count: number,
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const clientUrl = `${appUrl}/clients/${clientId}`

  const recipients = await getAgencyRecipientsForClient(supabase, clientId)
  const userIds = recipients.map((r) => r.id).filter(Boolean)
  const emails = recipients.map((r) => r.email).filter((e): e is string => Boolean(e))

  try {
    if (userIds.length) {
      await fetch(`${appUrl}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds,
          type: 'question_form_submitted',
          data: {
            clientId,
            clientName: businessName || clientName,
            count,
            url: clientUrl,
          },
        }),
      })
    }
  } catch (err) {
    console.error('question-form in-app notification error:', err)
  }

  try {
    const secret = process.env.APPS_SCRIPT_SECRET
    if (secret) {
      const to = emails.length ? Array.from(new Set([...emails, AGENCY_NOTIFY_EMAIL])) : [AGENCY_NOTIFY_EMAIL]
      await fetch(`${appUrl}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'question_form_submitted',
          payload: {
            secret,
            to,
            clientName: clientName || 'A client',
            businessName: businessName || '',
            count,
            url: clientUrl,
          },
        }),
      })
    }
  } catch (err) {
    console.error('question-form email notification error:', err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    const token = body.token?.trim()
    const thinFlags = body.thinFlags || {}

    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
    }

    const { data: form, error: lookupErr } = await supabase
      .from('question_forms')
      .select('id, client_id, questions, topics, submitted_at')
      .eq('token', token)
      .maybeSingle()

    if (lookupErr || !form) {
      return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 404 })
    }

    const formTopics = (Array.isArray(form.topics) ? form.topics : []) as FormTopic[]
    const isTopicForm = formTopics.length > 0
    const isAlreadySubmitted = !!form.submitted_at

    const rows: AnswerRow[] = []
    // For topic forms we also need to delete-then-reinsert per topic_group
    // when revisiting, so we can preserve a stable topic_group_id without
    // duplicating rows.
    const topicGroupIdsTouched: string[] = []

    if (isTopicForm) {
      // M2 path - 5-question topic groups.
      const topicAnswers = body.topicAnswers || {}
      // Persist a stable topic_group_id per topic by hashing topic.id with
      // form.id - same revisit hits the same group_id.
      // Random UUIDs would also work since we delete-then-reinsert; keeping
      // a deterministic id helps debugging.
      for (const topic of formTopics) {
        const topicAns = topicAnswers[topic.id]
        if (!topicAns) continue
        const groupId = topicGroupIdFor(form.id, topic.id)
        let topicHasAnswers = false

        for (const q of topic.questions) {
          const raw = topicAns[q.id]
          if (typeof raw !== 'string') continue
          const answer = raw.trim()
          if (!answer) continue
          topicHasAnswers = true
          const pillar: TopicPillar = topic.pillar_hint || 'unassigned'
          rows.push({
            client_id: form.client_id,
            question: q.text,
            answer,
            pillar,
            source: 'form',
            input_type: q.input_type,
            thin_flag: !!thinFlags[q.id],
            topic_group_id: groupId,
            group_position: INPUT_TYPE_TO_POSITION[q.input_type] ?? null,
          })
        }

        if (topicHasAnswers) topicGroupIdsTouched.push(groupId)
      }

      if (!rows.length) {
        return NextResponse.json(
          { success: false, error: 'Please answer at least one question.' },
          { status: 400 },
        )
      }

      // Revisit support: replace any prior rows for these topic_group_ids
      // before inserting new ones. Cleaner than upserting on a composite
      // key since the answer text changing on revisit is the common case.
      if (isAlreadySubmitted && topicGroupIdsTouched.length) {
        const { error: deleteErr } = await supabase
          .from('topics')
          .delete()
          .eq('client_id', form.client_id)
          .eq('source', 'form')
          .in('topic_group_id', topicGroupIdsTouched)
        if (deleteErr) {
          console.error('question-form submit revisit delete error:', deleteErr)
          return NextResponse.json(
            { success: false, error: 'Failed to update answers' },
            { status: 500 },
          )
        }
      }
    } else {
      // Legacy path - flat questions array.
      const answers = body.answers || {}
      const questions = (Array.isArray(form.questions) ? form.questions : []) as FormQuestion[]
      const questionMap = new Map<string, FormQuestion>()
      for (const q of questions) {
        if (q && typeof q.id === 'string') questionMap.set(q.id, q)
      }

      for (const [qid, rawAnswer] of Object.entries(answers)) {
        if (typeof rawAnswer !== 'string') continue
        const answer = rawAnswer.trim()
        if (!answer) continue
        const q = questionMap.get(qid)
        if (!q) continue
        rows.push({
          client_id: form.client_id,
          question: q.text,
          answer,
          pillar: q.pillar,
          source: 'form',
          input_type: 'untyped',
          thin_flag: !!thinFlags[qid],
          topic_group_id: null,
          group_position: null,
        })
      }

      if (!rows.length) {
        return NextResponse.json(
          { success: false, error: 'Please answer at least one question.' },
          { status: 400 },
        )
      }
    }

    const { error: insertErr } = await supabase.from('topics').insert(rows)
    if (insertErr) {
      console.error('question-form submit insert error:', insertErr)
      return NextResponse.json({ success: false, error: 'Failed to save answers' }, { status: 500 })
    }

    // Mark first-submit time only on the first submit. Later edits should
    // not bump submitted_at (the doc-level submission contract is "once").
    if (!isAlreadySubmitted) {
      const { error: updateErr } = await supabase
        .from('question_forms')
        .update({ submitted_at: new Date().toISOString() })
        .eq('id', form.id)
      if (updateErr) console.error('question-form submit mark error:', updateErr)
    }

    const { data: client } = await supabase
      .from('clients')
      .select('name, business_name')
      .eq('id', form.client_id)
      .maybeSingle()

    // Notify on first submit only - revisits are common (especially with
    // thin-answer follow-up) and don't need a fresh ping each time.
    if (!isAlreadySubmitted) {
      notifyAgency(
        req,
        form.client_id,
        client?.name || 'A client',
        client?.business_name || null,
        rows.length,
      ).catch((e) => console.error('notifyAgency error:', e))
    }

    return NextResponse.json({ success: true, saved: rows.length, revisited: isAlreadySubmitted })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('question-form submit exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

// Stable group id per (form, topic) so revisits of the same topic always
// land on the same topic_group_id without us tracking them separately.
// SHA-256 of (formId, topicId) reshaped into UUID 8-4-4-4-12 form.
function topicGroupIdFor(formId: string, topicId: string): string {
  const h = createHash('sha256').update(`${formId}:${topicId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
