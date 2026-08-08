import { env } from "cloudflare:workers";
import { requireQualityCapability, requireQualityRole } from "@/app/auth";
import type { QualityUser } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { requireSiteCapability } from "@/lib/platform/site-access";
import { assertApprovedSecurityTarget } from "@/lib/platform/security/security-config";

type ArtifactRun = {
  id: string; organizationId: string; siteId: string; targetId: string; storageKey: string | null;
  retentionUntil: string; legalHold: number; deletedAt: string | null; status: string; targetActive: number; siteActive: number;
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let user: QualityUser;
  try {
    user = await requireQualityCapability("review_security");
    await ensureDatabase();
    const { id } = await context.params;
    const run = await readArtifactRun(id);
    if (!run) return artifactText("Not found", 404);
    assertApprovedSecurityTarget(run.targetId);
    await requireSiteCapability(user, run.organizationId, run.siteId, "review_security");
    if (Number(run.targetActive) !== 1 || Number(run.siteActive) !== 1) return artifactText("Not found", 404);
    if (run.deletedAt || !run.storageKey) return artifactText("Artifact deleted", 410);
    const retentionTime = Date.parse(run.retentionUntil);
    if (Number(run.legalHold) !== 1 && (!Number.isFinite(retentionTime) || retentionTime <= Date.now())) {
      await deleteArtifact(run, user.email, "retention_expired");
      return artifactText("Artifact retention period expired", 410);
    }
    if (!env.EVIDENCE) return artifactText("Artifact unavailable", 503);
    const object = await env.EVIDENCE.get(run.storageKey);
    if (!object) return artifactText("Not found", 404);
    const now = new Date().toISOString();
    await getD1()
      .prepare(`INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('security_artifact_accessed', 'security_import_run', ?, ?, ?, ?)`)
      .bind(run.id, user.email, JSON.stringify({ organizationId: run.organizationId, siteId: run.siteId, targetId: run.targetId }), now)
      .run();
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, no-store");
    headers.set("content-type", "application/json");
    headers.set("content-disposition", `attachment; filename="strix-import-${id}.json"`);
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  } catch (error) {
    const status = errorStatus(error);
    return artifactText(status === 403 ? "Forbidden" : status === 401 ? "Authentication required" : "Artifact request failed", status);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireQualityRole("administrator");
    await ensureDatabase();
    const { id } = await context.params;
    const run = await readArtifactRun(id);
    if (!run) return artifactText("Not found", 404);
    await requireSiteCapability(user, run.organizationId, run.siteId, "review_security");
    if (Number(run.legalHold) === 1) return artifactText("Artifact is under legal hold", 409);
    if (!run.deletedAt) await deleteArtifact(run, user.email, "administrator_deletion");
    return new Response(null, { status: 204, headers: restrictedHeaders() });
  } catch (error) {
    const status = errorStatus(error);
    return artifactText(status === 403 ? "Forbidden" : status === 401 ? "Authentication required" : "Artifact deletion failed", status);
  }
}

async function readArtifactRun(id: string) {
  return getD1()
    .prepare(
      `SELECT r.id, r.organization_id AS organizationId, r.site_id AS siteId, r.target_id AS targetId,
              r.artifact_storage_key AS storageKey, r.retention_until AS retentionUntil,
              r.legal_hold AS legalHold, r.deleted_at AS deletedAt, r.status,
              t.active AS targetActive, s.active AS siteActive
       FROM security_import_runs r
       JOIN targets t ON t.id = r.target_id AND t.site_id = r.site_id
       JOIN sites s ON s.id = r.site_id AND s.organization_id = r.organization_id
       WHERE r.id = ?`,
    )
    .bind(id)
    .first<ArtifactRun>();
}

async function deleteArtifact(run: ArtifactRun, actor: string, reason: string) {
  const now = new Date().toISOString();
  if (run.storageKey && !env.EVIDENCE) throw Object.assign(new Error("Restricted artifact storage is unavailable."), { status: 503 });
  const d1 = getD1();
  const claimStatus = reason === "retention_expired" ? "artifact_expiring" : "artifact_deleting";
  const claim = await d1
    .prepare("UPDATE security_import_runs SET status = ?, deleted_at = ? WHERE id = ? AND deleted_at IS NULL AND legal_hold = 0")
    .bind(claimStatus, now, run.id)
    .run();
  if (Number(claim.meta?.changes ?? 0) !== 1) throw Object.assign(new Error("Artifact deletion state changed; refresh and try again."), { status: 409 });
  try {
    if (run.storageKey) await env.EVIDENCE!.delete(run.storageKey);
  } catch (error) {
    await d1
      .prepare("UPDATE security_import_runs SET status = ?, deleted_at = NULL WHERE id = ? AND status = ? AND deleted_at = ?")
      .bind(run.status, run.id, claimStatus, now)
      .run()
      .catch(() => undefined);
    throw error;
  }
  await d1.batch([
    d1
      .prepare("UPDATE security_import_runs SET artifact_storage_key = NULL, status = ? WHERE id = ? AND deleted_at = ? AND status = ?")
      .bind(reason === "retention_expired" ? "artifact_expired" : "artifact_deleted", run.id, now, claimStatus),
    d1
      .prepare(
        `INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at)
         SELECT 'security_artifact_deleted', 'security_import_run', ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM security_import_runs WHERE id = ? AND deleted_at = ?)`,
      )
      .bind(run.id, actor, JSON.stringify({ organizationId: run.organizationId, siteId: run.siteId, targetId: run.targetId, reason }), now, run.id, now),
  ]);
}

function errorStatus(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: unknown }).status) : 500;
  return Number.isFinite(status) && status >= 400 && status <= 599 ? status : 500;
}

function artifactText(body: string, status: number) {
  return new Response(body, { status, headers: restrictedHeaders() });
}

function restrictedHeaders() {
  return { "cache-control": "private, no-store", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" };
}
