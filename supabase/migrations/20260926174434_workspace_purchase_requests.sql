-- A purchase inquiry is not an account, an invoice or a paid subscription.
-- Anonymous visitors can submit only the fields required to arrange a quote;
-- no visitor can read or modify another person's contact details.
BEGIN;
CREATE TABLE public.workspace_purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name text NOT NULL CHECK (length(contact_name) BETWEEN 2 AND 120),
  work_email text NOT NULL UNIQUE CHECK (length(work_email) BETWEEN 5 AND 254 AND work_email = lower(work_email)),
  organization_name text NOT NULL CHECK (length(organization_name) BETWEEN 2 AND 160),
  seat_range text NOT NULL CHECK (seat_range IN ('1-5','6-20','21-100','101+')),
  plan text NOT NULL CHECK (plan IN ('team','enterprise')),
  contact_consent boolean NOT NULL CHECK (contact_consent IS TRUE),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_purchase_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_purchase_requests FROM PUBLIC, anon, authenticated;
GRANT INSERT (contact_name,work_email,organization_name,seat_range,plan,contact_consent)
  ON public.workspace_purchase_requests TO anon;
CREATE POLICY workspace_purchase_request_submit ON public.workspace_purchase_requests
  FOR INSERT TO anon WITH CHECK (contact_consent IS TRUE AND status = 'new');
COMMENT ON TABLE public.workspace_purchase_requests IS
  'Public sales inquiries only. Do not treat these rows as user accounts or payment entitlements.';
COMMIT;
