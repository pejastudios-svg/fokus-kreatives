-- Email branding (white-label option 1): outward-facing emails for a client
-- (invoice, meeting confirmations/reschedules) are still sent by the agency
-- Apps Script account, but display the client's name as the sender and set
-- Reply-To to the client's email so replies go straight to them.
--
-- Empty/null values fall back to clients.business_name / no reply-to.

alter table clients
  add column if not exists email_from_name text,
  add column if not exists email_reply_to text;
