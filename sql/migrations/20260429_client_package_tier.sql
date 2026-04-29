-- =============================================================================
-- Client package tiers.
--
-- Distinct from `content_tier` (which controls content-generation features).
-- `package_tier` is the client's subscription level: top, middle, or lower.
-- It drives:
--   - which CRM features they can see (lower=no CRM, middle=lead/meeting/capture
--     only, top=full)
--   - the per-campaign deliverable counts when creating a task
--   - the per-month campaign cap when auto-suggesting Campaign + Month numbers
-- =============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS package_tier text
    CHECK (package_tier IS NULL OR package_tier IN ('top', 'middle', 'lower'));

-- Optional clickup_folder_id stamped once the first task creates the folder
-- in ClickUp. Lets later tasks land in the same folder without re-creating it.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS clickup_folder_id text;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS clickup_list_id text;

-- =============================================================================
-- Done.
-- =============================================================================
