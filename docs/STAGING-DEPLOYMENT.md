> Historical review/procedure from 24 September. For the current release use README.md and docs/LAUNCH-PLAN.md. Apply the additional 20260925000100 migration only after backup and rehearsal.

# Staging deployment and data ownership

This is a procedure for the authorized deployment operator. It has not been executed against a remote project. Do not use the live Supabase database for initial validation.

## Fresh staging project

1. Create a separate Supabase project and a Vercel preview/staging environment. Select cloud regions based on the approved data-flow requirements; do not assume they satisfy Saudi residency.
2. Run `supabase/schema.sql`, then the migrations in chronological filename order. The tenant migration is a one-time migration, not a script to repeatedly run. The local test verifies this order against PostgreSQL/PGlite with a minimal Supabase auth stand-in.
3. Create/verify test identities using Supabase's administrator interface or approved invitation flow. Public registration in this application is intentionally disabled until organization invitations exist. Configure Supabase public signup consistently.
4. Provision organizations and memberships as the database owner. Obtain user IDs from verified identities, not from user-submitted role metadata. Example shape (replace all placeholders; do not execute unchanged):

```sql
BEGIN;
INSERT INTO public.organizations(id,name)
VALUES ('<organization UUID>', '<organization name>');
INSERT INTO public.organization_memberships
  (user_id,organization_id,role,display_name,email)
VALUES ('<verified auth user UUID>', '<organization UUID>', 'superadmin', '<name>', '<email>');
COMMIT;
```

The initial superadmin is scoped to one organization. It can assign admin or lower roles, but cannot promote peers to superadmin, change itself or access other organizations. Additional top-level administrators require a separately controlled provisioning process.

5. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, approved `APP_ALLOWED_ORIGINS` and, only when appropriate, `ANTHROPIC_API_KEY`. Routine API handlers no longer require service-role keys. Do not expose privileged keys in the frontend. Use different secrets and projects for preview and production.
6. Run `npm ci`, `npm run check`, `npm test`, `npm run build`. Vercel uses `vercel.json` and discovers the source `api/` functions; confirm this in an actual staging deployment. The build stages the maintained browser-module source into `dist/`.
7. Validate login with two organizations, viewer/manager/admin roles, sync authorization, same-ID project records, user listing, forbidden role changes, parser limits and provider failure handling. Verify the deployed Supabase RLS separately using actual user tokens. Do not treat UI visibility as the authorization test.

## Existing database migration

- Back up the database and any legacy `org_data` first; rehearse restore.
- Inspect actual constraints and policies against the schema in Git. The migration is transactional and does not CASCADE through unknown dependencies.
- Business rows receive nullable `organization_id` during migration. Existing NULL rows remain in place but are invisible to app users. A NOT VALID check permits existing legacy rows while enforcing ownership on new/modified rows.
- Build an explicit mapping of approved existing record IDs to verified organizations. Preserve old blob contents until all normalized values and ownership are verified. Do not assign every shared record to the first administrator.
- Backfill only reviewed rows as the database owner. Example shape:

```sql
UPDATE public.projects
SET organization_id = '<verified organization UUID>'
WHERE id IN ('<approved project ID>') AND organization_id IS NULL;
```

Repeat with reviewed related contracts/claims/documents and split any multi-organization blob into the appropriate `(organization_id,'main')` records. Confirm source and target counts/content before retirement of legacy data. `CHECK` constraints can be validated after all remaining NULL records are deliberately resolved.

- Old role metadata is untrusted. Provision approved memberships explicitly rather than copying user_metadata roles.
- Deploy the API and matching database changes together under a maintenance or controlled rollout plan. Rollback requires the reviewed database restore/migration plan; reverting only code could restore broad access patterns.

## What must happen before production

Close the blockers in `PRODUCTION-REVIEW.md`, particularly shared browser state, non-atomic sync, missing frontend source and identity lifecycle. Confirm the actual hosting target, domain control, cloud regions, secrets management, backups, operational owner and customer migration plan. No live deployment, data mutation or GitHub push is included in this local branch.
