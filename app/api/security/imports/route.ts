import { env } from "cloudflare:workers";
import { createHash, randomUUID } from "node:crypto";
import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { requireSiteCapability } from "@/lib/platform/site-access";
import { apiError, optionalText, requiredText } from "@/lib/platform/validation";
import { recordQualityUser } from "@/lib/platform/staff-data";
import { assertApprovedSecurityTarget, securityArtifactRetentionUntil } from "@/lib/platform/security/security-config";
import { loadSecurityReview } from "@/lib/platform/security/security-data";
import { MAX_REPORT_BYTES, STRIX_SOURCE, StrixInputError, parseStrixReport, sanitizeReviewNote } from "@/lib/platform/security/strix-core.mjs";

const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function POST(request: Request) {
  try {
    const user = await requireQualityCapability("review_security");
    await ensureDatabase();
    await recordQualityUser(user);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
      throw new StrixInputError("The upload exceeds the maximum import size.");
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new StrixInputError("A valid multipart report upload is required.");
    }
    const file = form.get("report");
    if (!(file instanceof File) || file.size === 0) throw Object.assign(new Error("A Strix report file (JSON or SARIF) is required."), { status: 400 });
    if (file.size > MAX_REPORT_BYTES) throw Object.assign(new Error("The report exceeds the maximum import size."), { status: 400 });
    const targetId = requiredText(form.get("targetId"), "Approved registered target", 100);
    const suppliedSource = optionalText(form.get("source"), 50);
    if (suppliedSource && suppliedSource.toLowerCase() !== STRIX_SOURCE) throw new StrixInputError("Only Strix reports are accepted by this evaluation route.");
    assertApprovedSecurityTarget(targetId);

    const d1 = getD1();
    const target = await d1
      .prepare(
        `SELECT s.organization_id AS organizationId, s.id AS siteId, t.id AS targetId, t.name AS targetName,
                t.environment, t.allowed_host AS allowedHost, t.allowed_path_prefix AS allowedPathPrefix
         FROM targets t JOIN sites s ON s.id = t.site_id
         WHERE t.id = ? AND t.active = 1 AND s.active = 1`,
      )
      .bind(targetId)
      .first<{ organizationId: string; siteId: string; targetId: string; targetName: string; environment: string; allowedHost: string; allowedPathPrefix: string }>();
    if (!target) return Response.json({ ok: false, error: "Approved registered target not found." }, { status: 404 });
    await requireSiteCapability(user, target.organizationId, target.siteId, "review_security");

    const bytes = new Uint8Array(await file.arrayBuffer());
    let reportText: string;
    try {
      reportText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new StrixInputError("The report must be valid UTF-8 JSON.");
    }
    const parsed = parseStrixReport(reportText, {
      source: STRIX_SOURCE,
      allowedHost: target.allowedHost,
      allowedPathPrefix: target.allowedPathPrefix,
    });
    const artifactSha256 = sha256Hex(bytes);
    const existing = await d1
      .prepare(
        `SELECT id, candidate_count AS candidateCount FROM security_import_runs
         WHERE organization_id = ? AND site_id = ? AND target_id = ? AND artifact_sha256 = ?`,
      )
      .bind(target.organizationId, target.siteId, target.targetId, artifactSha256)
      .first<{ id: string; candidateCount: number }>();
    if (existing) return Response.json({ ok: true, idempotent: true, importRunId: existing.id, candidateCount: existing.candidateCount }, { status: 200, headers: { "cache-control": "no-store" } });
    if (!env.EVIDENCE) throw Object.assign(new Error("Restricted artifact storage is unavailable."), { status: 503 });

    const importRunId = randomUUID();
    const now = new Date().toISOString();
    const retentionUntil = securityArtifactRetentionUntil(now);
    const targetLabel = `${target.targetName} · ${target.environment}`;
    const sourceVersion = safeMetadata(form.get("sourceVersion"), "Strix version", 50, /^[A-Za-z0-9][A-Za-z0-9._+-]*$/);
    const scanMode = safeMetadata(form.get("scanMode"), "Scan mode", 50, /^[A-Za-z0-9][A-Za-z0-9._ +:/-]*$/);
    const imageDigest = safeMetadata(form.get("imageDigest"), "Image digest", 200, /^sha256:[a-f0-9]{64}$/i);
    const model = safeMetadata(form.get("model"), "Model", 120, /^[A-Za-z0-9][A-Za-z0-9._ +:/-]*$/);
    const storageKey = `security-artifacts/${target.organizationId}/${target.siteId}/${target.targetId}/${importRunId}.json`;
    await env.EVIDENCE.put(storageKey, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        source: STRIX_SOURCE,
        classification: "restricted_security",
        organizationId: target.organizationId,
        siteId: target.siteId,
        targetId: target.targetId,
        sha256: artifactSha256,
        retentionUntil,
      },
    });

    const statements: D1PreparedStatement[] = [
      d1
        .prepare(
          `INSERT INTO security_import_runs
            (id, organization_id, site_id, target_id, source, source_version, target_label, scan_mode, image_digest, model,
             status, coverage_json, limitations_json, artifact_storage_key, artifact_sha256, candidate_count, imported_by,
             retention_until, legal_hold, deleted_at, created_at)
           VALUES (?, ?, ?, ?, 'strix', ?, ?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
        )
        .bind(importRunId, target.organizationId, target.siteId, target.targetId, sourceVersion, targetLabel, scanMode, imageDigest, model, JSON.stringify(parsed.coverage), JSON.stringify(parsed.limitations), storageKey, artifactSha256, parsed.candidates.length, user.email, retentionUntil, now),
      d1
        .prepare(`INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('security_import_created', 'security_import_run', ?, ?, ?, ?)`)
        .bind(importRunId, user.email, JSON.stringify({ organizationId: target.organizationId, siteId: target.siteId, targetId: target.targetId, source: STRIX_SOURCE, format: parsed.format, candidateCount: parsed.candidates.length }), now),
      d1
        .prepare(`INSERT INTO pilot_events (id, event_type, observation_id, actor_email, duration_ms, detail_json, created_at) VALUES (?, 'security_import_created', NULL, ?, NULL, ?, ?)`)
        .bind(randomUUID(), user.email, JSON.stringify({ importRunId, organizationId: target.organizationId, siteId: target.siteId, targetId: target.targetId, candidateCount: parsed.candidates.length }), now),
    ];
    for (const candidate of parsed.candidates) {
      statements.push(
        d1
          .prepare(
            `INSERT INTO security_candidates
              (id, import_run_id, external_id, title, severity, cwe, cvss_vector, endpoint, method, summary, remediation,
               fingerprint, sanitization_status, sanitization_flags_json, review_status, first_reviewer, reviewed_by,
               second_check_by, review_note, reviewed_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL, ?)`,
          )
          .bind(randomUUID(), importRunId, candidate.externalId, candidate.title, candidate.severity, candidate.cwe, candidate.cvssVector, candidate.endpoint, candidate.method, candidate.summary, candidate.remediation, candidate.fingerprint, candidate.sanitizationStatus, JSON.stringify(candidate.sanitizationFlags), now),
      );
    }

    try {
      await d1.batch(statements);
    } catch (writeError) {
      await env.EVIDENCE.delete(storageKey).catch(() => undefined);
      const raced = await d1
        .prepare("SELECT id, candidate_count AS candidateCount FROM security_import_runs WHERE organization_id = ? AND site_id = ? AND target_id = ? AND artifact_sha256 = ?")
        .bind(target.organizationId, target.siteId, target.targetId, artifactSha256)
        .first<{ id: string; candidateCount: number }>();
      if (raced) return Response.json({ ok: true, idempotent: true, importRunId: raced.id, candidateCount: raced.candidateCount }, { status: 200, headers: { "cache-control": "no-store" } });
      throw writeError;
    }

    return Response.json(
      { ok: true, importRunId, format: parsed.format, candidateCount: parsed.candidates.length, limitations: parsed.limitations, retentionUntil },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function GET() {
  try {
    const user = await requireQualityCapability("review_security");
    await ensureDatabase();
    const data = await loadSecurityReview(user);
    return Response.json(
      { ok: true, data: { ...data, note: "Imported Strix candidates are untrusted, sanitised evidence. No candidate becomes a canonical finding automatically." } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

function safeMetadata(value: FormDataEntryValue | null, label: string, maxLength: number, pattern: RegExp) {
  const text = optionalText(value, maxLength);
  if (text == null) return null;
  const sanitised = sanitizeReviewNote(text, maxLength);
  if (!pattern.test(sanitised)) throw new StrixInputError(`${label} contains unsupported characters or format.`);
  return sanitised;
}
