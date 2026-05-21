-- =============================================================================
-- Slot generation lock RPCs.
--
-- The original implementation acquired the lock client-side by calling
-- supabase-js .update().eq().or() with an OR filter that referenced the
-- lock column with a literal ISO timestamp. That filter shape hit a
-- PostgREST parser edge case (timestamps contain dots, which collide with
-- the .column.op.value separator) and produced a "column does not exist"
-- error even though the column was present and other queries against it
-- worked fine.
--
-- These two functions move the atomic check-and-set into the database so
-- the client only needs a one-shot rpc() call. No filter chains, no
-- timestamp-in-URL parsing.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.acquire_slot_generation_lock(
  p_slot_id uuid,
  p_token text,
  p_stale_ttl interval DEFAULT interval '3 minutes'
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_acquired_id uuid;
BEGIN
  UPDATE public.content_plan_slots
     SET generation_lock_at    = NOW(),
         generation_lock_token = p_token
   WHERE id = p_slot_id
     AND (generation_lock_at IS NULL
          OR generation_lock_at < NOW() - p_stale_ttl)
  RETURNING id INTO v_acquired_id;

  RETURN v_acquired_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_slot_generation_lock(
  p_slot_id uuid,
  p_token text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.content_plan_slots
     SET generation_lock_at    = NULL,
         generation_lock_token = NULL
   WHERE id = p_slot_id
     AND generation_lock_token = p_token;
END;
$$;

-- =============================================================================
-- Done.
-- =============================================================================
