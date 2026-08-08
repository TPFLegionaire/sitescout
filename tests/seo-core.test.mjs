import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEO_OPERATIONS,
  SeoBudgetError,
  SeoInputError,
  SeoProviderError,
  assertSeoOperation,
  assertWithinBudget,
  buildProviderTask,
  effectiveDimensions,
  estimateOperationCost,
  idempotencyInput,
  monthPrefix,
  normalizeDimensions,
  normalizeSnapshot,
  resolveDataForSeoBaseUrl,
  resolveTargetDomain,
  validateProviderEnvelope,
  validateProviderScope,
} from "../lib/platform/seo/dataforseo-core.mjs";

test("only the fixed operation enum crosses the boundary; free-form input is refused", () => {
  assert.throws(() => assertSeoOperation("https://victim.example/scan"), SeoInputError);
  assert.throws(() => assertSeoOperation("run_penetration_test"), SeoInputError);
  for (const operation of SEO_OPERATIONS) assert.equal(assertSeoOperation(operation), operation);
});

test("dimensions are validated and canonicalised against the agreed profile", () => {
  assert.deepEqual(normalizeDimensions({ country: "GB", language: "EN" }), { country: "gb", language: "en", device: "all", locationCode: 2826 });
  assert.deepEqual(normalizeDimensions({ country: "us", language: "en", device: "all", locationCode: 2840 }), { country: "us", language: "en", device: "all", locationCode: 2840 });
  assert.throws(() => normalizeDimensions({ country: "united kingdom", language: "en" }), SeoInputError);
  assert.throws(() => normalizeDimensions({ country: "gb", language: "en", device: "mobile" }), SeoInputError);
  assert.deepEqual(effectiveDimensions("backlink_summary", { country: "gb", language: "en", locationCode: 2826 }), { country: "global", language: "all", device: "all" });
});

test("a domain is resolved only from the approved target record, never a typed URL", () => {
  assert.equal(resolveTargetDomain({ allowedHost: "Example.COM" }), "example.com");
  assert.equal(resolveTargetDomain({ baseUrl: "https://shop.example.org/some/path" }), "shop.example.org");
  assert.throws(() => resolveTargetDomain({ baseUrl: "http://shop.example.org" }), SeoInputError);
  assert.throws(() => resolveTargetDomain({}), SeoInputError);
});

test("provider task bodies are operation-specific and never claim unsupported device scope", () => {
  const profile = { country: "gb", language: "en", device: "all", locationCode: 2826 };
  assert.deepEqual(buildProviderTask("domain_overview", "example.com", profile), { target: "example.com", language_code: "en", location_code: 2826 });
  assert.deepEqual(buildProviderTask("ranked_keywords", "example.com", profile), { target: "example.com", language_code: "en", location_code: 2826 });
  assert.deepEqual(buildProviderTask("backlink_summary", "example.com", profile), { target: "example.com" });
});

test("credential-bearing requests can only use exact approved DataForSEO origins", () => {
  assert.equal(resolveDataForSeoBaseUrl(), "https://api.dataforseo.com");
  assert.equal(resolveDataForSeoBaseUrl("https://sandbox.dataforseo.com/"), "https://sandbox.dataforseo.com");
  for (const unsafe of [
    "https://evil.example",
    "https://api.dataforseo.com.evil.example",
    "https://api.dataforseo.com/v3",
    "https://user:pass@api.dataforseo.com",
    "https://api.dataforseo.com?next=evil",
  ]) assert.throws(() => resolveDataForSeoBaseUrl(unsafe), SeoInputError);
});

test("spend is bounded before dispatch on both the per-operation and monthly caps", () => {
  assert.ok(estimateOperationCost("backlink_summary") > 0);
  assert.throws(() => assertWithinBudget({ estimate: 5, perOperationCapUsd: 1, monthlySpentUsd: 0, monthlyCapUsd: 100 }), SeoBudgetError);
  assert.throws(() => assertWithinBudget({ estimate: 0.5, perOperationCapUsd: 1, monthlySpentUsd: 24.8, monthlyCapUsd: 25 }), SeoBudgetError);
  assert.doesNotThrow(() => assertWithinBudget({ estimate: 0.1, perOperationCapUsd: 1, monthlySpentUsd: 1, monthlyCapUsd: 25 }));
});

