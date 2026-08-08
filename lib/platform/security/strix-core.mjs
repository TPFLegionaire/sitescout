/**
 * Strix import-only evaluation — pure, security-critical logic.
 *
 * Reference implementation for the revised plan's Phase 2. Strix is operated
 * SEPARATELY against a disposable, deliberately vulnerable target; SiteScout only
 * imports the resulting artifacts (Strix vulnerability JSON or SARIF). This module
 * has no network, no secrets and no execution path — it parses, sanitises and
 * classifies, and is unit-testable with `node --test`.
 *
 * Hard rules enforced here:
 * - candidate rows carry only descriptive fields; raw request/response/payload/
 *   proof is never copied out of the archived artifact into a candidate;
 * - free-text fields are redacted for obvious secrets before storage;
 * - an empty result is labelled incomplete, never "secure";
 * - a high/critical "reproducible" decision requires a second, different reviewer.
 */

export const STRIX_SOURCE = "strix";

export const SEVERITIES = Object.freeze(["critical", "high", "medium", "low", "info", "unknown"]);
export const HIGH_SEVERITIES = Object.freeze(["critical", "high"]);

/** Reviewer classifications (plan section 8.4). */
export const REVIEW_DECISIONS = Object.freeze(["reproducible", "plausible", "duplicate", "false_positive", "out_of_scope", "unsafe_evidence"]);

export const MAX_REPORT_BYTES = 10 * 1024 * 1024;

export class StrixInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "StrixInputError";
    this.status = 400;
  }
}

