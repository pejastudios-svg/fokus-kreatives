-- =============================================================================
-- capture_sessions: per-visit instrumentation for the capture-page
-- analytics tab.
--
-- One row per visit (not per submission). Lets us answer:
--   - How many people landed on this page?
--   - How many actually submitted? (visits → submissions funnel)
--   - How long did visitors spend?
--   - Which field were they on when they bounced? (drop-off insight)
--   - How many unique visitors? (distinct visitor_id)
--
-- visitor_id is a random uuid generated client-side and stored in
-- localStorage. NOT tied to auth - the public capture page has no
-- auth. Lets us de-duplicate "same person reloaded the page" without
-- needing PII.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.capture_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_page_id uuid NOT NULL REFERENCES public.capture_pages(id) ON DELETE CASCADE,

  -- Anonymous visitor identifier - random uuid from the client's
  -- localStorage. Persisted across reloads on the same browser so
  -- "unique visitors" is meaningful.
  visitor_id text NOT NULL,

  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,

  -- True when the visitor successfully submitted the form. Drives
  -- the submissions-vs-visits funnel.
  submitted boolean NOT NULL DEFAULT false,

  -- The last field id the visitor interacted with. When submitted=
  -- false this points at the field they bounced from - the seed of
  -- drop-off analysis.
  last_field_id text,

  -- Optional context. Not required for analytics; just useful when
  -- you want to know where the traffic is coming from.
  referrer text,
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capture_sessions_page_idx
  ON public.capture_sessions (capture_page_id);

-- Lets the drop-off query (group by last_field_id where not submitted)
-- skip a full scan on busy pages.
CREATE INDEX IF NOT EXISTS capture_sessions_page_submitted_idx
  ON public.capture_sessions (capture_page_id, submitted);

CREATE INDEX IF NOT EXISTS capture_sessions_visitor_idx
  ON public.capture_sessions (capture_page_id, visitor_id);

-- RLS: writes go through the public track endpoint via service role
-- (RLS bypassed). Reads from the dashboard use the same permissive
-- pattern as leads + capture_submissions.
ALTER TABLE public.capture_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated" ON public.capture_sessions;
CREATE POLICY "Allow all for authenticated"
  ON public.capture_sessions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
