-- =============================================================================
-- Story QA checklist.
--
-- Each generated story now carries a QA checklist (the same ChecklistItem
-- shape used for scripts) so the planner can surface AI-tell / fabrication /
-- CTA flags per story. Additive + nullable-with-default so legacy rows keep
-- rendering unchanged (empty checklist => no dropdown).
-- =============================================================================

ALTER TABLE public.story_queue_items
  ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

-- =============================================================================
-- Done.
-- =============================================================================
