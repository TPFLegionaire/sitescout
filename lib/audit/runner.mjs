import { createHash } from "node:crypto";
import { createRun, makeFinding, normaliseUrl, validateRunContract } from "./contracts.mjs";
import { parseHtml } from "./html.mjs";
import { safeFetch, validateUrlShape } from "./safety.mjs";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function contentType(response) {
  return response.headers.get("content-type")?.toLowerCase() ?? "";
}

function headerFindings(url, response) {
  const findings = [];
  const expected = [
    ["qa.security.csp", "content-security-policy", "Content Security Policy is absent", "high", "Define and test a restrictive Content-Security-Policy."],
    ["qa.security.hsts", "strict-transport-security", "HSTS is absent", "medium", "Serve Strict-Transport-Security on HTTPS responses."],
    ["qa.security.frame", "x-frame-options", "Clickjacking protection header is absent", "medium", "Set frame-ancestors in CSP or X-Frame-Options."],
    ["qa.security.nosniff", "x-content-type-options", "MIME sniffing protection is absent", "low", "Set X-Content-Type-Options: nosniff."],
  ];
  for (const [ruleId, header, title, severity, recommendation] of expected) {
    if (!response.headers.get(header)) findings.push(makeFinding({ ruleId, url, title, severity, category: "Security", summary: title, expected: `${header} response header`, actual: "Header not present", recommendation, evidence: { status: response.status, header } }));
  }
  const cors = response.headers.get("access-control-allow-origin");
  if (cors === "*") findings.push(makeFinding({ ruleId: "qa.security.cors-wildcard", url, title: "Wildcard CORS policy is exposed", severity: "high", category: "Security", summary: "The page response allows every origin.", expected: "No CORS header for HTML or an explicit trusted origin", actual: "Access-Control-Allow-Origin: *", recommendation: "Remove broad CORS from HTML responses and scope API policies to explicit origins.", evidence: { header: cors } }));
  return findings;
}

function pageFindings(url, response, parsed, bodySha256) {
  const findings = [];
  const baseEvidence = { status: response.status, bodySha256 };
  const add = (values) => findings.push(makeFinding({ url, ...values, evidence: { ...baseEvidence, ...(values.evidence ?? {}) } }));
  if (!parsed.title) add({ ruleId: "qa.seo.title-missing", title: "Page title is missing", severity: "high", category: "SEO", summary: "The document has no usable title.", expected: "A unique descriptive title", actual: "No title text", recommendation: "Add a concise, unique title.", evidence: { title: null } });
  else if (parsed.title.length > 65) add({ ruleId: "qa.seo.title-long", title: "Page title is unusually long", severity: "low", category: "SEO", summary: "The title may be truncated in search results.", expected: "Approximately 30-65 characters", actual: `${parsed.title.length} characters`, recommendation: "Shorten the title while preserving intent.", evidence: { title: parsed.title, length: parsed.title.length } });
  if (!parsed.description) add({ ruleId: "qa.seo.description-missing", title: "Meta description is missing", severity: "medium", category: "SEO", summary: "The document has no meta description.", expected: "A unique descriptive meta description", actual: "No description", recommendation: "Add a useful, page-specific meta description.", evidence: { description: null } });
  if (!parsed.canonical) add({ ruleId: "qa.seo.canonical-missing", title: "Canonical URL is missing", severity: "medium", category: "SEO", summary: "The document does not declare a canonical URL.", expected: "One absolute self-consistent canonical", actual: "No canonical link", recommendation: "Add and validate an absolute canonical URL.", evidence: { canonical: null } });
  if (!parsed.lang) add({ ruleId: "qa.accessibility.lang-missing", title: "Document language is missing", severity: "medium", category: "Accessibility", summary: "Assistive technology cannot reliably determine the page language.", expected: "A valid html lang attribute", actual: "No lang attribute", recommendation: "Set the correct language on the html element.", evidence: { lang: null } });
  if (parsed.h1.length === 0) add({ ruleId: "qa.accessibility.h1-missing", title: "Primary heading is missing", severity: "medium", category: "Accessibility", summary: "The page has no H1 heading.", expected: "One meaningful primary heading", actual: "Zero H1 headings", recommendation: "Add a clear primary heading.", evidence: { headings: [] } });
  if (parsed.h1.length > 1) add({ ruleId: "qa.content.h1-multiple", title: "Multiple primary headings detected", severity: "low", category: "Content", summary: "The page has multiple H1 headings.", expected: "A clear single primary heading hierarchy", actual: `${parsed.h1.length} H1 headings`, recommendation: "Review the heading hierarchy and retain one primary page heading.", evidence: { headings: parsed.h1 } });
  const missingAlt = parsed.images.filter((image) => !("alt" in image));
  if (missingAlt.length) add({ ruleId: "qa.accessibility.image-alt-missing", title: "Images are missing alt attributes", severity: "medium", category: "Accessibility", summary: `${missingAlt.length} image elements omit the alt attribute.`, expected: "Every image has meaningful alt text or alt=\"\" when decorative", actual: `${missingAlt.length} missing attributes`, recommendation: "Classify each image and add appropriate alt text.", evidence: { count: missingAlt.length, sources: missingAlt.slice(0, 10).map((image) => image.src ?? "unknown") } });
  return findings;
}

