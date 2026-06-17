-- Multi-signer agreements: one row per person who must sign. Each signer
-- gets their OWN unguessable token (their personal signing link), so we
-- always know who signed without asking them to identify themselves.
-- The agreement-level public_token stays as a view-only link.
--
-- An agreement flips to status='signed' only when every signer has signed.

create table if not exists agreement_signers (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references agreements(id) on delete cascade,
  email text not null,
  name text,
  token uuid not null default gen_random_uuid(),
  -- Typed-name signature + audit trail (null until they sign).
  signed_at timestamptz,
  signer_name text,
  sign_ip text,
  sign_user_agent text,
  created_at timestamptz not null default now()
);

create unique index if not exists agreement_signers_token_idx
  on agreement_signers (token);
create index if not exists agreement_signers_agreement_idx
  on agreement_signers (agreement_id);

alter table agreement_signers enable row level security;

-- Backfill: every existing non-draft agreement had exactly one recipient -
-- carry them over so old rows render with a signature block. Their already
-- emailed public_token link keeps working as the view link; signing for
-- them moves to the new per-signer token.
insert into agreement_signers (agreement_id, email, name, signed_at, signer_name, sign_ip, sign_user_agent)
select id, recipient_email, recipient_name, signed_at, signer_name, sign_ip, sign_user_agent
from agreements
where recipient_email is not null;
