import { randomUUID } from "node:crypto";
import { requireQualityRole } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, optionalText, requiredText } from "@/lib/platform/validation";

const transitions: Record<string, string[]> = {
  submitted: ["reproduced", "needs_info"],
  ai_triaged: ["reproduced", "needs_info"],
  needs_info: ["reproduced"],
  reproduced: ["assigned"],
  accepted: ["assigned"],
  supporting_evidence: ["assigned"],
  assigned: ["fixed"],
  fixed: ["retested", "assigned"],
  retested: ["closed", "assigned"],
  closed: [],
  rejected: [],
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireQualityRole("validator", "finding_owner", "administrator");
    await ensureDatabase();
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const status = requiredText(body.status, "Status", 40);
    const assignedTo = optionalText(body.assignedTo, 200);
    const note = optionalText(body.note, 1000) ?? "";
    const d1 = getD1();
    const report = await d1.prepare(`
      SELECT w.status, o.created_by AS createdBy, o.finding_id AS findingId, o.title
      FROM staff_report_workflow w JOIN observations o ON o.id = w.observation_id
      WHERE w.observation_id = ? AND o.source_channel = 'human'
    `).bind(id).first<{ status: string; createdBy: string; findingId: string | null; title: string }>();
    if (!report) return Response.json({ ok: false, error: "Staff report not found" }, { status: 404 });
    if (!(transitions[report.status] ?? []).includes(status)) throw Object.assign(new Error(`Cannot move a report from ${report.status} to ${status}.`), { status: 409 });
    if (user.role === "finding_owner" && !new Set(["assigned", "fixed"]).has(status)) throw Object.assign(new Error("Finding Owners can accept assignment and record a fix; a Validator must re-test and close it."), { status: 403 });
    if (user.role === "validator" && !new Set(["reproduced", "needs_info", "assigned", "retested", "closed"]).has(status)) throw Object.assign(new Error("Validators can reproduce, assign, re-test and close reports; a Finding Owner must record the fix."), { status: 403 });
    if (status === "assigned" && !report.findingId) throw Object.assign(new Error("Link or accept the report as a canonical finding before assignment."), { status: 409 });
    if (status === "assigned" && !assignedTo) throw Object.assign(new Error("Choose a Finding Owner before assignment."), { status: 400 });
    const now = new Date().toISOString();
    const notification = statusNotification(status, report.title, report.findingId, assignedTo);
    const statements: D1PreparedStatement[] = [
      d1.prepare("UPDATE staff_report_workflow SET status = ?, assigned_to = COALESCE(?, assigned_to), updated_by = ?, updated_at = ? WHERE observation_id = ?").bind(status, assignedTo, user.email, now, id),
      d1.prepare("INSERT INTO notifications (id, recipient_email, event_type, observation_id, finding_id, title, body, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)").bind(randomUUID(), report.createdBy, `report_${status}`, id, report.findingId, notification.title, notification.body, now),
      d1.prepare("INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('staff_report_status_changed', 'observation', ?, ?, ?, ?)").bind(id, user.email, JSON.stringify({ from: report.status, to: status, assignedTo, note }), now),
      d1.prepare("INSERT INTO pilot_events (id, event_type, observation_id, actor_email, duration_ms, detail_json, created_at) VALUES (?, 'workflow_status_changed', ?, ?, NULL, ?, ?)").bind(randomUUID(), id, user.email, JSON.stringify({ from: report.status, to: status, assignedTo }), now),
    ];
    if (status === "assigned" && report.findingId) statements.push(d1.prepare("UPDATE findings SET owner = ? WHERE id = ?").bind(assignedTo, report.findingId));
    await d1.batch(statements);
    return Response.json({ ok: true, workflowStatus: status });
  } catch (error) { return apiError(error); }
}

function statusNotification(status: string, title: string, findingId: string | null, assignedTo: string | null) {
  const suffix = findingId ? ` (${findingId})` : "";
  if (status === "assigned") return { title: "Report assigned", body: `“${title}”${suffix} has been assigned${assignedTo ? ` to ${assignedTo}` : ""}.` };
  if (status === "fixed") return { title: "Fix recorded", body: `A fix has been recorded for “${title}”${suffix}; it is awaiting re-test.` };
  if (status === "retested") return { title: "Re-test completed", body: `“${title}”${suffix} passed the recorded re-test and is ready to close.` };
  if (status === "closed") return { title: "Report closed", body: `“${title}”${suffix} has completed the Site Scout workflow.` };
  if (status === "reproduced") return { title: "Issue reproduced", body: `A validator reproduced “${title}”${suffix}.` };
  return { title: "Report updated", body: `“${title}”${suffix} is now ${status.replaceAll("_", " ")}.` };
}
