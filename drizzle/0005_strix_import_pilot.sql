-- Strix import-only evaluation. No active scan runs in SiteScout.
-- Every import is bound to an approved registered target; provider output is
-- untrusted evidence and never creates a canonical finding automatically.

CREATE TABLE IF NOT EXISTS security_import_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'strix',
  source_version TEXT,
  target_label TEXT NOT NULL,
  scan_mode TEXT,
  image_digest TEXT,
  model TEXT,
  status TEXT NOT NULL,
  coverage_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  artifact_storage_key TEXT,
  artifact_sha256 TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT NOT NULL,
  retention_until TEXT NOT NULL,
  legal_hold INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_import_runs_scope_sha
ON security_import_runs(organization_id, target_id, artifact_sha256);

CREATE INDEX IF NOT EXISTS idx_security_import_runs_scope_created
ON security_import_runs(organization_id, site_id, created_at);

CREATE INDEX IF NOT EXISTS idx_security_import_runs_retention
ON security_import_runs(retention_until, legal_hold, deleted_at);

CREATE TABLE IF NOT EXISTS security_candidates (
  id TEXT PRIMARY KEY,
  import_run_id TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  cwe TEXT NOT NULL DEFAULT '',
  cvss_vector TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  remediation TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  sanitization_status TEXT NOT NULL DEFAULT 'clean',
  sanitization_flags_json TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'pending',
  first_reviewer TEXT,
  reviewed_by TEXT,
  second_check_by TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_candidates_run ON security_candidates(import_run_id);
CREATE INDEX IF NOT EXISTS idx_security_candidates_fingerprint ON security_candidates(fingerprint);
CREATE INDEX IF NOT EXISTS idx_security_candidates_review ON security_candidates(review_status);
CREATE INDEX IF NOT EXISTS idx_security_candidates_sanitization ON security_candidates(sanitization_status);

CREATE TABLE IF NOT EXISTS security_candidate_reviews (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  decision TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  review_minutes REAL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_candidate_reviews_stage
ON security_candidate_reviews(candidate_id, stage);

CREATE INDEX IF NOT EXISTS idx_security_candidate_reviews_created
ON security_candidate_reviews(candidate_id, created_at);

PRAGMA optimize;
