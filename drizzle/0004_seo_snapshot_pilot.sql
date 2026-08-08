-- Direct SEO snapshot pilot (revised plan v2, Phase 1).
-- Source-specific by design (DataForSEO). No vendor-neutral provider framework
-- is introduced yet; that abstraction is deferred until a second real provider
-- exposes genuine commonality. SEO snapshots never write baselines or findings.

CREATE TABLE IF NOT EXISTS seo_snapshot_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'dataforseo',
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  cost_estimate REAL NOT NULL DEFAULT 0,
  cost_actual REAL,
  coverage_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  artifact_storage_key TEXT,
  artifact_sha256 TEXT,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_snapshot_runs_idempotency
ON seo_snapshot_runs(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_seo_snapshot_runs_site_requested
ON seo_snapshot_runs(site_id, requested_at);

CREATE INDEX IF NOT EXISTS idx_seo_snapshot_runs_status
ON seo_snapshot_runs(status, requested_at);

CREATE TABLE IF NOT EXISTS seo_snapshot_metrics (
  id TEXT PRIMARY KEY,
  snapshot_run_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  dimension_json TEXT NOT NULL,
  value_json TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seo_snapshot_metrics_run
ON seo_snapshot_metrics(snapshot_run_id);

PRAGMA optimize;
