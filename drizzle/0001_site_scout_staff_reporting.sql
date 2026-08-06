CREATE TABLE IF NOT EXISTS quality_users (
  email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  identity_source TEXT NOT NULL DEFAULT 'named-allowlist',
  active INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_users_role_active
ON quality_users(role, active);

CREATE TABLE IF NOT EXISTS staff_report_workflow (
  observation_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  triage_method TEXT NOT NULL,
  triage_json TEXT NOT NULL,
  duplicate_finding_id TEXT,
  assigned_to TEXT,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_report_status_updated
ON staff_report_workflow(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_staff_report_duplicate_finding
ON staff_report_workflow(duplicate_finding_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_email TEXT NOT NULL,
  event_type TEXT NOT NULL,
  observation_id TEXT,
  finding_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read_created
ON notifications(recipient_email, read_at, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_observation
ON notifications(observation_id);

PRAGMA optimize;
