-- =============================================================================
-- Topics consumption marker. When a planner slot is approved, every topic
-- referenced by that slot (via raw_material_refs) gets used_at = NOW().
--
-- Purpose: the planner picks topics that haven't been used yet. Marking
-- consumption on approval prevents the same answer set from being recycled
-- into a brand-new slot in a future plan.
--
-- M4 spec section 12.6:
--   "On success: updates slot status to 'approved', marks topic_group_id
--    as consumed (used_at on each topics row)."
--
-- Indexed because the planner's material loader filters on it.
-- =============================================================================

ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS used_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_topics_used_at_null
  ON public.topics (client_id) WHERE used_at IS NULL;

-- =============================================================================
-- Done.
-- =============================================================================
