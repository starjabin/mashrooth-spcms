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
-- Default deny until tenant-isolation migration is applied.

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
-- Default deny until tenant-isolation migration is applied.

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
-- Default deny until tenant-isolation migration is applied.

-- ── document_contents ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_contents (
  id          TEXT        PRIMARY KEY,
  content     TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ          DEFAULT NOW(),
  updated_at  TIMESTAMPTZ          DEFAULT NOW()
);
ALTER TABLE document_contents ENABLE ROW LEVEL SECURITY;
-- Default deny until tenant-isolation migration is applied.

-- Existing org_data is retained. Do not remove legacy keys until their
-- normalized records, ownership and backup have been verified.
