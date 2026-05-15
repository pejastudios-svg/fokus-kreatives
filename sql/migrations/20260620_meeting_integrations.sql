-- =============================================================================
-- Meeting integrations: foundation
--
-- Adds the schema needed to wire Calendly, Google Meet, and Zoom into
-- the capture-page meeting flow. After this migration:
--
--   - `user_integrations`     stores per-(user, client, provider) credentials.
--   - `meetings`              gains columns to record which integration
--                             created the meeting + the provider's external
--                             event id + the invitee's contact info.
--   - `capture_pages`         gains `meeting_integration` so each page can
--                             pick which provider visitors see.
--
-- All additions are nullable / default off so EXISTING capture pages and
-- meetings render identically post-migration.
-- =============================================================================

-- ---------------------------------------------------------------------
-- 1. user_integrations: per-CRM provider connection
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.integration_provider AS ENUM ('calendly', 'google_meet', 'zoom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which CRM (client_id) this connection belongs to. A user can
  -- connect Calendly once per CRM they manage; that's why we key on
  -- (client_id, provider) instead of just user_id.
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider public.integration_provider NOT NULL,

  -- Credentials. For Calendly: access_token = the user's Personal
  -- Access Token (long-lived). For Google + Zoom OAuth: access_token
  -- is short-lived and refresh_token is what we use to renew it.
  access_token text,
  refresh_token text,
  scope text,
  expires_at timestamptz,

  -- Connection state. `connected` = ready to use. `error` = a previous
  -- API call failed (token revoked, scope expired) - the UI surfaces
  -- this so the user knows to reconnect.
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'error', 'disconnected')),
  last_error text,

  -- Provider-specific metadata. Calendly: webhook signing key,
  -- subscription_id, scheduling_url. Google: calendar_id, email.
  -- Zoom: account_id, user_id. Anything else we discover later.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One active connection per (client, provider). Reconnecting
  -- updates the existing row rather than creating duplicates.
  UNIQUE (client_id, provider)
);

CREATE INDEX IF NOT EXISTS user_integrations_client_idx
  ON public.user_integrations (client_id);

CREATE INDEX IF NOT EXISTS user_integrations_user_idx
  ON public.user_integrations (user_id);

DROP TRIGGER IF EXISTS user_integrations_set_updated_at ON public.user_integrations;
CREATE TRIGGER user_integrations_set_updated_at
  BEFORE UPDATE ON public.user_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

-- Service-role-only. Connections are always managed through API routes
-- that authenticate via createServerClient + verify the caller owns the
-- client_id, so the table itself stays locked down.
DROP POLICY IF EXISTS "user_integrations_service_role" ON public.user_integrations;
CREATE POLICY "user_integrations_service_role"
  ON public.user_integrations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 2. meetings: integration-aware columns
-- ---------------------------------------------------------------------
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS integration_provider public.integration_provider,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS attendee_name text,
  ADD COLUMN IF NOT EXISTS attendee_email text,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

-- Unique on (provider, external_id) prevents the same integration
-- event from being inserted twice if a webhook re-fires. Partial index
-- so legacy meetings without an external_id aren't constrained.
CREATE UNIQUE INDEX IF NOT EXISTS meetings_integration_external_unique
  ON public.meetings (integration_provider, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS meetings_lead_idx
  ON public.meetings (lead_id) WHERE lead_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. capture_pages: which integration this page offers visitors
-- ---------------------------------------------------------------------
ALTER TABLE public.capture_pages
  ADD COLUMN IF NOT EXISTS meeting_integration public.integration_provider;

-- Existing pages with include_meeting=true keep their current
-- behaviour (manual date/time inputs) because meeting_integration
-- is null. Set this when the user picks an integration in the editor.
