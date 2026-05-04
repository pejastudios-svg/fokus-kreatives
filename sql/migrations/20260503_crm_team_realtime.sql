-- =============================================================================
-- Realtime: ensure crm_invites + client_memberships are in the
-- supabase_realtime publication so the team page can subscribe to
-- changes and update without a manual refresh.
--
-- Wrapped in DO blocks because ALTER PUBLICATION ... ADD TABLE errors
-- if the table is already in the publication, and we want the migration
-- to be idempotent regardless of the project's starting state.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'crm_invites'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_invites';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'client_memberships'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.client_memberships';
  END IF;
END$$;

-- REPLICA IDENTITY FULL so DELETE / UPDATE events carry the full old row,
-- which the JS client needs to apply filter clauses (we filter by
-- client_id on both subscriptions).
ALTER TABLE public.crm_invites REPLICA IDENTITY FULL;
ALTER TABLE public.client_memberships REPLICA IDENTITY FULL;

-- =============================================================================
-- Done.
-- =============================================================================
