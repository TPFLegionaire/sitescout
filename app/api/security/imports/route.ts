import { env } from "cloudflare:workers";
import { createHash, randomUUID } from "node:crypto";
import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, optionalText, requiredText } from "@/lib/platform/validation";
import { recordQualityUser } from "@/lib/platform/staff-data";
import { loadSecurityReview } from "@/lib/platform/security/security-data";
import { MAX_REPORT_BYTES, STRIX_SOURCE, parseStrixReport } from "@/lib/platform/security/strix-core.mjs";

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Security Reviewer / Administrator only. Imports a report produced by Strix run
// SEPARATELY against a disposable target. The raw artifact is archived to
// restricted storage; only sanitised candidate fields are persisted. This route
// never invokes the audit runner and never writes a finding or baseline.
export async function POST(request: Request) {
  try {
    const user = await requireQualityCapability("review_security");
    await ensureDatabase();
    await recordQualityUser(user);

    const form = await request.formData();
    const file = form.get("report");
    if (!(file instanceof File) || file.size === 0) throw Object.assign(new Error("A Strix report file (JSON or SARIF) is required."), { status: 400 });
    if (file.size > MAX_REPORT_BYTES) throw Object.assign(new Error("The report exceeds the maximum import size."), { status: 400 });

    const targetLabel = requiredText(form.get("targetLabel"), "Disposable target label", 200);
    const source = optionalText(form.get("source"), 50) ?? STRIX_SOURCE;
    const sourceVersion = optionalText(form.get("sourceVersion"), 50);
    const scanMode = optionalText(form.get("scanMode"), 50);
    const imageDigest = optionalText(form.get("imageDigest"), 200);
    const model = optionalText(form.get("model"), 120);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseStrixReport(new TextDecoder().decode(bytes), source);
    const artifactSha256 = sha256Hex(bytes);

    const d1 = getD1();
    const existing = await d1.prepare("SELECT id, candidate_count AS candidateCount FROM security_import_runs WHERE artifact_sha256 = ?").bind(artifactSha256).first<{ id: string; candidateCount: number }>();
    if (existing) return Response.json({ ok: true, idempotent: true, importRunId: existing.id, candidateCount: existing.candidateCount }, { status: 200, headers: { "cache-control": "no-store" } });

    if (!env.EVIDENCE) throw Object.assign(new Error("Restricted artifact storage is unavailable."), { status: 503 });

    const importRunId = randomUUID();
    const storageKey = `security-artifacts/${importRunId}.json`;
    await env.EVIDENCE.put(storageKey, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { source, classification: "restricted_security", importedBy: user.email },
    });

    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      d1
        .prepare(
          `INSERT INTO security_import_runs (id, source, source_version, target_label, scan_mode, image_digest, model, status, coverage_json, limitations_json, artifact_storage_key, artifact_sha256, candidate_count, imported_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(importRunId, source, sourceVersion, targetLabel, scanMode, imageDigest, model, JSON.stringify(parsed.coverage), JSON.stringify(parsed.limitations), storageKey, artifactSha256, parsed.candidates.length, user.email, now),
      d1
        .prepare(`INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('security_import_created', 'security_import_run', ?, ?, ?, ?)`)
        .bind(importRunId, user.email, JSON.stringify({ source, format: parsed.format, candidateCount: parsed.candidates.length, targetLabel }), now),
      d1
        .prepare(`INSERT INTO pilot_events (id, event_type, observation_id, actor_email, duration_ms, detail_json, created_at) VALUES (?, 'security_import_created', NULL, ?, NULL, ?, ?)`)
        .bind(randomUUID(), user.email, JSON.stringify({ importRunId, candidateCount: parsed.candidates.length }), now),
    ];
    for (const candidate of parsed.candidates) {
      statements.push(
        d1
          .prepare(
            `INSERT INTO security_candidates (id, import_run_id, external_id, title, severity, cwe, cvss_vector, endpoint, method, summary, remediation, fingerprint, review_status, first_reviewer, reviewed_by, second_check_by, review_note, reviewed_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL, ?)`,
          )
          .bind(randomUUID(), importRunId, candidate.externalId, candidate.title, candidate.severity, candidate.cwe, candidate.cvssVector, candidate.endpoint, candidate.method, candidate.summary, candidate.remediation, candidate.fingerprint, now),
      );
    }

    try {
      await d1.batch(statements);
    } catch (writeError) {
      await env.EVIDENCE.delete(storageKey).catch(() => undefined);
      throw writeError;
    }

    return Response.json(
      { ok: true, importRunId, format: parsed.format, candidateCount: parsed.candidates.length, limitations: parsed.limitations },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

// Review queue: sanitised import runs and candidates. No raw exploit material.
export async function GET() {
  try {
    await requireQualityCapability("review_security");
    await ensureDatabase();
    const data = await loadSecurityReview();
    return Response.json(
      { ok: true, data: { ...data, note: "Imported Strix candidates are untrusted, sanitised evidence. No candidate becomes a canonical finding automatically." } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
