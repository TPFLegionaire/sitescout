import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, optionalText, requiredText, validStatuses } from "@/lib/platform/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireQualityCapability("manage_findings");
    await ensureDatabase();
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const targetId = requiredText(body.targetId, "Target", 100);
    const status = requiredText(body.status, "Status", 30);
    if (!validStatuses.includes(status as (typeof validStatuses)[number])) throw Object.assign(new Error("Invalid finding status."), { status: 400 });
    const owner = optionalText(body.owner, 200);
    const acceptanceCriteria = optionalText(body.acceptanceCriteria, 4000);
    const d1 = getD1();
    const existing = await d1.prepare(`
      SELECT fs.id FROM finding_states fs
      JOIN findings f ON f.id = fs.finding_id
      JOIN targets t ON t.id = fs.target_id
      WHERE fs.finding_id = ? AND fs.target_id = ? AND f.site_id = t.site_id
    `).bind(id, targetId).first();
    if (!existing) return Response.json({ ok: false, error: "Finding state not found" }, { status: 404 });
    const statements = [
      d1.prepare("UPDATE finding_states SET status = ?, updated_at = ? WHERE finding_id = ? AND target_id = ?").bind(status, new Date().toISOString(), id, targetId),
      d1.prepare("UPDATE findings SET owner = COALESCE(?, owner), acceptance_criteria = COALESCE(?, acceptance_criteria) WHERE id = ?").bind(owner, acceptanceCriteria, id),
      d1.prepare("INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('finding_updated', 'finding', ?, ?, ?, ?)").bind(id, user.email, JSON.stringify({ targetId, status, owner, acceptanceCriteria }), new Date().toISOString()),
    ];
    await d1.batch(statements);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
