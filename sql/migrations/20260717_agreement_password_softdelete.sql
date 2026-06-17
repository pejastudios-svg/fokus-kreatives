-- Agreements: optional access password + soft delete (Recently Deleted).
--
-- access_password_hash: when set, the agreement/template is locked. The
-- public signing page AND the internal CRM view both require the password
-- before showing the body. Stored as a salted scrypt hash, never plaintext.
-- A password set on a template is copied onto agreements created from it.
--
-- deleted_at: soft delete. A deleted agreement disappears from the page and
-- its public link returns "no longer available", but the signature/audit and
-- already-sent emails are untouched (mirrors PandaDoc/DocuSign). Restorable
-- for 30 days, then a cron hard-deletes it.

alter table agreements add column if not exists access_password_hash text;
alter table agreements add column if not exists deleted_at timestamptz;
alter table agreement_templates add column if not exists access_password_hash text;

create index if not exists agreements_deleted_idx
  on agreements (client_id, deleted_at);
