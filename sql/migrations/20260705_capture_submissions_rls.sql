-- =============================================================================
-- capture_submissions: RLS policy
--
-- RLS was already enabled on this table but it had no policies, which
-- means the authenticated role was locked out of all reads (service
-- role bypasses RLS so server-side inserts kept working - that's why
-- rows landed in the DB but the Submissions tab showed empty).
--
-- Matches the existing permissive pattern on the leads table:
-- any signed-in user in the workspace can read submissions. Tightening
-- this to per-client membership later is a separate hardening pass.
-- =============================================================================

ALTER TABLE public.capture_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated" ON public.capture_submissions;
CREATE POLICY "Allow all for authenticated"
  ON public.capture_submissions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
