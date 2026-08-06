import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml } from "../lib/audit/html.mjs";
import { compareRuns } from "../lib/audit/baseline.mjs";
import { isBlockedAddress, safeFetch, validateUrlShape } from "../lib/audit/safety.mjs";
import { runAudit } from "../lib/audit/runner.mjs";

const target = {
  id: "sample-docs-staging",
  name: "Sample Documentation staging",
  environment: "staging",
  baseUrl: "https://www.example.org/docs",
  allowedHosts: ["www.example.org"],
  allowedPathPrefixes: ["/docs", "/robots.txt", "/sitemap.xml"],
  profiles: { smoke: { pageLimit: 2, concurrency: 1, requestDelayMs: 0, timeoutMs: 1000 } },
};

test("blocks private, loopback, link-local and documentation addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.2", "169.254.169.254", "192.168.1.1", "192.0.2.1", "::1", "fd00::1", "fe80::1"]) assert.equal(isBlockedAddress(address), true, address);
  assert.equal(isBlockedAddress("8.8.8.8"), false);
});

test("requires exact HTTPS host and approved path", () => {
  assert.equal(validateUrlShape("https://www.example.org/docs/guides", target).hostname, "www.example.org");
  assert.throws(() => validateUrlShape("http://www.example.org/docs", target), /Only HTTPS/);
  assert.throws(() => validateUrlShape("https://outside.example/docs", target), /allowlist/);
  assert.throws(() => validateUrlShape("https://www.example.org/admin", target), /Path/);
  assert.throws(() => validateUrlShape("https://user:secret@www.example.org/docs", target), /Credentials/);
});

test("revalidates redirects and rejects an off-target destination", async () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: "https://evil.example/collect" } });
  await assert.rejects(() => safeFetch(target.baseUrl, target, { lookup, fetchImpl }), /allowlist/);
});

test("rejects state-changing methods", async () => {
  await assert.rejects(() => safeFetch(target.baseUrl, target, { method: "POST" }), /Unsafe HTTP method/);
});

test("parses the minimum auditable HTML evidence", async () => {
  const html = await readFile(new URL("fixtures/healthy.html", import.meta.url), "utf8");
  const parsed = parseHtml(html, target.baseUrl);
  assert.equal(parsed.title, "Sample documentation");
  assert.equal(parsed.lang, "en");
  assert.deepEqual(parsed.h1, ["Sample documentation"]);
  assert.equal(parsed.images[0].alt, "Example system diagram");
});

test("runs a deterministic bounded crawl without touching the network", async () => {
  const html = await readFile(new URL("fixtures/healthy.html", import.meta.url), "utf8");
  const headers = { "content-type": "text/html", "content-security-policy": "default-src 'self'", "strict-transport-security": "max-age=31536000", "x-frame-options": "DENY", "x-content-type-options": "nosniff" };
  const safeFetchStub = async (url) => ({ response: new Response(html, { status: 200, headers }), finalUrl: url, redirects: 0 });
  const fixed = new Date("2026-08-01T10:00:00.000Z");
  const run = await runAudit(target, "smoke", { safeFetch: safeFetchStub, now: () => fixed });
  assert.equal(run.status, "complete");
  assert.equal(run.coverage.pagesAttempted, 2);
  assert.equal(run.coverage.linksDiscovered, 2);
  assert.equal(run.coverage.imageElementsObserved, 2);
  assert.equal(run.coverage.linkDiscoveryCapped, false);
  assert.equal(run.findings.length, 0);
});

test("records reproducible page hashes and selected response headers with findings", async () => {
  const html = "<!doctype html><html><head><title>Page</title></head><body><p>No primary heading or canonical.</p></body></html>";
  const headers = { "content-type": "text/html", "server": "fixture-server" };
  const safeFetchStub = async (url) => ({ response: new Response(html, { status: 200, headers }), finalUrl: url, redirects: 0 });
  const fixed = new Date("2026-08-01T10:00:00.000Z");
  const onePageTarget = { ...target, profiles: { smoke: { ...target.profiles.smoke, pageLimit: 1 } } };
  const run = await runAudit(onePageTarget, "smoke", { safeFetch: safeFetchStub, now: () => fixed });
  assert.equal(run.pages[0].headers.server, "fixture-server");
  assert.match(run.pages[0].bodySha256, /^[a-f0-9]{64}$/);
  const canonical = run.findings.find((finding) => finding.ruleId === "qa.seo.canonical-missing");
  assert.equal(canonical.evidence.bodySha256, run.pages[0].bodySha256);
  assert.equal(canonical.evidence.canonical, null);
});

test("only calculates deltas for comparable runs", () => {
  const base = { targetId: "t", rulesetVersion: "1", profileVersion: "1", findings: [{ ruleId: "a", url: "u" }, { ruleId: "b", url: "u" }] };
  const current = { targetId: "t", rulesetVersion: "1", profileVersion: "1", findings: [{ ruleId: "b", url: "u" }, { ruleId: "c", url: "u" }] };
  const delta = compareRuns(base, current);
  assert.equal(delta.comparable, true);
  assert.equal(delta.new[0].ruleId, "c");
  assert.equal(delta.persisting[0].ruleId, "b");
  assert.equal(delta.resolved[0].ruleId, "a");
  assert.equal(compareRuns({ ...base, rulesetVersion: "old" }, current).comparable, false);
});
