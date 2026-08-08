import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StrixInputError,
  normalizeSeverity,
  parseStrixReport,
  redactSecrets,
  resolveReviewDecision,
  sanitizeCandidate,
} from "../lib/platform/security/strix-core.mjs";

test("parses SARIF results into sanitised candidates", () => {
  const sarif = {
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "strix", rules: [{ id: "sqli", name: "SQL Injection", properties: { "security-severity": "9.1", cwe: "CWE-89" } }] } },
        results: [
          { ruleId: "sqli", level: "error", message: { text: "SQL injection at login" }, locations: [{ physicalLocation: { artifactLocation: { uri: "https://juice.local/rest/user/login" } } }], properties: { "security-severity": "9.1" } },
        ],
      },
    ],
  };
  const result = parseStrixReport(JSON.stringify(sarif));
  assert.equal(result.format, "sarif");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, "SQL Injection");
  assert.equal(result.candidates[0].severity, "high");
  assert.equal(result.candidates[0].cwe, "CWE-89");
  assert.equal(result.candidates[0].endpoint, "https://juice.local/rest/user/login");
});

test("parses Strix vulnerability JSON and never carries raw exploit material into a candidate", () => {
  const report = {
    vulnerabilities: [
      {
        id: "V-1",
        title: "Reflected XSS",
        severity: "medium",
        cwe: "CWE-79",
        endpoint: "https://juice.local/search?q=x",
        method: "get",
        description: "Reflected XSS. Authorization: Bearer abc123def456ghi789",
        remediation: "Encode output on render.",
        request: "GET /search?q=<script> HTTP/1.1\nCookie: session=SECRETVALUE12345",
        response: "<html>...</html>",
        proof: "curl -H 'Authorization: Bearer abc123def456ghi789' ...",
      },
    ],
  };
  const result = parseStrixReport(JSON.stringify(report));
  assert.equal(result.format, "strix-json");
  const candidate = result.candidates[0];
  // whitelist only — raw fields must be absent by omission
  assert.deepEqual(Object.keys(candidate).sort(), ["cvssVector", "cwe", "endpoint", "externalId", "fingerprint", "method", "remediation", "severity", "summary", "title"].sort());
  assert.equal(candidate.method, "GET");
  assert.ok(!candidate.summary.includes("abc123def456ghi789"), "bearer token must be redacted from summary");
  assert.ok(candidate.summary.includes("[redacted]"));
});

test("sanitizeCandidate reads only whitelisted fields, dropping any raw keys present on the record", () => {
  const candidate = sanitizeCandidate({ title: "IDOR", severity: "HIGH", endpoint: "https://x.local/api/1", request: "raw", response: "raw", payload: "raw" });
  assert.equal(candidate.severity, "high");
  assert.ok(!("request" in candidate) && !("response" in candidate) && !("payload" in candidate));
  assert.ok(candidate.fingerprint.startsWith("strix|"));
});

test("redactSecrets masks tokens, keys and long secrets", () => {
  const redacted = redactSecrets("admin. Authorization: Bearer abc123def456ghi789 api_key=SECRETVALUE12345 hash 0123456789abcdef0123456789abcdef");
  assert.ok(!redacted.includes("abc123def456ghi789"));
  assert.ok(!redacted.includes("SECRETVALUE12345"));
  assert.ok(!redacted.includes("0123456789abcdef0123456789abcdef"));
  assert.ok(redacted.includes("[redacted"));
});

test("severity maps provider strings and SARIF levels to a fixed enum", () => {
  assert.equal(normalizeSeverity("Critical"), "critical");
  assert.equal(normalizeSeverity("error"), "high");
  assert.equal(normalizeSeverity("warning"), "medium");
  assert.equal(normalizeSeverity("note"), "low");
  assert.equal(normalizeSeverity("informational"), "info");
  assert.equal(normalizeSeverity(""), "unknown");
});

test("an empty report is labelled incomplete, never secure", () => {
  const result = parseStrixReport(JSON.stringify({ vulnerabilities: [] }));
  assert.equal(result.candidates.length, 0);
  assert.ok(result.limitations[0].includes("not evidence that the target is secure"));
});

test("malformed and unrecognised reports are rejected safely", () => {
  assert.throws(() => parseStrixReport("{not json"), StrixInputError);
  assert.throws(() => parseStrixReport(JSON.stringify({ foo: 1 })), StrixInputError);
  assert.throws(() => parseStrixReport(""), StrixInputError);
});

test("a high/critical reproducible decision requires a second, different reviewer", () => {
  // low severity applies immediately
  assert.equal(resolveReviewDecision({ current: "pending", decision: "reproducible", severity: "low", reviewerEmail: "a@x" }).reviewStatus, "reproducible");

  // high severity parks for a second check
  const first = resolveReviewDecision({ current: "pending", decision: "reproducible", severity: "critical", reviewerEmail: "a@x" });
  assert.equal(first.reviewStatus, "awaiting_second_check");
  assert.equal(first.awaitingSecondCheck, true);

  // the same reviewer cannot self-confirm
  assert.throws(() => resolveReviewDecision({ current: "awaiting_second_check", decision: "reproducible", severity: "critical", reviewerEmail: "a@x", firstReviewerEmail: "a@x" }), StrixInputError);

  // a different reviewer confirms
  const confirmed = resolveReviewDecision({ current: "awaiting_second_check", decision: "reproducible", severity: "critical", reviewerEmail: "b@x", firstReviewerEmail: "a@x" });
  assert.equal(confirmed.reviewStatus, "reproducible");
  assert.equal(confirmed.secondCheckBy, "b@x");

  // non-reproducible decisions apply immediately even on high severity
  assert.equal(resolveReviewDecision({ current: "pending", decision: "false_positive", severity: "critical", reviewerEmail: "a@x" }).reviewStatus, "false_positive");
  assert.throws(() => resolveReviewDecision({ current: "pending", decision: "nonsense", severity: "low", reviewerEmail: "a@x" }), StrixInputError);
});
