export type TopicPillar =
  | 'educational'
  | 'storytelling'
  | 'authority'
  | 'series'
  | 'doubledown'
  | 'unassigned'

export interface Topic {
  id: string
  client_id: string
  question: string | null
  answer: string
  pillar: TopicPillar
  used_at: string | null
  last_used_content_id: string | null
  source: 'manual' | 'form' | 'import'
  created_at: string
}

export const TOPICS_TABLE_SQL = `
-- Run in Supabase SQL editor
create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  question text,
  answer text not null,
  pillar text not null default 'unassigned',
  used_at timestamptz,
  last_used_content_id uuid,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create index if not exists topics_client_idx on topics(client_id);
create index if not exists topics_client_used_idx on topics(client_id, used_at);
`