test("the idempotency key is stable per tenant/day/profile and client keys are only a suffix", () => {
  const base = { organizationId: "org-a", siteId: "site-a", targetId: "t1", operation: "domain_overview", dimensions: { country: "gb", language: "en", device: "all", locationCode: 2826 }, day: "2026-08-08" };
  assert.equal(idempotencyInput(base), idempotencyInput({ ...base }));
  assert.notEqual(idempotencyInput(base), idempotencyInput({ ...base, day: "2026-08-09" }));
  assert.notEqual(idempotencyInput(base), idempotencyInput({ ...base, organizationId: "org-b" }));
  assert.notEqual(idempotencyInput(base), idempotencyInput({ ...base, siteId: "site-b" }));
  assert.notEqual(idempotencyInput({ ...base, clientKey: "fixed-key" }), idempotencyInput({ ...base, organizationId: "org-b", clientKey: "fixed-key" }));
  assert.equal(idempotencyInput({ ...base, clientKey: "   " }), idempotencyInput(base));
  assert.throws(() => idempotencyInput({ ...base, clientKey: "bad key with spaces" }), SeoInputError);
  assert.match(idempotencyInput({ ...base, operation: "backlink_summary", dimensions: { country: "global", language: "all", device: "all" } }), /global\|all\|all\|global/);
});

test("HTTP success is insufficient unless the provider envelope and task both succeed", () => {
  const success = { status_code: 20000, tasks_error: 0, cost: 0.02, tasks: [{ id: "task-1", status_code: 20000, result: [] }] };
  assert.deepEqual(validateProviderEnvelope(success), { providerReference: "task-1", costActual: 0.02 });
  for (const failed of [
    { ...success, status_code: 40000 },
    { ...success, tasks_error: 1 },
    { ...success, tasks: [{ id: "task-2", status_code: 40501, cost: 0.01 }] },
    { status_code: 20000, tasks_error: 0, tasks: [] },
  ]) assert.throws(() => validateProviderEnvelope(failed), SeoProviderError);
});

test("Labs responses must echo the configured country and language profile", () => {
  const success = { status_code: 20000, tasks_error: 0, tasks: [{ id: "task-1", status_code: 20000, cost: 0.02, data: { location_code: 2826, language_code: "en" }, result: [] }] };
  assert.doesNotThrow(() => validateProviderScope("domain_overview", success, { country: "gb", language: "en", device: "all", locationCode: 2826 }));
  assert.throws(() => validateProviderScope("ranked_keywords", { ...success, tasks: [{ ...success.tasks[0], data: { location_code: 2840, language_code: "en" } }] }, { country: "gb", language: "en", device: "all", locationCode: 2826 }), SeoProviderError);
  assert.throws(() => validateProviderScope("domain_overview", { ...success, tasks: [{ ...success.tasks[0], data: null }] }, { country: "gb", language: "en", device: "all", locationCode: 2826 }), SeoProviderError);
  assert.doesNotThrow(() => validateProviderScope("backlink_summary", success, { country: "gb", language: "en", device: "all", locationCode: 2826 }));
});

test("a provider payload normalises to metrics, and an empty result is never reported as healthy", () => {
  const raw = { cost: 0.02, tasks: [{ id: "task-1", result: [{ metrics: { organic: { count: 128, etv: 3400, pos_1: 12 } } }] }] };
  const normalized = normalizeSnapshot("domain_overview", raw, { country: "gb", language: "en", device: "all", locationCode: 2826 });
  assert.equal(normalized.hasUsableData, true);
  assert.deepEqual(normalized.metrics.map((metric) => metric.metricKey).sort(), ["organic_keywords", "organic_positions_top1", "organic_traffic_estimate"]);
  assert.equal(normalized.limitations.length, 0);

  const empty = normalizeSnapshot("domain_overview", { tasks: [{ result: [] }] }, { country: "gb", language: "en", device: "all", locationCode: 2826 });
  assert.equal(empty.hasUsableData, false);
  assert.equal(empty.metrics.length, 0);
  assert.ok(empty.limitations[0].includes("not evidence that the website is healthy"));
});

test("the monthly spend bucket is keyed by YYYY-MM", () => {
  assert.equal(monthPrefix("2026-08-08T10:00:00.000Z"), "2026-08");
  assert.equal(monthPrefix("not-a-date"), "");
});
