import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = fs.readFileSync(new URL("../drizzle/0005_strix_import_pilot.sql", import.meta.url), "utf8");

test("security schema scopes import idempotency and makes review stages append-only", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  const insertRun = db.prepare(
    `INSERT INTO security_import_runs
      (id, organization_id, site_id, target_id, source, target_label, status, coverage_json, limitations_json,
       artifact_sha256, candidate_count, imported_by, retention_until, created_at)
     VALUES (?, ?, ?, ?, 'strix', ?, 'imported', '{}', '[]', ?, 1, ?, ?, ?)`,
  );
  const now = "2026-08-08T12:00:00.000Z";
  insertRun.run("run-a", "org-a", "site-a", "target-a", "Target A", "same-sha", "reviewer-a", "2026-09-07T12:00:00.000Z", now);
  assert.throws(
    () => insertRun.run("run-a-duplicate", "org-a", "site-a", "target-a", "Target A", "same-sha", "reviewer-a", "2026-09-07T12:00:00.000Z", now),
    /UNIQUE constraint failed/,
  );
  insertRun.run("run-b", "org-b", "site-b", "target-b", "Target B", "same-sha", "reviewer-b", "2026-09-07T12:00:00.000Z", now);

  db.prepare(
    `INSERT INTO security_candidates
      (id, import_run_id, title, severity, fingerprint, sanitization_status, sanitization_flags_json, review_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run("candidate-a", "run-a", "Sanitised candidate", "critical", "fingerprint", "quarantined", '["dropped_raw_evidence"]', now);
  const insertReview = db.prepare(
    `INSERT INTO security_candidate_reviews
      (id, candidate_id, stage, decision, reviewer_email, note, review_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertReview.run("review-first", "candidate-a", "first", "reproducible", "reviewer-a", "First check", 3, now);
  assert.throws(
    () => insertReview.run("review-first-rewrite", "candidate-a", "first", "false_positive", "reviewer-b", "Must not overwrite", 2, now),
    /UNIQUE constraint failed/,
  );
  insertReview.run("review-second", "candidate-a", "second", "reproducible", "reviewer-b", "Independent check", 2, now);
  assert.deepEqual(
    db.prepare("SELECT stage, reviewer_email AS reviewer FROM security_candidate_reviews ORDER BY created_at, stage").all().map((row) => ({ ...row })),
    [{ stage: "first", reviewer: "reviewer-a" }, { stage: "second", reviewer: "reviewer-b" }],
  );
});
