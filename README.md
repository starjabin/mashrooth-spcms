# Mashrooth SPCMS

A bilingual project and contract workspace using a maintainable browser-module frontend, Vercel Node functions and Supabase Auth/PostgreSQL.

**Release status: tested locally; live acceptance and production release are pending.** The tested code is an administrator-provisioned pilot, not a complete commercial/government integration product. See [the launch plan](docs/LAUNCH-PLAN.md).

## What works in this release

- Organization-scoped projects, contracts, risks, claims, local content records, obligations and procurement registers.
- Paginated reads; individually validated, version-checked writes; transactions and database audit.
- HttpOnly sessions with refresh and logout; administrator-managed roles; read-only viewer access.
- Bilingual English/Arabic interface, RTL layout, page exports and empty states using actual database values.
- PDF/DOCX/TXT extraction in a time/memory-limited worker, up to 3 MB and 100 PDF pages. Only extracted text is stored, not original files.
- Optional AI analysis with explicit data-processing enablement and daily tenant quotas. Disabled by default.
- Readiness endpoint, deployment verification command and GitHub Actions checks.

Self-service signup/invitations/recovery screens, payment subscriptions, email reminders, original-file storage/scanning/OCR, SSO/MFA UI and government API integrations are **not implemented**. Supabase operators must manage account invitations/recovery/offboarding. No compliance or Saudi residency certification is implied.

## Windows PowerShell / VS Code

Use Node 22.9+ or 24 and npm. From the repository folder:

```powershell
npm ci
Copy-Item .env.example .env.local
```

Edit `.env.local` with the **staging** Supabase URL and public project key. Apply the reviewed database schema/migrations and provision a verified user and organization before testing login. Never put passwords or secret service-role keys in Git.

```powershell
npm run dev
```

Open `http://localhost:3000`. Without database configuration the sign-in page appears and health correctly reports unavailable.

## Validation

```powershell
npm run check
npm test
npm run build
npm run verify:deployment -- https://YOUR-DEPLOYMENT-HOST
```

The last command checks DNS, HTTP/TLS, assets, readiness and anonymous denial. It does not certify login, cross-tenant live behavior, billing, AI residency, backup restore or regulatory compliance. `TEST_ACCESS_TOKEN` can optionally enable an authenticated read without printing the token.

## Deployment

1. Confirm the target Supabase/Vercel projects and actual regions. Rehearse database backup and restore before modifying an existing database.
2. In a fresh staging database, apply `supabase/schema.sql`, then **all** `supabase/migrations/*.sql` in filename order. On an existing database inspect which migrations/columns/policies already exist; do not replay blindly.
3. Provision verified Supabase identities, organizations and memberships as in `docs/STAGING-DEPLOYMENT.md`. Legacy unassigned records are hidden until their ownership is reviewed. Never infer roles from editable user metadata.
4. Deploy the reviewed branch to a Vercel preview with separate staging environment variables. The project uses `npm run build` and `dist` output; API functions live under `api`.
5. Run live acceptance for two organizations and multiple roles, session renewal, stale writes, parsing, AI failure behavior and mobile/Arabic screens. Complete the gates in the launch plan before promoting production.
6. Attach `mashrooth.com` only after confirming ownership and the verified deployment. Apply the DNS values returned by Vercel. DNS is not configured by pushing to GitHub.

## Source layout

`web/index.html` is the public pilot page; `/app` serves `web/app.html` and `web/app.js`. `lib/` holds parser-worker code. `api/` contains authenticated functions. The legacy root pages and compiled dashboard assets were removed because they carried unsupported claims and could be deployed accidentally.

The separate PocketBase and Python copies from earlier work are not this GitHub application's architecture. This release preserves the existing Supabase data model rather than silently deploying a different database.
