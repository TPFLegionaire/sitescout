import assert from "node:assert/strict";
import test from "node:test";
import { buildAutomatedGroups, normaliseUrlPattern, proposedFindingForRule } from "../lib/platform/automated-groups-core.mjs";

const description = (rule, severity = "medium") => `Recorded signal.\n\nRule: ${rule}\nSeverity: ${severity}`;
const mappings = {
  "sample-shop-staging": { "qa.seo.canonical-missing": "SHOP-M1", "qa.seo.title-long": "SHOP-L1" },
  "sample-shop-production": { "qa.seo.canonical-missing": "SHOP-M1" },
};

test("automated observations group by exact target, rule and generic URL pattern", () => {
  const rows = [
    { id: "1", targetId: "sample-shop-staging", runId: "run-a", url: "https://www.example.com/products/widget-a", title: "Canonical URL is missing", description: description("qa.seo.canonical-missing") },
    { id: "2", targetId: "sample-shop-staging", runId: "run-b", url: "https://www.example.com/products/widget-b", title: "Canonical URL is missing", description: description("qa.seo.canonical-missing") },
    { id: "3", targetId: "sample-shop-staging", runId: "run-a", url: "https://www.example.com/products/widget-b", title: "Long title", description: description("qa.seo.title-long", "low") },
    { id: "4", targetId: "sample-shop-production", runId: "run-c", url: "https://example.com/products/widget-c", title: "Canonical URL is missing", description: description("qa.seo.canonical-missing") },
  ];
  const groups = buildAutomatedGroups(rows, mappings);
  assert.equal(groups.length, 3);
  const canonicalStaging = groups.find((group) => group.targetId === "sample-shop-staging" && group.ruleId === "qa.seo.canonical-missing");
  assert.equal(canonicalStaging.count, 2);
  assert.equal(canonicalStaging.runCount, 2);
  assert.equal(canonicalStaging.urlPattern, "/products/:item");
  assert.equal(canonicalStaging.proposedFindingId, "SHOP-M1");
  assert.deepEqual(canonicalStaging.observationIds, ["1", "2"]);
});

test("only deployment-configured target rules receive a proposed finding", () => {
  assert.equal(proposedFindingForRule("qa.seo.canonical-missing", "sample-shop-staging", mappings), "SHOP-M1");
  assert.equal(proposedFindingForRule("qa.seo.canonical-missing", "sample-docs-staging", mappings), null);
  assert.equal(proposedFindingForRule("qa.unknown.rule", "sample-shop-staging", mappings), null);
  assert.equal(normaliseUrlPattern("https://example.com/search?page=999"), "/search?page=:value");
});
