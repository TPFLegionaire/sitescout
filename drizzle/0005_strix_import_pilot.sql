-- Strix import-only evaluation (revised plan v2, Phase 2).
-- SiteScout imports artifacts produced by Strix operated SEPARATELY against a
-- disposable, deliberately vulnerable target. There is no execution path here.
-- Candidate rows carry only sanitised descriptive fields; raw exploit material
-- stays in the restricted artifact and is never copied into a candidate. No
-- candidate becomes a canonical finding automatically.

CREATE TABLE IF NOT EXISTS security_import_runs (
  id TEXT PRIMARY KEY,
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
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_import_runs_sha
ON security_import_runs(artifact_sha256);

CREATE INDEX IF NOT EXISTS idx_security_import_runs_created
ON security_import_runs(created_at);

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

PRAGMA optimize;
