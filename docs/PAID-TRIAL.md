# Mashrooth paid trial

Built on the maintained `codex/tenant-security-foundation` release, not the legacy compiled main app. The existing app is static HTML + Vercel Node APIs; a Next.js rewrite is unnecessary for billing.

## Deploy in order

1. Apply the foundation migrations, then `20261001162012_paid_trial.sql` to the organization's staging database. Do not apply this organization schema to the old `tenants` production project.
2. Set the Supabase public key/URL, server-only service-role key, test Stripe secret, Growth and Enterprise recurring price IDs, `NEXT_PUBLIC_SITE_URL`, and `APP_ALLOWED_ORIGINS`. Enable Supabase email confirmation and allow the site's sign-in redirect. All secrets stay on the server.
3. Configure Stripe Customer Portal for payment-method updates, plan changes limited to these two products, and cancellation at period end. Avoid immediate cancellation unless intended.
4. Register `/api/billing/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`. Use the matching endpoint secret. REST calls deliberately pin Stripe API version `2024-06-20`; validate the selected endpoint version and fixtures before changing it.
5. Deploy this branch. `/trial` creates an Auth signup, email verification is required, and first verified login creates an organization, an admin membership and one 14-day trial. `/billing` is available even without entitlement. Existing staging organizations receive one initial trial; no row is reset.
6. Complete acceptance checks below before enabling real payments.

## Invariant

The database trigger initializes the fixed Growth trial. Only the signature-verified Stripe webhook calls the service-only `apply_billing_event` RPC to change status, plan, price, customer or subscription. Checkout, portal, success URL, browser state, signup metadata and purchase inquiries cannot grant paid access.

Entitlement: trialing before trial expiry OR active before synchronized period end. Past-due blocks protected use, while billing and portal stay accessible. Payment recovery re-synchronizes the subscription. Cancel-at-period-end keeps Stripe status active until its final deletion/cancellation event; immediate canceled state blocks immediately.

RLS is restrictive on business data. SECURITY DEFINER mutation/quota functions are private behind entitlement-checking wrappers. Membership/role checks remain enforced. Expired accounts retain no direct API/data bypass.

The webhook validates HMAC with Stripe's raw body, five-minute timestamp tolerance and constant-time comparison. It retrieves the current Stripe subscription on each event, validates workspace metadata and price allowlists, then atomically locks the billing row, deduplicates by event ID and rejects stale event ordering. Persistence errors return 500 for Stripe retries. The first subscription binding is serialized; conflicting parallel subscriptions require operator remediation.

## Acceptance checks

- Sign up, confirm email, sign in: fixed Growth trial and 14 days remaining.
- Repeated login does not reset trial or create another organization.
- Set trial expiry in the past: UI redirects to billing; records API returns 402; direct data SELECT gives no records; mutation/quota RPCs deny access.
- Test Checkout: do not unlock before webhook. After webhook, status and plan match Stripe and paid period is stored.
- Replay event and older events: state never regresses; failed writes retry.
- Other organization members cannot read billing or start Checkout/Portal for a workspace outside their membership. Only admin/superadmin can manage billing.
- Checkout metadata mismatch, unknown price and invalid/expired signature fail.
- Portal payment update, upgrade/downgrade, period-end cancellation, immediate cancellation, failed renewal and recovered payment synchronize access correctly.
- Confirm successful public deployment and Stripe delivery in the target account. Local mocked tests are not evidence that real money collection works.

## Deferred ZATCA

No ZATCA ledger, counter, signing/clearance API or CSID onboarding is wired into this release. `invoice.payment_succeeded` only synchronizes subscription state. Next: verify seller/tax/invoicing requirements, select SDK/provider, onboard sandbox CSID and compliance samples, implement durable invoice jobs with uniqueness per Stripe invoice and serialized ICV/PIH chain, validate cleared XML/QR, then production onboarding. The supplied signing skeleton is intentionally incomplete. This release does not claim Saudi tax-compliant invoice issuance.
