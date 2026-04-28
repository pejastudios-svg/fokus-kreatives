-- =============================================================================
-- Approval comments: time-grab + region-highlight annotations.
--
-- Each comment can optionally carry:
--   timestamp_seconds  - the playback time the reviewer was watching when they
--                        commented (videos only). Click the pill in the UI and
--                        the player scrubs to that moment.
--   region             - a percent-based shape drawn on the asset to highlight
--                        the area being discussed. Two shape kinds for now:
--                          { "shape": "circle",   "x": 0.42, "y": 0.31, "radius": 0.12 }
--                          { "shape": "freeform", "points": [{ "x": 0.1, "y": 0.2 }, ...] }
--                        Coordinates are 0-1 relative to the asset's rendered
--                        box so they survive any resize / device.
--   attachment_index   - which slide the annotation belongs to in a carousel
--                        item (0-based). Null = the item itself / not a
--                        carousel.
-- =============================================================================

ALTER TABLE public.approval_comments
  ADD COLUMN IF NOT EXISTS timestamp_seconds numeric,
  ADD COLUMN IF NOT EXISTS region jsonb,
  ADD COLUMN IF NOT EXISTS attachment_index integer;

-- Validation lives in app code (TypeScript) so we keep the schema flexible
-- for future shape kinds (rect, polygon, etc).

-- =============================================================================
-- Done.
-- =============================================================================
