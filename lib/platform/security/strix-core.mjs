/** Pure, import-only Strix evidence validation and sanitisation. */

export const STRIX_SOURCE = "strix";
export const SEVERITIES = Object.freeze(["critical", "high", "medium", "low", "info", "unknown"]);
export const HIGH_SEVERITIES = Object.freeze(["critical", "high", "unknown"]);
export const REVIEW_DECISIONS = Object.freeze(["reproducible", "plausible", "duplicate", "false_positive", "out_of_scope", "unsafe_evidence"]);
export const MAX_REPORT_BYTES = 10 * 1024 * 1024;
export const MAX_CANDIDATES = 75;
export const MAX_REPORT_RUNS = 25;
export const MAX_JSON_NODES = 50_000;
export const MAX_TOTAL_CANDIDATE_TEXT = 250_000;
export const RESTRICTED_EVIDENCE_PLACEHOLDER = "[Restricted security evidence — review the raw artifact.]";

const FINAL_REVIEW_STATUSES = new Set(REVIEW_DECISIONS);
const SAFE_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const SEVERITY_RANK = { unknown: 0, info: 1, low: 2, medium: 3, high: 4, critical: 5 };
const INTERNAL_SANITIZATION_FLAGS = new Set(["dropped_raw_evidence"]);
const RAW_EVIDENCE_KEYS = new Set([
  "request", "response", "payload", "proof", "poc", "curl", "command", "headers", "cookies",
  "webrequest", "webresponse", "codeflows", "stacks", "graphs", "attachments",
]);

export class StrixInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "StrixInputError";
    this.status = 400;
  }
}

export class StrixConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "StrixConflictError";
    this.status = 409;
  }
}

