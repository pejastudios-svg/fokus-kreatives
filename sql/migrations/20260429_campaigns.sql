-- =============================================================================
-- Campaigns: a lean ClickUp mirror.
--
-- A campaign is one monthly content bundle for a client (1 long-form +
-- repurposed deliverables, count varies by package_tier). The actual task
-- management lives in ClickUp - this table just records which campaigns
-- the agency has spun up, what they were configured for, and the current
-- status pulled back from ClickUp so we can show a log + filter board in
-- the app without duplicating the management UI.
--
-- Distinct from `public.tasks` (the existing project-management table).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Auto-suggest from history but editable on the create form.
  -- campaign_number cycles 1..N where N = the tier's per-month cap.
  -- month_number bumps when campaign_number rolls back to 1.
  campaign_number integer NOT NULL,
  month_number integer NOT NULL,

  -- Editable display name. Default "Campaign N | Month M".
  name text NOT NULL,

  -- Tier snapshot at creation. A later tier change on the client doesn't
  -- retroactively rewrite the deliverable counts on existing campaigns.
  tier_at_creation text
    CHECK (tier_at_creation IS NULL OR tier_at_creation IN ('top', 'middle', 'lower')),
  expected_long_form integer NOT NULL DEFAULT 1,
  expected_short_form integer NOT NULL DEFAULT 0,
  expected_engagement_reels integer NOT NULL DEFAULT 0,
  expected_carousels integer NOT NULL DEFAULT 0,
  expected_stories integer NOT NULL DEFAULT 0,

  -- Status mirrors the ClickUp board. Synced via the GET endpoint when the
  -- list page renders; never edited from the app directly.
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN (
      'todo',
      'in_progress',
      'ready_for_review',
      'waiting_for_feedback',
      'discontinued',
      'approved',
      'completed'
    )),

  -- ClickUp links. clickup_task_id is the only one we strictly need; the
  -- folder/list IDs are also stamped on the client (clients.clickup_folder_id
  -- / clients.clickup_list_id) so multiple campaigns share them.
  clickup_task_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_client_id_idx
  ON public.campaigns (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS campaigns_status_idx
  ON public.campaigns (status);

DROP TRIGGER IF EXISTS campaigns_set_updated_at ON public.campaigns;
CREATE TRIGGER campaigns_set_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Service role has full access; agency staff query through API routes.
CREATE POLICY "campaigns_service_role_all"
  ON public.campaigns FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Done.
-- =============================================================================
