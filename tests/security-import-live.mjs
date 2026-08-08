import assert from "node:assert/strict";

if (process.env.QUALITY_LIVE_MUTATION_OK !== "disposable") throw new Error("Refusing to test security imports without verified disposable D1/R2 state.");

const baseUrl = process.env.QUALITY_TEST_URL ?? "http://localhost:3000";
const identity = (email, name) => ({
  "x-sitescout-test-user-id": `integration:${email}`,
  "x-sitescout-test-user-email": email,
  "x-sitescout-test-user-name": name,
});
const adminOne = identity("admin1@pilot.invalid", "Security administrator one");
const adminTwo = identity("admin2@pilot.invalid", "Security administrator two");
const reporter = identity("reporter1@pilot.invalid", "Pilot reporter");
const unassignedReviewer = identity("security1@pilot.invalid", "Unassigned security reviewer");

async function json(path, init = {}, headers = adminOne) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function importForm(report, extra = {}) {
  const form = new FormData();
  form.set("targetId", extra.targetId ?? "sample-shop-staging");
  form.set("sourceVersion", extra.sourceVersion ?? "pilot-1.0.0");
  form.set("scanMode", extra.scanMode ?? "black-box");
  if (extra.source) form.set("source", extra.source);
  const bytes = extra.bytes ?? Buffer.from(JSON.stringify(report));
  form.set("report", new Blob([bytes], { type: "application/json" }), extra.filename ?? "strix-pilot.json");
  return form;
}

const rawSecret = "security-live-secret-123456789";
const querySecret = "query-live-secret-987654321";
const report = {
  vulnerabilities: [
    {
      id: "STRIX-LIVE-1",
      title: "Synthetic access-control candidate",
      severity: "medium",
      cvss_score: 9.3,
      cwe: "CWE-284",
      endpoint: `https://www.example.com/account/profile?session=${querySecret}#proof`,
      method: "GET",
      description: "Synthetic differential response requires human validation.",
      remediation: "Apply server-side object authorisation and add a regression test.",
      request: `GET /account/profile HTTP/1.1\nAuthorization: Bearer ${rawSecret}`,
      response: "HTTP/1.1 200 OK",
    },
    {
      id: "STRIX-LIVE-2",
      title: "Synthetic low-impact header candidate",
      severity: "low",
      endpoint: "/status",
      method: "HEAD",
      description: "Synthetic candidate for the single-review path.",
      remediation: "Confirm the intended response policy.",
    },
  ],
};

const reporterImport = await json("/api/security/imports", { method: "POST", body: importForm(report) }, reporter);
assert.equal(reporterImport.response.status, 403, "reporters must not import security evidence");

const unassignedRead = await json("/api/security/imports", {}, unassignedReviewer);
assert.equal(unassignedRead.response.status, 200);
assert.deepEqual(unassignedRead.payload.data.targets, [], "a reviewer without a site assignment must see no targets");
const unassignedImport = await json("/api/security/imports", { method: "POST", body: importForm(report) }, unassignedReviewer);
assert.equal(unassignedImport.response.status, 403, "a reviewer without a matching site assignment must not import");

const wrongTarget = await json("/api/security/imports", { method: "POST", body: importForm(report, { targetId: "sample-shop-production" }) });
assert.equal(wrongTarget.response.status, 403, "deployment target allowlist must fail closed");
const wrongSource = await json("/api/security/imports", { method: "POST", body: importForm(report, { source: "other-scanner" }) });
assert.equal(wrongSource.response.status, 400, "the evidence source must remain fixed to Strix");
const invalidUtf8 = await json("/api/security/imports", { method: "POST", body: importForm(report, { bytes: Uint8Array.from([0xff, 0xfe, 0xfd]) }) });
assert.equal(invalidUtf8.response.status, 400, "invalid UTF-8 must not become a server error");

const imported = await json("/api/security/imports", { method: "POST", body: importForm(report) });
assert.equal(imported.response.status, 201);
assert.equal(imported.payload.ok, true);
assert.equal(imported.payload.candidateCount, 2);
assert.ok(imported.payload.importRunId);

const duplicate = await json("/api/security/imports", { method: "POST", body: importForm(report) });
assert.equal(duplicate.response.status, 200);
assert.equal(duplicate.payload.idempotent, true);
assert.equal(duplicate.payload.importRunId, imported.payload.importRunId);

let reviewView = await json("/api/security/imports");
assert.equal(reviewView.response.status, 200);
const run = reviewView.payload.data.imports.find((item) => item.id === imported.payload.importRunId);
assert.ok(run);
assert.equal(run.organizationId, "demo-portfolio");
assert.equal(run.siteId, "sample-shop");
assert.equal(run.targetId, "sample-shop-staging");
assert.equal(run.source, "strix");
assert.ok(!("artifactStorageKey" in run), "private R2 keys must never enter the review API");
const candidates = reviewView.payload.data.candidates.filter((item) => item.importRunId === run.id);
assert.equal(candidates.length, 2);
const critical = candidates.find((item) => item.externalId === "STRIX-LIVE-1");
const low = candidates.find((item) => item.externalId === "STRIX-LIVE-2");
assert.ok(critical && low);
assert.equal(critical.severity, "critical", "numeric CVSS must override a lower textual severity");
assert.equal(critical.endpoint, "www.example.com/account/profile");
assert.equal(critical.sanitizationStatus, "quarantined");
assert.ok(JSON.parse(critical.sanitizationFlagsJson).includes("dropped_raw_evidence"));
const publicCandidateJson = JSON.stringify(critical);
assert.ok(!publicCandidateJson.includes(rawSecret));
assert.ok(!publicCandidateJson.includes(querySecret));
assert.ok(!publicCandidateJson.includes("HTTP/1.1"));

