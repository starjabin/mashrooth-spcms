-- Apply after tenant_isolation. Rehearse on a backup/staging database first.
BEGIN;
CREATE TABLE public.obligations (
  row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  project_id text, title text NOT NULL, due_date date NOT NULL, owner text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open', source_reference text NOT NULL, notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE TABLE public.procurement_items (
  row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  project_id text, title text NOT NULL, supplier text NOT NULL DEFAULT '', value numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'planned', due_date date, notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE TABLE public.activity_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_id uuid NOT NULL, action text NOT NULL, collection_name text NOT NULL, record_id text NOT NULL,
  record_version bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.activity_audit TO authenticated;
CREATE POLICY tenant_audit_read ON public.activity_audit FOR SELECT TO authenticated
USING(organization_id = (SELECT public.current_organization_id()) AND (SELECT public.current_member_role()) IN ('admin','superadmin'));

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['projects','contracts','grc_risks','lcgpa_records','claims','document_contents','obligations','procurement_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN version bigint NOT NULL DEFAULT 1',tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    -- All writes now go through one transaction with version and audit controls.
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tbl);
    IF tbl IN ('obligations','procurement_items') THEN
      EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(organization_id=(SELECT public.current_organization_id()))',tbl);
    END IF;
    EXECUTE format('CREATE INDEX %I ON public.%I(organization_id,row_id)',tbl || '_tenant_page',tbl);
  END LOOP;
END $$;
-- Legacy full-state writes are no longer permitted.
REVOKE INSERT, UPDATE, DELETE ON public.org_data FROM authenticated;
ALTER TABLE public.contracts ALTER COLUMN project_id DROP DEFAULT;
ALTER TABLE public.lcgpa_records ALTER COLUMN project_id DROP DEFAULT;
ALTER TABLE public.lcgpa_records ALTER COLUMN project_id DROP NOT NULL;
-- Existing sentinel references are retained untouched; new writes use NULL.

CREATE FUNCTION public.mutate_record(collection_name text, operation text, record_id text,
  expected_version bigint DEFAULT NULL, record_values jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tenant uuid; member_role text; vals jsonb; row_json jsonb; current_row jsonb; cols text; expr text;
  k text; fields text[]; tables text[] := ARRAY['projects','contracts','grc_risks','lcgpa_records','claims','document_contents','obligations','procurement_items'];
  child text; linked boolean; quota_count bigint;
BEGIN
  -- Serialize tenant changes, including role changes, to make authorization and
  -- relationship checks apply to the same transaction as the mutation.
  tenant := public.current_organization_id();
  IF tenant IS NULL THEN RAISE EXCEPTION 'Membership required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
  SELECT organization_id,role INTO tenant,member_role FROM public.organization_memberships WHERE user_id=auth.uid() FOR SHARE;
  IF tenant IS NULL OR member_role NOT IN ('manager','admin','superadmin') THEN
    RAISE EXCEPTION 'Write permission required' USING ERRCODE='42501';
  END IF;
  IF collection_name IS NULL OR NOT(collection_name = ANY(tables)) OR operation IS NULL OR operation NOT IN ('create','update','delete')
    OR record_id IS NULL OR record_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$' OR record_values IS NULL OR jsonb_typeof(record_values)<>'object'
    OR octet_length(record_values::text)>1000000 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
  fields := CASE collection_name
    WHEN 'projects' THEN ARRAY['name','status','budget','client','contractor','location','start_date','end_date','completion_pct','local_content_target','description']
    WHEN 'contracts' THEN ARRAY['title','project_id','type','status','value','signed_date','expiry_date','retention_pct','notes']
    WHEN 'grc_risks' THEN ARRAY['title','project_id','category','likelihood','impact','status','owner','regulation','due_date','mitigation']
    WHEN 'claims' THEN ARRAY['title','project_id','type','amount','status','submitted_date','clauze','claimant','days_requested','description']
    WHEN 'lcgpa_records' THEN ARRAY['item_name','project_id','category','total_value','local_value','supplier','period','certificate','notes']
    WHEN 'document_contents' THEN ARRAY['content']
    WHEN 'obligations' THEN ARRAY['title','project_id','due_date','owner','status','source_reference','notes']
    WHEN 'procurement_items' THEN ARRAY['title','project_id','supplier','value','status','due_date','notes'] END;
  FOR k IN SELECT jsonb_object_keys(record_values) LOOP
    IF NOT(k=ANY(fields)) THEN RAISE EXCEPTION 'Invalid field' USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT count(*) INTO quota_count FROM public.activity_audit WHERE organization_id=tenant AND actor_id=auth.uid() AND created_at > now()-interval '1 minute';
  IF quota_count>=120 THEN RAISE EXCEPTION 'Request limit reached' USING ERRCODE='PT429'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE organization_id=$1 AND id=$2 FOR UPDATE',collection_name) INTO current_row USING tenant,record_id;
  IF operation='create' THEN
    IF current_row IS NOT NULL THEN RAISE EXCEPTION 'Record exists' USING ERRCODE='PT409'; END IF;
  ELSE
    IF current_row IS NULL THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='PT404'; END IF;
    IF expected_version IS NULL OR expected_version<>(current_row->>'version')::bigint THEN RAISE EXCEPTION 'Record changed' USING ERRCODE='PT409'; END IF;
  END IF;
  IF operation='delete' THEN
    IF collection_name='projects' THEN
      FOREACH child IN ARRAY ARRAY['contracts','grc_risks','lcgpa_records','claims','obligations','procurement_items'] LOOP
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE organization_id=$1 AND project_id=$2)',child) INTO linked USING tenant,record_id;
        IF linked THEN RAISE EXCEPTION 'Project has linked records' USING ERRCODE='23503'; END IF;
      END LOOP;
    END IF;
    EXECUTE format('DELETE FROM public.%I WHERE organization_id=$1 AND id=$2',collection_name) USING tenant,record_id;
    row_json := current_row;
  ELSE
    vals := coalesce(current_row,'{}'::jsonb) || record_values;
    IF nullif(vals->>'project_id','') IS NOT NULL AND vals->>'project_id'<>'__unlinked' AND
      NOT EXISTS(SELECT 1 FROM public.projects WHERE organization_id=tenant AND id=vals->>'project_id') THEN
      RAISE EXCEPTION 'Project not found in organization' USING ERRCODE='23503';
    END IF;
    IF coalesce(vals->>'name',vals->>'title',vals->>'item_name',CASE WHEN collection_name='document_contents' THEN vals->>'content' END,'') ~ '^\s*$' THEN
      RAISE EXCEPTION 'Name or content is required' USING ERRCODE='23514';
    END IF;
    FOREACH k IN ARRAY ARRAY['budget','value','amount','total_value','local_value','days_requested'] LOOP
      IF vals ? k AND ((vals->>k)::numeric < 0 OR (vals->>k)::numeric > 1e14) THEN RAISE EXCEPTION 'Invalid amount' USING ERRCODE='23514'; END IF;
    END LOOP;
    FOREACH k IN ARRAY ARRAY['completion_pct','local_content_target','retention_pct'] LOOP
      IF vals ? k AND ((vals->>k)::numeric < 0 OR (vals->>k)::numeric > 100) THEN RAISE EXCEPTION 'Invalid percentage' USING ERRCODE='23514'; END IF;
    END LOOP;
    IF collection_name='grc_risks' THEN
      IF coalesce((vals->>'likelihood')::int,1) NOT BETWEEN 1 AND 5 OR coalesce((vals->>'impact')::int,1) NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Invalid score' USING ERRCODE='23514'; END IF;
      record_values := record_values || jsonb_build_object('risk_score',coalesce((vals->>'likelihood')::int,1)*coalesce((vals->>'impact')::int,1));
    END IF;
    IF collection_name='lcgpa_records' THEN
      IF coalesce((vals->>'local_value')::numeric,0)>coalesce((vals->>'total_value')::numeric,0) THEN RAISE EXCEPTION 'Local exceeds total' USING ERRCODE='23514'; END IF;
      record_values := record_values || jsonb_build_object('local_content_pct',CASE WHEN coalesce((vals->>'total_value')::numeric,0)>0 THEN round(coalesce((vals->>'local_value')::numeric,0)*100/(vals->>'total_value')::numeric,2) ELSE 0 END);
    END IF;
    vals := record_values || jsonb_build_object('id',record_id,'organization_id',tenant,'updated_at',now(),'version',coalesce((current_row->>'version')::bigint,0)+1);
    SELECT string_agg(format('%I',key),',' ORDER BY key), string_agg(format('r.%I',key),',' ORDER BY key)
      INTO cols,expr FROM jsonb_object_keys(vals) AS key;
    IF operation='create' THEN
      EXECUTE format('INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM jsonb_populate_record(NULL::public.%1$I,$1) r RETURNING to_jsonb(%1$I.*)',collection_name,cols,expr) INTO row_json USING vals;
    ELSE
      EXECUTE format('UPDATE public.%1$I SET (%2$s)=(SELECT %3$s FROM jsonb_populate_record(NULL::public.%1$I,$1) r) WHERE organization_id=$2 AND id=$3 RETURNING to_jsonb(%1$I.*)',collection_name,cols,expr) INTO row_json USING vals,tenant,record_id;
    END IF;
  END IF;
  INSERT INTO public.activity_audit(organization_id,actor_id,action,collection_name,record_id,record_version)
    VALUES(tenant,auth.uid(),operation,collection_name,record_id,(row_json->>'version')::bigint);
  RETURN row_json - 'organization_id';
END $$;
REVOKE ALL ON FUNCTION public.mutate_record(text,text,text,bigint,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutate_record(text,text,text,bigint,jsonb) TO authenticated;

CREATE INDEX activity_audit_rate ON public.activity_audit(organization_id,actor_id,created_at DESC);
CREATE FUNCTION public.workspace_summary() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'projects',(SELECT count(*) FROM public.projects),
    'contracts',(SELECT count(*) FROM public.contracts),
    'risks',(SELECT count(*) FROM public.grc_risks WHERE status NOT IN ('closed','mitigated')),
    'claims',(SELECT count(*) FROM public.claims WHERE status NOT IN ('settled','rejected')),
    'contractValue',coalesce((SELECT sum(value) FROM public.contracts),0),
    'localValue',coalesce((SELECT sum(local_value) FROM public.lcgpa_records),0),
    'totalValue',coalesce((SELECT sum(total_value) FROM public.lcgpa_records),0),
    'overdue',(SELECT count(*) FROM public.obligations WHERE due_date<current_date AND status NOT IN ('completed','waived')),
    'upcoming',coalesce((SELECT jsonb_agg(x) FROM (SELECT id,title,due_date,owner,source_reference FROM public.obligations WHERE status NOT IN ('completed','waived') ORDER BY due_date,id LIMIT 8)x),'[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.workspace_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_summary() TO authenticated;
CREATE TABLE public.service_usage (
  organization_id uuid NOT NULL REFERENCES public.organizations(id), service text NOT NULL,
  period date NOT NULL, used integer NOT NULL DEFAULT 0, PRIMARY KEY(organization_id,service,period)
);
ALTER TABLE public.service_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_usage FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.consume_service_quota(service_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid; max_calls integer; n integer;
BEGIN
  tenant := public.current_organization_id();
  IF tenant IS NULL OR public.current_member_role() NOT IN ('manager','admin','superadmin') THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  max_calls := CASE service_name WHEN 'ai' THEN 100 WHEN 'parse' THEN 200 ELSE 0 END;
  IF max_calls=0 THEN RAISE EXCEPTION 'Unknown service' USING ERRCODE='22023'; END IF;
  INSERT INTO public.service_usage(organization_id,service,period,used) VALUES(tenant,service_name,current_date,1)
    ON CONFLICT(organization_id,service,period) DO UPDATE SET used=public.service_usage.used+1
    WHERE public.service_usage.used<max_calls RETURNING used INTO n;
  IF n IS NULL THEN RAISE EXCEPTION 'Daily service quota exceeded' USING ERRCODE='PT429'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.consume_service_quota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_service_quota(text) TO authenticated;

CREATE FUNCTION public.deployment_version() RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$ SELECT '20260925000100'::text $$;
REVOKE ALL ON FUNCTION public.deployment_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deployment_version() TO anon, authenticated;
COMMIT;
