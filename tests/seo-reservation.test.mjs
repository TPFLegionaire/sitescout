import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { INITIAL_SEO_RESERVATION_SQL, RETRY_SEO_RESERVATION_SQL } from "../lib/platform/seo/seo-guard-core.mjs";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE seo_snapshot_runs (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, site_id TEXT NOT NULL, target_id TEXT NOT NULL,
    source TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL, dimensions_json TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE, cost_estimate REAL NOT NULL, cost_actual REAL, cost_reserved REAL NOT NULL,
    attempt_count INTEGER NOT NULL, lease_expires_at TEXT, provider_dispatched_at TEXT, failure_stage TEXT,
    provider_reference TEXT, coverage_json TEXT NOT NULL, limitations_json TEXT NOT NULL, artifact_storage_key TEXT,
    artifact_sha256 TEXT, requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, completed_at TEXT
  )`);
  return db;
}

function reserve(db, id, key, estimate = 0.02, cap = 1) {
  const now = "2026-08-08T10:00:00.000Z";
  const lease = "2026-08-08T10:02:00.000Z";
  return db.prepare(INITIAL_SEO_RESERVATION_SQL).run(
    id, "org-a", "site-a", "target-a", "domain_overview", "{}", key,
    estimate, estimate, lease, "admin@example.com", now, now, "2026-08", estimate, cap,
  );
}

test("the atomic reservation admits only one active provider dispatch", () => {
  const db = database();
  assert.equal(reserve(db, "run-1", "key-1").changes, 1);
  assert.equal(reserve(db, "run-2", "key-2").changes, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM seo_snapshot_runs").get().count, 1);
});

test("active reservations and actual cost both consume the monthly cap", () => {
  const db = database();
  assert.equal(reserve(db, "run-1", "key-1", 0.04, 0.05).changes, 1);
  db.prepare("UPDATE seo_snapshot_runs SET status = 'completed', cost_actual = 0.04, cost_reserved = 0.04, lease_expires_at = NULL").run();
  assert.equal(reserve(db, "run-2", "key-2", 0.02, 0.05).changes, 0);
});

test("failed runs can retry once, reserve prior cost plus the new estimate, and then stop", () => {
  const db = database();
  reserve(db, "run-1", "key-1", 0.02, 1);
  db.prepare("UPDATE seo_snapshot_runs SET status = 'failed_provider', cost_actual = 0.01, cost_reserved = 0.01, lease_expires_at = NULL").run();
  const retry = db.prepare(RETRY_SEO_RESERVATION_SQL).run(0.02, "2026-08-08T10:02:00.000Z", "admin@example.com", "run-1", 2, "2026-08-08T10:00:00.000Z", "2026-08", 0.02, 1);
  assert.equal(retry.changes, 1);
  const row = db.prepare("SELECT attempt_count AS attempts, cost_reserved AS reserved FROM seo_snapshot_runs").get();
  assert.equal(row.attempts, 2);
  assert.equal(row.reserved, 0.03);
  db.prepare("UPDATE seo_snapshot_runs SET status = 'failed_provider', lease_expires_at = NULL").run();
  const exhausted = db.prepare(RETRY_SEO_RESERVATION_SQL).run(0.02, "2026-08-08T10:04:00.000Z", "admin@example.com", "run-1", 2, "2026-08-08T10:03:00.000Z", "2026-08", 0.02, 1);
  assert.equal(exhausted.changes, 0);
});
