-- Supabase may grant EXECUTE to anon explicitly by default, in addition to PUBLIC.
-- These helpers must be callable only after authentication; authenticated
-- SECURITY DEFINER entrypoints keep their own membership and role checks.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.current_organization_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_member_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_member_role(uuid,text) FROM anon;

CREATE INDEX organization_memberships_org_lookup
  ON public.organization_memberships(organization_id,user_id);
CREATE INDEX member_role_audit_org_recent
  ON public.member_role_audit(organization_id,created_at DESC);
COMMIT;
