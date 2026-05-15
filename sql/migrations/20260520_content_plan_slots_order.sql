-- =============================================================================
-- Within-day reorder support: add display_order to content_plan_slots so the
-- UI can persist the order of multiple cards stacked on the same date.
--
-- The grid already groups slots by scheduled_date; this column just gives the
-- intra-date order. Default is 0 (existing rows all sort the same; created_at
-- breaks ties via the index below).
-- =============================================================================

ALTER TABLE public.content_plan_slots
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- Composite index lets the planner query do `ORDER BY scheduled_date,
-- display_order, created_at` in one index scan instead of a sort.
CREATE INDEX IF NOT EXISTS content_plan_slots_client_date_order_idx
  ON public.content_plan_slots (client_id, scheduled_date, display_order, created_at);

-- =============================================================================
-- Done.
-- =============================================================================
