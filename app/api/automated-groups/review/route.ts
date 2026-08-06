import { randomUUID } from "node:crypto";
import { requireQualityRole } from "@/app/auth";
import auditScope from "@/config/audit-scope.json";
import auditRuleMappings from "@/config/audit-rule-mappings.json";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { buildAutomatedGroups } from "@/lib/platform/automated-groups-core.mjs";
import { apiError, optionalText, requiredText } from "@/lib/platform/validation";

const decisions = new Set(["link", "reject"]);
const maxPerBatchReview = 250;

export async function POST(request: Request) {
  try {
    const user = await requireQualityRole("validator", "administrator");
    await ensureDatabase();
    const body = await request.json() as Record<string, unknown>;
    const groupId = requiredText(body.groupId, "Automated group", 1000);
    const decision = requiredText(body.decision, "Decision", 20);
    if (!decisions.has(decision)) throw Object.assign(new Error("Invalid automated-group decision."), { status: 400 });
    const findingId = optionalText(body.findingId, 100);
    const note = optionalText(body.note, 1000) ?? "Grouped automated review";
    const expectedCount = Number(body.expectedCount);
    if (!Number.isInteger(expectedCount) || expectedCount < 1) throw Object.assign(new Error("Refresh the queue before reviewing this group."), { status: 409 });
    const d1 = getD1();
    const observations = await d1.prepare(`
      SELECT id, target_id AS targetId, run_id AS runId, url, title, description
      FROM observations
      WHERE source_channel = 'automated' AND review_status = 'pending'
      ORDER BY created_at DESC LIMIT 5000
    `).all<{ id: string; targetId: string; runId: string | null; url: string; title: string; description: string }>();
    const group = buildAutomatedGroups(observations.results, auditRuleMappings.targets).find((candidate) => candidate.id === groupId);
    if (!group) return Response.json({ ok: false, error: "This group is no longer pending. Refresh the queue." }, { status: 409 });
    if (group.count !== expectedCount) return Response.json({ ok: false, error: "The group changed while it was being reviewed. Refresh and inspect it again." }, { status: 409 });

    let canonicalId: string | null = null;
    if (decision === "link") {
      canonicalId = findingId ?? group.proposedFindingId;
      if (!canonicalId) throw Object.assign(new Error("Choose a canonical finding before linking this group."), { status: 400 });
      if ((auditScope.excludedFindings as Array<{ id: string }>).some((finding) => finding.id === canonicalId)) throw Object.assign(new Error("That finding is governed through a separate workstream."), { status: 409 });
      const target = await d1.prepare("SELECT site_id AS siteId FROM targets WHERE id = ?").bind(group.targetId).first<{ siteId: string }>();
      if (!target) return Response.json({ ok: false, error: "Automated group target not found" }, { status: 404 });
      const exists = await d1.prepare("SELECT id FROM findings WHERE id = ? AND site_id = ?").bind(canonicalId, target.siteId).first();
      if (!exists) return Response.json({ ok: false, error: "Canonical finding not found" }, { status: 404 });
    }

    const observationIds = group.observationIds.slice(0, maxPerBatchReview);
    const now = new Date().toISOString();
    const reviewDecision = decision === "link" ? "bulk_link" : "bulk_reject";
    for (let index = 0; index < observationIds.length; index += 40) {
      const statements: D1PreparedStatement[] = [];
      for (const observationId of observationIds.slice(index, index + 40)) {
        statements.push(
          d1.prepare("UPDATE observations SET review_status = ?, finding_id = ? WHERE id = ? AND source_channel = 'automated' AND review_status = 'pending'").bind(decision === "link" ? "confirmed" : "rejected", canonicalId, observationId),
          d1.prepare("INSERT INTO review_decisions (id, observation_id, decision, finding_id, note, reviewer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(randomUUID(), observationId, reviewDecision, canonicalId, note, user.email, now),
        );
      }
      await d1.batch(statements);
    }
    const remaining = Math.max(0, group.count - observationIds.length);
    await d1.prepare("INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('automated_group_reviewed', 'automated_group', ?, ?, ?, ?)").bind(
      group.id, user.email, JSON.stringify({ decision, findingId: canonicalId, ruleId: group.ruleId, urlPattern: group.urlPattern, processed: observationIds.length, previousCount: group.count, remaining }), now,
    ).run();
    return Response.json({ ok: true, decision, findingId: canonicalId, processed: observationIds.length, remaining, refreshRequired: remaining > 0 });
  } catch (error) { return apiError(error); }
}
