import { randomUUID } from "node:crypto";
import type { QualityUser } from "@/app/auth";
import { QualityAuthError } from "@/app/auth";
import { getD1 } from "@/db";
import { isGlobalQualityAdministrator } from "@/lib/platform/site-access-core.mjs";
import { requireSiteCapability } from "@/lib/platform/site-access";
import { MAX_SEO_ATTEMPTS, SeoBudgetError, monthPrefix } from "./dataforseo-core.mjs";
import type { SeoDimensions, SeoOperation, SeoProfile } from "./dataforseo-core.mjs";
import { configuredSeoProfile, monthlyCapUsd, perOperationCapUsd } from "./dataforseo";
import { INITIAL_SEO_RESERVATION_SQL, RETRY_SEO_RESERVATION_SQL, SEO_COMMITTED_COST_EXPRESSION } from "./seo-guard-core.mjs";

export type SeoSiteOption = { siteId: string; siteName: string; targets: Array<{ targetId: string; targetName: string; environment: string }> };

export type SeoSnapshotRunRow = {
  id: string;
  siteId: string;
  targetId: string;
  source: string;
  operation: string;
  status: string;
  dimensionsJson: string;
  costEstimate: number;
  costActual: number | null;
  attemptCount: number;
  failureStage: string | null;
  coverageJson: string;
  limitationsJson: string;
  artifactSha256: string | null;
  requestedBy: string;
  requestedAt: string;
  completedAt: string | null;
};

export type SeoMetricRow = { snapshotRunId: string; metricKey: string; dimensionJson: string; valueJson: string; capturedAt: string };
export type SeoBudget = { month: string; monthlySpentUsd: number; monthlyCapUsd: number; perOperationCapUsd: number };
export type SeoSnapshotView = { snapshots: SeoSnapshotRunRow[]; metrics: SeoMetricRow[]; budget: SeoBudget; profile: SeoProfile };

type SeoRunGuardRow = { id: string; status: string; attemptCount: number; costActual: number | null };

export async function listSeoSites(user: QualityUser): Promise<SeoSiteOption[]> {
  if (user.identitySource === "public-preview") throw new QualityAuthError("Authenticated staff access is required for SEO evidence.", 403);
  const d1 = getD1();
  const query = isGlobalQualityAdministrator(user)
    ? d1.prepare(
        `SELECT s.id AS siteId, s.name AS siteName, t.id AS targetId, t.name AS targetName, t.environment AS environment
         FROM sites s JOIN targets t ON t.site_id = s.id
         WHERE s.active = 1 AND t.active = 1
         ORDER BY s.name, t.environment`,
      )
    : d1
        .prepare(
          `SELECT DISTINCT s.id AS siteId, s.name AS siteName, t.id AS targetId, t.name AS targetName, t.environment AS environment
           FROM sites s
           JOIN targets t ON t.site_id = s.id
           JOIN quality_user_roles r ON LOWER(r.email) = LOWER(?) AND r.organization_id = s.organization_id
             AND (r.site_id = s.id OR r.site_id = '*') AND r.role = ? AND r.active = 1
           WHERE s.active = 1 AND t.active = 1
           ORDER BY s.name, t.environment`,
        )
        .bind(user.email, user.role);
  const rows = await query.all<{ siteId: string; siteName: string; targetId: string; targetName: string; environment: string }>();
  const byId = new Map<string, SeoSiteOption>();
  for (const row of rows.results) {
    const site = byId.get(row.siteId) ?? { siteId: row.siteId, siteName: row.siteName, targets: [] };
    site.targets.push({ targetId: row.targetId, targetName: row.targetName, environment: row.environment });
    byId.set(row.siteId, site);
  }
  return [...byId.values()];
}

/** Actual provider cost plus active reservations for the deployment or one organisation. */
export async function monthlySpend(month: string, organizationId?: string): Promise<number> {
  const d1 = getD1();
  const sql = `SELECT COALESCE(SUM(${SEO_COMMITTED_COST_EXPRESSION}), 0) AS spent
    FROM seo_snapshot_runs WHERE substr(requested_at, 1, 7) = ?${organizationId ? " AND organization_id = ?" : ""}`;
  const statement = d1.prepare(sql);
  const row = organizationId
    ? await statement.bind(month, organizationId).first<{ spent: number }>()
    : await statement.bind(month).first<{ spent: number }>();
  return Number(row?.spent ?? 0);
}

