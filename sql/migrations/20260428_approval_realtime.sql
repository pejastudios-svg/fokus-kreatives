-- =============================================================================
-- Realtime: ensure approval_* tables are part of the supabase_realtime
-- publication so postgres_changes events fire across browsers.
--
-- Wrapped in DO blocks because ALTER PUBLICATION ... ADD TABLE will error if
-- the table is already in the publication, and we want the migration to be
-- idempotent regardless of the project's starting state.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'approval_comments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_comments';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'approval_items'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_items';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'approvals'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.approvals';
  END IF;
END$$;

-- REPLICA IDENTITY FULL lets DELETE / UPDATE events carry the full old row,
-- which the JS client uses to apply RLS filters correctly. (INSERT works
-- without it, but the others can fall through silently.)
ALTER TABLE public.approval_comments REPLICA IDENTITY FULL;
ALTER TABLE public.approval_items REPLICA IDENTITY FULL;
ALTER TABLE public.approvals REPLICA IDENTITY FULL;

-- =============================================================================
-- Done.
-- =============================================================================