export function redactSecrets(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/-----BEGIN[\s\S]{0,100}?PRIVATE KEY-----[\s\S]*?-----END[\s\S]{0,100}?PRIVATE KEY-----/gi, "[redacted-private-key]")
    .replace(/\b(Authorization\s*:\s*)(Basic|Bearer)\s+[^\s,;]+/gi, "$1$2 [redacted]")
    .replace(/\b((?:Set-)?Cookie\s*:\s*)[^\r\n]+/gi, "$1[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\b/g, "[redacted-jwt]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-access-key]")
    .replace(/\b(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|session(?:id)?|csrf(?:token)?|secret|password|passwd|pwd)(\s*[:=]\s*)("?)[^\s"'&,;]+/gi, "$1$2$3[redacted]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-hex]")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[redacted-b64]");
}

export function detectRestrictedContent(value) {
  const input = String(value ?? "");
  const flags = new Set();
  if (/-----BEGIN[\s\S]{0,100}?PRIVATE KEY-----/i.test(input)) flags.add("private_key");
  if (
    /\b(?:Authorization\s*:|(?:Set-)?Cookie\s*:|client[-_]?secret\s*[:=]|api[-_]?key\s*[:=]|access[-_]?token\s*[:=]|password\s*[:=])/i.test(input) ||
    redactSecrets(input) !== input
  ) flags.add("secret_material");
  if (/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+HTTP\/\d(?:\.\d)?/i.test(input) || /\bHTTP\/\d(?:\.\d)?\s+\d{3}\b/i.test(input)) flags.add("raw_http");
  if (/<script(?:\s|>)/i.test(input) || /\bUNION\s+(?:ALL\s+)?SELECT\b/i.test(input) || /(?:'|\")\s*OR\s+1\s*=\s*1/i.test(input) || /\bcurl\s+[^\r\n]*(?:-H|--header|--data)/i.test(input)) flags.add("exploit_payload");
  return [...flags];
}

export function sanitizeReviewNote(value, limit = 2000) {
  const result = sanitizeFreeText(value, limit);
  if (result.flags.some(isRestrictedFlag)) throw new StrixInputError("Review notes must not contain credentials, raw traffic or exploit payloads; use the restricted artifact instead.");
  return result.value;
}

export function normalizeSeverity(value, cvssValue) {
  const text = String(value ?? "").trim().toLowerCase();
  let textual = "unknown";
  if (text.includes("crit")) textual = "critical";
  else if (text.includes("high") || text === "error") textual = "high";
  else if (text.includes("med") || text.includes("moderate") || text === "warning") textual = "medium";
  else if (text.includes("low") || text === "note") textual = "low";
  else if (text.includes("info") || text === "none" || text === "informational") textual = "info";

  const score = readCvssScore(cvssValue);
  const scored = score == null ? "unknown" : score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : score > 0 ? "low" : "info";
  return SEVERITY_RANK[scored] > SEVERITY_RANK[textual] ? scored : textual;
}

export function sanitizeEndpoint(value, allowedHost, allowedPathPrefix = "/") {
  const raw = String(value ?? "").trim();
  const approvedHost = normalizeHost(allowedHost);
  const approvedPrefix = normalizePathPrefix(allowedPathPrefix);
  const flags = [];
  if (!raw) return { value: "", flags };
  let parsed;
  try {
    if (raw.startsWith("/")) parsed = new URL(raw, `https://${approvedHost}`);
    else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) parsed = new URL(raw);
    else if (approvedHost && raw.toLowerCase().startsWith(`${approvedHost}/`)) parsed = new URL(`https://${raw}`);
    else throw new Error("unsupported endpoint");
  } catch {
    return { value: "", flags: ["invalid_endpoint"] };
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) return { value: "", flags: ["unsupported_endpoint_scheme"] };
  if (parsed.username || parsed.password) flags.push("credential_in_url");
  if (parsed.search) flags.push("endpoint_query_removed");
  if (parsed.hash) flags.push("endpoint_fragment_removed");
  const host = normalizeHost(parsed.hostname);
  if (!approvedHost || host !== approvedHost || parsed.port) return { value: "", flags: [...flags, "out_of_scope_endpoint"] };
  const path = parsed.pathname.startsWith("/") ? parsed.pathname : `/${parsed.pathname}`;
  if (!pathWithinPrefix(path, approvedPrefix)) return { value: "", flags: [...flags, "out_of_scope_endpoint"] };
  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    flags.push("invalid_endpoint_encoding");
  }
  const pathFlags = detectRestrictedContent(`${path} ${decodedPath}`);
  if (pathFlags.length) return { value: "", flags: unique([...flags, ...pathFlags, "restricted_endpoint_path"]) };
  return { value: `${host}${path}`.slice(0, 500), flags };
}

export function sanitizeCandidate(record, options = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new StrixInputError("Every candidate must be a JSON object.");
  const source = options.source ?? STRIX_SOURCE;
  if (source !== STRIX_SOURCE) throw new StrixInputError("Only Strix imports are accepted by this evaluation route.");
  const allowedHost = normalizeHost(options.allowedHost);
  if (!allowedHost) throw new StrixInputError("An approved registered target host is required for sanitisation.");
  const allowedPathPrefix = normalizePathPrefix(options.allowedPathPrefix);

  const titleResult = sanitizeFreeText(record.title, 240);
  const summaryResult = sanitizeFreeText(record.summary, 2000);
  const remediationResult = sanitizeFreeText(record.remediation, 2000);
  const externalResult = sanitizeFreeText(record.externalId, 200);
  const cweResult = sanitizeFreeText(record.cwe, 40);
  const cvssResult = sanitizeFreeText(record.cvss, 120);
  const endpointResult = sanitizeEndpoint(record.endpoint, allowedHost, allowedPathPrefix);
  const methodRaw = String(record.method ?? "").trim().toUpperCase();
  const method = SAFE_METHODS.has(methodRaw) ? methodRaw : "";
  const flags = unique([
    ...titleResult.flags,
    ...summaryResult.flags,
    ...remediationResult.flags,
    ...externalResult.flags,
    ...cweResult.flags,
    ...cvssResult.flags,
    ...endpointResult.flags,
    ...(Array.isArray(options.inputFlags) ? options.inputFlags.filter((flag) => INTERNAL_SANITIZATION_FLAGS.has(flag)) : []),
    ...(methodRaw && !method ? ["invalid_method"] : []),
  ]);
  const quarantined = flags.some(isRestrictedFlag) || flags.includes("out_of_scope_endpoint") || flags.includes("credential_in_url");
  const sanitizationStatus = quarantined ? "quarantined" : flags.length ? "redacted" : "clean";
  const title = titleResult.value && !titleResult.quarantined ? titleResult.value : quarantined ? "Restricted security candidate" : "Untitled candidate";
  const summary = summaryResult.quarantined ? RESTRICTED_EVIDENCE_PLACEHOLDER : summaryResult.value;
  const remediation = remediationResult.quarantined ? RESTRICTED_EVIDENCE_PLACEHOLDER : remediationResult.value;
  const severity = normalizeSeverity(record.severity, record.cvssScore ?? record.cvss);
  const endpoint = endpointResult.value;
  const fingerprint = [source, allowedHost, cweResult.value || "?", endpoint || "restricted", title.toLowerCase()].join("|");
  return {
    externalId: externalResult.quarantined ? "" : externalResult.value,
    title,
    severity,
    cwe: cweResult.quarantined ? "" : cweResult.value,
    cvssVector: cvssResult.quarantined ? "" : cvssResult.value,
    endpoint,
    method,
    summary,
    remediation,
    fingerprint,
    sanitizationStatus,
    sanitizationFlags: flags,
  };
}

export function parseStrixReport(rawText, options = {}) {
  if (typeof rawText !== "string" || !rawText.trim()) throw new StrixInputError("The report is empty.");
  if ((options.source ?? STRIX_SOURCE) !== STRIX_SOURCE) throw new StrixInputError("Only Strix reports are accepted.");
  if (new TextEncoder().encode(rawText).byteLength > MAX_REPORT_BYTES) throw new StrixInputError("The report exceeds the maximum import size.");
  const allowedHost = normalizeHost(options.allowedHost);
  if (!allowedHost) throw new StrixInputError("An approved registered target host is required for sanitisation.");
  const allowedPathPrefix = normalizePathPrefix(options.allowedPathPrefix);
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new StrixInputError("The report is not valid JSON.");
  }
  assertJsonComplexity(parsed);

  let format;
  let records;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.hasOwn(parsed, "runs")) {
    if (parsed.version !== "2.1.0" || !Array.isArray(parsed.runs)) throw new StrixInputError("SARIF imports must declare version 2.1.0 and a runs array.");
    if (parsed.runs.length > MAX_REPORT_RUNS) throw new StrixInputError(`SARIF report exceeds the ${MAX_REPORT_RUNS}-run pilot limit.`);
    format = "sarif";
    records = parseSarif(parsed);
  } else {
    const array = coerceVulnerabilityArray(parsed);
    if (!array) throw new StrixInputError("Unrecognised report format. Expected Strix vulnerability JSON or SARIF 2.1.0.");
    if (array.length > MAX_CANDIDATES) throw new StrixInputError(`The report exceeds the ${MAX_CANDIDATES}-candidate pilot limit; split and review it before import.`);
    format = "strix-json";
    records = parseVulnerabilityJson(array);
  }
  if (records.length > MAX_CANDIDATES) throw new StrixInputError(`The report exceeds the ${MAX_CANDIDATES}-candidate pilot limit; split and review it before import.`);
  const candidates = records.map(({ candidate, inputFlags }) => sanitizeCandidate(candidate, { source: STRIX_SOURCE, allowedHost, allowedPathPrefix, inputFlags }));
  const totalText = candidates.reduce((sum, candidate) => sum + candidate.title.length + candidate.summary.length + candidate.remediation.length + candidate.endpoint.length, 0);
  if (totalText > MAX_TOTAL_CANDIDATE_TEXT) throw new StrixInputError("Sanitised candidate text exceeds the pilot storage limit.");
  const quarantined = candidates.filter((candidate) => candidate.sanitizationStatus === "quarantined").length;
  const redacted = candidates.filter((candidate) => candidate.sanitizationStatus === "redacted").length;
  const limitations = [];
  if (candidates.length === 0) limitations.push("Empty result: no candidates were reported. This is not evidence that the target is secure; scan coverage was not proven.");
  if (quarantined) limitations.push(`${quarantined} candidate(s) contain restricted, unsafe or out-of-scope evidence; only placeholders are shown outside the raw artifact.`);
  if (redacted) limitations.push(`${redacted} candidate(s) were redacted or had URL query/fragment data removed.`);
  return {
    format,
    candidates,
    coverage: { format, candidateCount: candidates.length, quarantinedCount: quarantined, redactedCount: redacted },
    limitations,
  };
}