export async function reserveSeoSnapshotRun(input: {
  organizationId: string;
  siteId: string;
  targetId: string;
  operation: SeoOperation;
  dimensions: SeoDimensions;
  idempotencyKey: string;
  estimate: number;
  requestedBy: string;
  now: string;
  leaseExpiresAt: string;
  monthlyCap: number;
}) {
  const d1 = getD1();
  await d1
    .prepare(
      `UPDATE seo_snapshot_runs SET status = 'abandoned', failure_stage = 'lease_expired', lease_expires_at = NULL,
         limitations_json = '["The previous request lease expired before completion."]', completed_at = ?
       WHERE status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
    )
    .bind(input.now, input.now)
    .run();

  let existing = await readGuardRun(input.idempotencyKey);
  if (existing?.status === "completed") return { idempotent: true as const, runId: existing.id, attemptCount: existing.attemptCount, previousActual: existing.costActual ?? 0 };
  if (existing?.status === "running") throw Object.assign(new Error("This SEO request is already in progress."), { status: 409 });
  if (existing && existing.attemptCount >= MAX_SEO_ATTEMPTS) throw Object.assign(new Error("This SEO request reached its retry limit."), { status: 409 });

  const runId = existing?.id ?? randomUUID();
  let result: D1Result<unknown>;
  if (existing) {
    result = await d1
      .prepare(RETRY_SEO_RESERVATION_SQL)
      .bind(input.estimate, input.leaseExpiresAt, input.requestedBy, runId, MAX_SEO_ATTEMPTS, input.now, monthPrefix(input.now), input.estimate, input.monthlyCap)
      .run();
  } else {
    try {
      result = await d1
        .prepare(INITIAL_SEO_RESERVATION_SQL)
        .bind(
          runId,
          input.organizationId,
          input.siteId,
          input.targetId,
          input.operation,
          JSON.stringify(input.dimensions),
          input.idempotencyKey,
          input.estimate,
          input.estimate,
          input.leaseExpiresAt,
          input.requestedBy,
          input.now,
          input.now,
          monthPrefix(input.now),
          input.estimate,
          input.monthlyCap,
        )
        .run();
    } catch (error) {
      existing = await readGuardRun(input.idempotencyKey);
      if (existing?.status === "completed") return { idempotent: true as const, runId: existing.id, attemptCount: existing.attemptCount, previousActual: existing.costActual ?? 0 };
      if (existing?.status === "running") throw Object.assign(new Error("This SEO request is already in progress."), { status: 409 });
      throw error;
    }
  }

  if (Number(result.meta?.changes ?? 0) !== 1) {
    const inflight = await d1.prepare("SELECT id FROM seo_snapshot_runs WHERE status = 'running' AND lease_expires_at > ? LIMIT 1").bind(input.now).first<{ id: string }>();
    if (inflight) throw Object.assign(new Error("Another SEO request is in progress. Try again once it completes."), { status: 409 });
    const committed = await monthlySpend(monthPrefix(input.now));
    if (committed + input.estimate > input.monthlyCap) {
      throw new SeoBudgetError(`This request would exceed the monthly SEO cap $${input.monthlyCap.toFixed(2)} (already committed $${committed.toFixed(2)}).`);
    }
    throw Object.assign(new Error("The SEO request could not be reserved safely."), { status: 409 });
  }

  const claimed = await readGuardRun(input.idempotencyKey);
  return { idempotent: false as const, runId, attemptCount: claimed?.attemptCount ?? 1, previousActual: existing?.costActual ?? 0 };
}

export async function markSeoProviderDispatched(runId: string, dispatchedAt: string) {
  const result = await getD1()
    .prepare("UPDATE seo_snapshot_runs SET provider_dispatched_at = ? WHERE id = ? AND status = 'running'")
    .bind(dispatchedAt, runId)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error("SEO request lease was lost before provider dispatch.");
}

export async function recordSeoProviderCost(runId: string, totalCost: number, providerReference: string | null) {
  const result = await getD1()
    .prepare(
      `UPDATE seo_snapshot_runs SET cost_actual = ?, cost_reserved = ?, provider_reference = ?
       WHERE id = ? AND status = 'running'`,
    )
    .bind(totalCost, totalCost, providerReference, runId)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error("SEO request lease was lost after provider dispatch.");
}

export async function markSeoRunFailed(input: {
  runId: string;
  stage: "provider" | "persistence";
  limitation: string;
  completedAt: string;
  costActual?: number | null;
  providerReference?: string | null;
  artifactStorageKey?: string | null;
  artifactSha256?: string | null;
}) {
  await getD1()
    .prepare(
      `UPDATE seo_snapshot_runs SET status = ?, failure_stage = ?, limitations_json = ?, completed_at = ?, lease_expires_at = NULL,
         cost_actual = COALESCE(?, cost_actual), cost_reserved = COALESCE(?, cost_actual, 0),
         provider_reference = COALESCE(?, provider_reference), artifact_storage_key = COALESCE(?, artifact_storage_key),
         artifact_sha256 = COALESCE(?, artifact_sha256)
       WHERE id = ?`,
    )
    .bind(
      input.stage === "provider" ? "failed_provider" : "failed_persistence",
      input.stage,
      JSON.stringify([input.limitation]),
      input.completedAt,
      input.costActual ?? null,
      input.costActual ?? null,
      input.providerReference ?? null,
      input.artifactStorageKey ?? null,
      input.artifactSha256 ?? null,
      input.runId,
    )
    .run();
}

export async function loadSeoSnapshotsForSite(user: QualityUser, siteId: string): Promise<SeoSnapshotView> {
  const d1 = getD1();
  const site = await d1.prepare("SELECT organization_id AS organizationId FROM sites WHERE id = ? AND active = 1").bind(siteId).first<{ organizationId: string }>();
  if (!site) throw Object.assign(new Error("Website not found."), { status: 404 });
  await requireSiteCapability(user, site.organizationId, siteId, "view_seo");

  const runs = await d1
    .prepare(
      `SELECT id, site_id AS siteId, target_id AS targetId, source, operation, status, dimensions_json AS dimensionsJson,
              cost_estimate AS costEstimate, cost_actual AS costActual, attempt_count AS attemptCount, failure_stage AS failureStage,
              coverage_json AS coverageJson, limitations_json AS limitationsJson, artifact_sha256 AS artifactSha256,
              requested_by AS requestedBy, requested_at AS requestedAt, completed_at AS completedAt
       FROM seo_snapshot_runs WHERE organization_id = ? AND site_id = ? ORDER BY requested_at DESC LIMIT 50`,
    )
    .bind(site.organizationId, siteId)
    .all<SeoSnapshotRunRow>();

  const ids = runs.results.map((row) => row.id);
  let metrics: SeoMetricRow[] = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(", ");
    const metricRows = await d1
      .prepare(`SELECT snapshot_run_id AS snapshotRunId, metric_key AS metricKey, dimension_json AS dimensionJson, value_json AS valueJson, captured_at AS capturedAt FROM seo_snapshot_metrics WHERE snapshot_run_id IN (${placeholders}) ORDER BY captured_at DESC`)
      .bind(...ids)
      .all<SeoMetricRow>();
    metrics = metricRows.results;
  }

  const month = monthPrefix(new Date().toISOString());
  return {
    snapshots: runs.results,
    metrics,
    budget: { month, monthlySpentUsd: await monthlySpend(month, site.organizationId), monthlyCapUsd: monthlyCapUsd(), perOperationCapUsd: perOperationCapUsd() },
    profile: configuredSeoProfile(),
  };
}

async function readGuardRun(idempotencyKey: string) {
  return getD1()
    .prepare("SELECT id, status, attempt_count AS attemptCount, cost_actual AS costActual FROM seo_snapshot_runs WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .first<SeoRunGuardRow>();
}
