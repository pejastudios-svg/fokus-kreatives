# Email Sending at Scale — Amazon SES Relay Plan

**Status:** Decision pending (team review). Not started.
**Owner:** Jedidiah / Fokus Kreativez
**Last updated:** 2026-06-16

---

## Why this exists (the problem)

Right now the CRM sends email two ways:
1. **Client's own Gmail / Google Workspace** via SMTP (nodemailer) — white-label, but capped at ~100–500/day per account by Google.
2. **Shared Apps Script account** (`fokuskreatives@gmail.com`) for internal/agency notifications — also subject to a daily MailApp quota.

As clients' lead lists grow, the Gmail cap throttles campaigns (a Tuesday email finishes arriving days later), and the shared account can hit its quota on routine pings (new lead, meeting logged, etc.).

**Goal:** remove the daily ceiling while keeping the white-label look — every client's email must still send **from and be authenticated as that client's own domain** (SPF/DKIM/DMARC), with replies going to a mailbox the client owns.

---

## The decision to make at the team meeting

Do we move outward sending onto **Amazon SES** (paid, ~single-digit dollars/month) — yes or no?

Context for the decision:
- **"Free + sustainable + white-label multi-tenant" is not achievable.** (Deep research, 2026.) Free tiers are far too small for our scale and self-hosting trades dollars for a deliverability-operations burden we don't want.
- **SES is the recommended path:** cheapest sustainable option, scales hardest, and as of Aug 2025 has native **tenant management** built for exactly this multi-client white-label case.
- **Cost is small but not zero.** Roughly **$2–5/month** at ~20,000 emails/month (10 clients × 2,000). Not the hundreds Mailchimp charges.
- **Blocker:** creating the AWS account requires entering a payment card.

If the team says no, we stay on the current Gmail/Workspace + Apps Script setup, which is fine for smaller lists (the existing per-plan upgrade nudge already tells us when a client outgrows it).

---

## Research verdict (summary)

- No transactional sender has a permanently-free tier big enough: Resend 100/day & 3k/mo, SMTP2GO 1k/mo, SES 3k/mo only for the first 12 months. 10 clients × 2k/mo = 20k/mo blows past all of them.
- **Self-hosting (Postal, etc.)** is real but it's a mail *engine*, not a campaign builder, and it shifts cost to reputation ops (IP warm-up, Gmail Postmaster Tools + Microsoft SNDS, blocklist monitoring, bounce/complaint handling, rDNS). Only worth it at much larger, steady volume — and even then the sane version relays through SES anyway.
- **At our volume, do NOT use dedicated IPs** — a shared pool + each client's authenticated domain is actually safer (dedicated IPs need constant high volume to stay warm).
- SES tenant isolation **reduces but does not fully erase** shared-account reputation risk, so the **bounce/complaint webhook → suppression list** (Half B, step 5) is the piece that actually protects us.
- Honest caveat: domain authentication gets a strong inbox rate, **not** a guarantee against spam — content, list hygiene, and complaint rates still matter.

Alternative if we want least-fuss over lowest-cost: **SMTP2GO Starter** (~$10–20/mo at 20k, unlimited verified domains, simplest to wire). SES is the better long-term/cost pick.

---

## Half A — AWS setup (Fokus Kreativez does this once, ~30 min + ~1 day approval)

1. Create/sign in to an AWS account (card required). Go to **SES** and pick one region — use `us-east-1` unless there's a reason not to. Identities are per-region, so commit to one.
2. **Verify the agency domain first** (`fokuskreatives.space`) as identity #1: SES → Identities → Create identity → Domain → enable **Easy DKIM**. Add the **3 CNAME records** SES gives you at the registrar. Also add a **DMARC** TXT record and a **custom MAIL FROM** subdomain (e.g. `mail.fokuskreatives.space`) for SPF alignment. Doubles as the test domain.
3. **Request production access:** SES → Account dashboard → Request production access. The form asks how we handle bounces/complaints/unsubscribes — we already have a **suppression list + one-click unsubscribe**, so state that. ~24h approval.
4. **Create a Configuration Set** with an event destination (SNS topic) for **bounces + complaints** — feeds bad addresses back into the suppression list.
5. **Create an IAM user** (programmatic access) with a least-privilege SES policy (send + identity management + tenant management). Copy the **Access Key ID + Secret**.
6. **Provide env vars** to the app: `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` (plus config-set name + an SNS webhook secret once step 4 is done).

---

## Half B — What gets built (the integration)

Build order; first three need no live AWS credentials and can start anytime:

1. **DB migration** — `client_email_domains` table: client_id, domain, DKIM tokens, verification status, tenant name, MAIL FROM, region, reply-to.
2. **SES sender lib** (`@aws-sdk/client-sesv2`, new dependency) — create a client's domain identity (returns DNS records), check verification status, create + associate the SES **tenant**, and `trySesSend()` that renders via the existing email templates and sends as the client's domain with their reply-to + List-Unsubscribe header.
3. **"Send from your own domain" UI** in CRM Settings — client enters their domain, we show the exact DNS records to paste, a **Verify** button polls SES until green, replies route to a mailbox they own.
4. **Outbox routing** — `deliverEmail()` order becomes **SES (if domain verified) → client Gmail SMTP → Apps Script**. Once verified, ALL that client's CRM mail (invoices, meetings, agreements, campaigns) flows through SES and the Gmail cap stops applying. *(Touches `src/lib/emailOutbox.ts`.)*
5. **Bounce/complaint webhook** (`/api/ses/notifications`) — SNS posts bounces/complaints → auto-add to `email_suppressions`. **Critical for reputation.**
6. **Agency internal domain** — verify `fokuskreatives.space` as its own tenant and route internal notifications (new lead, meeting logged, etc.) through it, lifting the Apps Script quota.

**First end-to-end test once keys land:** verify `fokuskreatives.space`, send a real email through SES, confirm a bounce lands in the suppression list. Then flip clients on one at a time.

---

## Rough cost (10 clients × 2,000 emails/mo = 20,000/mo)

| Option | Monthly | Notes |
|---|---|---|
| **Amazon SES** | ~$2–5 | Cheapest sustainable; tenant mgmt; one-time prod-access approval |
| SMTP2GO Starter | ~$10–20 | Simplest to wire; unlimited verified domains |
| Free tiers / self-host | "free" | Caps at ~3k/mo, or becomes a deliverability-ops job. Not viable at scale. |

All pricing is 2025–2026 and changes — re-verify SES tenant per-month charges and current free-tier structure before committing (SES free-tier model changed mid-2025: newer accounts get a $200 credit instead of 3k/mo-for-12-months).

---

## Open questions for the team

- Are we OK with ~$2–5/month (scales with volume) for materially better deliverability and no Gmail cap?
- Who owns the AWS account + billing card?
- Do we want SES (cheapest, slight setup) or SMTP2GO (simplest, a bit pricier)?
- For clients: are they willing to add a few DNS records to their domain? (Required for white-label — same as Mailchimp requires. Clients with a website already have a domain.)
- Reply handling: confirm each client has a mailbox to receive replies (or a forward).

---

## If we proceed

Tell Claude to "start the SES build from the planner doc." Steps B1–B3 can begin immediately (no AWS needed); B4–B6 go live once the env vars from Half A step 6 are in place.
