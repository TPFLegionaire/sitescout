import { env } from "cloudflare:workers";
import { randomUUID } from "node:crypto";
import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { prepareEvidenceUpload } from "@/lib/platform/evidence-upload";
import { evidenceRetentionUntil, privacyPolicy } from "@/lib/platform/privacy";
import { apiError, requiredText } from "@/lib/platform/validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let uploadedStorageKey: string | null = null;
  try {
    const user = await requireQualityCapability("submit_report");
    await ensureDatabase();
    const { id } = await context.params;
    const form = await request.formData();
    const message = requiredText(form.get("message"), "Reply", 4000);
    const d1 = getD1();
    const report = await d1.prepare(`
      SELECT o.id, o.created_by AS createdBy, o.title, o.review_status AS reviewStatus, w.status,
             COALESCE(p.classification, 'standard') AS classification
      FROM observations o
      JOIN staff_report_workflow w ON w.observation_id = o.id
      LEFT JOIN report_privacy p ON p.observation_id = o.id
      WHERE o.id = ? AND o.source_channel = 'human'
    `).bind(id).first<{ id: string; createdBy: string; title: string; reviewStatus: string; status: string; classification: "standard" | "restricted_security" }>();
    if (!report) return Response.json({ ok: false, error: "Report not found" }, { status: 404 });
    if (report.createdBy.toLowerCase() !== user.email.toLowerCase()) return Response.json({ ok: false, error: "You can reply only to your own report." }, { status: 403 });
    if (report.status !== "needs_info" || report.reviewStatus !== "needs_info") throw Object.assign(new Error("This report is not currently waiting for more information."), { status: 409 });

    const file = form.get("screenshot");
    const hasScreenshot = file instanceof File && file.size > 0;
    let upload: Awaited<ReturnType<typeof prepareEvidenceUpload>> | null = null;
    let assetId: string | null = null;
    if (hasScreenshot) {
      if (form.get("privacyConfirmed") !== "true") throw Object.assign(new Error("Confirm that the additional screenshot contains only approved public website content."), { status: 400 });
      const usage = await d1.prepare(`
        SELECT COUNT(e.id) AS assetCount, COALESCE(SUM(c.size_bytes), 0) AS trackedBytes
        FROM evidence_assets e LEFT JOIN evidence_controls c ON c.asset_id = e.id
        WHERE e.observation_id = ?
      `).bind(id).first<{ assetCount: number; trackedBytes: number }>();
      if (Number(usage?.assetCount ?? 0) >= privacyPolicy.maxEvidenceAssetsPerReport) throw Object.assign(new Error("This report has reached its evidence attachment limit."), { status: 409 });
      if (file.type !== "image/png") throw Object.assign(new Error("Additional screenshots must be PNG files so SiteScout can strip embedded metadata."), { status: 400 });
      upload = await prepareEvidenceUpload(file, true);
      if (Number(usage?.trackedBytes ?? 0) + upload.sizeBytes > privacyPolicy.maxEvidenceBytesPerReport) throw Object.assign(new Error("This report has reached its private evidence storage limit."), { status: 409 });
      if (!env.EVIDENCE) throw Object.assign(new Error("Evidence storage is unavailable."), { status: 503 });
      assetId = randomUUID();
      uploadedStorageKey = `observations/${id}/${assetId}.${upload.extension}`;
      await env.EVIDENCE.put(uploadedStorageKey, upload.bytes, { httpMetadata: { contentType: upload.contentType }, customMetadata: { originalName: upload.originalName, uploadedBy: user.email, classification: report.classification } });
    }

    const now = new Date().toISOString();
    const messageId = randomUUID();
    const statements: D1PreparedStatement[] = [
      d1.prepare("INSERT INTO report_messages (id, observation_id, author_email, author_role, message_type, body, evidence_asset_id, created_at) VALUES (?, ?, ?, ?, 'reporter_reply', ?, ?, ?)").bind(messageId, id, user.email, user.role, message, assetId, now),
      d1.prepare("UPDATE observations SET review_status = 'pending' WHERE id = ?").bind(id),
      d1.prepare("UPDATE staff_report_workflow SET status = 'submitted', updated_by = ?, updated_at = ? WHERE observation_id = ?").bind(user.email, now, id),
      d1.prepare("INSERT INTO notifications (id, recipient_email, event_type, observation_id, finding_id, title, body, read_at, created_at) VALUES (?, ?, 'report_response_received', ?, NULL, 'Response received', ?, NULL, ?)").bind(randomUUID(), user.email, id, `Your additional information for “${report.title}” is back with the validation team.`, now),
      d1.prepare("INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('staff_report_replied', 'observation', ?, ?, ?, ?)").bind(id, user.email, JSON.stringify({ messageId, evidenceAssetId: assetId, classification: report.classification }), now),
      d1.prepare("INSERT INTO pilot_events (id, event_type, observation_id, actor_email, duration_ms, detail_json, created_at) VALUES (?, 'reporter_replied', ?, ?, NULL, ?, ?)").bind(randomUUID(), id, user.email, JSON.stringify({ messageId, evidenceAssetId: assetId }), now),
    ];
    if (upload && assetId && uploadedStorageKey) {
      statements.push(
        d1.prepare("INSERT INTO evidence_assets (id, observation_id, kind, storage_key, public_url, caption, privacy_status, created_at) VALUES (?, ?, 'screenshot', ?, NULL, ?, 'submitter-confirmed-public-only', ?)").bind(assetId, id, uploadedStorageKey, upload.originalName || "Additional private screenshot", now),
        d1.prepare("INSERT INTO evidence_controls (asset_id, observation_id, size_bytes, retention_until, legal_hold, created_at) VALUES (?, ?, ?, ?, 0, ?)").bind(assetId, id, upload.sizeBytes, evidenceRetentionUntil(report.classification, now), now),
      );
    }
    const reviewers = await d1.prepare("SELECT email FROM quality_users WHERE active = 1 AND role IN ('validator', 'administrator') AND LOWER(email) <> LOWER(?)").bind(user.email).all<{ email: string }>();
    for (const reviewer of reviewers.results) statements.push(
      d1.prepare("INSERT INTO notifications (id, recipient_email, event_type, observation_id, finding_id, title, body, read_at, created_at) VALUES (?, ?, 'report_response_ready', ?, NULL, 'Report response ready', ?, NULL, ?)").bind(randomUUID(), reviewer.email, id, `Additional information is ready for “${report.title}”.`, now),
    );
    try { await d1.batch(statements); } catch (error) {
      if (uploadedStorageKey && env.EVIDENCE) await env.EVIDENCE.delete(uploadedStorageKey);
      throw error;
    }
    return Response.json({ ok: true, workflowStatus: "submitted", messageId, evidenceAssetId: assetId }, { status: 201 });
  } catch (error) {
    if (uploadedStorageKey && env.EVIDENCE) await env.EVIDENCE.delete(uploadedStorageKey).catch(() => undefined);
    return apiError(error);
  }
}
