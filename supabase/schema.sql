-- ============================================================
-- Mashrooth SPCMS — Supabase Schema (full, idempotent)
-- Run this in the Supabase SQL Editor — safe to re-run.
-- ============================================================

-- ── 1. org_data — misc blob for complex structures not yet normalized ─────────
CREATE TABLE IF NOT EXISTS org_data (
  id          TEXT        PRIMARY KEY DEFAULT 'main',
  data        JSONB       NOT NULL    DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL    DEFAULT NOW()
);
ALTER TABLE org_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "org_data_select" ON org_data FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "org_data_insert" ON org_data FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "org_data_update" ON org_data FOR UPDATE USING (auth.role() = 'authenticated');

-- ── 2. projects ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                    TEXT        PRIMARY KEY,
  name                  TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'active',
  budget                NUMERIC              DEFAULT 0,
  start_date            TEXT,
  end_date              TEXT,
  client                TEXT                 DEFAULT '',
  contractor            TEXT                 DEFAULT '',
  location              TEXT                 DEFAULT '',
  description           TEXT                 DEFAULT '',
  local_content_target  NUMERIC              DEFAULT 0,
  completion_pct        NUMERIC              DEFAULT 0,
  created_at            TIMESTAMPTZ          DEFAULT NOW(),
  updated_at            TIMESTAMPTZ          DEFAULT NOW()
);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "projects_all" ON projects FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ── 3. contracts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id              TEXT        PRIMARY KEY,
  project_id      TEXT                 DEFAULT '__unlinked',
  title           TEXT        NOT NULL,
  type            TEXT        NOT NULL DEFAULT 'Contract',
  status          TEXT        NOT NULL DEFAULT 'active',
  value           NUMERIC              DEFAULT 0,
  signed_date     TEXT,
  expiry_date     TEXT,
  parties         JSONB                DEFAULT '[]',
  retention_pct   NUMERIC              DEFAULT 0,
  notes           TEXT                 DEFAULT '',
  has_text        BOOLEAN              DEFAULT FALSE,
  created_at      TIMESTAMPTZ          DEFAULT NOW(),
  updated_at      TIMESTAMPTZ          DEFAULT NOW()
);
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "contracts_all" ON contracts FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ── 4. grc_risks ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grc_risks (
  id          TEXT        PRIMARY KEY,
  project_id  TEXT,
  title       TEXT        NOT NULL,
  category    TEXT        NOT NULL DEFAULT 'Operational',
  likelihood  INTEGER              DEFAULT 1,
  impact      INTEGER              DEFAULT 1,
  risk_score  INTEGER              DEFAULT 1,
  status      TEXT        NOT NULL DEFAULT 'open',
  owner       TEXT                 DEFAULT '',
  mitigation  TEXT                 DEFAULT '',
  due_date    TEXT,
  regulation  TEXT                 DEFAULT '',
  created_at  TIMESTAMPTZ          DEFAULT NOW(),
  updated_at  TIMESTAMPTZ          DEFAULT NOW()
);
ALTER TABLE grc_risks ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "grc_risks_all" ON grc_risks FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ── 5. lcgpa_records ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lcgpa_records (
  id                 TEXT        PRIMARY KEY,
  project_id         TEXT        NOT NULL DEFAULT '__unlinked',
  category           TEXT        NOT NULL DEFAULT 'Labor',
  item_name          TEXT        NOT NULL,
  total_value        NUMERIC              DEFAULT 0,
  local_value        NUMERIC              DEFAULT 0,
  local_content_pct  NUMERIC              DEFAULT 0,
  supplier           TEXT                 DEFAULT '',
  period             TEXT                 DEFAULT '',
  certificate        TEXT                 DEFAULT '',
  notes              TEXT                 DEFAULT '',
  created_at         TIMESTAMPTZ          DEFAULT NOW(),
  updated_at         TIMESTAMPTZ          DEFAULT NOW()
);
ALTER TABLE lcgpa_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "lcgpa_records_all" ON lcgpa_records FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ── 6. claims ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS claims (
  id              TEXT        PRIMARY KEY,
  project_id      TEXT,
  title           TEXT        NOT NULL,
  type            TEXT        NOT NULL DEFAULT 'EOT',
  amount          NUMERIC              DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'draft',
  submitted_date  TEXT,
  clauze          TEXT                 DEFAULT '',
  claimant        TEXT                 DEFAULT '',
  description     TEXT                 DEFAULT '',
  days_requested  INTEGER              DEFAULT 0,
  created_at      TIMESTAMPTZ          DEFAULT NOW(),
  updated_at      TIMESTAMPTZ          DEFAULT NOW()
);
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "claims_all" ON claims FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ── 7. document_contents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_contents (
  id          TEXT        PRIMARY KEY,
  content     TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ          DEFAULT NOW(),
  updated_at  TIMESTAMPTZ          DEFAULT NOW()
);
ALTER TABLE document_contents ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "document_contents_all" ON document_contents FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ── 8. Seed org_data with empty blob (idempotent) ─────────────────────────────
INSERT INTO org_data (id, data)
VALUES ('main', '{
  "wbsPhases": {},
  "pipelineSteps": {},
  "contractWorkflowStatus": {},
  "aiFindings": [],
  "complianceControls": [],
  "procurementItems": [],
  "crossDocumentFindings": [],
  "preBidClarifications": []
}')
ON CONFLICT (id) DO NOTHING;

-- ── Done. Verify with: ────────────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;
