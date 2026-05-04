-- =============================================================================
-- CRM team invites
--
-- One row per pending CRM team invitation. Lives separately from the
-- global public.users table so:
--   1. We don't pollute users with placeholder rows that pop back when
--      a membership is recreated.
--   2. We can carry per-invite state (expiry, role, who invited).
--   3. Cancelling a pending invite is an actual delete with no side-
--      effects on the global user table.
--
-- The flow:
--   - Admin/manager invites someone -> row inserted here, email fires.
--   - Invitee opens /invite/[token] -> reads this row, sets password.
--   - On accept: the API provisions the auth user, ensures the matching
--     public.users row, inserts client_memberships(role=this.role), then
--     stamps accepted_at on the invite (kept for audit, never re-used).
--   - Resend regenerates the token + bumps expires_at.
--
-- Writes are gated through API routes that use the service role key,
-- so RLS here only needs to allow service role and (optionally) the
-- authenticated agency admin to read for debugging.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.crm_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  email text NOT NULL,
  name text,

  role text NOT NULL DEFAULT 'manager'
    CHECK (role IN ('admin', 'manager', 'employee')),

  -- Random URL-safe token. Encoded as hex of 24 random bytes (= 48 chars).
  token text NOT NULL UNIQUE
    DEFAULT encode(gen_random_bytes(24), 'hex'),

  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Defaults to 7 days; resend extends it by another 7 from now.
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),

  -- Stamped when the invitee successfully activates. We keep the row
  -- for audit so the team page can show "joined on X via invite".
  accepted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One pending invite per (client, email). Re-inviting the same email
  -- updates the existing row instead of creating duplicates.
  UNIQUE (client_id, email)
);

CREATE INDEX IF NOT EXISTS crm_invites_token_idx
  ON public.crm_invites(token);
CREATE INDEX IF NOT EXISTS crm_invites_client_idx
  ON public.crm_invites(client_id);
CREATE INDEX IF NOT EXISTS crm_invites_pending_idx
  ON public.crm_invites(client_id, accepted_at)
  WHERE accepted_at IS NULL;

DROP TRIGGER IF EXISTS crm_invites_set_updated_at ON public.crm_invites;
CREATE TRIGGER crm_invites_set_updated_at
  BEFORE UPDATE ON public.crm_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.crm_invites ENABLE ROW LEVEL SECURITY;

-- Service role bypass. ALL reads + writes go through the API routes
-- in src/app/api/crm/team/* and src/app/api/invite/* using the service
-- role key. We deliberately do NOT add an anon/authenticated SELECT
-- policy: that would let anyone enumerate every pending invite and
-- harvest the activation tokens. The activation page does its lookup
-- via /api/invite/lookup, which is server-side and authorized.
CREATE POLICY "crm_invites_service_role_all"
  ON public.crm_invites FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Done.
-- =============================================================================
