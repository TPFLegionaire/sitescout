// Role-by-role checks of the restricted security report boundary and of who may
// assign and fix staff reports, run over HTTP against a development server on
// disposable state. Synthetic data only.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { json, startDevServer, users } from "./support/dev-server.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const TARGET = "sample-shop-production";

let server;
let administrator, validator, owner, otherOwner, reporter, viewer;
let sequence = 0;

before(async () => {
  server = await startDevServer();
  ({ administrator, validator, owner, otherOwner, reporter, viewer } = Object.fromEntries(Object.entries(users).map(([role, email]) => [role, server.as(email)])));
}, { timeout: 240_000 });

after(async () => { await server?.stop(); }, { timeout: 60_000 });

/** Files a report as the reporter and returns its id, evidence id and the unique text placed in each field. */
async function fileReport({ restricted }) {
  sequence += 1;
  const tag = `${restricted ? "RSTR" : "STD"}-${Date.now()}-${sequence}`;
  const marks = { title: `${tag}-TITLE`, description: `${tag}-DESCRIPTION`, expected: `${tag}-EXPECTED`, actual: `${tag}-ACTUAL` };
  const form = new FormData();
  form.set("targetId", TARGET);
  form.set("url", "https://example.com/products/widget-a");
  form.set("title", `Synthetic report ${marks.title}`);
  form.set("description", `Synthetic description ${marks.description}`);
  form.set("expected", `Synthetic expectation ${marks.expected}`);
  form.set("actual", `Synthetic behaviour ${marks.actual}`);
  form.set("privacyConfirmed", "true");
  form.set("reportingVersion", "site-scout-v1");
  if (restricted) form.set("securitySensitive", "true");
  form.set("screenshot", new Blob([PNG], { type: "image/png" }), "synthetic-page.png");
  const submitted = await reporter("/api/observations", { method: "POST", body: form });
  assert.equal(submitted.status, 201, submitted.text);
  const id = submitted.json.observationId;
  const stored = (await administrator("/api/dashboard")).json.data.observations.find((observation) => observation.id === id);
  assert.equal(stored.privacyClassification, restricted ? "restricted_security" : "standard");
  return { id, evidenceId: stored.evidence[0].id, marks: Object.values(marks) };
}

/** Everything the role's dashboard returns, as text, so a leak through any field is caught. */
async function dashboardText(role) {
  const dashboard = await role("/api/dashboard");
  assert.equal(dashboard.status, 200, dashboard.text);
  return dashboard.text;
}

function assertNoTrace(text, report, who) {
  assert.ok(!text.includes(report.id), `${who} can see the restricted report id`);
  for (const mark of report.marks) assert.ok(!text.includes(mark), `${who} can see restricted report text (${mark.split("-").at(-1)})`);
}

const setStatus = (role, report, body) => role(`/api/staff-reports/${report.id}/status`, json(body));

test("a restricted report leaves no trace for a Finding Owner it is not assigned to", async () => {
  const report = await fileReport({ restricted: true });
  assertNoTrace(await dashboardText(owner), report, "an unassigned Finding Owner");
  assert.equal((await owner(`/api/evidence/${report.evidenceId}`)).status, 403);
  assert.equal((await setStatus(owner, report, { status: "assigned", assignedTo: users.owner })).status, 403);
  assert.equal((await setStatus(owner, report, { status: "fixed" })).status, 403);
  // The people inside the boundary still see it.
  for (const insider of [validator, administrator]) assert.ok((await dashboardText(insider)).includes(report.marks[1]));
});

test("accepting a restricted report keeps its text out of the shared finding register", async () => {
  const report = await fileReport({ restricted: true });
  const accepted = await validator(`/api/observations/${report.id}/review`, json({ decision: "accept_new", severity: "high", note: "Synthetic acceptance." }));
  assert.equal(accepted.status, 200, accepted.text);

  for (const [who, role] of [["the Management Viewer", viewer], ["an unassigned Finding Owner", owner]]) {
    const text = await dashboardText(role);
    assertNoTrace(text, report, who);
    assert.ok(text.includes(accepted.json.findingId), `${who} should still see that a finding exists`);
  }
  const finding = (await viewer("/api/dashboard")).json.data.findings.find((candidate) => candidate.id === accepted.json.findingId);
  assert.equal(finding.severity, "high");
  assert.match(finding.title, /restricted/i);
  // The validator keeps the full report.
  assert.ok((await dashboardText(validator)).includes(report.marks[1]));
});