/** Mask obvious secrets in free text before it is stored or shown to a reviewer. */
export function redactSecrets(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\b/g, "[redacted-jwt]")
    .replace(/\b(authorization|api[-_]?key|access[-_]?token|token|secret|password|passwd|pwd)(\s*[:=]\s*)("?)[^\s"'&]+/gi, "$1$2$3[redacted]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-hex]")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[redacted-b64]");
}

export function normalizeSeverity(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "unknown";
  if (text.includes("crit")) return "critical";
  if (text.includes("high") || text === "error") return "high";
  if (text.includes("med") || text.includes("moderate") || text === "warning") return "medium";
  if (text.includes("low") || text === "note") return "low";
  if (text.includes("info") || text === "none" || text === "informational") return "info";
  return "unknown";
}

function text(value, limit) {
  return redactSecrets(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, limit);
}

function normalizeEndpoint(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.pathname}`.toLowerCase();
  } catch {
    return raw.split(/[?#]/)[0].toLowerCase().slice(0, 500);
  }
}

/**
 * Reduce one raw report record to a sanitised candidate. Only the whitelisted
 * descriptive fields survive; anything resembling raw exploit material is dropped
 * by omission (it is never read from the record here).
 */
export function sanitizeCandidate(record, source = STRIX_SOURCE) {
  const title = text(record.title, 240) || "Untitled candidate";
  const severity = normalizeSeverity(record.severity);
  const cwe = text(record.cwe, 40);
  const cvssVector = text(record.cvss, 120);
  const endpoint = text(record.endpoint, 500);
  const method = text(record.method, 12).toUpperCase();
  const summary = text(record.summary, 2000);
  const remediation = text(record.remediation, 2000);
  const externalId = text(record.externalId, 200);
  const fingerprint = [source, cwe || "?", normalizeEndpoint(endpoint), title.toLowerCase()].join("|");
  return { externalId, title, severity, cwe, cvssVector, endpoint, method, summary, remediation, fingerprint };
}

function indexSarifRules(run) {
  const rules = run?.tool?.driver?.rules;
  const map = new Map();
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (rule && typeof rule.id === "string") {
        map.set(rule.id, {
          name: rule.name ?? rule.shortDescription?.text ?? rule.id,
          cwe: rule.properties?.cwe ?? "",
          securitySeverity: rule.properties?.["security-severity"] ?? "",
        });
      }
    }
  }
  return map;
}

function parseSarif(parsed) {
  const records = [];
  for (const run of parsed.runs ?? []) {
    const rules = indexSarifRules(run);
    for (const result of run?.results ?? []) {
      const ruleId = result.ruleId ?? result.rule?.id ?? "";
      const rule = rules.get(ruleId) ?? {};
      const location = result.locations?.[0]?.physicalLocation;
      records.push({
        externalId: ruleId,
        title: rule.name ?? ruleId ?? "SARIF result",
        severity: result.level ?? rule.securitySeverity ?? "",
        cvss: result.properties?.["security-severity"] ?? rule.securitySeverity ?? "",
        cwe: rule.cwe ?? "",
        endpoint: location?.artifactLocation?.uri ?? "",
        method: "",
        summary: result.message?.text ?? "",
        remediation: "",
      });
    }
  }
  return records;
}

function coerceVulnArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of ["vulnerabilities", "findings", "results", "issues"]) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
  }
  return null;
}

function parseVulnJson(array) {
  return array
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      externalId: item.id ?? item.uuid ?? item.ruleId ?? "",
      title: item.title ?? item.name ?? item.type ?? "Vulnerability",
      severity: item.severity ?? item.risk ?? item.level ?? "",
      cvss: item.cvss ?? item.cvss_vector ?? item.cvssVector ?? "",
      cwe: item.cwe ?? item.cweId ?? item.cwe_id ?? "",
      endpoint: item.endpoint ?? item.url ?? item.location ?? item.affected_url ?? "",
      method: item.method ?? item.http_method ?? "",
      summary: item.description ?? item.summary ?? item.details ?? item.message ?? "",
      remediation: item.remediation ?? item.fix ?? item.recommendation ?? "",
    }));
}

/**
 * Parse a raw report string into sanitised candidates plus coverage/limitations.
 * Throws StrixInputError on malformed or unrecognised input (rejected safely).
 */
export function parseStrixReport(rawText, source = STRIX_SOURCE) {
  if (typeof rawText !== "string" || !rawText.trim()) throw new StrixInputError("The report is empty.");
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new StrixInputError("The report is not valid JSON.");
  }

  let format;
  let records;
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.runs)) {
    format = "sarif";
    records = parseSarif(parsed);
  } else {
    const array = coerceVulnArray(parsed);
    if (!array) throw new StrixInputError("Unrecognised report format. Expected Strix vulnerability JSON or SARIF.");
    format = "strix-json";
    records = parseVulnJson(array);
  }

  const candidates = records.map((record) => sanitizeCandidate(record, source));
  const limitations = [];
  if (candidates.length === 0) {
    limitations.push("Empty result: no candidates were reported. This is not evidence that the target is secure; scan coverage was not proven.");
  }
  return { format, candidates, coverage: { format, candidateCount: candidates.length }, limitations };
}

/**
 * Decide the next review state. A high/critical "reproducible" decision parks the
 * candidate for a second check by a DIFFERENT reviewer before it is confirmed.
 */
export function resolveReviewDecision({ current, decision, severity, reviewerEmail, firstReviewerEmail }) {
  if (!REVIEW_DECISIONS.includes(decision)) throw new StrixInputError("Unknown review decision.");
  const email = String(reviewerEmail ?? "").trim().toLowerCase();
  if (!email) throw new StrixInputError("A reviewer is required.");

  const needsSecondCheck = decision === "reproducible" && HIGH_SEVERITIES.includes(severity);
  if (!needsSecondCheck) {
    return { reviewStatus: decision, awaitingSecondCheck: false, firstReviewer: email, secondCheckBy: null };
  }
  if (current !== "awaiting_second_check") {
    return { reviewStatus: "awaiting_second_check", awaitingSecondCheck: true, firstReviewer: email, secondCheckBy: null };
  }
  const first = String(firstReviewerEmail ?? "").trim().toLowerCase();
  if (!first) throw new StrixInputError("The first reviewer is missing for the second check.");
  if (email === first) throw new StrixInputError("A different reviewer must perform the second check on a high or critical candidate.");
  return { reviewStatus: "reproducible", awaitingSecondCheck: false, firstReviewer: first, secondCheckBy: email };
}
