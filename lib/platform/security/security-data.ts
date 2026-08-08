import type { QualityUser } from "@/app/auth";
import { QualityAuthError } from "@/app/auth";
import { getD1 } from "@/db";
import { isGlobalQualityAdministrator } from "@/lib/platform/site-access-core.mjs";
import { approvedSecurityTargetIds } from "./security-config";
import { computeSecurityMetrics } from "./metrics-core.mjs";
import type { SecurityMetrics } from "./metrics-core.mjs";

export type SecurityTargetOption = { organizationId: string; siteId: string; targetId: string; siteName: string; targetName: string; environment: string };
export type SecurityImportRunRow = {
  id: string; organizationId: string; siteId: string; targetId: string; source: string; sourceVersion: string | null;
  targetLabel: string; scanMode: string | null; imageDigest: string | null; model: string | null; status: string;
  coverageJson: string; limitationsJson: string; artifactSha256: string; candidateCount: number; importedBy: string;
  retentionUntil: string; legalHold: number; deletedAt: string | null; createdAt: string;
};
export type SecurityCandidateRow = {
  id: string; importRunId: string; externalId: string; title: string; severity: string; cwe: string; cvssVector: string;
  endpoint: string; method: string; summary: string; remediation: string; fingerprint: string;
  sanitizationStatus: string; sanitizationFlagsJson: string; reviewStatus: string; firstReviewer: string | null;
  reviewedBy: string | null; secondCheckBy: string | null; reviewNote: string | null; reviewedAt: string | null; createdAt: string;
};
export type SecurityCandidateReviewRow = {
  id: string; candidateId: string; stage: string; decision: string; reviewerEmail: string; note: string;
  reviewMinutes: number | null; createdAt: string;
};

export type { SecurityMetrics } from "./metrics-core.mjs";
export type SecurityReviewView = {
  targets: SecurityTargetOption[];
  imports: SecurityImportRunRow[];
  candidates: SecurityCandidateRow[];
  reviews: SecurityCandidateReviewRow[];
  metrics: SecurityMetrics;
};

export async function loadSecurityReview(user: QualityUser): Promise<SecurityReviewView> {
  if (user.identitySource === "public-preview") throw new QualityAuthError("Authenticated security-review access is required.", 403);
  const targetIds = [...approvedSecurityTargetIds()];
  if (!targetIds.length) return emptyView();
  const d1 = getD1();
  const placeholders = targetIds.map(() => "?").join(", ");
  const global = isGlobalQualityAdministrator(user);
  const targetQuery = global
    ? d1
        .prepare(
          `SELECT s.organization_id AS organizationId, s.id AS siteId, t.id AS targetId, s.name AS siteName,
                  t.name AS targetName, t.environment
           FROM targets t JOIN sites s ON s.id = t.site_id
           WHERE t.active = 1 AND s.active = 1 AND t.id IN (${placeholders})
           ORDER BY s.name, t.environment`,
        )
        .bind(...targetIds)
    : d1
        .prepare(
          `SELECT DISTINCT s.organization_id AS organizationId, s.id AS siteId, t.id AS targetId, s.name AS siteName,
                  t.name AS targetName, t.environment
           FROM targets t JOIN sites s ON s.id = t.site_id
           JOIN quality_user_roles q ON LOWER(q.email) = LOWER(?) AND q.organization_id = s.organization_id
             AND (q.site_id = s.id OR q.site_id = '*') AND q.role = ? AND q.active = 1
           WHERE t.active = 1 AND s.active = 1 AND t.id IN (${placeholders})
           ORDER BY s.name, t.environment`,
        )
        .bind(user.email, user.role, ...targetIds);
  const targets = await targetQuery.all<SecurityTargetOption>();
  if (!targets.results.length) return emptyView();

  const accessibleTargetIds = targets.results.map((target) => target.targetId);
  const accessiblePlaceholders = accessibleTargetIds.map(() => "?").join(", ");
  const imports = await d1
    .prepare(
      `SELECT r.id, r.organization_id AS organizationId, r.site_id AS siteId, r.target_id AS targetId, r.source,
              r.source_version AS sourceVersion, r.target_label AS targetLabel, r.scan_mode AS scanMode,
              r.image_digest AS imageDigest, r.model, r.status, r.coverage_json AS coverageJson,
              r.limitations_json AS limitationsJson, r.artifact_sha256 AS artifactSha256,
              r.candidate_count AS candidateCount, r.imported_by AS importedBy, r.retention_until AS retentionUntil,
              r.legal_hold AS legalHold, r.deleted_at AS deletedAt, r.created_at AS createdAt
       FROM security_import_runs r
       JOIN targets t ON t.id = r.target_id AND t.site_id = r.site_id
       JOIN sites s ON s.id = r.site_id AND s.organization_id = r.organization_id
       WHERE r.target_id IN (${accessiblePlaceholders}) AND t.active = 1 AND s.active = 1
       ORDER BY r.created_at DESC LIMIT 50`,
    )
    .bind(...accessibleTargetIds)
    .all<SecurityImportRunRow>();

  const importIds = imports.results.map((row) => row.id);
  let candidates: SecurityCandidateRow[] = [];
  if (importIds.length) {
    const importPlaceholders = importIds.map(() => "?").join(", ");
    const rows = await d1
      .prepare(
        `SELECT id, import_run_id AS importRunId, external_id AS externalId, title, severity, cwe,
                cvss_vector AS cvssVector, endpoint, method, summary, remediation, fingerprint,
                sanitization_status AS sanitizationStatus, sanitization_flags_json AS sanitizationFlagsJson,
                review_status AS reviewStatus, first_reviewer AS firstReviewer, reviewed_by AS reviewedBy,
                second_check_by AS secondCheckBy, review_note AS reviewNote, reviewed_at AS reviewedAt,
                created_at AS createdAt
         FROM security_candidates WHERE import_run_id IN (${importPlaceholders})
         ORDER BY severity, created_at DESC`,
      )
      .bind(...importIds)
      .all<SecurityCandidateRow>();
    candidates = rows.results;
  }

  let reviews: SecurityCandidateReviewRow[] = [];
  if (importIds.length) {
    const importPlaceholders = importIds.map(() => "?").join(", ");
    const rows = await d1
      .prepare(
        `SELECT r.id, r.candidate_id AS candidateId, r.stage, r.decision, r.reviewer_email AS reviewerEmail,
                r.note, r.review_minutes AS reviewMinutes, r.created_at AS createdAt
         FROM security_candidate_reviews r
         JOIN security_candidates c ON c.id = r.candidate_id
         WHERE c.import_run_id IN (${importPlaceholders})
         ORDER BY r.created_at ASC`,
      )
      .bind(...importIds)
      .all<SecurityCandidateReviewRow>();
    reviews = rows.results;
  }

  const metrics: SecurityMetrics = computeSecurityMetrics(
    candidates.map((candidate) => ({ severity: candidate.severity, reviewStatus: candidate.reviewStatus })),
    imports.results.map((run) => ({ candidateCount: run.candidateCount })),
    reviews.map((review) => ({ minutes: review.reviewMinutes })),
  );
  return { targets: targets.results, imports: imports.results, candidates, reviews, metrics };
}

function emptyView(): SecurityReviewView {
  return { targets: [], imports: [], candidates: [], reviews: [], metrics: computeSecurityMetrics([], [], []) };
}
