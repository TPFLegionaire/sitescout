import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CANDIDATES,
  MAX_REPORT_BYTES,
  RESTRICTED_EVIDENCE_PLACEHOLDER,
  StrixConflictError,
  StrixInputError,
  normalizeSeverity,
  parseStrixReport,
  redactSecrets,
  resolveReviewDecision,
  sanitizeCandidate,
  sanitizeEndpoint,
  sanitizeReviewNote,
} from "../lib/platform/security/strix-core.mjs";

const scope = { allowedHost: "www.example.com", allowedPathPrefix: "/" };

test("parses SARIF 2.1.0, applies numeric CVSS and removes URL query data", () => {
  const sarif = {
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "strix", rules: [{ id: "sqli", name: "SQL Injection", properties: { "security-severity": "9.1", cwe: "CWE-89" } }] } },
      results: [{
        ruleId: "sqli",
        level: "warning",
        message: { text: "Potential SQL injection at login" },
        locations: [{ physicalLocation: { artifactLocation: { uri: "https://www.example.com/rest/user/login?session=secret#proof" } } }],
        properties: { "security-severity": "9.1" },
      }],
    }],
  };
  const result = parseStrixReport(JSON.stringify(sarif), scope);
  assert.equal(result.format, "sarif");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, "SQL Injection");
  assert.equal(result.candidates[0].severity, "critical");
  assert.equal(result.candidates[0].cwe, "CWE-89");
  assert.equal(result.candidates[0].endpoint, "www.example.com/rest/user/login");
  assert.deepEqual(result.candidates[0].sanitizationFlags, ["endpoint_query_removed", "endpoint_fragment_removed"]);
  assert.equal(result.candidates[0].sanitizationStatus, "redacted");
});

test("generic Strix JSON drops raw traffic and quarantines secrets without leaking them", () => {
  const token = "secretBearerValue123456789";
  const report = {
    vulnerabilities: [{
      id: "V-1",
      title: "Reflected XSS",
      severity: "medium",
      cwe: "CWE-79",
      endpoint: "https://www.example.com/search?q=%3Cscript%3E",
      method: "get",
      description: `Reflected input. Authorization: Bearer ${token}`,
      remediation: "Encode output on render.",
      request: "GET /search?q=<script> HTTP/1.1\nCookie: session=anotherSecret12345",
      response: "HTTP/1.1 200 OK",
      proof: "curl --header 'Authorization: Bearer hidden' https://www.example.com",
    }],
  };
  const result = parseStrixReport(JSON.stringify(report), scope);
  const candidate = result.candidates[0];
  assert.equal(candidate.method, "GET");
  assert.equal(candidate.endpoint, "www.example.com/search");
  assert.equal(candidate.summary, RESTRICTED_EVIDENCE_PLACEHOLDER);
  assert.equal(candidate.sanitizationStatus, "quarantined");
  assert.ok(candidate.sanitizationFlags.includes("secret_material"));
  assert.ok(candidate.sanitizationFlags.includes("dropped_raw_evidence"));
  assert.ok(!JSON.stringify(candidate).includes(token));
  for (const forbidden of ["request", "response", "payload", "proof"]) assert.ok(!(forbidden in candidate));
});

test("sanitizeCandidate is a strict whitelist and marks dropped raw evidence", () => {
  const candidate = sanitizeCandidate(
    { title: "IDOR", severity: "HIGH", endpoint: "/api/1", request: "raw", response: "raw", payload: "raw" },
    { ...scope, inputFlags: ["dropped_raw_evidence", "attacker_supplied_flag"] },
  );
  assert.equal(candidate.severity, "high");
  assert.equal(candidate.endpoint, "www.example.com/api/1");
  assert.equal(candidate.sanitizationStatus, "quarantined");
  assert.deepEqual(candidate.sanitizationFlags, ["dropped_raw_evidence"]);
  assert.ok(!("request" in candidate) && !("response" in candidate) && !("payload" in candidate));
  assert.ok(candidate.fingerprint.startsWith("strix|www.example.com|"));
});

test("endpoint sanitisation is exact-host, path-scoped and secret-safe", () => {
  assert.deepEqual(sanitizeEndpoint("/shop/item?token=hidden#proof", "www.example.com", "/shop"), {
    value: "www.example.com/shop/item",
    flags: ["endpoint_query_removed", "endpoint_fragment_removed"],
  });
  assert.ok(sanitizeEndpoint("https://other.example/shop", "www.example.com", "/shop").flags.includes("out_of_scope_endpoint"));
  assert.ok(sanitizeEndpoint("https://www.example.com/admin", "www.example.com", "/shop").flags.includes("out_of_scope_endpoint"));
  assert.ok(sanitizeEndpoint("https://user:pass@www.example.com/shop", "www.example.com", "/shop").flags.includes("credential_in_url"));
  assert.ok(sanitizeEndpoint("https://www.example.com:8443/shop", "www.example.com", "/shop").flags.includes("out_of_scope_endpoint"));
  const pathSecret = sanitizeEndpoint(`https://www.example.com/shop/${"a".repeat(40)}`, "www.example.com", "/shop");
  assert.equal(pathSecret.value, "");
  assert.ok(pathSecret.flags.includes("secret_material"));
  assert.ok(pathSecret.flags.includes("restricted_endpoint_path"));
});

