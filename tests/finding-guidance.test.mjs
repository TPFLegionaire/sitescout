import assert from "node:assert/strict";
import test from "node:test";
import { buildFindingGuidance } from "../lib/platform/finding-guidance-core.mjs";

test("out-of-range pagination guidance is useful without overstating harm", () => {
  const guidance = buildFindingGuidance({ id: "DEMO-H1", title: "Unlimited out-of-range pagination returned 200 and duplicate content", category: "SEO", severity: "high" });
  assert.match(guidance.explanation, /impossible page number/i);
  assert.match(guidance.security, /not evidence of a breach/i);
  assert.ok(guidance.customers.length > 40);
  assert.ok(guidance.reputation.length > 40);
  assert.deepEqual(guidance.knownLinks, []);
});

test("new findings receive complete, qualified category guidance", () => {
  const guidance = buildFindingGuidance({ id: "SC-2042", title: "Checkout page gives no confirmation after form submission", category: "Experience", severity: "medium" });
  for (const field of ["explanation", "security", "customers", "reputation", "caveat"]) {
    assert.equal(typeof guidance[field], "string");
    assert.ok(guidance[field].length > 20);
  }
  assert.match(guidance.caveat, /not proof/i);
  assert.doesNotMatch(`${guidance.explanation} ${guidance.security}`, /confirmed breach|customers were harmed/i);
});

test("supported category fallbacks supply every impact dimension", () => {
  for (const category of ["Security", "Accessibility", "SEO", "Availability", "Content", "Experience"]) {
    const guidance = buildFindingGuidance({ id: `NEW-${category}`, title: "Example control failed", category });
    for (const field of ["explanation", "security", "customers", "reputation"]) assert.ok(guidance[field]);
  }
});
