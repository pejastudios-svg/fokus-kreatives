-- =============================================================================
-- Content plan share links: revocable, time-limited tokens that let a
-- client view the planner read-only at /plan/[token]. No email gate, no
-- auth - the link itself is the auth.
--
-- The view-only page hides:
--   * scoring math from generation_meta
--   * "why this format" rationale
--   * cooldown state
--   * any edit affordances
--
-- Tokens are uuids (high entropy) and indexed for O(1) lookup.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.content_plan_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,

  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_plan_share_links_token_idx
  ON public.content_plan_share_links (token);

CREATE INDEX IF NOT EXISTS content_plan_share_links_client_idx
  ON public.content_plan_share_links (client_id, created_at DESC);

ALTER TABLE public.content_plan_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_plan_share_links_service_role_all" ON public.content_plan_share_links;
CREATE POLICY "content_plan_share_links_service_role_all"
  ON public.content_plan_share_links FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Done.
-- =============================================================================
