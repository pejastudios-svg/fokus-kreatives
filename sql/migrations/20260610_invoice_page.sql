-- Invoice page model: replace the .docx with a hosted, token-addressed
-- invoice page, a payment link, and a client "I've paid" signal the CRM
-- confirms.

alter table payments
  -- External payment URL the "Pay now" button redirects to.
  add column if not exists payment_link text,
  -- Public, unguessable token for the invoice page (/invoice/<token>).
  add column if not exists public_token uuid not null default gen_random_uuid(),
  -- Set when the client clicks "I've paid" on the invoice page. The invoice
  -- only becomes status='paid' once a CRM user confirms it.
  add column if not exists client_marked_paid_at timestamptz;

create unique index if not exists payments_public_token_idx on payments(public_token);
