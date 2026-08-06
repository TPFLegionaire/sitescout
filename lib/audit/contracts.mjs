import { createHash, randomUUID } from "node:crypto";

export const RULESET_VERSION = "sitescout-rules-v1";
export const PROFILE_VERSION = "safe-crawl-v1";

export const severities = Object.freeze(["critical", "high", "medium", "low"]);
export const findingStatuses = Object.freeze(["open", "partial", "resolved", "regressed", "not_tested"]);

export function stableFindingId(ruleId, targetUrl, discriminator = "") {
  const digest = createHash("sha256")
    .update(`${ruleId}\n${normaliseUrl(targetUrl)}\n${discriminator}`)
    .digest("hex")
    .slice(0, 12);
  return `${ruleId}-${digest}`;
}

export function normaliseUrl(value) {
  const url = new URL(value);
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  return url.href.replace(/\/$/, url.pathname === "/" ? "/" : "");
}

export function createRun(target, profile, now = new Date()) {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    targetId: target.id,
    targetName: target.name,
    environment: target.environment,
    baseUrl: target.baseUrl,
    status: "running",
    runType: "automated",
    startedAt: now.toISOString(),
    completedAt: null,
    rulesetVersion: RULESET_VERSION,
    profileVersion: PROFILE_VERSION,
    profile,
    browser: "HTTP",
    viewport: "not-applicable",
    locale: "en-GB",
    comparable: true,
    comparisonReason: null,
    coverage: {
      pageLimit: target.profiles[profile].pageLimit,
      queueLimit: target.profiles[profile].pageLimit * 5,
      linkObservationLimit: target.profiles[profile].pageLimit * 50,
      pagesAttempted: 0,
      pagesCompleted: 0,
      htmlPages: 0,
      linksDiscovered: 0,
      linkDiscoveryCapped: false,
      imageElementsObserved: 0,
    },
    limitations: [
      "Read-only HTTP audit: no form submission, authentication, checkout, or state-changing interaction.",
      "Visual correctness and business meaning require human screenshot review.",
      "JavaScript-only content is not asserted unless a separately recorded browser pass is used.",
    ],
    pages: [],
    findings: [],
  };
}

export function validateRunContract(run) {
  const errors = [];
  for (const key of ["schemaVersion", "id", "targetId", "environment", "baseUrl", "status", "startedAt", "rulesetVersion", "profileVersion"]) {
    if (run[key] === undefined || run[key] === null || run[key] === "") errors.push(`Missing ${key}`);
  }
  if (!Array.isArray(run.findings)) errors.push("findings must be an array");
  if (!Array.isArray(run.pages)) errors.push("pages must be an array");
  if (!Array.isArray(run.limitations)) errors.push("limitations must be an array");
  for (const finding of run.findings ?? []) {
    if (!finding.id || !finding.ruleId || !finding.url || !finding.title) errors.push("Finding is missing identity fields");
    if (!severities.includes(finding.severity)) errors.push(`Invalid severity for ${finding.id ?? "unknown"}`);
    if (!finding.evidence || typeof finding.evidence !== "object") errors.push(`Missing evidence for ${finding.id ?? "unknown"}`);
  }
  return { valid: errors.length === 0, errors };
}

export function makeFinding({ ruleId, url, title, severity, category, summary, expected, actual, recommendation, evidence = {}, discriminator = "" }) {
  return {
    id: stableFindingId(ruleId, url, discriminator || actual),
    ruleId,
    url: normaliseUrl(url),
    title,
    severity,
    category,
    summary,
    expected,
    actual,
    recommendation,
    evidence,
  };
}
