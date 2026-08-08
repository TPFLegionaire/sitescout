import { getD1 } from "@/db";
import { monthPrefix } from "./dataforseo-core.mjs";
import { monthlyCapUsd, perOperationCapUsd } from "./dataforseo";

export type SeoSiteOption = {
  siteId: string;
  siteName: string;
  targets: Array<{ targetId: string; targetName: string; environment: string }>;
};

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
  coverageJson: string;
  limitationsJson: string;
  artifactSha256: string | null;
  requestedBy: string;
  requestedAt: string;
  completedAt: string | null;
};

export type SeoMetricRow = {
  snapshotRunId: string;
  metricKey: string;
  dimensionJson: string;
  valueJson: string;
  capturedAt: string;
};

export type SeoBudget = { month: string; monthlySpentUsd: number; monthlyCapUsd: number; perOperationCapUsd: number };

export type SeoSnapshotView = { snapshots: SeoSnapshotRunRow[]; metrics: SeoMetricRow[]; budget: SeoBudget };

/** Active sites with their active targets, for the administrator trigger. */
export async function listSeoSites(): Promise<SeoSiteOption[]> {
  const rows = await getD1()
    .prepare(
      `SELECT s.id AS siteId, s.name AS siteName, t.id AS targetId, t.name AS targetName, t.environment AS environment
       FROM sites s JOIN targets t ON t.site_id = s.id
       WHERE s.active = 1 AND t.active = 1
       ORDER BY s.name, t.environment`,
    )
    .all<{ siteId: string; siteName: string; targetId: string; targetName: string; environment: string }>();
  const byId = new Map<string, SeoSiteOption>();
  for (const row of rows.results) {
    let site = byId.get(row.siteId);
    if (!site) {
      site = { siteId: row.siteId, siteName: row.siteName, targets: [] };
      byId.set(row.siteId, site);
    }
    site.targets.push({ targetId: row.targetId, targetName: row.targetName, environment: row.environment });
  }
  return [...byId.values()];
}

/** Sum of actual SEO spend for a YYYY-MM bucket. Used by the monthly cap and the read views. */
export async function monthlySpend(month: string): Promise<number> {
  const row = await getD1()
    .prepare("SELECT COALESCE(SUM(cost_actual), 0) AS spent FROM seo_snapshot_runs WHERE status = 'completed' AND substr(requested_at, 1, 7) = ?")
    .bind(month)
    .first<{ spent: number }>();
  return Number(row?.spent ?? 0);
}

/** Read-only snapshot view for one approved site. Shared by the page (SSR) and the GET route. */
export async function loadSeoSnapshotsForSite(siteId: string): Promise<SeoSnapshotView> {
  const d1 = getD1();
  const runs = await d1
    .prepare(
      `SELECT id, site_id AS siteId, target_id AS targetId, source, operation, status, dimensions_json AS dimensionsJson, cost_estimate AS costEstimate, cost_actual AS costActual, coverage_json AS coverageJson, limitations_json AS limitationsJson, artifact_sha256 AS artifactSha256, requested_by AS requestedBy, requested_at AS requestedAt, completed_at AS completedAt
       FROM seo_snapshot_runs WHERE site_id = ? ORDER BY requested_at DESC LIMIT 50`,
    )
    .bind(siteId)
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
    budget: { month, monthlySpentUsd: await monthlySpend(month), monthlyCapUsd: monthlyCapUsd(), perOperationCapUsd: perOperationCapUsd() },
  };
}
