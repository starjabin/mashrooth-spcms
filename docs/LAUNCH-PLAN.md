# Mashrooth launch plan

This is the release checklist for `mashrooth.com`. The present build is a private pilot. A production launch requires each gate below to have an owner, evidence and a rollback procedure. Projected sales are business targets, not a software guarantee.

## 1. Public claims and domain

- Use the new public `web/index.html` and the workspace at `/app`. The legacy root page was removed because it advertised unverified ratings, availability, integrations and legal/compliance results.
- Suspend the existing `mashrooth.fresme.com` page at its actual host or replace its copy. It currently says SCCC/Riyadh residency, self-hosted Qwen, automated bank guarantees and regulator integrations, 14-day free trials and customer outcomes. None are substantiated by this release. Source changes alone cannot change an independently hosted live page.
- Verify control of `mashrooth.com`, existing mail MX/SPF/DKIM/DMARC, and current DNS before modifying records. Attach the apex and optionally `www` to the actual Vercel project, copy the exact DNS records returned by Vercel, confirm HTTPS and a single canonical redirect. Never replace MX records during website cutover.
- Vercel showed `mashrooth.com` available for registration on 26 September 2026 at $11.25 for the first year, renewing at $11.25/year before any tax changes. It is attached to the project but remains unregistered and reports Invalid Configuration. Vercel requests apex A `@` → `216.198.79.1` after ownership is established. Registration and DNS control are still required; the attachment is not a reservation.
- Publish accurate privacy terms, processor/retention details and customer support contacts before accepting public customer data. Review statements about FIDIC, regulators, Saudi data location and financial returns with qualified owners.

## 2. Hosting and capacity

- Proposed application tier: Vercel Pro with Fluid Compute for stateless Node API functions and a global CDN for static assets. Use an owned project with team access, cost alerts, firewall/bot controls, preview deployment protection, logs and a rollback owner. This scales application requests; capacity is not unlimited.
- The public HTML and static assets use Vercel's default static delivery; the API sets `Cache-Control: no-store` on user data. A global `no-store` header was removed so it cannot disable static CDN caching for every visitor.
- The current `vercel.json` pins API compute to `bom1` (Mumbai), near the separate staging database in AWS `ap-south-1`. Verify the effective region in a deployed preview and measure end-to-end latency from Saudi client networks before choosing the production database region. Do not treat an edge/CDN location as evidence of data residency.
- Proposed database tier: a separately owned paid Supabase project with measured compute size, per-query latency, connection usage, indexes and monitored backups. Do not promise an arbitrary requests-per-second figure. Size using p95 and p99 timings, realistic concurrent users, representative tenant data, load tests and cost ceilings. Upgrade compute before saturation; reserve connections for Auth/PostgREST. Heavy OCR/large document pipelines need a separate durable worker and storage design.
- Define acceptance targets with initial customers before sale (suggested starting targets: p95 reads < 800 ms, p95 writes < 1.5 s, error rate < 0.5% at tested peak, with the test region and load recorded). Adjust from measured application and database behavior rather than marketing statements.

## 3. Database and security

- Inspect real schemas, row ownership and migrations; recover the paused database only after confirming its role, backups and exposure. Create separate staging and production projects. Apply the reviewed base schema and migrations to staging first. Backfill each legacy row to a verified organization; test restore before production changes.
- Run Supabase security/performance advisors. Test membership revocation, role boundaries, concurrent writes and isolation for two organizations using real Supabase JWTs, plus RLS access through the Data API. Configure confirmation and recovery email through owned SMTP, MFA policy, session lifetime and abuse protection.
- Review AI data flow and provider terms. AI remains disabled until provider, processing location and customer approval are recorded. Do not feed sensitive contracts to an unapproved external model.

## 4. Commercial SaaS features

- Add a verified organization signup/invitation/offboarding lifecycle with single-tenant bootstrap, limited trials and abuse controls. Existing operator provisioning is suitable only for a controlled pilot.
- The new `/signup` page selects a Team or Enterprise purchase inquiry and records the visitor's contact details only when `PURCHASE_REQUESTS_ENABLED=true` and the isolated `workspace_purchase_requests` migration has been applied. This is an inquiry, not a checkout, subscription, account creation or entitlement. The user approved applying the isolated migration to the existing production database on 26 September; production recorded it as `20260926181229` while staging recorded it as `20260926174434` (the filename in this repository). Reconcile migration histories before automated `db push` against either project; do not run the table-creating migration twice. RLS blocks public reads and updates; anonymous INSERT is limited to the six contact fields. A Vercel firewall rule limits `POST /api/purchase-requests` to three requests per ten minutes per IP. `/purchase-privacy` discloses the request fields and actual processing locations. Public intake stays closed by default until the request owner confirms contact handling, a retention/deletion schedule, and an independently tested backup/restore routine; the current Supabase organization is on the Free plan without managed daily backups.
- Select and contract a payment provider suitable for SAR invoicing and tax handling. Implement hosted checkout, authenticated idempotent webhooks, subscription state/entitlement checks enforced on the server and database, renewal/failure/cancellation flows, invoices and refunds. Do not mark billing active on the basis of a pricing page.
- Add actual storage/scanning/OCR, notification delivery with retries, complete exports/deletion requests, support administration and incident handling. Integrate government and bank APIs only after formal access, documented specifications and test credentials. Avoid simulated actions represented as live integrations.
- Run a customer pilot for Arabic/English, accessibility and mobile usage. Record feedback, support volume and task completion. Publish prices, feature limits and SLAs only after the capabilities and costs have been measured.

## 5. Deployment sequence and evidence

1. Publish the reviewed branch and pass CI. Preserve an immutable commit for every release.
2. Obtain access to the actual Vercel project and domain registrar. Configure staging variables and deploy a protected preview.
3. Migrate a separate staging database and provision users from two organizations. Pass integration, security, browser and representative load tests.
4. Review processor agreements, support terms, incident contacts and privacy copy. Approve measured pricing and entitlement rules.
5. Back up production, apply verified migrations, deploy the tested artifact, attach the owned domain and run `npm run verify:deployment -- https://mashrooth.com` plus authenticated end-to-end checks.
6. Watch error/latency/cost dashboards during a limited pilot. Record a restore rehearsal, rollback conditions and the person responsible before opening public sales.

**Current release state (26 September 2026):** The branch is published in draft PR #1 with passing GitHub and Vercel checks. The redesigned bilingual pilot landing page is served from `patchedapp.vercel.app`; the static page and Arabic/English switch were browser-checked. The Mumbai staging database has all reviewed migrations and its isolated preview passes the deployment verifier with HTTP 200 database readiness. Staging has no provisioned test identities, so authenticated tenant acceptance remains open.

The bilingual purchase inquiry page is available at `/signup`. The production purchase inquiry table has been applied with insert-only public permissions and no existing inquiry records at verification. The new firewall limit is active. Customer submission remains intentionally disabled in Production and Preview until the remaining operational controls are ready; the privacy notice is published with the form, but its final retention schedule is still undecided.

The original Tokyo Supabase project has been resumed and still contains two auth users and two legacy tenants. Its four May migrations and legacy tables do not match the new application's readiness contract. Preserve its data and auth state until a reviewed migration and account plan is approved. The Production API still returns HTTP 503 database unavailable even while the landing page serves successfully. `mashrooth.com` is attached to Vercel but is not registered or DNS verified. The separate `mashrooth.fresme.com` page remains outside this deployment. Paid onboarding, billing, authenticated acceptance, load tests, a production migration and domain cutover remain outstanding.
