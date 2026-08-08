import { env } from "cloudflare:workers";
import { createHash, randomUUID } from "node:crypto";
import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { requireSiteCapability } from "@/lib/platform/site-access";
import { apiError, requiredText } from "@/lib/platform/validation";
import {
  SEO_LEASE_MS,
  SEO_SOURCE,
  SeoProviderError,
  assertSeoOperation,
  assertWithinBudget,
  effectiveDimensions,
  estimateOperationCost,
  idempotencyInput,
  normalizeSnapshot,
  resolveTargetDomain,
} from "@/lib/platform/seo/dataforseo-core.mjs";
import { configuredSeoProfile, fetchDataForSeoSnapshot, monthlyCapUsd, perOperationCapUsd, seoConfigured } from "@/lib/platform/seo/dataforseo";
import {
  loadSeoSnapshotsForSite,
  markSeoProviderDispatched,
  markSeoRunFailed,
  recordSeoProviderCost,
  reserveSeoSnapshotRun,
} from "@/lib/platform/seo/seo-data";

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function POST(request: Request) {
  try {
    const user = await requireQualityCapability("capture_seo");
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw Object.assign(new Error("A JSON request body is required."), { status: 400 });
    const siteId = requiredText(body.siteId, "Site", 100);
    const targetId = requiredText(body.targetId, "Target", 100);
    const operation = assertSeoOperation(body.operation);
    const clientKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : null;

    const d1 = getD1();
    const target = await d1
      .prepare(
        `SELECT s.organization_id AS organizationId, t.id AS targetId, t.site_id AS siteId,
                t.allowed_host AS allowedHost, t.base_url AS baseUrl
         FROM targets t JOIN sites s ON s.id = t.site_id
         WHERE t.id = ? AND t.site_id = ? AND t.active = 1 AND s.active = 1`,
      )
      .bind(targetId, siteId)
      .first<{ organizationId: string; targetId: string; siteId: string; allowedHost: string; baseUrl: string }>();
    if (!target) return Response.json({ ok: false, error: "Target not found for the selected site." }, { status: 404 });
    await requireSiteCapability(user, target.organizationId, target.siteId, "capture_seo");

    if (!seoConfigured()) throw Object.assign(new Error("The SEO provider is not configured for this deployment."), { status: 503 });
    if (!env.EVIDENCE) throw Object.assign(new Error("Private artifact storage is unavailable."), { status: 503 });

    const profile = configuredSeoProfile();
    const dimensions = effectiveDimensions(operation, profile);
    const domain = resolveTargetDomain(target);
    const now = new Date().toISOString();
    const estimate = estimateOperationCost(operation);
    assertWithinBudget({ estimate, perOperationCapUsd: perOperationCapUsd(), monthlySpentUsd: 0, monthlyCapUsd: monthlyCapUsd() });
    const canonicalInput = idempotencyInput({
      organizationId: target.organizationId,
      siteId: target.siteId,
      targetId: target.targetId,
      operation,
      dimensions,
      day: now.slice(0, 10),
      clientKey,
    });
    const idempotencyKey = sha256Hex(new TextEncoder().encode(canonicalInput));
    const reservation = await reserveSeoSnapshotRun({
      organizationId: target.organizationId,
      siteId: target.siteId,
      targetId: target.targetId,
      operation,
      dimensions,
      idempotencyKey,
      estimate,
      requestedBy: user.email,
      now,
      leaseExpiresAt: new Date(Date.now() + SEO_LEASE_MS).toISOString(),
      monthlyCap: monthlyCapUsd(),
    });
    if (reservation.idempotent) {
      return Response.json({ ok: true, idempotent: true, snapshotRunId: reservation.runId }, { status: 200, headers: { "cache-control": "no-store" } });
    }

    const runId = reservation.runId;
    let providerSucceeded = false;
    let totalCost = reservation.previousActual;
    let providerReference: string | null = null;
    let storageKey: string | null = null;
    let artifactSha256: string | null = null;
    try {
      await markSeoProviderDispatched(runId, new Date().toISOString());
      const provider = await fetchDataForSeoSnapshot(operation, domain, profile);
      providerSucceeded = true;
      providerReference = provider.providerReference;
      totalCost += provider.costActual ?? estimate;
      await recordSeoProviderCost(runId, totalCost, providerReference);

      const normalized = normalizeSnapshot(operation, provider.raw, dimensions);
      const archived = await archiveRawProviderResponse({
        raw: provider.raw,
        organizationId: target.organizationId,
        siteId: target.siteId,
        runId,
        attemptCount: reservation.attemptCount,
        operation,
      });
      storageKey = archived.storageKey;
      artifactSha256 = archived.artifactSha256;
      const completedAt = new Date().toISOString();
      const statements: D1PreparedStatement[] = [
        d1
          .prepare(
            `UPDATE seo_snapshot_runs SET status = 'completed', failure_stage = NULL, cost_actual = ?, cost_reserved = ?,
               coverage_json = ?, limitations_json = ?, artifact_storage_key = ?, artifact_sha256 = ?,
               provider_reference = ?, lease_expires_at = NULL, completed_at = ?
             WHERE id = ? AND status = 'running'`,
          )
          .bind(totalCost, totalCost, JSON.stringify({ ...normalized.coverage, providerReference }), JSON.stringify(normalized.limitations), storageKey, artifactSha256, providerReference, completedAt, runId),
      ];
      for (const metric of normalized.metrics) {
        statements.push(
          d1
            .prepare(
              `INSERT INTO seo_snapshot_metrics (id, snapshot_run_id, metric_key, dimension_json, value_json, captured_at)
               SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
                 SELECT 1 FROM seo_snapshot_runs WHERE id = ? AND status = 'completed' AND artifact_sha256 = ?
               )`,
            )
            .bind(randomUUID(), runId, metric.metricKey, JSON.stringify(metric.dimension), JSON.stringify(metric.value), completedAt, runId, artifactSha256),
        );
      }
      statements.push(
        d1
          .prepare(
            `INSERT INTO pilot_events (id, event_type, observation_id, actor_email, duration_ms, detail_json, created_at)
             SELECT ?, 'seo_snapshot_captured', NULL, ?, NULL, ?, ? WHERE EXISTS (
               SELECT 1 FROM seo_snapshot_runs WHERE id = ? AND status = 'completed' AND artifact_sha256 = ?
             )`,
          )
          .bind(randomUUID(), user.email, JSON.stringify({ runId, operation, hasUsableData: normalized.hasUsableData, metricCount: normalized.metrics.length }), completedAt, runId, artifactSha256),
        d1
          .prepare(
            `INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at)
             SELECT 'seo_snapshot_captured', 'seo_snapshot_run', ?, ?, ?, ? WHERE EXISTS (
               SELECT 1 FROM seo_snapshot_runs WHERE id = ? AND status = 'completed' AND artifact_sha256 = ?
             )`,
          )
          .bind(runId, user.email, JSON.stringify({ organizationId: target.organizationId, siteId: target.siteId, targetId: target.targetId, operation, source: SEO_SOURCE, hasUsableData: normalized.hasUsableData }), completedAt, runId, artifactSha256),
      );
      const results = await d1.batch(statements);
      if (Number(results[0]?.meta?.changes ?? 0) !== 1) throw new Error("SEO snapshot finalisation lost its active lease.");
      return Response.json(
        { ok: true, snapshotRunId: runId, hasUsableData: normalized.hasUsableData, metricCount: normalized.metrics.length, costActual: totalCost, limitations: normalized.limitations },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      const providerError = error instanceof SeoProviderError ? error : null;
      if (providerError) {
        providerReference = providerError.providerReference;
        if (typeof providerError.costActual === "number") totalCost += providerError.costActual;
        if (providerError.raw !== null) {
          try {
            const archived = await archiveRawProviderResponse({ raw: providerError.raw, organizationId: target.organizationId, siteId: target.siteId, runId, attemptCount: reservation.attemptCount, operation });
            storageKey = archived.storageKey;
            artifactSha256 = archived.artifactSha256;
          } catch {
            // The sanitized run status remains authoritative if private archival is unavailable.
          }
        }
      }
      if (providerSucceeded && storageKey) {
        try { await env.EVIDENCE.delete(storageKey); } catch { /* best-effort orphan prevention */ }
        storageKey = null;
        artifactSha256 = null;
      }
      const stage = providerSucceeded ? "persistence" : "provider";
      try {
        await markSeoRunFailed({
          runId,
          stage,
          limitation: stage === "provider" ? "The provider request failed; no usable snapshot was recorded." : "The provider responded, but the snapshot could not be persisted safely.",
          completedAt: new Date().toISOString(),
          costActual: totalCost > 0 ? totalCost : null,
          providerReference,
          artifactStorageKey: storageKey,
          artifactSha256,
        });
      } catch {
        // A stale running lease is recovered by the next reservation attempt.
      }
      throw Object.assign(new Error(stage === "provider" ? "The SEO provider request failed. No usable snapshot was recorded." : "The SEO provider responded, but the snapshot could not be persisted safely."), { status: 502 });
    }
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireQualityCapability("view_seo");
    await ensureDatabase();
    const siteId = requiredText(new URL(request.url).searchParams.get("siteId"), "Site", 100);
    const data = await loadSeoSnapshotsForSite(user, siteId);
    return Response.json(
      { ok: true, data: { ...data, note: "External SEO intelligence. No finding or baseline is created or changed by these snapshots." } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

async function archiveRawProviderResponse(input: {
  raw: unknown;
  organizationId: string;
  siteId: string;
  runId: string;
  attemptCount: number;
  operation: string;
}) {
  const bytes = new TextEncoder().encode(JSON.stringify(input.raw ?? null));
  const artifactSha256 = sha256Hex(bytes);
  const storageKey = `seo-artifacts/${input.organizationId}/${input.siteId}/${input.runId}-attempt-${input.attemptCount}.json`;
  await env.EVIDENCE.put(storageKey, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { source: SEO_SOURCE, operation: input.operation, organizationId: input.organizationId, siteId: input.siteId, sha256: artifactSha256 },
  });
  return { storageKey, artifactSha256 };
}
