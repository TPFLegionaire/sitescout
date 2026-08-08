type ExpiringSecurityArtifact = {
  id: string;
  organizationId: string;
  siteId: string;
  targetId: string;
  storageKey: string | null;
  retentionUntil: string;
  status: string;
};

export type SecurityRetentionResult = {
  inspected: number;
  expired: number;
  deleted: number;
  failed: number;
};

export function isSecurityArtifactExpired(retentionUntil: string, now: string | Date) {
  const deadline = Date.parse(retentionUntil);
  const nowTime = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowTime)) throw new Error("A valid retention check time is required.");
  return !Number.isFinite(deadline) || deadline <= nowTime;
}

export async function purgeExpiredSecurityArtifacts(
  d1: D1Database,
  evidence: R2Bucket,
  input: { now?: string; actor?: string; limit?: number } = {},
): Promise<SecurityRetentionResult> {
  const now = input.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error("A valid retention check time is required.");
  const actor = input.actor?.trim() || "system:security-retention";
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(Number(input.limit), 1), 250) : 100;
  const rows = await d1
    .prepare(
      `SELECT id, organization_id AS organizationId, site_id AS siteId, target_id AS targetId,
              artifact_storage_key AS storageKey, retention_until AS retentionUntil, status
       FROM security_import_runs
       WHERE deleted_at IS NULL AND legal_hold = 0
       ORDER BY retention_until ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<ExpiringSecurityArtifact>();

  const result: SecurityRetentionResult = { inspected: rows.results.length, expired: 0, deleted: 0, failed: 0 };
  for (const row of rows.results) {
    if (!isSecurityArtifactExpired(row.retentionUntil, now)) continue;
    result.expired += 1;
    const deletedAt = new Date(now).toISOString();
    let claimRecorded = false;
    try {
      const claim = await d1
        .prepare(
          `UPDATE security_import_runs
           SET status = 'artifact_expiring', deleted_at = ?
           WHERE id = ? AND deleted_at IS NULL AND legal_hold = 0 AND retention_until = ?`,
        )
        .bind(deletedAt, row.id, row.retentionUntil)
        .run();
      if (Number(claim.meta?.changes ?? 0) !== 1) continue;
      claimRecorded = true;
      if (row.storageKey) await evidence.delete(row.storageKey);
    } catch (error) {
      result.failed += 1;
      if (claimRecorded) {
        await d1
          .prepare(
            `UPDATE security_import_runs SET status = ?, deleted_at = NULL
             WHERE id = ? AND status = 'artifact_expiring' AND deleted_at = ?`,
          )
          .bind(row.status, row.id, deletedAt)
          .run()
          .catch(() => undefined);
      }
      console.error("SiteScout security artifact retention failed", row.id, error instanceof Error ? error.message : "Unknown error");
      continue;
    }
    try {
      const update = await d1
        .prepare(
          `UPDATE security_import_runs
           SET artifact_storage_key = NULL, deleted_at = ?, status = 'artifact_expired'
           WHERE id = ? AND status = 'artifact_expiring' AND deleted_at = ?`,
        )
        .bind(deletedAt, row.id, deletedAt)
        .run();
      if (Number(update.meta?.changes ?? 0) !== 1) throw new Error("Retention finalisation conflict.");
      await d1
        .prepare(
          `INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at)
           VALUES ('security_artifact_deleted', 'security_import_run', ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          actor,
          JSON.stringify({ organizationId: row.organizationId, siteId: row.siteId, targetId: row.targetId, reason: "retention_expired" }),
          deletedAt,
        )
        .run();
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      console.error("SiteScout security artifact retention failed", row.id, error instanceof Error ? error.message : "Unknown error");
    }
  }
  return result;
}
