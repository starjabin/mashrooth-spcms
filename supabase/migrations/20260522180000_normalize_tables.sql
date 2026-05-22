-- ============================================================
-- Migration: Normalize entity tables
-- Adds grc_risks, lcgpa_records, claims, document_contents
-- ============================================================

-- ── grc_risks ─────────────────────────────────────────────────────────────────
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
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'grc_risks' AND policyname = 'grc_risks_all'
  ) THEN
    CREATE POLICY grc_risks_all ON grc_risks FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── lcgpa_records ─────────────────────────────────────────────────────────────
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
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'lcgpa_records' AND policyname = 'lcgpa_records_all'
  ) THEN
    CREATE POLICY lcgpa_records_all ON lcgpa_records FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── claims ────────────────────────────────────────────────────────────────────
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
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'claims' AND policyname = 'claims_all'
  ) THEN
    CREATE POLICY claims_all ON claims FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── document_contents ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_contents (
  id          TEXT        PRIMARY KEY,
  content     TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ          DEFAULT NOW(),
  updated_at  TIMESTAMPTZ          DEFAULT NOW()
);
ALTER TABLE document_contents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'document_contents' AND policyname = 'document_contents_all'
  ) THEN
    CREATE POLICY document_contents_all ON document_contents FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── Trim org_data blob — remove keys now handled by normalized tables ─────────
UPDATE org_data
SET data = data
  - 'projects'
  - 'contractDocuments'
  - 'grcRisks'
  - 'lcgpaRecords'
  - 'claims'
  - 'documentContents'
WHERE id = 'main';
