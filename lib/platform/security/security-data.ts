import { getD1 } from "@/db";
import { computeSecurityMetrics } from "./metrics-core.mjs";
import type { SecurityMetrics } from "./metrics-core.mjs";

export type SecurityImportRunRow = {
  id: string;
  source: string;
  sourceVersion: string | null;
  targetLabel: string;
  scanMode: string | null;
  imageDigest: string | null;
  model: string | null;
  status: string;
  coverageJson: string;
  limitationsJson: string;
  artifactSha256: string;
  candidateCount: number;
  importedBy: string;
  createdAt: string;
};

export type SecurityCandidateRow = {
  id: string;
  importRunId: string;
  externalId: string;
  title: string;
  severity: string;
  cwe: string;
  cvssVector: string;
  endpoint: string;
  method: string;
  summary: string;
  remediation: string;
  fingerprint: string;
  reviewStatus: string;
  firstReviewer: string | null;
  reviewedBy: string | null;
  secondCheckBy: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type { SecurityMetrics } from "./metrics-core.mjs";
export type SecurityReviewView = { imports: SecurityImportRunRow[]; candidates: SecurityCandidateRow[]; metrics: SecurityMetrics };

/** Import runs and their candidates for the review queue. Sanitised fields only. */
export async function loadSecurityReview(): Promise<SecurityReviewView> {
  const d1 = getD1();
  const imports = await d1
    .prepare(
      `SELECT id, source, source_version AS sourceVersion, target_label AS targetLabel, scan_mode AS scanMode, image_digest AS imageDigest, model, status, coverage_json AS coverageJson, limitations_json AS limitationsJson, artifact_sha256 AS artifactSha256, candidate_count AS candidateCount, imported_by AS importedBy, created_at AS createdAt
       FROM security_import_runs ORDER BY created_at DESC LIMIT 50`,
    )
    .all<SecurityImportRunRow>();

  const ids = imports.results.map((row) => row.id);
  let candidates: SecurityCandidateRow[] = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await d1
      .prepare(
        `SELECT id, import_run_id AS importRunId, external_id AS externalId, title, severity, cwe, cvss_vector AS cvssVector, endpoint, method, summary, remediation, fingerprint, review_status AS reviewStatus, first_reviewer AS firstReviewer, reviewed_by AS reviewedBy, second_check_by AS secondCheckBy, review_note AS reviewNote, reviewed_at AS reviewedAt, created_at AS createdAt
         FROM security_candidates WHERE import_run_id IN (${placeholders}) ORDER BY severity, created_at DESC`,
      )
      .bind(...ids)
      .all<SecurityCandidateRow>();
    candidates = rows.results;
  }

  const reviewEventRows = await d1
    .prepare("SELECT duration_ms AS durationMs FROM pilot_events WHERE event_type = 'security_candidate_reviewed'")
    .all<{ durationMs: number | null }>();
  const reviewEvents = reviewEventRows.results.map((row) => ({ minutes: typeof row.durationMs === "number" ? row.durationMs / 60000 : null }));

  const metrics: SecurityMetrics = computeSecurityMetrics(
    candidates.map((candidate) => ({ severity: candidate.severity, reviewStatus: candidate.reviewStatus })),
    imports.results.map((run) => ({ candidateCount: run.candidateCount })),
    reviewEvents,
  );
  return { imports: imports.results, candidates, metrics };
}
