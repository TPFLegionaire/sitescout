import assert from "node:assert/strict";
import test from "node:test";
import { contentSecurityPolicy, isCrossOriginWrite } from "../lib/platform/request-guard-core.mjs";

const app = "https://sitescout.example.com";
const write = (headers = {}, method = "POST") =>
  isCrossOriginWrite({ method, url: `${app}/api/baselines`, origin: headers.origin ?? null, secFetchSite: headers["sec-fetch-site"] ?? null });

test("a page on another site cannot make a signed-in browser change state", () => {
  assert.equal(write({ "sec-fetch-site": "cross-site", origin: "https://attacker.example" }), true);
  // Browsers that predate Sec-Fetch-Site still send Origin on a cross-site form post.
  assert.equal(write({ origin: "https://attacker.example" }), true);
  for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal(write({ "sec-fetch-site": "cross-site" }, method), true);
});

test("a sibling subdomain, another port and a scheme downgrade are not this application", () => {
  assert.equal(write({ "sec-fetch-site": "same-site", origin: "https://other.example.com" }), true);
  assert.equal(write({ origin: "https://other.example.com" }), true);
  assert.equal(write({ origin: "http://sitescout.example.com" }), true);
  assert.equal(write({ origin: "https://sitescout.example.com:8443" }), true);
});

test("the application's own pages keep working", () => {
  assert.equal(write({ "sec-fetch-site": "same-origin", origin: app }), false);
  assert.equal(write({ origin: app }), false);
  assert.equal(write({ origin: "https://SITESCOUT.example.com:443" }), false);
  // Under Referrer-Policy: no-referrer a same-origin form navigation sends "Origin: null";
  // Sec-Fetch-Site is what identifies it as ours.
  assert.equal(write({ "sec-fetch-site": "same-origin", origin: "null" }), false);
});

test("an opaque or malformed Origin is rejected when the browser sends no Sec-Fetch-Site", () => {
  assert.equal(write({ origin: "null" }), true);
  assert.equal(write({ origin: "not a url" }), true);
});

test("clients that are not browsers are unaffected", () => {
  // The audit CLI and service tokens send neither header and carry no ambient cookie.
  assert.equal(write({}), false);
});

test("reads are never blocked, so links from email and other sites still open", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(write({ "sec-fetch-site": "cross-site", origin: "https://attacker.example" }, method), false);
  }
});

test("the policy runs only nonced or same-origin scripts and forbids framing, plugins and base hijacking", () => {
  const nonce = "0123456789abcdef0123456789abcdef";
  const directives = new Map(contentSecurityPolicy(nonce).split("; ").map((directive) => {
    const [name, ...sources] = directive.split(" ");
    return [name, sources];
  }));
  assert.deepEqual(directives.get("script-src"), ["'self'", `'nonce-${nonce}'`]);
  assert.deepEqual(directives.get("default-src"), ["'self'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("base-uri"), ["'none'"]);
  assert.deepEqual(directives.get("form-action"), ["'self'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
});

test("string evaluation is allowed only when a development server asks for it explicitly", () => {
  const nonce = "0123456789abcdef0123456789abcdef";
  const scriptSources = (policy) => policy.split("; ").find((directive) => directive.startsWith("script-src "));
  for (const options of [undefined, {}, { allowEval: false }, { allowEval: "true" }, { allowEval: 1 }]) {
    assert.equal(scriptSources(contentSecurityPolicy(nonce, options)), `script-src 'self' 'nonce-${nonce}'`);
  }
  // React and Vite dev tooling evaluate strings; without this every development page reports violations.
  assert.equal(scriptSources(contentSecurityPolicy(nonce, { allowEval: true })), `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`);
});

test("a missing or malformed nonce fails loudly instead of yielding a policy browsers ignore", () => {
  for (const nonce of ["", undefined, "short", "has space 0123456789abcdef", "quote'0123456789abcdef"]) {
    assert.throws(() => contentSecurityPolicy(nonce), /nonce/);
  }
});
