-- =============================================================================
-- Topics: extend with input_type tagging + thin-flag + topic group id.
--
-- Today the `topics` table holds one row per client braindump answer, tagged
-- with a pillar. M2 changes the question-form generation to produce
-- 5-question topic groups (scene, failed_attempt, turning_point, framework,
-- proof). Each answer keeps its existing pillar but also carries:
--
--   input_type:     which raw-material slot this answer fills (the planner
--                   uses this to pick which formats can use which answer)
--   thin_flag:      flagged by the question-form UI when the answer fails
--                   the thin-answer check (< 25 words AND no specific noun)
--   topic_group_id: groups 5 answers from the same topic together so the
--                   long-form generator can pull all 5 in their natural order
--
-- Existing rows default to input_type='untyped' and thin_flag=false. Topic
-- group ids are nullable - legacy answers stay un-grouped.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.topic_input_type AS ENUM (
    'scene',
    'failed_attempt',
    'turning_point',
    'framework',
    'proof',
    'opinion',
    'named_mentor',
    'win_moment',
    'untyped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS input_type public.topic_input_type NOT NULL DEFAULT 'untyped';

ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS thin_flag boolean NOT NULL DEFAULT false;

ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS topic_group_id uuid;

-- Optional: position within the 5-question arc (1..5). Helps the long-form
-- generator preserve order when pulling all 5 answers for one topic.
ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS group_position integer
    CHECK (group_position IS NULL OR group_position BETWEEN 1 AND 10);

CREATE INDEX IF NOT EXISTS topics_input_type_idx
  ON public.topics (input_type) WHERE input_type <> 'untyped';

CREATE INDEX IF NOT EXISTS topics_group_idx
  ON public.topics (topic_group_id) WHERE topic_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS topics_thin_idx
  ON public.topics (client_id, thin_flag) WHERE thin_flag = true;

-- =============================================================================
-- Done.
-- =============================================================================
