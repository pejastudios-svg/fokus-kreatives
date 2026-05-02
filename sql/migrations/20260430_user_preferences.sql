-- =============================================================================
-- Per-user preferences.
--
-- One row per user covering everything they can toggle in Settings:
--   - theme           : light / dark
--   - nav_mode        : fixed (always visible) / hover (slide down on hover)
--   - notify_new_lead, notify_new_meeting, notify_payment_reminder : the
--     CRM-side notification toggles. Default ON; flipping off suppresses
--     both the in-app popup and the email (wired in Phase D).
--
-- One row per user means we can lookup with a single PK fetch on first
-- render and avoid client-side preference proliferation in localStorage.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,

  theme text NOT NULL DEFAULT 'dark'
    CHECK (theme IN ('light', 'dark')),

  nav_mode text NOT NULL DEFAULT 'fixed'
    CHECK (nav_mode IN ('fixed', 'hover')),

  notify_new_lead boolean NOT NULL DEFAULT true,
  notify_new_meeting boolean NOT NULL DEFAULT true,
  notify_payment_reminder boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS user_preferences_set_updated_at ON public.user_preferences;
CREATE TRIGGER user_preferences_set_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read + write their own row.
CREATE POLICY "user_preferences_self_select"
  ON public.user_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_preferences_self_insert"
  ON public.user_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_preferences_self_update"
  ON public.user_preferences FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role bypass (server routes that read/write on behalf of a user).
CREATE POLICY "user_preferences_service_role_all"
  ON public.user_preferences FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Done.
-- =============================================================================
