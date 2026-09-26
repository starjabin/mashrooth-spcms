-- Review and run in STAGING first. Unassigned legacy rows remain quarantined.
-- Applied by the database owner; application traffic must never use service_role.
BEGIN;
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_memberships (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  role text NOT NULL CHECK(role IN ('viewer','manager','admin','superadmin')),
  display_name text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT 'General', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
-- These two functions intentionally run as the migration owner to avoid
-- recursive membership RLS. They expose only the caller's own membership.
CREATE FUNCTION public.current_organization_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
$$;
CREATE FUNCTION public.current_member_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM public.organization_memberships WHERE user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.current_organization_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_member_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_organization_id(), public.current_member_role() TO authenticated;
REVOKE ALL ON public.organizations, public.organization_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organizations, public.organization_memberships TO authenticated;
CREATE POLICY organization_read ON public.organizations FOR SELECT TO authenticated
  USING (id = (SELECT public.current_organization_id()));
CREATE POLICY membership_read ON public.organization_memberships FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR
    (organization_id = (SELECT public.current_organization_id()) AND
     (SELECT public.current_member_role()) IN ('admin','superadmin')));

CREATE TABLE public.member_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_id uuid NOT NULL, target_id uuid NOT NULL, old_role text NOT NULL, new_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.member_role_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_role_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_role_audit TO authenticated;
CREATE POLICY role_audit_read ON public.member_role_audit FOR SELECT TO authenticated USING
  (organization_id = (SELECT public.current_organization_id()) AND
   (SELECT public.current_member_role()) IN ('admin','superadmin'));

CREATE FUNCTION public.set_member_role(target_user_id uuid, new_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller public.organization_memberships%ROWTYPE;
  target public.organization_memberships%ROWTYPE;
  roles text[] := ARRAY['viewer','manager','admin','superadmin'];
BEGIN
  IF auth.uid() IS NULL OR target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Role change denied' USING ERRCODE = '42501';
  END IF;
  -- Serialize role changes within the organization, avoiding competing
  -- administrators validating privileges against different snapshots.
  PERFORM pg_advisory_xact_lock(hashtextextended(public.current_organization_id()::text, 0));
  SELECT * INTO caller FROM public.organization_memberships WHERE user_id = auth.uid() FOR UPDATE;
  SELECT * INTO target FROM public.organization_memberships WHERE user_id = target_user_id FOR UPDATE;
  IF caller.user_id IS NULL OR target.user_id IS NULL OR caller.organization_id <> target.organization_id
    OR caller.role NOT IN ('admin','superadmin') OR new_role IS NULL OR NOT(new_role = ANY(roles))
    OR array_position(roles,target.role) >= array_position(roles,caller.role)
    OR array_position(roles,new_role) >= array_position(roles,caller.role) THEN
    RAISE EXCEPTION 'Role change denied' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organization_memberships SET role = new_role WHERE user_id = target_user_id;
  INSERT INTO public.member_role_audit(organization_id,actor_id,target_id,old_role,new_role)
    VALUES(caller.organization_id,caller.user_id,target.user_id,target.role,new_role);
  RETURN jsonb_build_object('id',target_user_id,'role',new_role);
END $$;
REVOKE ALL ON FUNCTION public.set_member_role(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid,text) TO authenticated;

DO $$
DECLARE tbl text; pol record; pk text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['org_data','projects','contracts','grc_risks','lcgpa_records','claims','document_contents'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN organization_id uuid REFERENCES public.organizations(id)', tbl);
    -- NOT VALID preserves existing rows without guessing their tenant. New or
    -- modified rows must have an owner; RLS prevents clients seeing NULL rows.
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (organization_id IS NOT NULL) NOT VALID', tbl, tbl || '_owner_required');
    -- Existing IDs are reused by the compiled frontend (e.g. PRJ-2025-007).
    -- Scope their uniqueness by organization instead of sharing a global ID.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN row_id uuid NOT NULL DEFAULT gen_random_uuid()', tbl);
    SELECT conname INTO pk FROM pg_constraint WHERE conrelid = format('public.%I',tbl)::regclass AND contype = 'p';
    IF pk IS NOT NULL THEN EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',tbl,pk); END IF;
    EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (row_id)',tbl);
    EXECUTE format('ALTER TABLE public.%I ADD UNIQUE (organization_id,id)',tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    -- PostgreSQL ORs permissive policies, so all old broad policies must go.
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=tbl LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',pol.policyname,tbl);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',tbl);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',tbl);
    EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING (organization_id=(SELECT public.current_organization_id()))',tbl);
    EXECUTE format('CREATE POLICY tenant_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (organization_id=(SELECT public.current_organization_id()) AND (SELECT public.current_member_role()) IN (''manager'',''admin'',''superadmin''))',tbl);
    EXECUTE format('CREATE POLICY tenant_update ON public.%I FOR UPDATE TO authenticated USING (organization_id=(SELECT public.current_organization_id()) AND (SELECT public.current_member_role()) IN (''manager'',''admin'',''superadmin'')) WITH CHECK (organization_id=(SELECT public.current_organization_id()) AND (SELECT public.current_member_role()) IN (''manager'',''admin'',''superadmin''))',tbl);
    EXECUTE format('CREATE POLICY tenant_delete ON public.%I FOR DELETE TO authenticated USING (organization_id=(SELECT public.current_organization_id()) AND (SELECT public.current_member_role()) IN (''manager'',''admin'',''superadmin''))',tbl);
  END LOOP;
END $$;
COMMIT;
