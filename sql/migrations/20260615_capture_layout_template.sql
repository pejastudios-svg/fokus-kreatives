-- =============================================================================
-- Capture pages: layout_template
--
-- Adds a layout selector so each capture page can pick a visual shell:
--   'compact'      | centered card with optional banner header (current look)
--   'split-right'  | image on right, form/content on left
--   'split-left'   | flipped: image on left, form/content on right
--   'hero-overlay' | full-bleed image, form in centered frosted card
--   'banner-top'   | full-width banner image up top, form stacked below
--   'minimal'      | no image, big typography + form, plain bg
--
-- Default is 'compact' so EVERY existing capture page renders exactly
-- the same as before this migration. The dispatcher in the public page
-- treats null/missing as 'compact' too as a belt-and-suspenders default.
-- =============================================================================

ALTER TABLE public.capture_pages
  ADD COLUMN IF NOT EXISTS layout_template text NOT NULL DEFAULT 'compact'
    CHECK (layout_template IN (
      'compact',
      'split-right',
      'split-left',
      'hero-overlay',
      'banner-top',
      'minimal'
    ));

-- Pre-existing rows: backfill to the default explicitly. The table-level
-- DEFAULT 'compact' handles this for new rows; UPDATE locks in older rows
-- created before this migration (in case any DDL race left them NULL).
UPDATE public.capture_pages
   SET layout_template = 'compact'
 WHERE layout_template IS NULL;
