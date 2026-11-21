// Runs the production build (dist/) in workerd and checks the request boundary
// end to end. Requires `npm run build` first; `npm test` does that.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const POLICY_HEADER = "content-security-policy-report-only";
const REJECTION = "Cross-origin request rejected.";
const ATTACKER = "https://attacker.example";

let worker;
let base;
let stateDirectory;

before(async () => {
  process.env.WRANGLER_SEND_METRICS ??= "false";
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  const { unstable_dev: startWorker } = await import("wrangler");
  stateDirectory = await mkdtemp(join(tmpdir(), "sitescout-worker-"));
  worker = await startWorker(fileURLToPath(new URL("dist/server/index.js", root)), {
    config: fileURLToPath(new URL("dist/server/wrangler.json", root)),
    experimental: { disableExperimentalWarning: true },
    persistTo: stateDirectory,
    // The read-only public demo gives the build a signed-out role, so requests reach real routes.
    vars: { QUALITY_PUBLIC_DEMO: "true" },
    logLevel: "error",
    ip: "127.0.0.1",
  });
  base = `http://${worker.address}:${worker.port}`;
});

after(async () => {
  await worker?.stop();
  if (stateDirectory) await rm(stateDirectory, { recursive: true, force: true });
});

// Requests carry no body: the boundary does not depend on one, and the local dev proxy drops its
// connection after a write whose body the Worker never read, which fails the request that follows.
async function send(path, { method = "POST", headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers, redirect: "manual" });
  const text = await response.text();
  let error = null;
  try { error = JSON.parse(text).error ?? null; } catch { /* not JSON */ }
  return { response, text, error };
}

test("a cross-site write is refused before any route runs, whatever the route or method", async () => {
  const writes = [
    ["POST", "/api/audits/import"], ["POST", "/api/baselines"], ["POST", "/api/observations"],
    ["POST", "/api/security/imports"], ["PATCH", "/api/findings/any"], ["POST", "/api/not-a-route"],
  ];
  for (const [method, path] of writes) {
    for (const headers of [{ origin: ATTACKER }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "null" }]) {
      const { response, error } = await send(path, { method, headers: { ...headers, "content-type": "text/plain" } });
      assert.equal(response.status, 403, `${method} ${path} ${JSON.stringify(headers)}`);
      assert.equal(error, REJECTION, `${method} ${path} ${JSON.stringify(headers)}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
});

test("the application's own pages and non-browser clients still reach the routes", async () => {
  for (const headers of [{ origin: base }, { origin: base, "sec-fetch-site": "same-origin" }, {}]) {
    const { error } = await send("/api/baselines", { headers });
    assert.ok(error, "the route answered with its own JSON error for the read-only demo role");
    assert.notEqual(error, REJECTION, JSON.stringify(headers));
  }
});

test("cross-site reads are not blocked", async () => {
  const { response } = await send("/api/health", { method: "GET", headers: { origin: ATTACKER, "sec-fetch-site": "cross-site" } });
  assert.equal(response.status, 200);
});

test("every response carries the policy, and each page's inline scripts carry that response's nonce", async () => {
  // The whole directive is matched, so a production build that also allowed 'unsafe-eval' or 'unsafe-inline' fails here.
  const nonceOf = (response) => response.headers.get(POLICY_HEADER)?.match(/(?:^|; )script-src 'self' 'nonce-([0-9a-f]{32})'(?:;|$)/)?.[1];
  const first = await send("/", { method: "GET" });
  assert.equal(first.response.status, 200);
  const nonce = nonceOf(first.response);
  assert.ok(nonce, `policy header: ${first.response.headers.get(POLICY_HEADER)}`);

  const inlineScripts = [...first.text.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1]).filter((attributes) => !/\bsrc=/.test(attributes));
  assert.ok(inlineScripts.length > 0, "the page streams inline scripts; if this changes the nonce may no longer be needed");
  for (const attributes of inlineScripts) assert.ok(attributes.includes(`nonce="${nonce}"`), `inline script without the response nonce: <script${attributes}>`);
  assert.doesNotMatch(first.text, /\son[a-z]+="/, "inline event handlers cannot be nonced");

  const second = await send("/", { method: "GET" });
  assert.notEqual(nonceOf(second.response), nonce, "the nonce must be fresh per response");

  // Responses the Worker builds itself (the refusal, API JSON) are labelled too.
  assert.ok(nonceOf((await send("/api/baselines", { headers: { origin: ATTACKER } })).response));
  assert.ok(nonceOf((await send("/api/health", { method: "GET" })).response));
});
