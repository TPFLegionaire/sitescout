import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLocalTriage } from "../lib/platform/triage-core.mjs";

test("local assistance drafts a report and suggests only supplied active candidates", () => {
  const candidates = [
    { id: "SHOP-M3", title: "Mobile navigation control does not respond", category: "Usability", recommendation: "Correct the mobile navigation control." },
    { id: "SHOP-L2", title: "Canonical metadata is incomplete", category: "SEO", recommendation: "Add canonical metadata." },
  ];
  const draft = buildLocalTriage({
    url: "https://example.com/products",
    description: "The mobile navigation control does not respond when tapped.",
  }, candidates);
  assert.equal(draft.method, "local-assist");
  assert.equal(draft.externalProcessing, false);
  assert.equal(draft.provisionalSeverity, "undetermined");
  assert.ok(draft.title.length > 0);
  assert.ok(draft.reproductionSteps.length >= 3);
  assert.equal(draft.duplicateCandidates[0].id, "SHOP-M3");
  assert.ok(draft.duplicateCandidates.every((candidate) => candidates.some((allowed) => allowed.id === candidate.id)));
});

test("staff reporting migration preserves separate workflow, notification and role records", async () => {
  const [migration, operationsMigration, multiSiteMigration, dashboardData] = await Promise.all([
    readFile(new URL("../drizzle/0001_site_scout_staff_reporting.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_pilot_operations.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_multi_site_core.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/data.ts", import.meta.url), "utf8"),
  ]);
  for (const table of ["quality_users", "staff_report_workflow", "notifications"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /idx_staff_report_status_updated/);
  assert.match(migration, /idx_notifications_recipient_read_created/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/i);
  for (const table of ["report_messages", "report_privacy", "evidence_controls", "pilot_events"]) assert.match(operationsMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(operationsMigration, /idx_report_messages_observation_created/);
  assert.match(operationsMigration, /idx_evidence_controls_retention/);
  assert.doesNotMatch(operationsMigration, /DROP TABLE|DELETE FROM/i);
  for (const table of ["organizations", "sites", "quality_user_roles"]) assert.match(multiSiteMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(multiSiteMigration, /idx_quality_user_roles_scope/);
  assert.doesNotMatch(multiSiteMigration, /DROP TABLE|DELETE FROM/i);
  assert.match(dashboardData, /WHERE o\.finding_id IS NOT NULL AND o\.review_status = 'confirmed'/);
  assert.doesNotMatch(dashboardData, /SELECT COALESCE\(finding_id, suggested_finding_id\) AS findingId/);
});
