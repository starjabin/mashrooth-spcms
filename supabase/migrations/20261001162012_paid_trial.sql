BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE public.subscriptions (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'trialing' CHECK(status IN ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')),
 plan text NOT NULL DEFAULT 'Growth' CHECK(plan IN ('Growth','Enterprise')),
 trial_ends_at timestamptz NOT NULL DEFAULT (now()+interval '14 days'),
 current_period_end timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
 price_id text, stripe_customer text UNIQUE, stripe_subscription text UNIQUE,
 last_event_created bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
CREATE POLICY subscription_member_read ON public.subscriptions FOR SELECT TO authenticated
 USING(organization_id=(SELECT public.current_organization_id()));
CREATE TABLE private.billing_events(event_id text PRIMARY KEY, organization_id uuid NOT NULL, created bigint NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.billing_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION private.start_trial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.subscriptions(organization_id,status,plan) VALUES(NEW.id,'trialing','Growth');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.start_trial() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER organization_start_trial AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.start_trial();
-- Staging migration gives existing pilot workspaces one trial; never resets an existing row.
INSERT INTO public.subscriptions(organization_id) SELECT id FROM public.organizations ON CONFLICT DO NOTHING;

CREATE FUNCTION public.workspace_entitled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.subscriptions WHERE organization_id=public.current_organization_id() AND
  ((status='trialing' AND now()<trial_ends_at) OR (status='active' AND now()<current_period_end)))
$$;
REVOKE ALL ON FUNCTION public.workspace_entitled() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workspace_entitled() TO authenticated;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['org_data','projects','contracts','grc_risks','lcgpa_records','claims','document_contents','obligations','procurement_items','activity_audit'] LOOP
  EXECUTE format('CREATE POLICY subscription_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT public.workspace_entitled())) WITH CHECK((SELECT public.workspace_entitled()))',tbl);
 END LOOP;
END $$;
-- Existing SECURITY DEFINER write RPCs bypass RLS. Wrap them with entitlement checks.
ALTER FUNCTION public.mutate_record(text,text,text,bigint,jsonb) SET SCHEMA private;
ALTER FUNCTION public.consume_service_quota(text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.mutate_record(text,text,text,bigint,jsonb),private.consume_service_quota(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.mutate_record(collection_name text, operation text, record_id text, expected_version bigint DEFAULT NULL, record_values jsonb DEFAULT '{}') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.current_organization_id() IS NULL THEN RAISE EXCEPTION 'Membership required' USING ERRCODE='42501'; END IF;
 IF NOT public.workspace_entitled() THEN RAISE EXCEPTION 'Subscription required' USING ERRCODE='42501'; END IF;
 RETURN private.mutate_record(collection_name,operation,record_id,expected_version,record_values);
END $$;
CREATE FUNCTION public.consume_service_quota(service_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.current_organization_id() IS NULL THEN RAISE EXCEPTION 'Membership required' USING ERRCODE='42501'; END IF;
 IF NOT public.workspace_entitled() THEN RAISE EXCEPTION 'Subscription required' USING ERRCODE='42501'; END IF;
 PERFORM private.consume_service_quota(service_name);
END $$;
REVOKE ALL ON FUNCTION public.mutate_record(text,text,text,bigint,jsonb),public.consume_service_quota(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mutate_record(text,text,text,bigint,jsonb),public.consume_service_quota(text) TO authenticated;

-- Called only after email confirmation; one workspace per existing membership model.
CREATE FUNCTION public.ensure_trial_workspace(workspace_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Confirmed email required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 SELECT organization_id INTO org FROM public.organization_memberships WHERE user_id=uid;
 IF org IS NOT NULL THEN RETURN org; END IF;
 IF workspace_name IS NULL OR length(trim(workspace_name)) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Workspace name required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.organizations(name) VALUES(trim(workspace_name)) RETURNING id INTO org;
 INSERT INTO public.organization_memberships(user_id,organization_id,role) VALUES(uid,org,'admin');
 RETURN org;
END $$;
REVOKE ALL ON FUNCTION public.ensure_trial_workspace(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ensure_trial_workspace(text) TO authenticated;

-- Atomic, idempotent webhook write. Application routes cannot execute it.
CREATE FUNCTION public.apply_billing_event(event_id text,event_created bigint,workspace uuid,snapshot jsonb) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.subscriptions;
BEGIN
 IF event_id IS NULL OR event_created IS NULL OR snapshot->>'plan' NOT IN ('Growth','Enterprise') OR snapshot->>'stripe_subscription' IS NULL THEN RAISE EXCEPTION 'Invalid billing event'; END IF;
 SELECT * INTO s FROM public.subscriptions WHERE organization_id=workspace FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Workspace subscription missing'; END IF;
 IF EXISTS(SELECT 1 FROM private.billing_events e WHERE e.event_id=apply_billing_event.event_id) THEN RETURN false; END IF;
 -- An old subscription may not overwrite a replacement subscription.
 IF s.stripe_subscription IS NOT NULL AND s.stripe_subscription<>snapshot->>'stripe_subscription' AND s.status NOT IN ('canceled','incomplete_expired') THEN RAISE EXCEPTION 'Another subscription is already bound'; END IF;
 IF event_created>=s.last_event_created THEN
  UPDATE public.subscriptions SET status=snapshot->>'status',plan=snapshot->>'plan',price_id=snapshot->>'price_id',
   stripe_customer=snapshot->>'stripe_customer',stripe_subscription=snapshot->>'stripe_subscription',
   current_period_end=(snapshot->>'current_period_end')::timestamptz,cancel_at_period_end=(snapshot->>'cancel_at_period_end')::boolean,
   last_event_created=event_created,updated_at=now() WHERE organization_id=workspace;
 END IF;
 INSERT INTO private.billing_events(event_id,organization_id,created) VALUES(event_id,workspace,event_created);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.apply_billing_event(text,bigint,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_event(text,bigint,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.deployment_version() RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$ SELECT '20261001162012'::text $$;
COMMIT;
