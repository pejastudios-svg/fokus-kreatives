-- =============================================================================
-- Review-page comments: support anonymous (email-gated) reviewers + file
-- attachments.
--
-- 1. user_id becomes NULLABLE so review-link reviewers (who don't have a
--    `users` row) can post.
-- 2. reviewer_email gives us a clean place to store the reviewer's email
--    instead of mangling it into the body. Existing rows keep null here.
-- 3. attachments is a jsonb array of `{ url, name, size }` so a single
--    comment can carry multiple files.
-- =============================================================================

ALTER TABLE public.approval_comments
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.approval_comments
  ADD COLUMN IF NOT EXISTS reviewer_email text;

ALTER TABLE public.approval_comments
  ADD COLUMN IF NOT EXISTS attachments jsonb;

-- =============================================================================
-- Done.
-- =============================================================================
