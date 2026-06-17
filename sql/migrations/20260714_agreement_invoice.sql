-- Phase 2: invoice attached to an agreement ("sign and continue to invoice").
--
-- The invoice is CONFIG on the agreement until every signer has signed -
-- no payment row exists for unsigned deals, so Revenue stays clean. The
-- final signature creates the real payment through the normal invoice
-- shape, billed to the first signer.
--
--   invoice_config: { lineItems: [{description, quantity, unit_price}],
--                     currency, dueDays }
--
-- payments.agreement_id records provenance so the Revenue page and
-- notifications can say which agreement an invoice came from, and the
-- agreement page can reflect the payment's paid state.

alter table agreements
  add column if not exists invoice_config jsonb;

alter table payments
  add column if not exists agreement_id uuid references agreements(id) on delete set null;

create index if not exists payments_agreement_idx on payments (agreement_id);
