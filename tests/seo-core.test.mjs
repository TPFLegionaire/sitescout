import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEO_OPERATIONS,
  SeoBudgetError,
  SeoInputError,
  assertSeoOperation,
  assertWithinBudget,
  estimateOperationCost,
  idempotencyInput,
  monthPrefix,
  normalizeDimensions,
  normalizeSnapshot,
  resolveTargetDomain,
} from "../lib/platform/seo/dataforseo-core.mjs";

test("only the fixed operation enum crosses the boundary; free-form input is refused", () => {
  assert.throws(() => assertSeoOperation("https://victim.example/scan"), SeoInputError);
  assert.throws(() => assertSeoOperation("run_penetration_test"), SeoInputError);
  for (const operation of SEO_OPERATIONS) assert.equal(assertSeoOperation(operation), operation);
});

test("dimensions are validated and canonicalised against the agreed profile", () => {
  assert.deepEqual(normalizeDimensions({ country: "GB", language: "EN" }), { country: "gb", language: "en", device: "desktop" });
  assert.deepEqual(normalizeDimensions({ country: "us", language: "en", device: "MOBILE" }), { country: "us", language: "en", device: "mobile" });
  assert.throws(() => normalizeDimensions({ country: "united kingdom", language: "en" }), SeoInputError);
  assert.throws(() => normalizeDimensions({ country: "gb", language: "en", device: "smart-fridge" }), SeoInputError);
});

test("a domain is resolved only from the approved target record, never a typed URL", () => {
  assert.equal(resolveTargetDomain({ allowedHost: "Example.COM" }), "example.com");
  assert.equal(resolveTargetDomain({ baseUrl: "https://shop.example.org/some/path" }), "shop.example.org");
  assert.throws(() => resolveTargetDomain({}), SeoInputError);
});

test("spend is bounded before dispatch on both the per-operation and monthly caps", () => {
  assert.ok(estimateOperationCost("backlink_summary") > 0);
  assert.throws(() => assertWithinBudget({ estimate: 5, perOperationCapUsd: 1, monthlySpentUsd: 0, monthlyCapUsd: 100 }), SeoBudgetError);
  assert.throws(() => assertWithinBudget({ estimate: 0.5, perOperationCapUsd: 1, monthlySpentUsd: 24.8, monthlyCapUsd: 25 }), SeoBudgetError);
  assert.doesNotThrow(() => assertWithinBudget({ estimate: 0.1, perOperationCapUsd: 1, monthlySpentUsd: 1, monthlyCapUsd: 25 }));
});

test("the idempotency key is stable per day and profile, and a client key overrides it", () => {
  const base = { targetId: "t1", operation: "domain_overview", dimensions: { country: "gb", language: "en" }, day: "2026-08-08" };
  assert.equal(idempotencyInput(base), idempotencyInput({ ...base }));
  assert.notEqual(idempotencyInput(base), idempotencyInput({ ...base, day: "2026-08-09" }));
  assert.notEqual(idempotencyInput(base), idempotencyInput({ ...base, dimensions: { country: "us", language: "en" } }));
  assert.equal(
    idempotencyInput({ ...base, clientKey: "fixed-key" }),
    idempotencyInput({ ...base, dimensions: { country: "us", language: "fr" }, clientKey: "fixed-key" }),
  );
});

test("a provider payload normalises to metrics, and an empty result is never reported as healthy", () => {
  const raw = { cost: 0.02, tasks: [{ id: "task-1", result: [{ metrics: { organic: { count: 128, etv: 3400, pos_1: 12 } } }] }] };
  const normalized = normalizeSnapshot("domain_overview", raw, { country: "gb", language: "en", device: "desktop" });
  assert.equal(normalized.hasUsableData, true);
  assert.deepEqual(normalized.metrics.map((metric) => metric.metricKey).sort(), ["organic_keywords", "organic_positions_top1", "organic_traffic_estimate"]);
  assert.equal(normalized.limitations.length, 0);

  const empty = normalizeSnapshot("domain_overview", { tasks: [{ result: [] }] }, { country: "gb", language: "en", device: "desktop" });
  assert.equal(empty.hasUsableData, false);
  assert.equal(empty.metrics.length, 0);
  assert.ok(empty.limitations[0].includes("not evidence that the website is healthy"));
});

test("the monthly spend bucket is keyed by YYYY-MM", () => {
  assert.equal(monthPrefix("2026-08-08T10:00:00.000Z"), "2026-08");
  assert.equal(monthPrefix("not-a-date"), "");
});
