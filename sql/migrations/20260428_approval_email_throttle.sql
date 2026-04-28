-- =============================================================================
-- Email throttling for approval comments.
--
-- We always emit in-app notifications for new comments, but emails are
-- throttled per approval to avoid spamming the agency (or the client) when
-- someone fires off a burst of messages. The route consults
-- last_comment_email_at + cooldown before sending; if we send, we update it.
-- =============================================================================

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS last_comment_email_at timestamptz;

-- Index optional — small column, only read by the comment route per-approval.

-- =============================================================================
-- Done.
-- =============================================================================