const reporterArtifact = await fetch(`${baseUrl}/api/security/artifacts/${run.id}`, { headers: reporter });
assert.equal(reporterArtifact.status, 403, "reporters must not retrieve raw security evidence");
assert.match(reporterArtifact.headers.get("cache-control") ?? "", /no-store/);
const rawArtifact = await fetch(`${baseUrl}/api/security/artifacts/${run.id}`, { headers: adminOne });
assert.equal(rawArtifact.status, 200);
assert.match(rawArtifact.headers.get("cache-control") ?? "", /private/);
assert.match(rawArtifact.headers.get("cache-control") ?? "", /no-store/);
assert.equal(rawArtifact.headers.get("x-content-type-options"), "nosniff");
assert.match(rawArtifact.headers.get("content-disposition") ?? "", /attachment/);
const rawText = await rawArtifact.text();
assert.ok(rawText.includes(rawSecret), "the authorised restricted download must preserve immutable source evidence");

const oversizedReview = await json(`/api/security/candidates/${low.id}/review`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "false_positive", note: "x".repeat(17 * 1024), reviewMinutes: 1 }),
});
assert.equal(oversizedReview.response.status, 400);
const unsafeNote = await json(`/api/security/candidates/${low.id}/review`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "false_positive", note: `Authorization: Bearer ${rawSecret}`, reviewMinutes: 1 }),
});
assert.equal(unsafeNote.response.status, 400);
const invalidMinutes = await json(`/api/security/candidates/${low.id}/review`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "false_positive", note: "Safe note", reviewMinutes: -1 }),
});
assert.equal(invalidMinutes.response.status, 400);
const lowReview = await json(`/api/security/candidates/${low.id}/review`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "false_positive", note: "Synthetic low-impact result rejected.", reviewMinutes: 1 }),
});
assert.equal(lowReview.response.status, 200);
assert.equal(lowReview.payload.reviewStatus, "false_positive");

const firstCheck = await json(`/api/security/candidates/${critical.id}/review`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "reproducible", note: "First check completed against the disposable target.", reviewMinutes: 3 }),
});
assert.equal(firstCheck.response.status, 200);
assert.equal(firstCheck.payload.reviewStatus, "awaiting_second_check");
assert.equal(firstCheck.payload.awaitingSecondCheck, true);
const selfCheck = await json(`/api/security/candidates/${critical.id}/review`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "reproducible", note: "Must not self-confirm.", reviewMinutes: 2 }),
});
assert.equal(selfCheck.response.status, 409);
const secondCheck = await json(`/api/security/candidates/${critical.id}/review`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "reproducible", note: "Independent second check completed.", reviewMinutes: 2 }),
}, adminTwo);
assert.equal(secondCheck.response.status, 200);
assert.equal(secondCheck.payload.reviewStatus, "reproducible");
const immutableFinal = await json(`/api/security/candidates/${critical.id}/review`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "duplicate", note: "Final history must be immutable.", reviewMinutes: 1 }),
}, adminTwo);
assert.equal(immutableFinal.response.status, 409);

reviewView = await json("/api/security/imports");
const criticalHistory = reviewView.payload.data.reviews.filter((item) => item.candidateId === critical.id);
assert.deepEqual(criticalHistory.map((item) => item.stage), ["first", "second"]);
assert.notEqual(criticalHistory[0].reviewerEmail, criticalHistory[1].reviewerEmail);
assert.equal(reviewView.payload.data.candidates.find((item) => item.id === critical.id).reviewStatus, "reproducible");

const reporterRetention = await json("/api/security/artifacts/retention", { method: "POST" }, reporter);
assert.equal(reporterRetention.response.status, 403);
const retention = await json("/api/security/artifacts/retention", { method: "POST" });
assert.equal(retention.response.status, 200);
assert.equal(retention.payload.deleted, 0);

const reporterDelete = await fetch(`${baseUrl}/api/security/artifacts/${run.id}`, { method: "DELETE", headers: reporter });
assert.equal(reporterDelete.status, 403);
const adminDelete = await fetch(`${baseUrl}/api/security/artifacts/${run.id}`, { method: "DELETE", headers: adminOne });
assert.equal(adminDelete.status, 204);
const deletedArtifact = await fetch(`${baseUrl}/api/security/artifacts/${run.id}`, { headers: adminOne });
assert.equal(deletedArtifact.status, 410);
assert.match(deletedArtifact.headers.get("cache-control") ?? "", /no-store/);

reviewView = await json("/api/security/imports");
assert.ok(reviewView.payload.data.imports.find((item) => item.id === run.id).deletedAt);
assert.equal(reviewView.payload.data.candidates.filter((item) => item.importRunId === run.id).length, 2, "sanitised review history must survive raw-artifact deletion");

process.stdout.write(`${JSON.stringify({
  ok: true,
  importRunId: run.id,
  candidateCount: candidates.length,
  appendOnlyReviewEvents: criticalHistory.length,
  rawArtifactDeleted: true,
}, null, 2)}\n`);