test("secret redaction covers credentials, tokens, cookies, keys and long opaque values", () => {
  const source = [
    "Authorization: Basic dXNlcjpwYXNzd29yZA==",
    "Cookie: session=secret-cookie",
    "client_secret=topSecretValue",
    "AKIAABCDEFGHIJKLMNOP",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature",
    "0123456789abcdef0123456789abcdef",
    "-----BEGIN PRIVATE KEY----- hidden -----END PRIVATE KEY-----",
  ].join("\n");
  const redacted = redactSecrets(source);
  for (const secret of ["dXNlcjpwYXNzd29yZA==", "secret-cookie", "topSecretValue", "AKIAABCDEFGHIJKLMNOP", "0123456789abcdef0123456789abcdef", " hidden "]) {
    assert.ok(!redacted.includes(secret), secret);
  }
  assert.match(redacted, /\[redacted/);
});

test("severity uses the more conservative textual or numeric CVSS value", () => {
  assert.equal(normalizeSeverity("warning", "9.1"), "critical");
  assert.equal(normalizeSeverity("critical", "2.0"), "critical");
  assert.equal(normalizeSeverity("", 7.5), "high");
  assert.equal(normalizeSeverity("", 4), "medium");
  assert.equal(normalizeSeverity("", 0), "info");
  assert.equal(normalizeSeverity("", "11"), "unknown");
});

test("empty output is explicitly incomplete rather than evidence of security", () => {
  const result = parseStrixReport(JSON.stringify({ vulnerabilities: [] }), scope);
  assert.equal(result.candidates.length, 0);
  assert.match(result.limitations[0], /not evidence that the target is secure/i);
});

test("malformed, ambiguous, oversized and over-complex reports fail closed", () => {
  assert.throws(() => parseStrixReport("{not json", scope), StrixInputError);
  assert.throws(() => parseStrixReport(JSON.stringify({ foo: 1 }), scope), StrixInputError);
  assert.throws(() => parseStrixReport(JSON.stringify({ vulnerabilities: [], findings: [] }), scope), StrixInputError);
  assert.throws(() => parseStrixReport(JSON.stringify({ version: "2.0.0", runs: [] }), scope), StrixInputError);
  assert.throws(() => parseStrixReport(JSON.stringify({ version: "2.1.0", runs: [{ results: {} }] }), scope), StrixInputError);
  assert.throws(() => parseStrixReport(JSON.stringify({ vulnerabilities: Array.from({ length: MAX_CANDIDATES + 1 }, (_, id) => ({ id })) }), scope), StrixInputError);
  assert.throws(() => parseStrixReport("x".repeat(MAX_REPORT_BYTES + 1), scope), StrixInputError);
  const deeplyNested = { vulnerabilities: [] };
  let cursor = deeplyNested;
  for (let index = 0; index < 22; index += 1) cursor = cursor.child = {};
  assert.throws(() => parseStrixReport(JSON.stringify(deeplyNested), scope), StrixInputError);
  assert.throws(() => parseStrixReport(JSON.stringify({ vulnerabilities: [] }), { allowedHost: "" }), StrixInputError);
  assert.throws(() => parseStrixReport(JSON.stringify({ vulnerabilities: [] }), { ...scope, source: "other" }), StrixInputError);
});

test("review notes reject secrets, raw traffic and exploit payloads", () => {
  assert.equal(sanitizeReviewNote("Confirmed against the approved disposable target."), "Confirmed against the approved disposable target.");
  assert.throws(() => sanitizeReviewNote("Authorization: Bearer secretValue123456"), StrixInputError);
  assert.throws(() => sanitizeReviewNote("GET /admin HTTP/1.1"), StrixInputError);
  assert.throws(() => sanitizeReviewNote("Try <script>alert(1)</script>"), StrixInputError);
});

test("all high, critical and unknown decisions require a different second reviewer", () => {
  const low = resolveReviewDecision({ current: "pending", decision: "reproducible", severity: "low", reviewerEmail: "a@x" });
  assert.equal(low.reviewStatus, "reproducible");
  assert.equal(low.stage, "final");

  for (const severity of ["high", "critical", "unknown"]) {
    for (const decision of ["reproducible", "false_positive"]) {
      const first = resolveReviewDecision({ current: "pending", decision, severity, reviewerEmail: "a@x" });
      assert.equal(first.reviewStatus, "awaiting_second_check");
      assert.equal(first.stage, "first");
    }
  }

  assert.throws(
    () => resolveReviewDecision({ current: "awaiting_second_check", decision: "reproducible", severity: "critical", reviewerEmail: "A@x", firstReviewerEmail: "a@x" }),
    StrixConflictError,
  );
  const changed = resolveReviewDecision({ current: "awaiting_second_check", decision: "false_positive", severity: "critical", reviewerEmail: "b@x", firstReviewerEmail: "a@x" });
  assert.equal(changed.reviewStatus, "false_positive");
  assert.equal(changed.stage, "second");
  assert.equal(changed.secondCheckBy, "b@x");
  assert.throws(() => resolveReviewDecision({ current: "reproducible", decision: "duplicate", severity: "low", reviewerEmail: "c@x" }), StrixConflictError);
  assert.throws(() => resolveReviewDecision({ current: "pending", decision: "nonsense", severity: "low", reviewerEmail: "a@x" }), StrixInputError);
});
