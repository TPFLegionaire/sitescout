import assert from "node:assert/strict";

if (process.env.QUALITY_LIVE_MUTATION_OK !== "disposable") throw new Error("Synthetic pilot requires isolated disposable D1/R2 state.");

const baseUrl = process.env.QUALITY_TEST_URL ?? "http://localhost:3000";
const users = [
  ...Array.from({ length: 5 }, (_, index) => ({ email: `reporter${index + 1}@pilot.invalid`, role: "reporter" })),
  ...Array.from({ length: 2 }, (_, index) => ({ email: `validator${index + 1}@pilot.invalid`, role: "validator" })),
  ...Array.from({ length: 2 }, (_, index) => ({ email: `owner${index + 1}@pilot.invalid`, role: "finding_owner" })),
  { email: "admin1@pilot.invalid", role: "administrator" },
];
const byEmail = Object.fromEntries(users.map((user) => [user.email, user]));
const screenshot = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function auth(user) {
  return {
    "x-sitescout-test-user-id": `synthetic-${user.email}`,
    "x-sitescout-test-user-email": user.email,
    "x-sitescout-test-user-name": `Synthetic ${user.role}`,
  };
}

async function json(path, init = {}, user = byEmail["admin1@pilot.invalid"]) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...auth(user), ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function reportForm({ title, description, durationMs, restricted = false }) {
  const form = new FormData();
  form.set("targetId", "sample-shop-production");
  form.set("url", "https://example.com/products/widget-a");
  form.set("title", title);
  form.set("description", description);
  form.set("expected", "The product page should present an accurate and usable result.");
  form.set("actual", description);
  form.set("suggestedFindingId", "SHOP-M1");
  form.set("reportingVersion", "site-scout-v1");
  form.set("privacyConfirmed", "true");
  form.set("submissionDurationMs", String(durationMs));
  if (restricted) form.set("securitySensitive", "true");
  form.set("screenshot", new Blob([screenshot], { type: "image/png" }), "synthetic-public-page.png");
  return form;
}

for (const user of users) {
  const response = await json("/api/my-reports", {}, user);
  assert.equal(response.response.status, 200, `${user.role} should access their own reports`);
}
const reporterDashboard = await json("/api/dashboard", {}, byEmail["reporter1@pilot.invalid"]);
assert.equal(reporterDashboard.response.status, 403);

const submitted = await json("/api/observations", { method: "POST", body: reportForm({ title: "Synthetic feedback-loop report", description: "The product image and title appear inconsistent on mobile.", durationMs: 14500 }) }, byEmail["reporter1@pilot.invalid"]);
assert.equal(submitted.response.status, 201);
const reportId = submitted.payload.observationId;

const informationRequest = await json(`/api/observations/${reportId}/review`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "needs_info", note: "Please confirm the browser width and whether a refresh changes the result." }),
}, byEmail["validator1@pilot.invalid"]);
assert.equal(informationRequest.response.status, 200);

let reporterView = await json("/api/my-reports", {}, byEmail["reporter1@pilot.invalid"]);
let report = reporterView.payload.data.reports.find((item) => item.id === reportId);
assert.equal(report.workflowStatus, "needs_info");
assert.equal(report.messages.length, 1);
assert.equal(report.messages[0].messageType, "information_request");

const replyForm = new FormData();
replyForm.set("message", "Reproduced at 390px width in Edge. A hard refresh does not change the mismatch.");
replyForm.set("privacyConfirmed", "true");
replyForm.set("screenshot", new Blob([screenshot], { type: "image/png" }), "additional-public-evidence.png");
const replied = await json(`/api/my-reports/${reportId}/reply`, { method: "POST", body: replyForm }, byEmail["reporter1@pilot.invalid"]);
assert.equal(replied.response.status, 201);

const validatorDashboard = await json("/api/dashboard", {}, byEmail["validator1@pilot.invalid"]);
const pendingReport = validatorDashboard.payload.data.observations.find((item) => item.id === reportId);
assert.equal(pendingReport.reviewStatus, "pending");
assert.equal(pendingReport.evidence.length, 2);
assert.equal(pendingReport.messages.length, 2);

const supported = await json(`/api/observations/${reportId}/review`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision: "support", findingId: "SHOP-M1", note: "Additional mobile evidence validated." }),
}, byEmail["validator1@pilot.invalid"]);
assert.equal(supported.response.status, 200);
assert.equal((await json(`/api/staff-reports/${reportId}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "assigned", assignedTo: "owner1@pilot.invalid" }) }, byEmail["validator1@pilot.invalid"])).response.status, 200);
assert.equal((await json(`/api/staff-reports/${reportId}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "fixed" }) }, byEmail["owner1@pilot.invalid"])).response.status, 200);
assert.equal((await json(`/api/staff-reports/${reportId}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "retested" }) }, byEmail["validator2@pilot.invalid"])).response.status, 200);
assert.equal((await json(`/api/staff-reports/${reportId}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "closed" }) }, byEmail["validator2@pilot.invalid"])).response.status, 200);

reporterView = await json("/api/my-reports", {}, byEmail["reporter1@pilot.invalid"]);
report = reporterView.payload.data.reports.find((item) => item.id === reportId);
assert.equal(report.workflowStatus, "closed");
for (const eventType of ["report_needs_info", "report_response_received", "report_linked", "report_fixed", "report_retested", "report_closed"]) assert.ok(reporterView.payload.data.notifications.some((notification) => notification.eventType === eventType));

