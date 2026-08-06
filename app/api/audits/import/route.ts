import { env } from "cloudflare:workers";
import { randomUUID } from "node:crypto";
import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, pathWithinPrefix } from "@/lib/platform/validation";

const maxBytes = 5 * 1024 * 1024;

type ImportedFinding = {
  id: string;
  ruleId: string;
  url: string;
  title: string;
  severity: string;
  category: string;
  summary: string;
  expected: string;
  actual: string;
  recommendation: string;
  evidence: unknown;
};

type ImportedRun = {
  schemaVersion: number;
  id: string;
  targetId: string;
  status: string;
  runType: string;
  startedAt: string;
  completedAt: string;
  rulesetVersion: string;
  profileVersion: string;
  profile: string;
  browser: string;
  viewport: string;
  locale: string;
  comparable: boolean;
  comparisonReason: string | null;
  coverage: Record<string, unknown>;
  limitations: string[];
  findings: ImportedFinding[];
};

function validateRun(value: unknown): asserts value is ImportedRun {
  if (!value || typeof value !== "object") throw Object.assign(new Error("Audit JSON must be an object."), { status: 400 });
  const run = value as Partial<ImportedRun>;
  for (const field of ["id", "targetId", "status", "startedAt", "completedAt", "rulesetVersion", "profileVersion", "profile"] as const) {
    if (typeof run[field] !== "string" || !run[field]) throw Object.assign(new Error(`Audit JSON is missing ${field}.`), { status: 400 });
  }
  if (run.schemaVersion !== 1 || run.status !== "complete") throw Object.assign(new Error("Only completed schema-version 1 audit runs are accepted."), { status: 400 });
  if (!Array.isArray(run.findings) || run.findings.length > 5000 || !Array.isArray(run.limitations)) throw Object.assign(new Error("Audit findings or limitations are invalid."), { status: 400 });
  for (const finding of run.findings) {
    if (!finding?.id || !finding.ruleId || !finding.url || !finding.title || !["critical", "high", "medium", "low"].includes(finding.severity)) throw Object.assign(new Error("Audit contains a malformed finding."), { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireQualityCapability("manage_baselines");
    await ensureDatabase();
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw Object.assign(new Error("Audit JSON exceeds 5 MB."), { status: 413 });
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw Object.assign(new Error("Audit JSON could not be parsed."), { status: 400 }); }
    validateRun(value);
    const run = value;
    const d1 = getD1();
    const target = await d1.prepare("SELECT id, allowed_host AS allowedHost, allowed_path_prefix AS allowedPathPrefix FROM targets WHERE id = ?").bind(run.targetId).first<{ id: string; allowedHost: string; allowedPathPrefix: string }>();
    if (!target) return Response.json({ ok: false, error: "Audit target is not registered." }, { status: 400 });
    for (const finding of run.findings) {
      let url: URL;
      try { url = new URL(finding.url); } catch { throw Object.assign(new Error(`Finding URL is invalid: ${finding.url}`), { status: 400 }); }
      if (url.protocol !== "https:" || url.hostname.toLowerCase() !== target.allowedHost.toLowerCase() || !pathWithinPrefix(url.pathname, target.allowedPathPrefix)) throw Object.assign(new Error(`Finding URL is outside the registered target: ${finding.url}`), { status: 400 });
    }
    if (await d1.prepare("SELECT id FROM audit_runs WHERE id = ?").bind(run.id).first()) return Response.json({ ok: false, error: "This audit run is already imported." }, { status: 409 });
    if (!env.EVIDENCE) throw Object.assign(new Error("Audit evidence storage is unavailable."), { status: 503 });
    const storageKey = `audit-runs/${run.targetId}/${run.id}.json`;
    await env.EVIDENCE.put(storageKey, raw, { httpMetadata: { contentType: "application/json" }, customMetadata: { importedBy: user.email } });
    const now = new Date().toISOString();
    const statements = [
      d1.prepare(`INSERT INTO audit_runs (id, target_id, run_type, status, started_at, completed_at, ruleset_version, profile_version, browser, viewport, locale, page_limit, pages_attempted, pages_completed, comparable, comparison_reason, coverage_json, limitations_json, triggered_by, created_at) VALUES (?, ?, 'automated', 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        run.id, run.targetId, run.startedAt, run.completedAt, run.rulesetVersion, run.profileVersion, run.browser || "HTTP", run.viewport || "not-applicable", run.locale || "en-GB", Number(run.coverage.pageLimit ?? 0), Number(run.coverage.pagesAttempted ?? 0), Number(run.coverage.pagesCompleted ?? 0), run.comparable ? 1 : 0, run.comparisonReason, JSON.stringify(run.coverage), JSON.stringify(run.limitations), user.email, now,
      ),
      d1.prepare("INSERT INTO activity_log (event_type, entity_type, entity_id, actor, detail_json, created_at) VALUES ('audit_imported', 'audit_run', ?, ?, ?, ?)").bind(run.id, user.email, JSON.stringify({ targetId: run.targetId, findings: run.findings.length, storageKey }), now),
    ];
    for (const finding of run.findings) {
      statements.push(d1.prepare(`INSERT INTO observations (id, target_id, run_id, finding_id, suggested_finding_id, source_channel, url, title, description, expected, actual, review_status, created_by, created_at) VALUES (?, ?, ?, NULL, NULL, 'automated', ?, ?, ?, ?, ?, 'pending', ?, ?)`).bind(randomUUID(), run.targetId, run.id, finding.url, finding.title, `${finding.summary}\n\nRule: ${finding.ruleId}\nSeverity: ${finding.severity}\nRecommendation: ${finding.recommendation}`, finding.expected, `${finding.actual}\n\nEvidence: ${JSON.stringify(finding.evidence)}`, user.email, now));
    }
    try {
      for (let index = 0; index < statements.length; index += 50) await d1.batch(statements.slice(index, index + 50));
    } catch (error) {
      await d1.batch([
        d1.prepare("DELETE FROM observations WHERE run_id = ?").bind(run.id),
        d1.prepare("DELETE FROM activity_log WHERE event_type = 'audit_imported' AND entity_id = ?").bind(run.id),
        d1.prepare("DELETE FROM audit_runs WHERE id = ?").bind(run.id),
      ]).catch((cleanupError) => console.error("Audit import compensation failed", cleanupError));
      await env.EVIDENCE.delete(storageKey);
      throw error;
    }
    return Response.json({ ok: true, runId: run.id, observationsQueued: run.findings.length }, { status: 201 });
  } catch (error) { return apiError(error); }
}
