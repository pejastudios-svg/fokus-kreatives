-- =============================================================================
-- Public review links — Option B (token + email-gated OTP)
--
-- What this adds:
--   • approvals.share_token  — random uuid that goes in the public URL
--     ( /review/<token> ). Existing rows are backfilled.
--   • review_sessions table   — short-lived OTP + session storage so we know
--     which email is currently allowed to view + act on which approval.
--
-- All writes from the public page go through service-role server routes that
-- look up + validate against this table; the table itself is not directly
-- exposed to the anon role.
-- =============================================================================

-- 1. share_token on approvals -------------------------------------------------

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS share_token uuid UNIQUE DEFAULT gen_random_uuid();

-- Backfill any rows that existed before the column.
UPDATE public.approvals
   SET share_token = gen_random_uuid()
 WHERE share_token IS NULL;

-- After backfill we want it NOT NULL. Catch any pre-existing rows still null
-- (shouldn't happen after the UPDATE above, but be defensive).
ALTER TABLE public.approvals
  ALTER COLUMN share_token SET NOT NULL;

CREATE INDEX IF NOT EXISTS approvals_share_token_idx
  ON public.approvals(share_token);

-- 2. review_sessions ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.review_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES public.approvals(id) ON DELETE CASCADE,
  email text NOT NULL,
  -- OTP we send to the email. Plain (10-min TTL); we never expose this to the
  -- client beyond the email body.
  otp_code text,
  otp_expires_at timestamptz,
  otp_attempts int NOT NULL DEFAULT 0,
  -- After verify, we generate this opaque token and set it as a cookie.
  session_token text UNIQUE,
  session_expires_at timestamptz,
  verified_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_sessions_session_token_idx
  ON public.review_sessions(session_token);

CREATE INDEX IF NOT EXISTS review_sessions_approval_email_idx
  ON public.review_sessions(approval_id, email);

-- The table is only ever touched via service-role server routes — RLS denies
-- direct access to the anon and authenticated roles by default.
ALTER TABLE public.review_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_sessions_no_direct ON public.review_sessions;
CREATE POLICY review_sessions_no_direct ON public.review_sessions
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- =============================================================================
-- Done.
-- =============================================================================