export function resolveReviewDecision({ current, decision, severity, reviewerEmail, firstReviewerEmail }) {
  if (!REVIEW_DECISIONS.includes(decision)) throw new StrixInputError("Unknown review decision.");
  const email = String(reviewerEmail ?? "").trim().toLowerCase();
  if (!email) throw new StrixInputError("A reviewer is required.");
  if (FINAL_REVIEW_STATUSES.has(current)) throw new StrixConflictError("This candidate already has a final review decision.");
  if (current !== "pending" && current !== "awaiting_second_check") throw new StrixConflictError("Candidate review state is not valid for this action.");

  if (current === "awaiting_second_check") {
    const first = String(firstReviewerEmail ?? "").trim().toLowerCase();
    if (!first) throw new StrixConflictError("The first reviewer is missing for the second check.");
    if (email === first) throw new StrixConflictError("A different reviewer must perform the second check on a high, critical or unknown-severity candidate.");
    return { reviewStatus: decision, awaitingSecondCheck: false, firstReviewer: first, secondCheckBy: email, stage: "second", expectedCurrent: current };
  }

  const needsSecondCheck = HIGH_SEVERITIES.includes(severity);
  if (needsSecondCheck) {
    return { reviewStatus: "awaiting_second_check", awaitingSecondCheck: true, firstReviewer: email, secondCheckBy: null, stage: "first", expectedCurrent: current };
  }
  return { reviewStatus: decision, awaitingSecondCheck: false, firstReviewer: email, secondCheckBy: null, stage: "final", expectedCurrent: current };
}

