import type { TopicPillar } from './topics'

export interface FormQuestion {
  id: string
  text: string
  pillar: TopicPillar
  placeholder?: string
}

export interface QuestionForm {
  id: string
  client_id: string
  token: string
  title: string | null
  questions: FormQuestion[]
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
