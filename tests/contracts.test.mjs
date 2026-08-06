import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRun, makeFinding, validateRunContract } from "../lib/audit/contracts.mjs";

test("demo portfolio, targets, findings and rule mappings are internally consistent", async () => {
  const [config, scope, mappings, seed] = await Promise.all([
    readFile(new URL("../config/audit-targets.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../config/audit-scope.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../config/audit-rule-mappings.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/demo-seed.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(config.targets.map((target) => target.id).sort(), seed.targets.map((target) => target.id).sort());
  assert.equal(seed.product.sites.length, 2);
  assert.equal(seed.targets.length, 4);
  assert.equal(seed.findings.length, 8);
  assert.equal(new Set(seed.findings.map((finding) => finding.id)).size, 8);
  const siteIds = new Set(seed.product.sites.map((site) => site.id));
  const findingById = new Map(seed.findings.map((finding) => [finding.id, finding]));
  for (const target of seed.targets) assert.ok(siteIds.has(target.siteId));
  for (const finding of seed.findings) assert.ok(siteIds.has(finding.siteId));
  for (const [targetId, ruleMap] of Object.entries(mappings.targets)) {
    const target = seed.targets.find((candidate) => candidate.id === targetId);
    assert.ok(target, targetId);
    for (const findingId of Object.values(ruleMap)) assert.equal(findingById.get(findingId)?.siteId, target.siteId);
  }
  assert.deepEqual(scope.excludedFindings, []);
  assert.ok(seed.warnings.every((warning) => /synthetic|automation/i.test(warning)));
});

test("audit run contract rejects malformed findings", () => {
  const target = { id: "t", name: "T", environment: "test", baseUrl: "https://example.com/", profiles: { smoke: { pageLimit: 1 } } };
  const run = createRun(target, "smoke", new Date("2026-08-01T00:00:00Z"));
  run.status = "complete";
  run.completedAt = "2026-08-01T00:01:00Z";
  run.findings.push(makeFinding({ ruleId: "r", url: target.baseUrl, title: "x", severity: "low", category: "x", summary: "x", expected: "x", actual: "x", recommendation: "x", evidence: {} }));
  assert.deepEqual(validateRunContract(run), { valid: true, errors: [] });
  run.findings[0].severity = "urgent";
  assert.equal(validateRunContract(run).valid, false);
});
