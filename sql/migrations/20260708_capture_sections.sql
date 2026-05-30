-- =============================================================================
-- capture_pages: multi-section (multi-step) forms.
--
-- A capture form can be split into up to 10 ordered sections, each with an
-- optional title + description. Each field references its section via the
-- field's `sectionId` (stored inside the existing `fields` jsonb). The public
-- page then shows one section per step with Next/Back; the last step carries
-- the submit button. Pages with an empty `sections` array render every field
-- on a single page exactly as before, so this is backward compatible.
--
-- Shape: [{ "id": "section-...", "title": "...", "description": "..." }, ...]
-- =============================================================================

ALTER TABLE public.capture_pages
  ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '[]'::jsonb;
