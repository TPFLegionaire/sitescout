import { env } from "cloudflare:workers";
import { createHash, randomUUID } from "node:crypto";
import { requireQualityRole } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, requiredText } from "@/lib/platform/validation";
import {
  SEO_SOURCE,
  assertSeoOperation,
  assertWithinBudget,
  estimateOperationCost,
  idempotencyInput,
  monthPrefix,
  normalizeDimensions,
  normalizeSnapshot,
  resolveTargetDomain,
} from "@/lib/platform/seo/dataforseo-core.mjs";
import { fetchDataForSeoSnapshot, monthlyCapUsd, perOperationCapUsd, seoConfigured } from "@/lib/platform/seo/dataforseo";

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function monthlySpend(month: string) {
  const row = await getD1()
    .prepare("SELECT COALESCE(SUM(cost_actual), 0) AS spent FROM seo_snapshot_runs WHERE status = 'completed' AND substr(requested_at, 1, 7) = ?")
    .bind(month)
    .first<{ spent: number }>();
  return Number(row?.spent ?? 0);
}

// Administrator-only. A registered target ID and a fixed operation enum cross the
// boundary — never a free-form URL. Cost is bounded before dispatch; a repeat
// request is idempotent; the raw response is archived privately by hash; and no
// snapshot is ever written to the finding register or a baseline.
export async function POST(request: Request) {
  try {
    const user = await requireQualityRole("administrator");
    await ensureDatabase();

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw Object.assign(new Error("A JSON request body is required."), { status: 400 });
    const siteId = requiredText(body.siteId, "Site", 100);
    const targetId = requiredText(body.targetId, "Target", 100);
    const operation = assertSeoOperation(body.operation);
    const dimensions = normalizeDimensions((body.dimensions ?? {}) as { country?: unknown; language?: unknown; device?: unknown });
    const clientKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : null;

    const d1 = getD1();
    const target = await d1
      .prepare(
        `SELECT s.organization_id AS organizationId, t.id AS targetId, t.site_id AS siteId, t.allowed_host AS allowedHost, t.base_url AS baseUrl
         FROM targets t JOIN sites s ON s.id = t.site_id
         WHERE t.id = ? AND t.site_id = ? AND t.active = 1`,
      )
      .bind(targetId, siteId)
      .first<{ organizationId: string; targetId: string; siteId: string; allowedHost: string; baseUrl: string }>();
    if (!target) return Response.json({ ok: false, error: "Target not found for the selected site." }, { status: 404 });

    const domain = resolveTargetDomain({ allowedHost: target.allowedHost, baseUrl: target.baseUrl });
    const now = new Date().toISOString();
    const idempotencyKey = sha256Hex(new TextEncoder().encode(idempotencyInput({ targetId, operation, dimensions, day: now.slice(0, 10), clientKey })));

    // Idempotency: a completed run for the same key is returned without new billable work.
    const existing = await d1.prepare("SELECT id, status FROM seo_snapshot_runs WHERE idempotency_key = ?").bind(idempotencyKey).first<{ id: string; status: string }>();
    if (existing?.status === "completed") return Response.json({ ok: true, idempotent: true, snapshotRunId: existing.id }, { status: 200, headers: { "cache-control": "no-store" } });
    if (existing?.status === "running") throw Object.assign(new Error("This SEO request is already in progress."), { status: 409 });

    // Single active request at a time (pilot guard against runaway spend/load).
    const inflight = await d1.prepare("SELECT COUNT(*) AS count FROM seo_snapshot_runs WHERE status = 'running'").first<{ count: number }>();
    if (Number(inflight?.count ?? 0) > 0) throw Object.assign(new Error("Another SEO request is in progress. Try again once it completes."), { status: 409 });

    if (!seoConfigured()) throw Object.assign(new Error("The SEO provider is not configured for this deployment."), { status: 503 });
    if (!env.EVIDENCE) throw Object.assign(new Error("Private artifact storage is unavailable."), { status: 503 });

    const estimate = estimateOperationCost(operation);
    assertWithinBudget({ estimate, perOperationCapUsd: perOperationCapUsd(), monthlySpentUsd: await monthlySpend(monthPrefix(now)), monthlyCapUsd: monthlyCapUsd() });

    const runId = randomUUID();
    await d1
      .prepare(
        `INSERT INTO seo_snapshot_runs (id, organization_id, site_id, target_id, source, operation, status, dimensions_json, idempotency_key, cost_estimate, cost_actual, coverage_json, limitations_json, artifact_storage_key, artifact_sha256, requested_by, requested_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, NULL, '{}', '[]', NULL, NULL, ?, ?, NULL)`,
      )
      .bind(runId, target.organizationId, target.siteId, target.targetId, SEO_SOURCE, operation, JSON.stringify(dimensions), idempotencyKey, estimate, user.email, now)
      .run();

    try {
      const { raw, providerReference, costActual } = await fetchDataForSeoSnapshot(operation, domain, dimensions);
      const normalized = normalizeSnapshot(operation, raw, dimensions);
      const bytes = new TextEncoder().encode(JSON.stringify(raw ?? null));
      const artifactSha256 = sha256Hex(bytes);
      const storageKey = `seo-artifacts/${runId}.json`;
      await env.EVIDENCE.put(storageKey, bytes, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { source: SEO_SOURCE, operation, siteId: target.siteId, requestedBy: user.email },
      });

      const completedAt = new Date().toISOString();
      const finalCost = typeof costActual === "number" ? costActual : estimate;
      const statements: D1PreparedStatement[] = [
        d1
          .prepare(
            `UPDATE seo_snapshot_runs SET status = 'completed', cost_actual = ?, coverage_json = ?, limitations_json = ?, artifact_storage_key = ?, artifact_sha256 = ?, completed_at = ? WHERE id = ?`,
          )
          .bind(finalCost, JSON.stringify({ ...normalized.coverage, providerReference }), JSON.stringify(normalized.limitations), storageKey, artifactSha256, completedAt, runId),
        d1
          .prepare(`INSERT INTO pilot_events (id, event_type, observation_id, actor_email, duration_ms, detail_json, created_at) VALUES (?, 'seo_snapshot_captured', NULL, ?, NULL, ?, ?)`)
          .bind(randomUUID(), user.email, JSON.stringify({ runId, operation, hasUsableData: normalized.hasUsableData, metricCount: normalized.metrics.length }), completedAt),
        d1
          .prepare(`INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('seo_snapshot_captured', 'seo_snapshot_run', ?, ?, ?, ?)`)
          .bind(runId, user.email, JSON.stringify({ siteId: target.siteId, targetId: target.targetId, operation, source: SEO_SOURCE, hasUsableData: normalized.hasUsableData }), completedAt),
      ];
      for (const metric of normalized.metrics) {
        statements.push(
          d1
            .prepare(`INSERT INTO seo_snapshot_metrics (id, snapshot_run_id, metric_key, dimension_json, value_json, captured_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(randomUUID(), runId, metric.metricKey, JSON.stringify(metric.dimension), JSON.stringify(metric.value), completedAt),
        );
      }
      await d1.batch(statements);
      return Response.json(
        { ok: true, snapshotRunId: runId, hasUsableData: normalized.hasUsableData, metricCount: normalized.metrics.length, costActual: finalCost, limitations: normalized.limitations },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    } catch (providerError) {
      const message = providerError instanceof Error ? providerError.message : "SEO provider request failed.";
      await d1
        .prepare("UPDATE seo_snapshot_runs SET status = 'failed', limitations_json = ?, completed_at = ? WHERE id = ?")
        .bind(JSON.stringify([`Provider request failed: ${message}`]), new Date().toISOString(), runId)
        .run();
      throw Object.assign(new Error("The SEO provider request failed. No usable snapshot was recorded."), { status: 502 });
    }
  } catch (error) {
    return apiError(error);
  }
}

// Read-only listing for an approved site. No mutation, no provider dispatch.
export async function GET(request: Request) {
  try {
    await requireQualityRole("management_viewer", "validator", "finding_owner", "administrator");
    await ensureDatabase();
    const siteId = requiredText(new URL(request.url).searchParams.get("siteId"), "Site", 100);
    const d1 = getD1();

    const runs = await d1
      .prepare(
        `SELECT id, site_id AS siteId, target_id AS targetId, source, operation, status, dimensions_json AS dimensionsJson, cost_estimate AS costEstimate, cost_actual AS costActual, coverage_json AS coverageJson, limitations_json AS limitationsJson, artifact_sha256 AS artifactSha256, requested_by AS requestedBy, requested_at AS requestedAt, completed_at AS completedAt
         FROM seo_snapshot_runs WHERE site_id = ? ORDER BY requested_at DESC LIMIT 50`,
      )
      .bind(siteId)
      .all<{ id: string; siteId: string; targetId: string; source: string; operation: string; status: string; dimensionsJson: string; costEstimate: number; costActual: number | null; coverageJson: string; limitationsJson: string; artifactSha256: string | null; requestedBy: string; requestedAt: string; completedAt: string | null }>();

    const ids = runs.results.map((row) => row.id);
    let metrics: Array<{ snapshotRunId: string; metricKey: string; dimensionJson: string; valueJson: string; capturedAt: string }> = [];
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(", ");
      const metricRows = await d1
        .prepare(`SELECT snapshot_run_id AS snapshotRunId, metric_key AS metricKey, dimension_json AS dimensionJson, value_json AS valueJson, captured_at AS capturedAt FROM seo_snapshot_metrics WHERE snapshot_run_id IN (${placeholders}) ORDER BY captured_at DESC`)
        .bind(...ids)
        .all<{ snapshotRunId: string; metricKey: string; dimensionJson: string; valueJson: string; capturedAt: string }>();
      metrics = metricRows.results;
    }

    const month = monthPrefix(new Date().toISOString());
    return Response.json(
      {
        ok: true,
        data: {
          snapshots: runs.results,
          metrics,
          budget: { month, monthlySpentUsd: await monthlySpend(month), monthlyCapUsd: monthlyCapUsd(), perOperationCapUsd: perOperationCapUsd() },
          note: "External SEO intelligence. No finding or baseline is created or changed by these snapshots.",
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
