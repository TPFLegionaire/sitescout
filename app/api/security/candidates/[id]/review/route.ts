import { randomUUID } from "node:crypto";
import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { requireSiteCapability } from "@/lib/platform/site-access";
import { apiError, requiredText } from "@/lib/platform/validation";
import { StrixConflictError, resolveReviewDecision, sanitizeReviewNote } from "@/lib/platform/security/strix-core.mjs";

const MAX_REVIEW_BODY_BYTES = 16 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireQualityCapability("review_security");
    await ensureDatabase();
    const { id } = await context.params;
    const body = await readReviewBody(request);
    const decision = requiredText(body.decision, "Decision", 40);
    const note = sanitizeReviewNote(body.note ?? "", 2000);
    const reviewMinutes = optionalReviewMinutes(body.reviewMinutes);

    const d1 = getD1();
    const candidate = await d1
      .prepare(
        `SELECT c.id, c.severity, c.review_status AS reviewStatus, c.first_reviewer AS firstReviewer,
                r.organization_id AS organizationId, r.site_id AS siteId, r.target_id AS targetId
         FROM security_candidates c
         JOIN security_import_runs r ON r.id = c.import_run_id
         JOIN targets t ON t.id = r.target_id AND t.site_id = r.site_id AND t.active = 1
         JOIN sites s ON s.id = r.site_id AND s.organization_id = r.organization_id AND s.active = 1
         WHERE c.id = ?`,
      )
      .bind(id)
      .first<{ id: string; severity: string; reviewStatus: string; firstReviewer: string | null; organizationId: string; siteId: string; targetId: string }>();
    if (!candidate) return Response.json({ ok: false, error: "Candidate not found." }, { status: 404 });
    await requireSiteCapability(user, candidate.organizationId, candidate.siteId, "review_security");

    const resolution = resolveReviewDecision({
      current: candidate.reviewStatus,
      decision,
      severity: candidate.severity,
      reviewerEmail: user.email,
      firstReviewerEmail: candidate.firstReviewer,
    });
    const reviewId = randomUUID();
    const eventId = randomUUID();
    const now = new Date().toISOString();
    const secondGuard = resolution.stage === "second" ? " AND LOWER(first_reviewer) <> LOWER(?)" : "";
    const insertBindings: unknown[] = [reviewId, id, resolution.stage, decision, user.email, note, reviewMinutes, now, id, resolution.expectedCurrent];
    const updateBindings: unknown[] = [resolution.reviewStatus, resolution.firstReviewer, resolution.secondCheckBy, user.email, note, now, id, resolution.expectedCurrent];
    if (resolution.stage === "second") {
      insertBindings.push(user.email);
      updateBindings.push(user.email);
    }
    let results: D1Result<unknown>[];
    try {
      results = await d1.batch([
        d1
          .prepare(
            `INSERT INTO security_candidate_reviews (id, candidate_id, stage, decision, reviewer_email, note, review_minutes, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM security_candidates
             WHERE id = ? AND review_status = ?${secondGuard}`,
          )
          .bind(...insertBindings),
        d1
          .prepare(
            `UPDATE security_candidates SET review_status = ?, first_reviewer = ?, second_check_by = ?,
               reviewed_by = ?, review_note = ?, reviewed_at = ?
             WHERE id = ? AND review_status = ?${secondGuard}`,
          )
          .bind(...updateBindings),
        d1
          .prepare(
            `INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at)
             SELECT 'security_candidate_reviewed', 'security_candidate', ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM security_candidate_reviews WHERE id = ?)`,
          )
          .bind(id, user.email, JSON.stringify({ organizationId: candidate.organizationId, siteId: candidate.siteId, targetId: candidate.targetId, decision, stage: resolution.stage, reviewStatus: resolution.reviewStatus, awaitingSecondCheck: resolution.awaitingSecondCheck }), now, reviewId),
        d1
          .prepare(
            `INSERT INTO pilot_events (id, event_type, observation_id, actor_email, duration_ms, detail_json, created_at)
             SELECT ?, 'security_candidate_reviewed', NULL, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM security_candidate_reviews WHERE id = ?)`,
          )
          .bind(eventId, user.email, reviewMinutes != null ? Math.round(reviewMinutes * 60000) : null, JSON.stringify({ candidateId: id, organizationId: candidate.organizationId, siteId: candidate.siteId, severity: candidate.severity, decision, stage: resolution.stage, reviewStatus: resolution.reviewStatus }), now, reviewId),
      ]);
    } catch (error) {
      if (isReviewStageConflict(error)) throw new StrixConflictError("This review stage was already recorded. Refresh the candidate before trying again.");
      throw error;
    }
    if (Number(results[0]?.meta?.changes ?? 0) !== 1 || Number(results[1]?.meta?.changes ?? 0) !== 1) {
      throw new StrixConflictError("The candidate changed while it was being reviewed. Refresh and try again.");
    }
    return Response.json({ ok: true, reviewStatus: resolution.reviewStatus, awaitingSecondCheck: resolution.awaitingSecondCheck }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

function optionalReviewMinutes(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 600) {
    throw Object.assign(new Error("Review minutes must be a number greater than 0 and no more than 600."), { status: 400 });
  }
  return parsed;
}

function isReviewStageConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /UNIQUE constraint failed:\s*security_candidate_reviews\.(?:candidate_id|stage)/i.test(message);
}

async function readReviewBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REVIEW_BODY_BYTES) {
    throw Object.assign(new Error("The review request is too large."), { status: 400 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_REVIEW_BODY_BYTES) throw Object.assign(new Error("The review request is too large."), { status: 400 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw Object.assign(new Error("A valid UTF-8 JSON request body is required."), { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("A JSON object is required."), { status: 400 });
  }
  return parsed as Record<string, unknown>;
}
