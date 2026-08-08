import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, optionalText, requiredText } from "@/lib/platform/validation";
import { resolveReviewDecision } from "@/lib/platform/security/strix-core.mjs";

// Security Reviewer / Administrator classify a candidate. A high or critical
// "reproducible" decision parks the candidate for a second check by a different
// reviewer before it is confirmed. No decision creates a canonical finding.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireQualityCapability("review_security");
    await ensureDatabase();
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw Object.assign(new Error("A JSON request body is required."), { status: 400 });
    const decision = requiredText(body.decision, "Decision", 40);
    const note = optionalText(body.note, 2000);

    const d1 = getD1();
    const candidate = await d1
      .prepare("SELECT id, severity, review_status AS reviewStatus, first_reviewer AS firstReviewer FROM security_candidates WHERE id = ?")
      .bind(id)
      .first<{ id: string; severity: string; reviewStatus: string; firstReviewer: string | null }>();
    if (!candidate) return Response.json({ ok: false, error: "Candidate not found." }, { status: 404 });

    const resolution = resolveReviewDecision({
      current: candidate.reviewStatus,
      decision,
      severity: candidate.severity,
      reviewerEmail: user.email,
      firstReviewerEmail: candidate.firstReviewer,
    });

    const now = new Date().toISOString();
    await d1.batch([
      d1
        .prepare(
          `UPDATE security_candidates SET review_status = ?, first_reviewer = ?, second_check_by = ?, reviewed_by = ?, review_note = COALESCE(?, review_note), reviewed_at = ? WHERE id = ?`,
        )
        .bind(resolution.reviewStatus, resolution.firstReviewer, resolution.secondCheckBy, user.email, note, now, id),
      d1
        .prepare(`INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('security_candidate_reviewed', 'security_candidate', ?, ?, ?, ?)`)
        .bind(id, user.email, JSON.stringify({ decision, reviewStatus: resolution.reviewStatus, awaitingSecondCheck: resolution.awaitingSecondCheck }), now),
    ]);

    return Response.json({ ok: true, reviewStatus: resolution.reviewStatus, awaitingSecondCheck: resolution.awaitingSecondCheck }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
