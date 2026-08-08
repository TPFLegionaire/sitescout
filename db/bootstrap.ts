import { getD1 } from "./index";
import seedPayload from "../data/demo-seed.json";

const SCHEMA_VERSION = "6";
const SEED_VERSION = "sitescout-demo-v1";
const SEEDED_AT = "2026-08-01T08:00:00.000Z";

const baseSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, product_name TEXT NOT NULL DEFAULT 'SiteScout', brand_label TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS targets (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, environment TEXT NOT NULL, base_url TEXT NOT NULL, allowed_host TEXT NOT NULL, allowed_path_prefix TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_runs (id TEXT PRIMARY KEY, target_id TEXT NOT NULL, run_type TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, ruleset_version TEXT NOT NULL, profile_version TEXT NOT NULL, browser TEXT NOT NULL, viewport TEXT NOT NULL, locale TEXT NOT NULL, page_limit INTEGER NOT NULL, pages_attempted INTEGER NOT NULL DEFAULT 0, pages_completed INTEGER NOT NULL DEFAULT 0, comparable INTEGER NOT NULL DEFAULT 1, comparison_reason TEXT, coverage_json TEXT NOT NULL, limitations_json TEXT NOT NULL, triggered_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS baselines (id TEXT PRIMARY KEY, target_id TEXT NOT NULL, run_id TEXT NOT NULL, version INTEGER NOT NULL, reason TEXT NOT NULL, approved_by TEXT NOT NULL, created_at TEXT NOT NULL, superseded_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS findings (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, display_key TEXT NOT NULL, title TEXT NOT NULL, severity TEXT NOT NULL, category TEXT NOT NULL, recommendation TEXT NOT NULL, acceptance_criteria TEXT NOT NULL DEFAULT '', owner TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finding_states (id TEXT PRIMARY KEY, finding_id TEXT NOT NULL, target_id TEXT NOT NULL, status TEXT NOT NULL, delta TEXT NOT NULL, last_run_id TEXT NOT NULL, current_evidence TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, target_id TEXT NOT NULL, run_id TEXT, finding_id TEXT, suggested_finding_id TEXT, source_channel TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, expected TEXT NOT NULL DEFAULT '', actual TEXT NOT NULL DEFAULT '', review_status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS evidence_assets (id TEXT PRIMARY KEY, observation_id TEXT NOT NULL, kind TEXT NOT NULL, storage_key TEXT, public_url TEXT, caption TEXT NOT NULL, privacy_status TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS review_decisions (id TEXT PRIMARY KEY, observation_id TEXT NOT NULL, decision TEXT NOT NULL, finding_id TEXT, note TEXT NOT NULL DEFAULT '', reviewer TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS quality_users (email TEXT PRIMARY KEY, user_id TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, identity_source TEXT NOT NULL DEFAULT 'named-allowlist', active INTEGER NOT NULL DEFAULT 1, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS quality_user_roles (id TEXT PRIMARY KEY, email TEXT NOT NULL, organization_id TEXT NOT NULL, site_id TEXT NOT NULL DEFAULT '*', role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS staff_report_workflow (observation_id TEXT PRIMARY KEY, status TEXT NOT NULL, triage_method TEXT NOT NULL, triage_json TEXT NOT NULL, duplicate_finding_id TEXT, assigned_to TEXT, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS report_messages (id TEXT PRIMARY KEY, observation_id TEXT NOT NULL, author_email TEXT NOT NULL, author_role TEXT NOT NULL, message_type TEXT NOT NULL, body TEXT NOT NULL, evidence_asset_id TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS report_privacy (observation_id TEXT PRIMARY KEY, classification TEXT NOT NULL DEFAULT 'standard', legal_hold INTEGER NOT NULL DEFAULT 0, policy_version TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS evidence_controls (asset_id TEXT PRIMARY KEY, observation_id TEXT NOT NULL, size_bytes INTEGER NOT NULL, retention_until TEXT, legal_hold INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pilot_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, observation_id TEXT, actor_email TEXT NOT NULL, duration_ms INTEGER, detail_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_email TEXT NOT NULL, event_type TEXT NOT NULL, observation_id TEXT, finding_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, actor TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS seo_snapshot_runs (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, site_id TEXT NOT NULL, target_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'dataforseo', operation TEXT NOT NULL, status TEXT NOT NULL, dimensions_json TEXT NOT NULL, idempotency_key TEXT NOT NULL, cost_estimate REAL NOT NULL DEFAULT 0, cost_actual REAL, cost_reserved REAL NOT NULL DEFAULT 0, attempt_count INTEGER NOT NULL DEFAULT 0, lease_expires_at TEXT, provider_dispatched_at TEXT, failure_stage TEXT, provider_reference TEXT, coverage_json TEXT NOT NULL, limitations_json TEXT NOT NULL, artifact_storage_key TEXT, artifact_sha256 TEXT, requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS seo_snapshot_metrics (id TEXT PRIMARY KEY, snapshot_run_id TEXT NOT NULL, metric_key TEXT NOT NULL, dimension_json TEXT NOT NULL, value_json TEXT NOT NULL, captured_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS security_import_runs (id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'strix', source_version TEXT, target_label TEXT NOT NULL, scan_mode TEXT, image_digest TEXT, model TEXT, status TEXT NOT NULL, coverage_json TEXT NOT NULL, limitations_json TEXT NOT NULL, artifact_storage_key TEXT, artifact_sha256 TEXT NOT NULL, candidate_count INTEGER NOT NULL DEFAULT 0, imported_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS security_candidates (id TEXT PRIMARY KEY, import_run_id TEXT NOT NULL, external_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, severity TEXT NOT NULL, cwe TEXT NOT NULL DEFAULT '', cvss_vector TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', remediation TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'pending', first_reviewer TEXT, reviewed_by TEXT, second_check_by TEXT, review_note TEXT, reviewed_at TEXT, created_at TEXT NOT NULL)`,
];

const indexStatements = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_organization_slug ON sites(organization_id, slug)`,
  `CREATE INDEX IF NOT EXISTS idx_sites_organization_active ON sites(organization_id, active)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_targets_site_environment ON targets(site_id, environment)`,
  `CREATE INDEX IF NOT EXISTS idx_targets_site_active ON targets(site_id, active)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_runs_target_completed ON audit_runs(target_id, completed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON audit_runs(status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_baselines_target_version ON baselines(target_id, version)`,
  `CREATE INDEX IF NOT EXISTS idx_baselines_current ON baselines(target_id, superseded_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_site_display_key ON findings(site_id, display_key)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_site_severity ON findings(site_id, severity)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_finding_states_pair ON finding_states(finding_id, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_finding_states_target_status ON finding_states(target_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_observations_review ON observations(review_status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_observations_finding ON observations(finding_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_observation ON evidence_assets(observation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_review_decisions_observation ON review_decisions(observation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_quality_users_role_active ON quality_users(role, active)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_user_roles_scope ON quality_user_roles(email, organization_id, site_id, role)`,
  `CREATE INDEX IF NOT EXISTS idx_quality_user_roles_email_active ON quality_user_roles(email, active)`,
  `CREATE INDEX IF NOT EXISTS idx_quality_user_roles_site_role ON quality_user_roles(site_id, role, active)`,
  `CREATE INDEX IF NOT EXISTS idx_staff_report_status_updated ON staff_report_workflow(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_staff_report_duplicate_finding ON staff_report_workflow(duplicate_finding_id)`,
  `CREATE INDEX IF NOT EXISTS idx_report_messages_observation_created ON report_messages(observation_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_report_messages_author ON report_messages(author_email)`,
  `CREATE INDEX IF NOT EXISTS idx_report_privacy_classification_hold ON report_privacy(classification, legal_hold)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_controls_observation ON evidence_controls(observation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_controls_retention ON evidence_controls(retention_until, legal_hold)`,
  `CREATE INDEX IF NOT EXISTS idx_pilot_events_type_created ON pilot_events(event_type, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_pilot_events_actor ON pilot_events(actor_email)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read_created ON notifications(recipient_email, read_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_observation ON notifications(observation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_snapshot_runs_idempotency ON seo_snapshot_runs(idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS idx_seo_snapshot_runs_site_requested ON seo_snapshot_runs(site_id, requested_at)`,
  `CREATE INDEX IF NOT EXISTS idx_seo_snapshot_runs_status ON seo_snapshot_runs(status, lease_expires_at, requested_at)`,
  `CREATE INDEX IF NOT EXISTS idx_seo_snapshot_metrics_run ON seo_snapshot_metrics(snapshot_run_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_security_import_runs_sha ON security_import_runs(artifact_sha256)`,
  `CREATE INDEX IF NOT EXISTS idx_security_import_runs_created ON security_import_runs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_security_candidates_run ON security_candidates(import_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_security_candidates_fingerprint ON security_candidates(fingerprint)`,
  `CREATE INDEX IF NOT EXISTS idx_security_candidates_review ON security_candidates(review_status)`,
];

async function runBatches(statements: D1PreparedStatement[], size = 40) {
  const d1 = getD1();
  for (let index = 0; index < statements.length; index += size) {
    await d1.batch(statements.slice(index, index + size));
  }
}

async function ensureColumn(table: string, column: string, statement: string) {
  const d1 = getD1();
  const columns = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (!columns.results.some((candidate) => candidate.name === column)) await d1.prepare(statement).run();
}

async function migrateLegacyShape() {
  const d1 = getD1();
  await d1.prepare("DROP INDEX IF EXISTS idx_targets_environment").run();
  await d1.prepare("DROP INDEX IF EXISTS idx_seo_snapshot_runs_status").run();
  await ensureColumn("targets", "site_id", "ALTER TABLE targets ADD COLUMN site_id TEXT");
  await ensureColumn("findings", "site_id", "ALTER TABLE findings ADD COLUMN site_id TEXT");
  await ensureColumn("findings", "display_key", "ALTER TABLE findings ADD COLUMN display_key TEXT");
  await ensureColumn("seo_snapshot_runs", "cost_reserved", "ALTER TABLE seo_snapshot_runs ADD COLUMN cost_reserved REAL NOT NULL DEFAULT 0");
  await ensureColumn("seo_snapshot_runs", "attempt_count", "ALTER TABLE seo_snapshot_runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("seo_snapshot_runs", "lease_expires_at", "ALTER TABLE seo_snapshot_runs ADD COLUMN lease_expires_at TEXT");
  await ensureColumn("seo_snapshot_runs", "provider_dispatched_at", "ALTER TABLE seo_snapshot_runs ADD COLUMN provider_dispatched_at TEXT");
  await ensureColumn("seo_snapshot_runs", "failure_stage", "ALTER TABLE seo_snapshot_runs ADD COLUMN failure_stage TEXT");
  await ensureColumn("seo_snapshot_runs", "provider_reference", "ALTER TABLE seo_snapshot_runs ADD COLUMN provider_reference TEXT");
  await d1.prepare("UPDATE seo_snapshot_runs SET status = 'failed_provider', failure_stage = 'provider' WHERE status = 'failed'").run();
  await d1.prepare("UPDATE seo_snapshot_runs SET attempt_count = 1 WHERE attempt_count = 0 AND status <> 'abandoned'").run();

  const legacyTarget = await d1.prepare("SELECT id FROM targets WHERE site_id IS NULL OR site_id = '' LIMIT 1").first();
  const legacyFinding = await d1.prepare("SELECT id FROM findings WHERE site_id IS NULL OR site_id = '' OR display_key IS NULL OR display_key = '' LIMIT 1").first();
  if (!legacyTarget && !legacyFinding) return;

  await d1.batch([
    d1.prepare("INSERT OR IGNORE INTO organizations (id, slug, name, product_name, brand_label, created_at) VALUES ('legacy-import', 'legacy-import', 'Legacy import', 'SiteScout', 'LEGACY IMPORT', ?)").bind(SEEDED_AT),
    d1.prepare("INSERT OR IGNORE INTO sites (id, organization_id, slug, name, active, created_at) VALUES ('legacy-site', 'legacy-import', 'legacy-site', 'Legacy website', 1, ?)").bind(SEEDED_AT),
    d1.prepare("UPDATE targets SET site_id = 'legacy-site' WHERE site_id IS NULL OR site_id = ''"),
    d1.prepare("UPDATE findings SET site_id = 'legacy-site' WHERE site_id IS NULL OR site_id = ''"),
    d1.prepare("UPDATE findings SET display_key = id WHERE display_key IS NULL OR display_key = ''"),
  ]);
}

async function seedDatabase() {
  const d1 = getD1();
  const existing = await d1.prepare("SELECT value FROM schema_meta WHERE key = ?").bind("seed_version").first<{ value: string }>();
  if (existing?.value === SEED_VERSION) return;

  const statements: D1PreparedStatement[] = [];
  const organization = seedPayload.product.organization;
  statements.push(
    d1.prepare("INSERT OR IGNORE INTO organizations (id, slug, name, product_name, brand_label, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      organization.id,
      organization.slug,
      organization.name,
      seedPayload.product.name,
      organization.brandLabel,
      SEEDED_AT,
    ),
  );
  for (const site of seedPayload.product.sites) {
    statements.push(
      d1.prepare("INSERT OR IGNORE INTO sites (id, organization_id, slug, name, active, created_at) VALUES (?, ?, ?, ?, 1, ?)").bind(
        site.id,
        organization.id,
        site.slug,
        site.name,
        SEEDED_AT,
      ),
    );
  }
  for (const target of seedPayload.targets) {
    statements.push(
      d1.prepare("INSERT OR IGNORE INTO targets (id, site_id, name, environment, base_url, allowed_host, allowed_path_prefix, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)").bind(
        target.id,
        target.siteId,
        target.name,
        target.environment,
        target.baseUrl,
        target.allowedHost,
        target.allowedPathPrefix,
        SEEDED_AT,
      ),
    );
  }
  for (const run of seedPayload.runs) {
    statements.push(
      d1.prepare("INSERT OR IGNORE INTO audit_runs (id, target_id, run_type, status, started_at, completed_at, ruleset_version, profile_version, browser, viewport, locale, page_limit, pages_attempted, pages_completed, comparable, comparison_reason, coverage_json, limitations_json, triggered_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
        run.id,
        run.targetId,
        run.runType,
        run.status,
        run.startedAt,
        run.completedAt,
        run.rulesetVersion,
        run.profileVersion,
        run.browser,
        run.viewport,
        run.locale,
        run.pageLimit,
        run.pagesAttempted,
        run.pagesCompleted,
        run.comparable ? 1 : 0,
        run.comparisonReason,
        JSON.stringify(run.coverage),
        JSON.stringify(run.limitations),
        run.triggeredBy,
        run.createdAt,
      ),
    );
  }
  for (const baseline of seedPayload.baselines) {
    statements.push(
      d1.prepare("INSERT OR IGNORE INTO baselines (id, target_id, run_id, version, reason, approved_by, created_at, superseded_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)").bind(
        baseline.id,
        baseline.targetId,
        baseline.runId,
        baseline.version,
        baseline.reason,
        baseline.approvedBy,
        baseline.createdAt,
      ),
    );
  }
  for (const finding of seedPayload.findings) {
    statements.push(
      d1.prepare("INSERT OR IGNORE INTO findings (id, site_id, display_key, title, severity, category, recommendation, acceptance_criteria, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)").bind(
        finding.id,
        finding.siteId,
        finding.displayKey,
        finding.title,
        finding.severity,
        finding.category,
        finding.recommendation,
        finding.acceptanceCriteria,
        SEEDED_AT,
      ),
    );
    for (const state of finding.states) {
      statements.push(
        d1.prepare("INSERT OR IGNORE INTO finding_states (id, finding_id, target_id, status, delta, last_run_id, current_evidence, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
          `${finding.id}:${state.targetId}`,
          finding.id,
          state.targetId,
          state.status,
          state.delta,
          state.lastRunId,
          state.currentEvidence,
          state.updatedAt,
        ),
      );
    }
  }
  for (const observation of seedPayload.observations) {
    statements.push(
      d1.prepare("INSERT OR IGNORE INTO observations (id, target_id, run_id, finding_id, suggested_finding_id, source_channel, url, title, description, expected, actual, review_status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
        observation.id,
        observation.targetId,
        observation.runId,
        observation.findingId,
        observation.suggestedFindingId,
        observation.sourceChannel,
        observation.url,
        observation.title,
        observation.description,
        observation.expected,
        observation.actual,
        observation.reviewStatus,
        observation.createdBy,
        observation.createdAt,
      ),
    );
  }
  statements.push(
    d1.prepare("INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      "demo_seeded",
      "organization",
      organization.id,
      "SiteScout demonstration seed",
      JSON.stringify({ sites: seedPayload.product.sites.length, targets: seedPayload.targets.length, findings: seedPayload.findings.length, synthetic: true }),
      SEEDED_AT,
    ),
  );

  await runBatches(statements);
  await d1.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)").bind("seed_version", SEED_VERSION).run();
}

let readyPromise: Promise<void> | null = null;

export async function ensureDatabase() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = getD1();
      await runBatches(baseSchemaStatements.map((statement) => d1.prepare(statement)));
      await migrateLegacyShape();
      await runBatches(indexStatements.map((statement) => d1.prepare(statement)));
      await d1.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)").bind("schema_version", SCHEMA_VERSION).run();
      await seedDatabase();
      await d1.prepare("PRAGMA optimize").run();
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  await readyPromise;
}

export async function databaseReadiness() {
  await ensureDatabase();
  const d1 = getD1();
  const [meta, organizations, sites, findings, targets, runs, observations, baselines, staffReports, notifications, reportMessages, pilotEvents] = await Promise.all([
    d1.prepare("SELECT key, value FROM schema_meta ORDER BY key").all<{ key: string; value: string }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM organizations").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM sites").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM findings").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM targets").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM audit_runs").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM observations").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM baselines").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM staff_report_workflow").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM notifications").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM report_messages").first<{ count: number }>(),
    d1.prepare("SELECT COUNT(*) AS count FROM pilot_events").first<{ count: number }>(),
  ]);
  return {
    schemaVersion: meta.results.find((row: { key: string; value: string }) => row.key === "schema_version")?.value ?? null,
    seedVersion: meta.results.find((row: { key: string; value: string }) => row.key === "seed_version")?.value ?? null,
    counts: {
      organizations: organizations?.count ?? 0,
      sites: sites?.count ?? 0,
      findings: findings?.count ?? 0,
      targets: targets?.count ?? 0,
      runs: runs?.count ?? 0,
      observations: observations?.count ?? 0,
      baselines: baselines?.count ?? 0,
      staffReports: staffReports?.count ?? 0,
      notifications: notifications?.count ?? 0,
      reportMessages: reportMessages?.count ?? 0,
      pilotEvents: pilotEvents?.count ?? 0,
    },
  };
}
