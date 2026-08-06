import { randomUUID } from "node:crypto";
import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, requiredText } from "@/lib/platform/validation";

export async function POST(request: Request) {
  try {
    const user = await requireQualityCapability("manage_baselines");
    await ensureDatabase();
    const body = await request.json() as Record<string, unknown>;
    const targetId = requiredText(body.targetId, "Target", 100);
    const runId = requiredText(body.runId, "Run", 100);
    const reason = requiredText(body.reason, "Reason", 500);
    const d1 = getD1();
    const run = await d1.prepare("SELECT id FROM audit_runs WHERE id = ? AND target_id = ? AND status = 'complete'").bind(runId, targetId).first();
    if (!run) return Response.json({ ok: false, error: "Only a completed run from the same target can become a baseline." }, { status: 400 });
    const current = await d1.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM baselines WHERE target_id = ?").bind(targetId).first<{ version: number }>();
    const now = new Date().toISOString();
    const baselineId = randomUUID();
    await d1.batch([
      d1.prepare("UPDATE baselines SET superseded_at = ? WHERE target_id = ? AND superseded_at IS NULL").bind(now, targetId),
      d1.prepare("INSERT INTO baselines (id, target_id, run_id, version, reason, approved_by, created_at, superseded_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)").bind(baselineId, targetId, runId, (current?.version ?? 0) + 1, reason, user.email, now),
      d1.prepare("INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('baseline_promoted', 'baseline', ?, ?, ?, ?)").bind(baselineId, user.email, JSON.stringify({ targetId, runId, reason }), now),
    ]);
    return Response.json({ ok: true, baselineId, version: (current?.version ?? 0) + 1 }, { status: 201 });
  } catch (error) { return apiError(error); }
}