function parseSarif(parsed) {
  const records = [];
  for (const run of parsed.runs) {
    if (!run || typeof run !== "object" || Array.isArray(run)) throw new StrixInputError("Every SARIF run must be an object.");
    if (run.results != null && !Array.isArray(run.results)) throw new StrixInputError("SARIF run results must be an array.");
    const rules = indexSarifRules(run);
    for (const result of run.results ?? []) {
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new StrixInputError("Every SARIF result must be an object.");
      const ruleId = result.ruleId ?? result.rule?.id ?? "";
      const rule = rules.get(ruleId) ?? {};
      const location = result.locations?.[0]?.physicalLocation;
      const score = result.properties?.["security-severity"] ?? rule.securitySeverity ?? "";
      records.push({
        candidate: {
          externalId: ruleId,
          title: rule.name ?? ruleId ?? "SARIF result",
          severity: result.level ?? "",
          cvss: result.properties?.cvss ?? score,
          cvssScore: score,
          cwe: rule.cwe ?? "",
          endpoint: location?.artifactLocation?.uri ?? "",
          method: "",
          summary: result.message?.text ?? "",
          remediation: rule.help ?? "",
        },
        inputFlags: rawEvidenceFlags(result),
      });
      if (records.length > MAX_CANDIDATES) throw new StrixInputError(`The report exceeds the ${MAX_CANDIDATES}-candidate pilot limit; split and review it before import.`);
    }
  }
  return records;
}

