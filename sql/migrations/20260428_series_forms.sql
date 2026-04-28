-- =============================================================================
-- Series Forms: separate intake flow for multi-day/episode content series.
--
-- Distinct from question_forms because series answers shouldn't pollute the
-- regular topic bank - they're tied to one specific series concept ("30 lessons
-- by 30", "60 days of X", etc) and feed an external prompt that produces all
-- N entries from the client's actual answers, not from inferred profile data.
-- =============================================================================

create table if not exists series_forms (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),

  -- Series identity
  title text not null,                          -- "30 lessons by 30"
  series_label text not null default 'Day',     -- Day | Part | Episode | Chapter | Lesson
  series_length int not null default 30,
  format text not null default 'short',         -- longform | short | carousel | story | engagement
  framing text,                                 -- lessons | progress | challenge | step-by-step | freeform

  -- Generated questions, one per entry. Shape:
  -- [{ id, text, entry_index, beat_type, anchor_field?, anchor_value?, placeholder? }]
  questions jsonb not null default '[]'::jsonb,

  -- Optional consistent close + brand line (the "this is 30 lessons by 30" repetition)
  cta_text text,
  brand_line text,

  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists series_forms_client_idx on series_forms(client_id);
create index if not exists series_forms_token_idx on series_forms(token);

create table if not exists series_answers (
  id uuid primary key default gen_random_uuid(),
  series_form_id uuid not null references series_forms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  question_id text not null,
  question_text text not null,
  entry_index int not null,
  answer text not null,
  created_at timestamptz not null default now()
);

create index if not exists series_answers_form_idx on series_answers(series_form_id);
create index if not exists series_answers_form_entry_idx on series_answers(series_form_id, entry_index);

-- =============================================================================
-- Done.
-- =============================================================================
