import { randomUUID } from "node:crypto";
import { requireQualityRole } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, optionalText, requiredText } from "@/lib/platform/validation";
import auditScope from "@/config/audit-scope.json";

const decisions = new Set(["confirm", "link", "support", "accept_new", "needs_info", "reject"]);
const severities = new Set(["critical", "high", "medium", "low"]);
// What the shared register shows for a finding that came from a restricted security report.
const restrictedRegisterEntry = {
  title: "Restricted security finding",
  recommendation: "Follow the restricted security report. Its detail is limited to Validators, Administrators and the assigned Finding Owner.",
  acceptanceCriteria: "Agreed on the restricted security report and confirmed by a Validator re-test.",
  evidence: "Held on the restricted security report.",
  source: "staff-report:restricted",
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireQualityRole("validator", "administrator");
    await ensureDatabase();
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const decision = requiredText(body.decision, "Decision", 30);
    if (!decisions.has(decision)) throw Object.assign(new Error("Invalid review decision."), { status: 400 });
    const requestedFindingId = optionalText(body.findingId, 100);
    const note = optionalText(body.note, 2000) ?? "";
    if (decision === "needs_info" && !note) throw Object.assign(new Error("Explain what additional information the reporter should provide."), { status: 400 });
    const d1 = getD1();
    const observation = await d1.prepare(`
      SELECT o.id, o.target_id AS targetId, t.site_id AS siteId, o.suggested_finding_id AS suggestedFindingId, o.source_channel AS sourceChannel,
             created_by AS createdBy, title, description, expected, actual, review_status AS reviewStatus,
             COALESCE((SELECT p.classification FROM report_privacy p WHERE p.observation_id = o.id), 'standard') AS classification
      FROM observations o JOIN targets t ON t.id = o.target_id WHERE o.id = ?
    `).bind(id).first<{ id: string; targetId: string; siteId: string; suggestedFindingId: string | null; sourceChannel: string; createdBy: string; title: string; description: string; expected: string; actual: string; reviewStatus: string; classification: string }>();
    if (!observation) return Response.json({ ok: false, error: "Observation not found" }, { status: 404 });
    if (!["pending", "needs_info"].includes(observation.reviewStatus)) throw Object.assign(new Error("This observation already has a final review decision."), { status: 409 });
    if (observation.sourceChannel !== "human" && new Set(["support", "accept_new", "needs_info"]).has(decision)) throw Object.assign(new Error("This decision is available only for staff reports."), { status: 400 });

    let canonicalId = decision === "reject" || decision === "needs_info" ? null : requestedFindingId ?? observation.suggestedFindingId;
    const statements: D1PreparedStatement[] = [];
    const now = new Date().toISOString();

    if (decision === "accept_new") {
      const severity = optionalText(body.severity, 20) ?? "medium";
      if (!severities.has(severity)) throw Object.assign(new Error("Invalid severity."), { status: 400 });
      canonicalId = `SC-${now.slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
      // Every operator role and the Management Viewer read the register, so a restricted report contributes none of its text and not its id.
      const register = observation.classification === "restricted_security" ? restrictedRegisterEntry : {
        title: observation.title,
        recommendation: optionalText(body.recommendation, 2000) ?? `Investigate the staff report and correct the behaviour described as: ${observation.actual}`,
        acceptanceCriteria: optionalText(body.acceptanceCriteria, 2000) ?? observation.expected,
        evidence: observation.description,
        source: `staff-report:${id}`,
      };
      statements.push(
        d1.prepare("INSERT INTO findings (id, site_id, display_key, title, severity, category, recommendation, acceptance_criteria, owner, created_at) VALUES (?, ?, ?, ?, ?, 'Staff report', ?, ?, NULL, ?)").bind(canonicalId, observation.siteId, canonicalId, register.title, severity, register.recommendation, register.acceptanceCriteria, now),
        d1.prepare("INSERT INTO finding_states (id, finding_id, target_id, status, delta, last_run_id, current_evidence, updated_at) VALUES (?, ?, ?, 'open', 'New staff-validated finding', ?, ?, ?)").bind(`${canonicalId}:${observation.targetId}`, canonicalId, observation.targetId, register.source, register.evidence, now),
      );
    } else if (canonicalId) {
      if ((auditScope.excludedFindings as Array<{ id: string }>).some((finding) => finding.id === canonicalId)) throw Object.assign(new Error("That finding is governed through a separate workstream and cannot be linked in this audit queue."), { status: 409 });
      const exists = await d1.prepare("SELECT id FROM findings WHERE id = ? AND site_id = ?").bind(canonicalId, observation.siteId).first();
      if (!exists) return Response.json({ ok: false, error: "Canonical finding not found" }, { status: 404 });
    } else if (!new Set(["reject", "needs_info"]).has(decision)) {
      throw Object.assign(new Error("Select a canonical finding or accept this as a new finding."), { status: 400 });
    }

    const reviewStatus = decision === "reject" ? "rejected" : decision === "needs_info" ? "needs_info" : "confirmed";
    const workflowStatus = decision === "reject" ? "rejected" : decision === "needs_info" ? "needs_info" : decision === "accept_new" ? "accepted" : decision === "support" || decision === "link" ? "supporting_evidence" : "accepted";
    statements.push(
      d1.prepare("UPDATE observations SET review_status = ?, finding_id = ? WHERE id = ?").bind(reviewStatus, canonicalId, id),
      d1.prepare("INSERT INTO review_decisions (id, observation_id, decision, finding_id, note, reviewer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(randomUUID(), id, decision, canonicalId, note, user.email, now),
      d1.prepare("INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('observation_reviewed', 'observation', ?, ?, ?, ?)").bind(id, user.email, JSON.stringify({ decision, findingId: canonicalId, note, workflowStatus }), now),
    );

    if (observation.sourceChannel === "human") {
      const notification = notificationFor(workflowStatus, observation.title, canonicalId);
      statements.push(
        d1.prepare(`
          INSERT INTO staff_report_workflow (observation_id, status, triage_method, triage_json, duplicate_finding_id, assigned_to, updated_by, created_at, updated_at)
          VALUES (?, ?, 'legacy-review', '{}', ?, NULL, ?, ?, ?)
          ON CONFLICT(observation_id) DO UPDATE SET status = excluded.status, duplicate_finding_id = excluded.duplicate_finding_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at
        `).bind(id, workflowStatus, canonicalId, user.email, now, now),
        d1.prepare("INSERT INTO notifications (id, recipient_email, event_type, observation_id, finding_id, title, body, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)").bind(randomUUID(), observation.createdBy, notification.eventType, id, canonicalId, notification.title, notification.body, now),
        d1.prepare("INSERT INTO pilot_events (id, event_type, observation_id, actor_email, duration_ms, detail_json, created_at) VALUES (?, 'report_reviewed', ?, ?, NULL, ?, ?)").bind(randomUUID(), id, user.email, JSON.stringify({ decision, findingId: canonicalId }), now),
      );
      if (decision === "needs_info") statements.push(
        d1.prepare("INSERT INTO report_messages (id, observation_id, author_email, author_role, message_type, body, evidence_asset_id, created_at) VALUES (?, ?, ?, ?, 'information_request', ?, NULL, ?)").bind(randomUUID(), id, user.email, user.role, note, now),
      );
    }

    await d1.batch(statements);
    return Response.json({ ok: true, findingId: canonicalId, workflowStatus });
  } catch (error) { return apiError(error); }
}

function notificationFor(status: string, reportTitle: string, findingId: string | null) {
  if (status === "needs_info") return { eventType: "report_needs_info", title: "More information requested", body: `A validator needs more information about “${reportTitle}”.` };
  if (status === "supporting_evidence") return { eventType: "report_linked", title: "Evidence linked", body: `Your report now supports canonical finding ${findingId}.` };
  if (status === "rejected") return { eventType: "report_rejected", title: "Report reviewed", body: `“${reportTitle}” was not accepted as a website finding. The decision remains in the audit trail.` };
  return { eventType: "report_accepted", title: "Report accepted", body: `Your report was accepted as canonical finding ${findingId}.` };
}
