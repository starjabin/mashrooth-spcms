> Historical review/procedure from 24 September. For the current release use README.md and docs/RELEASE-REVIEW-20260925.md. Apply the additional 20260925000100 migration only after backup and rehearsal.

# Repository production review — 24 September 2026

Reviewed starting commit: `c81e1378f36a1f4c4cc08b2dea1ca8f8a74f1d99` on the repository's main branch. This assessment supersedes assumptions drawn from the separate Python pilot. The real project already has Vercel functions, Supabase authentication, normalized database tables and a server-side AI proxy. Retain that investment while correcting the boundaries below.

## Critical findings and changes

| Finding in the original source | Change in this branch | Verification/limit |
|---|---|---|
| `api/sync.js` used a service-role key, unfiltered queries and one shared `org_data/main` blob | Queries use the caller's access token, database membership and organization predicates. Writes override any submitted tenant ID. SQL policies enforce read/write scope and role. | API tests plus actual PostgreSQL policies exercised in PGlite. Live Supabase remains untested. |
| `_auth` consumers and user administration authorized from `user_metadata.role` | A protected `organization_memberships` table is the sole role/tenant authority. User metadata is not trusted for permissions. | A simulated user-editable superadmin role cannot obtain writes or admin access. |
| `api/admin/users.js` listed all authentication users and could modify their metadata across organizations | Member list is tenant filtered; role changes run through a scoped, hierarchy-checked SQL transaction with audit. | Cross-tenant, self and upward role changes fail in SQL tests. Superadmin means organization administrator here, not cross-tenant platform access. |
| `api/ai/analyze.js` accepted a public constant as an alternative credential | Real session and write membership required; bounded text and provider timeout; caller receives sanitized provider failure. | Public proxy key without a session is denied. Old compiled AI request is patched to send its session token. |
| Broad authenticated-user policies; base SQL contained invalid `CREATE POLICY IF NOT EXISTS`; old normalization removed blob keys without copying values | Fresh schema defaults to deny; tenant migration replaces old policies. Historical normalization retains data. | Clean schema + normalization + tenant migration execute in PostgreSQL/PGlite. Already-deleted historical data cannot be recovered by this change. |
| Frontend IDs are reused between organizations | Database row IDs separate physical identity from `(organization_id,id)` uniqueness | Identical project IDs in two organizations remain isolated. |
| Upstream errors were returned as successful empty state; UI showed cloud/role success before confirmation | Read failures surface; role updates and cloud save success wait for server confirmation | API failure test; UI logic inspected but not browser-tested. Full sync atomicity is still missing. |
| DOCX ZIP library had high severity allocation advisories | `adm-zip` pinned to 0.6.1; size/type/base64 and expanded-DOCX checks added | Valid/oversized DOCX tests; see audit result below. This is not malware scanning or parser isolation. |
| Static deploy output pointed at the repository root | Build stages only index/import/dashboard scripts and assets into `dist/` | Local build checked. Hosting deployment still requires validation. |

## Remaining release blockers

1. **Original frontend source and browser isolation.** Only a compiled bundle is present. React state and the import/dashboard tools share `localStorage['mashrooth_crud_v1']`; cloud load merges local and remote data. On a shared browser, account changes can expose or re-upload prior account state. Backend isolation does not fix this. Recover source, bind caches to verified user/organization and clear in-memory state on session changes; preferably remove sensitive offline persistence until explicitly designed.
2. **Sync correctness.** Bulk POST sends multiple independent writes and a read/merge/write blob operation. Partial writes, lost concurrent updates, missing delete semantics and API row limits remain. Replace full-snapshot sync with validated resource operations or an atomic versioned RPC; add pagination and conflict detection. Reference integrity between tenant projects, contracts and document content needs explicit constraints and tests.
3. **Identity lifecycle.** This branch fails closed for unprovisioned users and disables public registration. Production still needs verified invitations, recovery, MFA, session refresh/revocation, organization onboarding, rate limiting and offboarding. The compiled registration flow must be replaced. Do not map old user-editable roles into trusted memberships automatically.
4. **Secure ingestion.** Parsing still occurs synchronously in an API function. Move files to private quarantine storage, malware scanning and bounded background workers with retry/dead-letter handling, file hashes and source versions. Add page-preserving extraction and Arabic OCR. This patch caps decoded uploads at 3 MB to leave space within Vercel's request envelope; larger uploads require direct authenticated object storage [3].
5. **Billing and entitlements.** The bundle derives a subscription display from the user's role. No verified payment/webhook/entitlement lifecycle is implemented. Build plans, seat/storage/AI limits, payment event verification and idempotency, cancellation/export and enterprise billing administration.
6. **Contract control and notifications.** A durable first-class obligation register, validated source citations, reviewer revisions, date rules, scheduler, delivery tracking and escalation are still needed. A UI countdown is not evidence of a delivered notice or alert.
7. **Audit and operations.** Only membership role changes receive new database audit in this branch. General business mutations, source access, notifications and AI actions need server audit with retention. Add monitoring, redacted logs, backups, restore drills, migration/rollback procedures and incident handling.
8. **Data governance and AI.** The AI route sends submitted text to Anthropic. No Saudi data-residency or compliance conclusion can be inferred from the source. Approve actual cloud regions, subprocessors, AI handling, retention/deletion and cross-border data flows before handling confidential contracts or making residency claims.
9. **Frontend product integrity.** Recover source, remove unused demo authentication and fabricated subscription logic, implement real member administration/invitations, align upload limits throughout all screens, and validate Arabic/RTL, accessibility and source rendering. The small compiled-bundle patch here is temporary compatibility work, not a reproducible React build.

## Verification

- Nine Node tests pass: eight API/parser cases and one PostgreSQL/PGlite scenario with multiple SQL assertions.
- The SQL scenario executes the base schema and migrations; checks same-ID records across organizations, quarantined legacy blobs, viewer write denial, forbidden tenant writes, role hierarchy, role-change audit and immediate membership removal.
- JavaScript syntax checks and public-asset build pass.
- Initial production dependency audit found one vulnerable direct package (`adm-zip`); it was upgraded. The final registry audit result is recorded in `DEPENDENCY-AUDIT.json`.
- No live site penetration test, real Supabase integration test, browser rendering, load test, provider AI call, billing test, customer data migration or deployment was performed.

## Release decision and next sequence

**NO-GO for production.** This branch is a tested security foundation for staging. Apply the migration and provision explicit memberships in a separate Supabase project first. Restore original frontend source and fix browser/sync isolation before inviting external pilot customers. Then implement identity lifecycle, ingestion workers, obligations/reminders and commercial controls, followed by restore/security/load checks.

Do not enable Vercel previews against a production Supabase project during this work. The new API intentionally denies all users without approved memberships; existing unassigned rows remain hidden. The migration changes business-table primary keys; unknown live foreign keys may cause a safe transaction failure and require an adapted migration. Never add CASCADE simply to force it through.

## References

- Supabase authorization and user-metadata warning: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase key privileges: https://supabase.com/docs/guides/getting-started/api-keys
- Vercel function payload limits: https://vercel.com/docs/functions/limitations
- ZIP allocation advisories: https://github.com/advisories/GHSA-xcpc-8h2w-3j85 and https://github.com/advisories/GHSA-7q85-xj36-vmfc
