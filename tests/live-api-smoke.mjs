import assert from "node:assert/strict";

if (process.env.QUALITY_LIVE_MUTATION_OK !== "disposable") throw new Error("Refusing to mutate D1/R2 without verified disposable state.");

const baseUrl = process.env.QUALITY_TEST_URL ?? "http://localhost:3000";
const adminHeaders = {
  "x-sitescout-test-user-id": "local-integration-admin",
  "x-sitescout-test-user-email": "admin1@pilot.invalid",
  "x-sitescout-test-user-name": "Local integration administrator",
};

async function json(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...adminHeaders, ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const health = await json("/api/health");
assert.equal(health.response.status, 200);
assert.equal(health.payload.ok, true);
assert.equal(health.payload.database.schemaVersion, "7");
assert.ok(health.payload.database.counts.organizations >= 1);
assert.ok(health.payload.database.counts.sites >= 2);
assert.ok(health.payload.database.counts.findings >= 8);

const before = await json("/api/dashboard");
assert.equal(before.response.status, 200);
assert.equal(before.payload.data.sites.length, 2);
assert.equal(before.payload.data.findings.length, 8);

function observationForm(privacyConfirmed) {
  const form = new FormData();
  form.set("targetId", "sample-shop-production");
  form.set("url", "https://example.com/products/widget-a");
  form.set("title", "Integration test observation");
  form.set("description", "Verifies the local screenshot evidence contract.");
  form.set("expected", "The observation is accepted only with privacy confirmation.");
  form.set("actual", "The endpoint applied the evidence boundary.");
  form.set("suggestedFindingId", "SHOP-M1");
  form.set("reportingVersion", "site-scout-v1");
  if (privacyConfirmed) form.set("privacyConfirmed", "true");
  return form;
}

const screenshot = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const rejectedForm = observationForm(false);
rejectedForm.set("screenshot", new Blob([screenshot], { type: "image/png" }), "synthetic-page.png");
const rejected = await json("/api/observations", { method: "POST", body: rejectedForm });
assert.equal(rejected.response.status, 400);
assert.match(rejected.payload.error, /Confirm/);

const disguisedForm = observationForm(true);
disguisedForm.set("screenshot", new Blob(["not an image"], { type: "image/png" }), "disguised.png");
const disguised = await json("/api/observations", { method: "POST", body: disguisedForm });
assert.equal(disguised.response.status, 400);
assert.match(disguised.payload.error, /does not match/);

const acceptedForm = observationForm(true);
acceptedForm.set("screenshot", new Blob([screenshot], { type: "image/png" }), "synthetic-page.png");
const accepted = await json("/api/observations", { method: "POST", body: acceptedForm });
assert.equal(accepted.response.status, 201);
assert.ok(accepted.payload.observationId);

const withObservation = await json("/api/dashboard");
const observation = withObservation.payload.data.observations.find((item) => item.id === accepted.payload.observationId);
assert.equal(observation.reviewStatus, "pending");
assert.equal(observation.evidence.length, 1);
const evidence = await fetch(`${baseUrl}/api/evidence/${observation.evidence[0].id}`, { headers: adminHeaders });
assert.equal(evidence.status, 200);
assert.match(evidence.headers.get("content-type") ?? "", /^image\/png/);

const reviewed = await json(`/api/observations/${observation.id}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "support", findingId: "SHOP-M1", note: "Local integration verification" }) });
assert.equal(reviewed.response.status, 200);
const duplicateReview = await json(`/api/observations/${observation.id}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "support", findingId: "SHOP-M1", note: "Must not apply twice" }) });
assert.equal(duplicateReview.response.status, 409);

for (const [status, body] of [
  ["assigned", { status: "assigned", assignedTo: "admin1@pilot.invalid" }], ["fixed", { status: "fixed" }],
  ["retested", { status: "retested" }], ["closed", { status: "closed" }],
]) {
  const result = await json(`/api/staff-reports/${observation.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(result.response.status, 200, status);
}

const myReports = await json("/api/my-reports");
assert.equal(myReports.payload.data.reports.find((report) => report.id === observation.id).workflowStatus, "closed");
for (const eventType of ["report_linked", "report_fixed", "report_retested", "report_closed"]) assert.ok(myReports.payload.data.notifications.some((notification) => notification.eventType === eventType));

const findingUpdate = await json("/api/findings/SHOP-M1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId: "sample-shop-production", status: "regressed", owner: "", acceptanceCriteria: "" }) });
assert.equal(findingUpdate.response.status, 200);

const runId = `live-test-${Date.now()}`;
const auditRun = {
  schemaVersion: 1, id: runId, targetId: "sample-shop-production", status: "complete", runType: "automated",
  startedAt: "2026-08-01T10:00:00.000Z", completedAt: "2026-08-01T10:01:00.000Z", rulesetVersion: "sitescout-rules-v1",
  profileVersion: "safe-crawl-v1", profile: "smoke", browser: "HTTP", viewport: "not-applicable", locale: "en-GB",
  comparable: true, comparisonReason: null, coverage: { pageLimit: 1, pagesAttempted: 1, pagesCompleted: 1 },
  limitations: ["Synthetic local integration run."], findings: [{ id: "qa.test.finding", ruleId: "qa.test.rule", url: "https://example.com/", title: "Synthetic integration finding", severity: "low", category: "Test", summary: "Verifies immutable audit ingestion.", expected: "The run is stored and queued.", actual: "Synthetic evidence.", recommendation: "Discard with the temporary D1 state.", evidence: { synthetic: true } }],
};
const imported = await json("/api/audits/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(auditRun) });
assert.equal(imported.response.status, 201);
const promoted = await json("/api/baselines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId: "sample-shop-production", runId, reason: "Synthetic local integration verification" }) });
assert.equal(promoted.response.status, 201);
assert.equal(promoted.payload.version, 2);

process.stdout.write(`${JSON.stringify({ ok: true, health: health.payload.database, observationId: observation.id, importedRun: runId }, null, 2)}\n`);
