-- Agreements: encrypt the body at rest when an access password is set.
--
-- body_encryption holds the envelope: the body is encrypted with a random
-- per-document key (DEK); the DEK is wrapped both under a key derived from
-- the password (so password-holders can read it) and under the server master
-- key (so the agency owner can recover if the password is lost). When set,
-- body_html is blanked - the plaintext no longer lives in the row, so a raw
-- DB leak reveals nothing without the password or the server key.

alter table agreements add column if not exists body_encryption jsonb;
alter table agreement_templates add column if not exists body_encryption jsonb;
