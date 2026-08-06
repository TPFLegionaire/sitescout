CREATE TABLE IF NOT EXISTS report_messages (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_role TEXT NOT NULL,
  message_type TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence_asset_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_messages_observation_created
ON report_messages(observation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_report_messages_author
ON report_messages(author_email);

CREATE TABLE IF NOT EXISTS report_privacy (
  observation_id TEXT PRIMARY KEY,
  classification TEXT NOT NULL DEFAULT 'standard',
  legal_hold INTEGER NOT NULL DEFAULT 0,
  policy_version TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_privacy_classification_hold
ON report_privacy(classification, legal_hold);

CREATE TABLE IF NOT EXISTS evidence_controls (
  asset_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  retention_until TEXT,
  legal_hold INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_controls_observation
ON evidence_controls(observation_id);

CREATE INDEX IF NOT EXISTS idx_evidence_controls_retention
ON evidence_controls(retention_until, legal_hold);

CREATE TABLE IF NOT EXISTS pilot_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  observation_id TEXT,
  actor_email TEXT NOT NULL,
  duration_ms INTEGER,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pilot_events_type_created
ON pilot_events(event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_pilot_events_actor
ON pilot_events(actor_email);

PRAGMA optimize;
