import assert from "node:assert/strict";

if (process.env.QUALITY_LIVE_MUTATION_OK !== "disposable") throw new Error("Public preview validation requires isolated disposable D1/R2 state.");

const baseUrl = process.env.QUALITY_TEST_URL ?? "http://localhost:3000";

async function json(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const dashboard = await json("/api/dashboard");
assert.equal(dashboard.response.status, 200);
assert.equal(dashboard.payload.user.role, "management_viewer");
assert.equal(dashboard.payload.user.localPilot, false);
assert.equal(dashboard.payload.data.pilot.deployment, "public-management-preview");
assert.equal(dashboard.payload.data.sites.length, 2);
assert.equal(dashboard.payload.data.summary.pendingAutomated, 1);
assert.equal(dashboard.payload.data.queues.automated, 1);
assert.equal(dashboard.payload.data.automatedGroups.reduce((total, group) => total + group.count, 0), 1);
assert.equal(dashboard.payload.data.pilotMetrics.knownUsers, 0);
for (const runId of ["run-sample-shop-production-v1", "run-sample-shop-staging-v1", "run-sample-docs-production-v1", "run-sample-docs-staging-v1"]) {
  assert.ok(dashboard.payload.data.runs.some((run) => run.id === runId));
}

const home = await fetch(`${baseUrl}/`);
assert.equal(home.status, 200);
assert.match(await home.text(), /Public preview/);

for (const path of ["/report", "/my-reports"]) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  assert.ok([301, 302, 303, 307, 308].includes(response.status));
  assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/");
}

const blockedMutations = [
  ["/api/observations", { method: "POST" }],
  ["/api/findings/SHOP-H1", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/audits/import", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/baselines", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/automated-groups/review", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
];
for (const [path, init] of blockedMutations) {
  const result = await json(path, init);
  assert.equal(result.response.status, 403, `${path} must remain read-only for public viewers`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  access: "public-read-only",
  automatedObservations: dashboard.payload.data.queues.automated,
  automatedGroups: dashboard.payload.data.queues.automatedGroupCount,
  mutationEndpointsBlocked: blockedMutations.length,
}, null, 2)}\n`);