function indexSarifRules(run) {
  const rules = run?.tool?.driver?.rules;
  if (rules != null && !Array.isArray(rules)) throw new StrixInputError("SARIF driver rules must be an array.");
  const map = new Map();
  for (const rule of rules ?? []) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new StrixInputError("Every SARIF rule must be an object.");
    if (typeof rule.id === "string") {
      map.set(rule.id, {
        name: rule.name ?? rule.shortDescription?.text ?? rule.id,
        cwe: rule.properties?.cwe ?? "",
        securitySeverity: rule.properties?.["security-severity"] ?? "",
        help: rule.help?.text ?? rule.fullDescription?.text ?? "",
      });
    }
  }
  return map;
}

function coerceVulnerabilityArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const matches = ["vulnerabilities", "findings", "results", "issues"].filter((key) => Object.hasOwn(parsed, key));
  if (matches.length !== 1 || !Array.isArray(parsed[matches[0]])) return null;
  return parsed[matches[0]];
}

function parseVulnerabilityJson(array) {
  return array.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new StrixInputError("Every Strix vulnerability must be an object.");
    if (!("title" in item) && !("name" in item) && !("type" in item) && !("id" in item) && !("uuid" in item)) {
      throw new StrixInputError("Every Strix vulnerability must include an identifier or title.");
    }
    return {
      candidate: {
        externalId: item.id ?? item.uuid ?? item.ruleId ?? "",
        title: item.title ?? item.name ?? item.type ?? "Vulnerability",
        severity: item.severity ?? item.risk ?? item.level ?? "",
        cvss: item.cvss_vector ?? item.cvssVector ?? item.cvss ?? "",
        cvssScore: item.cvss_score ?? item.cvssScore ?? item.score ?? item.cvss ?? "",
        cwe: item.cwe ?? item.cweId ?? item.cwe_id ?? "",
        endpoint: item.endpoint ?? item.url ?? item.location ?? item.affected_url ?? "",
        method: item.method ?? item.http_method ?? "",
        summary: item.description ?? item.summary ?? item.details ?? item.message ?? "",
        remediation: item.remediation ?? item.fix ?? item.recommendation ?? "",
      },
      inputFlags: rawEvidenceFlags(item),
    };
  });
}

function rawEvidenceFlags(record) {
  for (const [key, value] of Object.entries(record ?? {})) {
    if (RAW_EVIDENCE_KEYS.has(key.toLowerCase()) && value != null && value !== "" && (!Array.isArray(value) || value.length)) {
      return ["dropped_raw_evidence"];
    }
  }
  return [];
}

function sanitizeFreeText(value, limit) {
  const raw = String(value ?? "");
  const flags = detectRestrictedContent(raw);
  let output = redactSecrets(raw).replace(/\s+/g, " ").trim();
  const quarantined = flags.some(isRestrictedFlag);
  if (quarantined) output = RESTRICTED_EVIDENCE_PLACEHOLDER;
  if (output.length > limit) {
    output = output.slice(0, limit);
    flags.push("truncated");
  }
  return { value: output, flags: unique(flags), quarantined };
}

function assertJsonComplexity(root) {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES) throw new StrixInputError("The report is too structurally complex for the import pilot.");
    if (depth > 20) throw new StrixInputError("The report nesting depth exceeds the import limit.");
    if (value && typeof value === "object") {
      const children = Array.isArray(value) ? value : Object.values(value);
      for (const child of children) stack.push({ value: child, depth: depth + 1 });
    }
  }
}

function readCvssScore(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10) return value;
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const score = Number(text);
  return Number.isFinite(score) && score >= 0 && score <= 10 ? score : null;
}

function normalizeHost(value) {
  const host = String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
  return /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host) ? host : "";
}

function normalizePathPrefix(value) {
  const prefix = String(value ?? "/").trim();
  if (!prefix.startsWith("/") || prefix.includes("?") || prefix.includes("#")) throw new StrixInputError("The registered target path scope is invalid.");
  return prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

function pathWithinPrefix(pathname, prefix) {
  return prefix === "/" ? pathname.startsWith("/") : pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isRestrictedFlag(flag) {
  return ["private_key", "secret_material", "raw_http", "exploit_payload", "dropped_raw_evidence", "restricted_endpoint_path"].includes(flag);
}

function unique(values) {
  return [...new Set(values)];
}
