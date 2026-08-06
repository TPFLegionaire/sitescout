import { env } from "cloudflare:workers";
import { randomUUID } from "node:crypto";
import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, assertTargetUrl, optionalText, requiredText } from "@/lib/platform/validation";
import { prepareEvidenceUpload } from "@/lib/platform/evidence-upload";
import { evidenceRetentionUntil, privacyPolicy, reportClassification } from "@/lib/platform/privacy";
import { createTriageDraft } from "@/lib/platform/triage";
import { getTriageCandidates, recordQualityUser } from "@/lib/platform/staff-data";

export async function POST(request: Request) {
  try {
    const user = await requireQualityCapability("submit_report");
    await ensureDatabase();
    await recordQualityUser(user);
    const form = await request.formData();
    if (form.get("privacyConfirmed") !== "true") throw Object.assign(new Error("Confirm that the screenshot contains only approved public website content."), { status: 400 });
    const targetId = requiredText(form.get("targetId"), "Environment", 100);
    const d1 = getD1();
    const target = await d1.prepare("SELECT site_id AS siteId, allowed_host AS allowedHost, allowed_path_prefix AS allowedPathPrefix FROM targets WHERE id = ? AND active = 1").bind(targetId).first<{ siteId: string; allowedHost: string; allowedPathPrefix: string }>();
    if (!target) return Response.json({ ok: false, error: "Target not found" }, { status: 404 });
    const url = assertTargetUrl(form.get("url"), target);
    const description = requiredText(form.get("description"), "What happened", 4000);
    const suppliedTitle = optionalText(form.get("title"), 240);
    const suppliedExpected = optionalText(form.get("expected"), 2000);
    const suppliedActual = optionalText(form.get("actual"), 2000);
    const suppliedSuggestedFindingId = optionalText(form.get("suggestedFindingId"), 100);
    const triageCandidates = await getTriageCandidates(target.siteId);
    const draft = await createTriageDraft({ url, description, title: suppliedTitle ?? undefined, expected: suppliedExpected ?? undefined, actual: suppliedActual ?? undefined }, triageCandidates);
    const title = suppliedTitle ?? draft.title;
    const expected = suppliedExpected ?? draft.expected;
    const actual = suppliedActual ?? draft.observed;
    const suggestedFindingId = suppliedSuggestedFindingId ?? draft.suggestedFindingId;
    if (suggestedFindingId && !triageCandidates.some((candidate) => candidate.id === suggestedFindingId)) throw Object.assign(new Error("Suggested finding is not available in the active audit scope."), { status: 400 });
    const reportingVersion = optionalText(form.get("reportingVersion"), 50);
    const upload = await prepareEvidenceUpload(form.get("screenshot") as FormDataEntryValue, reportingVersion === "site-scout-v1");
    const classification = reportClassification(form.get("securitySensitive"));
    const durationValue = Number(form.get("submissionDurationMs"));
    const submissionDurationMs = Number.isFinite(durationValue) && durationValue >= 0 && durationValue <= 3_600_000 ? Math.round(durationValue) : null;
    if (!env.EVIDENCE) throw Object.assign(new Error("Evidence storage is unavailable."), { status: 503 });
    const observationId = randomUUID();
    const assetId = randomUUID();
    const storageKey = `observations/${observationId}/${assetId}.${upload.extension}`;
    const evidenceName = reportingVersion === "site-scout-v1" ? "edited-site-scout-screenshot.png" : upload.originalName;
    await env.EVIDENCE.put(storageKey, upload.bytes, { httpMetadata: { contentType: upload.contentType }, customMetadata: { originalName: evidenceName, uploadedBy: user.email, classification } });
    const now = new Date().toISOString();
    const workflowStatus = draft.method === "openai-text-assist" ? "ai_triaged" : "submitted";
    const notificationId = randomUUID();
    try {
      await d1.batch([
        d1.prepare(`INSERT INTO observations (id, target_id, run_id, finding_id, suggested_finding_id, source_channel, url, title, description, expected, actual, review_status, created_by, created_at) VALUES (?, ?, NULL, NULL, ?, 'human', ?, ?, ?, ?, ?, 'pending', ?, ?)`).bind(observationId, targetId, suggestedFindingId, url, title, description, expected, actual, user.email, now),
        d1.prepare(`INSERT INTO evidence_assets (id, observation_id, kind, storage_key, public_url, caption, privacy_status, created_at) VALUES (?, ?, 'screenshot', ?, NULL, ?, 'submitter-confirmed-public-only', ?)`).bind(assetId, observationId, storageKey, reportingVersion === "site-scout-v1" ? "Edited Site Scout screenshot" : evidenceName, now),
        d1.prepare(`INSERT INTO staff_report_workflow (observation_id, status, triage_method, triage_json, duplicate_finding_id, assigned_to, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`).bind(observationId, workflowStatus, draft.method, JSON.stringify(draft), suggestedFindingId, user.email, now, now),
        d1.prepare(`INSERT INTO report_privacy (observation_id, classification, legal_hold, policy_version, created_by, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)`).bind(observationId, classification, privacyPolicy.version, user.email, now, now),
        d1.prepare(`INSERT INTO evidence_controls (asset_id, observation_id, size_bytes, retention_until, legal_hold, created_at) VALUES (?, ?, ?, ?, 0, ?)`).bind(assetId, observationId, upload.sizeBytes, evidenceRetentionUntil(classification, now), now),
        d1.prepare(`INSERT INTO pilot_events (id, event_type, observation_id, actor_email, duration_ms, detail_json, created_at) VALUES (?, 'report_submitted', ?, ?, ?, ?, ?)`).bind(randomUUID(), observationId, user.email, submissionDurationMs, JSON.stringify({ reportingVersion: reportingVersion ?? "legacy", classification }), now),
        d1.prepare(`INSERT INTO notifications (id, recipient_email, event_type, observation_id, finding_id, title, body, read_at, created_at) VALUES (?, ?, 'report_received', ?, NULL, 'Report received', ?, NULL, ?)`).bind(notificationId, user.email, observationId, `Site Scout received “${title}”. A validator will review it.`, now),
        d1.prepare(`INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('observation_submitted', 'observation', ?, ?, ?, ?)`).bind(observationId, user.email, JSON.stringify({ targetId, url, suggestedFindingId, workflowStatus, triageMethod: draft.method }), now),
      ]);
    } catch (error) {
      await env.EVIDENCE.delete(storageKey);
      throw error;
    }
    return Response.json({ ok: true, observationId, workflowStatus, draft }, { status: 201 });
  } catch (error) { return apiError(error); }
}