function selectedHeaders(response) {
  const names = ["content-type", "content-length", "cache-control", "content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy", "access-control-allow-origin", "server"];
  return Object.fromEntries(names.map((name) => [name, response.headers.get(name)]).filter(([, value]) => value !== null));
}

function responseFinding(url, status) {
  if (status < 400) return null;
  return makeFinding({ ruleId: "qa.http.error", url, title: `Page returned HTTP ${status}`, severity: status >= 500 ? "high" : "medium", category: "Availability", summary: "A crawled page did not return a successful response.", expected: "HTTP 2xx or intentional, documented redirect", actual: `HTTP ${status}`, recommendation: "Repair the route or the link that exposes it.", evidence: { status } });
}

export async function runAudit(target, profile = "smoke", dependencies = {}) {
  if (!target.profiles?.[profile]) throw new Error(`Unknown profile ${profile} for ${target.id}`);
  validateUrlShape(target.baseUrl, target);
  const options = target.profiles[profile];
  const run = createRun(target, profile, dependencies.now?.() ?? new Date());
  const queue = [normaliseUrl(target.baseUrl)];
  const queued = new Set(queue);
  const discovered = new Set(queue);
  const visited = new Set();
  const fetcher = dependencies.safeFetch ?? safeFetch;

  while (queue.length && visited.size < options.pageLimit) {
    const requestedUrl = queue.shift();
    if (!requestedUrl || visited.has(requestedUrl)) continue;
    visited.add(requestedUrl);
    run.coverage.pagesAttempted += 1;
    try {
      const { response, finalUrl, redirects } = await fetcher(requestedUrl, target, { timeoutMs: options.timeoutMs, method: "GET" });
      const page = { requestedUrl, finalUrl, status: response.status, redirects, contentType: contentType(response), headers: selectedHeaders(response), fetchedAt: (dependencies.now?.() ?? new Date()).toISOString(), error: null };
      run.pages.push(page);
      run.coverage.pagesCompleted += 1;
      const statusFinding = responseFinding(finalUrl, response.status);
      if (statusFinding) run.findings.push(statusFinding);
      run.findings.push(...headerFindings(finalUrl, response));
      if (page.contentType.includes("text/html")) {
        const html = await response.text();
        const parsed = parseHtml(html, finalUrl);
        const bodySha256 = createHash("sha256").update(html).digest("hex");
        page.bodySha256 = bodySha256;
        page.htmlBytes = new TextEncoder().encode(html).byteLength;
        run.coverage.htmlPages += 1;
        run.coverage.imageElementsObserved += parsed.images.length;
        run.findings.push(...pageFindings(finalUrl, response, parsed, bodySha256));
        for (const link of parsed.links) {
          try {
            const validated = validateUrlShape(link, target);
            const normalised = normaliseUrl(validated.href);
            if (discovered.size < run.coverage.linkObservationLimit) discovered.add(normalised);
            else if (!discovered.has(normalised)) run.coverage.linkDiscoveryCapped = true;
            if (!queued.has(normalised) && !visited.has(normalised) && queued.size < options.pageLimit * 5) {
              queued.add(normalised);
              queue.push(normalised);
            }
          } catch {
            // External, unsafe and out-of-scope links are intentionally not fetched.
          }
        }
        run.coverage.linksDiscovered = discovered.size;
      }
    } catch (error) {
      run.pages.push({ requestedUrl, finalUrl: null, status: null, redirects: 0, contentType: null, fetchedAt: (dependencies.now?.() ?? new Date()).toISOString(), error: error instanceof Error ? error.message : String(error) });
      run.findings.push(makeFinding({ ruleId: "qa.http.fetch-failed", url: requestedUrl, title: "Page could not be fetched safely", severity: "high", category: "Availability", summary: "The bounded read-only request failed.", expected: "A successful response inside the approved target", actual: error instanceof Error ? error.message : String(error), recommendation: "Confirm reachability, TLS, redirect destination and target configuration.", evidence: { error: error instanceof Error ? error.message : String(error) } }));
    }
    if (options.requestDelayMs > 0 && queue.length) await sleep(options.requestDelayMs);
  }
  run.status = "complete";
  run.completedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const contract = validateRunContract(run);
  if (!contract.valid) throw new Error(`Audit contract failed: ${contract.errors.join("; ")}`);
  return run;
}
