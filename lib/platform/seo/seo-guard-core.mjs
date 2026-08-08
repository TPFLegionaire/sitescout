/** Shared SQL for D1's atomic single-flight and budget reservations. */

export const SEO_COMMITTED_COST_EXPRESSION =
  "CASE WHEN status = 'running' THEN MAX(cost_reserved, COALESCE(cost_actual, 0)) ELSE COALESCE(cost_actual, 0) END";

export const INITIAL_SEO_RESERVATION_SQL = `INSERT INTO seo_snapshot_runs
  (id, organization_id, site_id, target_id, source, operation, status, dimensions_json, idempotency_key,
   cost_estimate, cost_actual, cost_reserved, attempt_count, lease_expires_at, provider_dispatched_at, failure_stage,
   provider_reference, coverage_json, limitations_json, artifact_storage_key, artifact_sha256, requested_by, requested_at, completed_at)
 SELECT ?, ?, ?, ?, 'dataforseo', ?, 'running', ?, ?, ?, NULL, ?, 1, ?, NULL, NULL, NULL, '{}', '[]', NULL, NULL, ?, ?, NULL
 WHERE NOT EXISTS (SELECT 1 FROM seo_snapshot_runs active WHERE active.status = 'running' AND active.lease_expires_at > ?)
   AND (SELECT COALESCE(SUM(${SEO_COMMITTED_COST_EXPRESSION}), 0)
        FROM seo_snapshot_runs WHERE substr(requested_at, 1, 7) = ?) + ? <= ?`;

export const RETRY_SEO_RESERVATION_SQL = `UPDATE seo_snapshot_runs
 SET status = 'running', attempt_count = attempt_count + 1,
     cost_reserved = COALESCE(cost_actual, 0) + ?, lease_expires_at = ?, provider_dispatched_at = NULL,
     failure_stage = NULL, limitations_json = '[]', completed_at = NULL, requested_by = ?
 WHERE id = ? AND status IN ('failed_provider', 'failed_persistence', 'abandoned') AND attempt_count < ?
   AND NOT EXISTS (SELECT 1 FROM seo_snapshot_runs active WHERE active.status = 'running' AND active.lease_expires_at > ?)
   AND (SELECT COALESCE(SUM(${SEO_COMMITTED_COST_EXPRESSION}), 0)
        FROM seo_snapshot_runs WHERE substr(requested_at, 1, 7) = ?) + ? <= ?`;
