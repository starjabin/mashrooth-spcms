-- ============================================================
-- Mashrooth SPCMS — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- 1. Org-level shared state (single JSON blob, all users share one row)
CREATE TABLE IF NOT EXISTS org_data (
  id          TEXT        PRIMARY KEY DEFAULT 'main',
  data        JSONB       NOT NULL    DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL    DEFAULT NOW()
);

-- Enable Row-Level Security
ALTER TABLE org_data ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read the org data
CREATE POLICY "Authenticated users can read org_data"
  ON org_data FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any authenticated user can insert (first-time seed)
CREATE POLICY "Authenticated users can insert org_data"
  ON org_data FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Any authenticated user can update the shared state
CREATE POLICY "Authenticated users can update org_data"
  ON org_data FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ============================================================
-- 2. Contracts table (normalised — optional, for future reporting)
-- ============================================================
CREATE TABLE IF NOT EXISTS contracts (
  id              TEXT        PRIMARY KEY,
  project_id      TEXT,
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

CREATE POLICY "Authenticated users can manage contracts"
  ON contracts FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- 3. Projects table (normalised — optional)
-- ============================================================
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

CREATE POLICY "Authenticated users can manage projects"
  ON projects FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- 4. Seed the initial empty org_data row (idempotent)
-- ============================================================
INSERT INTO org_data (id, data)
VALUES ('main', '{
  "_demo": false,
  "projects": [],
  "contractDocuments": {},
  "aiFindings": [],
  "wbsPhases": {},
  "lcgpaRecords": {},
  "claims": [],
  "grcRisks": [],
  "complianceControls": [],
  "procurementItems": [],
  "documentContents": {},
  "crossDocumentFindings": [],
  "preBidClarifications": [],
  "pipelineSteps": {},
  "contractWorkflowStatus": {}
}')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Done. Verify with:
-- SELECT id, updated_at FROM org_data;
-- ============================================================