const restricted = await json("/api/observations", { method: "POST", body: reportForm({ title: "Synthetic restricted security report", description: "A response may disclose an internal implementation value.", durationMs: 18000, restricted: true }) }, byEmail["reporter2@pilot.invalid"]);
assert.equal(restricted.response.status, 201);
const restrictedDashboard = await json("/api/dashboard", {}, byEmail["validator1@pilot.invalid"]);
const restrictedReport = restrictedDashboard.payload.data.observations.find((item) => item.id === restricted.payload.observationId);
assert.equal(restrictedReport.privacyClassification, "restricted_security");
const restrictedAssetId = restrictedReport.evidence[0].id;
const ownerDashboard = await json("/api/dashboard", {}, byEmail["owner2@pilot.invalid"]);
assert.equal(ownerDashboard.payload.data.observations.some((item) => item.id === restricted.payload.observationId), false);
assert.equal((await fetch(`${baseUrl}/api/evidence/${restrictedAssetId}`, { headers: auth(byEmail["owner2@pilot.invalid"]) })).status, 403);
assert.equal((await fetch(`${baseUrl}/api/evidence/${restrictedAssetId}`, { headers: auth(byEmail["validator1@pilot.invalid"]) })).status, 200);

const runId = `synthetic-970-${Date.now()}`;
const rules = [
  ["qa.seo.canonical-missing", "Canonical URL is missing", "medium", 650],
  ["qa.seo.title-long", "Page title is unusually long", "low", 200],
  ["qa.seo.description-missing", "Meta description is missing", "medium", 80],
  ["qa.accessibility.h1-missing", "Primary heading is missing", "medium", 40],
];
const findings = [];
let sequence = 0;
for (const [ruleId, title, severity, count] of rules) {
  for (let index = 0; index < count; index += 1) {
    sequence += 1;
    findings.push({ id: `${ruleId}-${index}`, ruleId, url: `https://www.example.com/products/SYNTH-${sequence}`, title, severity, category: "Synthetic", summary: "Synthetic grouped-review evidence.", expected: "The rule should pass.", actual: "The rule produced evidence.", recommendation: "Link only after human group review.", evidence: { synthetic: true, sequence } });
  }
}
const imported = await json("/api/audits/import", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    schemaVersion: 1, id: runId, targetId: "sample-shop-staging", status: "complete", runType: "automated",
    startedAt: "2026-08-01T09:00:00.000Z", completedAt: "2026-08-01T09:10:00.000Z", rulesetVersion: "sitescout-rules-v1", profileVersion: "synthetic-grouping-v1",
    profile: "synthetic", browser: "HTTP", viewport: "not-applicable", locale: "en-GB", comparable: false, comparisonReason: "Synthetic pilot only.",
    coverage: { pageLimit: 970, pagesAttempted: 970, pagesCompleted: 970 }, limitations: ["Synthetic data; not website evidence."], findings,
  }),
}, byEmail["admin1@pilot.invalid"]);
assert.equal(imported.response.status, 201);
assert.equal(imported.payload.observationsQueued, 970);

let bulkProcessed = 0;
for (let pass = 0; pass < 20; pass += 1) {
  const dashboard = await json("/api/dashboard", {}, byEmail["admin1@pilot.invalid"]);
  const syntheticGroups = dashboard.payload.data.automatedGroups.filter((group) => group.id && group.sampleUrls.some((url) => url.includes("SYNTH-")));
  if (!syntheticGroups.length) break;
  for (const group of syntheticGroups) {
    const decision = group.proposedFindingId ? "link" : "reject";
    const result = await json("/api/automated-groups/review", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: group.id, decision, findingId: group.proposedFindingId, expectedCount: group.count, note: "Synthetic ten-user pilot bulk decision" }),
    }, byEmail["validator2@pilot.invalid"]);
    assert.equal(result.response.status, 200);
    assert.ok(result.payload.processed > 0 && result.payload.processed <= 250);
    bulkProcessed += result.payload.processed;
  }
}
assert.equal(bulkProcessed, 970);

const finalDashboard = await json("/api/dashboard", {}, byEmail["admin1@pilot.invalid"]);
assert.ok(finalDashboard.payload.data.pilotMetrics.knownUsers >= 10);
assert.equal(finalDashboard.payload.data.pilotMetrics.usersByRole.reporter, 5);
assert.equal(finalDashboard.payload.data.pilotMetrics.usersByRole.validator, 2);
assert.equal(finalDashboard.payload.data.pilotMetrics.usersByRole.finding_owner, 2);
assert.ok(finalDashboard.payload.data.pilotMetrics.underTwentySecondsRate >= 50);
assert.equal(finalDashboard.payload.data.privacy.mode, "dry-run");
assert.equal(finalDashboard.payload.data.privacy.deletionEnabled, false);
assert.ok(finalDashboard.payload.data.privacy.protectedSecurityAssets >= 1);

process.stdout.write(`${JSON.stringify({ ok: true, syntheticUsers: 10, feedbackLoopReport: reportId, restrictedEvidenceProtected: true, automatedObservationsBulkReviewed: bulkProcessed, metrics: finalDashboard.payload.data.pilotMetrics, privacy: { mode: finalDashboard.payload.data.privacy.mode, deletionEnabled: finalDashboard.payload.data.privacy.deletionEnabled } }, null, 2)}\n`);
