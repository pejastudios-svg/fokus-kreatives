import type { TopicPillar } from './topics'

// Legacy flat-question shape. Existing forms still carry this; new forms
// generated via M2's 5-question topic flow populate `topics` instead.
export interface FormQuestion {
  id: string
  text: string
  pillar: TopicPillar
  placeholder?: string
}

// M2: each topic gets 5 questions in locked input-type order
// (scene -> failed_attempt -> turning_point -> framework -> proof).
// Mirrors public.topic_input_type from migration 20260505_topics_input_type.
export type TopicInputType =
  | 'scene'
  | 'failed_attempt'
  | 'turning_point'
  | 'framework'
  | 'proof'
  | 'opinion'
  | 'named_mentor'
  | 'win_moment'

export interface FormTopicQuestion {
  id: string
  input_type: TopicInputType
  text: string
  placeholder?: string
}

// Topic axes - the structural angle of a topic. Used by the planner to
// rotate which axis each batch uses so consecutive batches can't all be
// "transformation arc" or all "industry myth" - even when the AI thinks
// it's varying the title, the underlying SHAPE of the topic stays diverse.
export type TopicAxis =
  | 'transformation'      // a before/after journey for the owner or a client
  | 'mistake'             // a specific thing the owner tried that flopped
  | 'industry_myth'       // a common belief the owner thinks is wrong
  | 'hot_take'            // a contrarian opinion the owner holds
  | 'origin'              // an early-days moment from the owner's path
  | 'client_win'          // a specific result the owner produced for a client
  | 'framework_reveal'    // surfacing one component of the owner's methodology
  | 'pivot'               // a strategic decision that changed direction
  | 'mentor_lesson'       // a lesson learned from a specific person
  | 'industry_observation' // a pattern the owner notices in the niche

export const TOPIC_AXES: TopicAxis[] = [
  'transformation',
  'mistake',
  'industry_myth',
  'hot_take',
  'origin',
  'client_win',
  'framework_reveal',
  'pivot',
  'mentor_lesson',
  'industry_observation',
]

export interface FormTopic {
  id: string
  title: string
  pillar_hint: TopicPillar
  questions: FormTopicQuestion[]
  /** Structural angle. Optional on legacy rows; populated on new batches so
   *  axis-rotation logic can read recent history. */
  topic_axis?: TopicAxis
}

export interface QuestionForm {
  id: string
  client_id: string
  token: string
  title: string | null
  // Legacy column - populated for forms created before M2.
  questions: FormQuestion[]
  // M2 column - populated for forms created via the 5-question topic flow.
  topics?: FormTopic[]
  pillars: TopicPillar[]
  submitted_at: string | null
  created_at: string
}

export const QUESTION_FORMS_SQL = `
-- Run once in Supabase SQL editor
create table if not exists question_forms (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  title text,
  questions jsonb not null default '[]'::jsonb,
  pillars text[] not null default '{}',
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists question_forms_client_idx on question_forms(client_id);
create index if not exists question_forms_token_idx on question_forms(token);
`
