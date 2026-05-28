-- =============================================================================
-- Link capture_submissions to the visit (capture_sessions) that produced it.
--
-- Why: the analytics tab derives Visits / Unique Visitors / Avg Time / the
-- visits-vs-submissions funnel from capture_sessions, and the Submissions
-- count is max(submission rows, sessions flagged submitted). Without a link
-- back to the session, deleting a submission could never reduce those
-- session-derived stats. Storing session_id lets the delete flow remove the
-- one visit that led to the submission so the funnel stays truthful.
--
-- ON DELETE SET NULL (not CASCADE): a session can disappear for reasons
-- unrelated to the submission (e.g. a future cleanup job); when it does we
-- only want to drop the link, never silently delete the captured lead.
-- =============================================================================

ALTER TABLE public.capture_submissions
  ADD COLUMN IF NOT EXISTS session_id uuid
    REFERENCES public.capture_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS capture_submissions_session_idx
  ON public.capture_submissions (session_id);