test("only a Validator or Administrator assigns a restricted report, and only the assignee gains access", async () => {
  const report = await fileReport({ restricted: true });
  assert.equal((await validator(`/api/observations/${report.id}/review`, json({ decision: "accept_new", severity: "medium", note: "Synthetic acceptance." }))).status, 200);

  assert.equal((await setStatus(owner, report, { status: "assigned", assignedTo: users.owner })).status, 403, "a Finding Owner must not take a restricted report");
  assert.equal((await owner(`/api/evidence/${report.evidenceId}`)).status, 403);

  assert.equal((await setStatus(validator, report, { status: "assigned", assignedTo: users.owner })).status, 200);
  const evidence = await owner(`/api/evidence/${report.evidenceId}`);
  assert.equal(evidence.status, 200);
  assert.match(evidence.contentType, /^image\/png/);
  assert.ok((await dashboardText(owner)).includes(report.marks[1]), "the assigned Finding Owner needs the report text");

  assertNoTrace(await dashboardText(otherOwner), report, "another Finding Owner");
  assert.equal((await otherOwner(`/api/evidence/${report.evidenceId}`)).status, 403);
  assert.equal((await setStatus(otherOwner, report, { status: "fixed" })).status, 403);
  assert.equal((await setStatus(owner, report, { status: "fixed" })).status, 200);
});

test("a Finding Owner may take an unassigned standard report, for themselves only, and only its assignee records the fix", async () => {
  const report = await fileReport({ restricted: false });
  assert.equal((await validator(`/api/observations/${report.id}/review`, json({ decision: "support", findingId: "SHOP-M1", note: "Synthetic link." }))).status, 200);

  assert.equal((await setStatus(owner, report, { status: "assigned", assignedTo: users.otherOwner })).status, 403, "a Finding Owner must not assign work to someone else");
  assert.equal((await setStatus(owner, report, { status: "assigned", assignedTo: "Web team" })).status, 403);
  assert.equal((await setStatus(otherOwner, report, { status: "fixed" })).status, 409, "a fix cannot be recorded before the report is assigned");

  assert.equal((await setStatus(owner, report, { status: "assigned", assignedTo: users.owner.toUpperCase() })).status, 200);
  assert.equal((await setStatus(otherOwner, report, { status: "fixed" })).status, 403, "another Finding Owner must not record the fix");
  assert.equal((await setStatus(owner, report, { status: "fixed" })).status, 200);
  // A Validator returns it to work; the other Finding Owner still cannot take it over.
  assert.equal((await setStatus(validator, report, { status: "assigned", assignedTo: users.owner })).status, 200);
  assert.equal((await setStatus(otherOwner, report, { status: "assigned", assignedTo: users.otherOwner })).status, 403);
});

test("a standard report assigned to a team by name can be fixed by any Finding Owner, and the rest of the workflow is unchanged", async () => {
  const report = await fileReport({ restricted: false });
  assert.equal((await validator(`/api/observations/${report.id}/review`, json({ decision: "support", findingId: "SHOP-M1", note: "Synthetic link." }))).status, 200);
  assert.equal((await setStatus(validator, report, { status: "assigned", assignedTo: "Web team" })).status, 200, "a Validator may assign by name");
  assert.equal((await setStatus(owner, report, { status: "retested" })).status, 403, "a Finding Owner does not re-test");
  assert.equal((await setStatus(otherOwner, report, { status: "fixed" })).status, 200);
  assert.equal((await setStatus(validator, report, { status: "retested" })).status, 200);
  assert.equal((await setStatus(administrator, report, { status: "closed" })).status, 200);
});

test("a restricted report assigned by name stays closed to every Finding Owner", async () => {
  const report = await fileReport({ restricted: true });
  assert.equal((await validator(`/api/observations/${report.id}/review`, json({ decision: "accept_new", severity: "low", note: "Synthetic acceptance." }))).status, 200);
  assert.equal((await setStatus(validator, report, { status: "assigned", assignedTo: "Web team" })).status, 200);
  for (const [who, role] of [["a Finding Owner", owner], ["another Finding Owner", otherOwner]]) {
    assertNoTrace(await dashboardText(role), report, who);
    assert.equal((await role(`/api/evidence/${report.evidenceId}`)).status, 403);
    assert.equal((await setStatus(role, report, { status: "fixed" })).status, 403);
  }
});
