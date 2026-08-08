import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function filesBelow(url) {
  let entries;
  try { entries = await readdir(url, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
    if (entry.isDirectory()) result.push(...await filesBelow(child)); else result.push(child);
  }
  return result;
}

test("build emits the application and required workflow routes", async () => {
  await access(new URL("dist/server/index.js", root));
  const routeFiles = [
    "app/api/health/route.ts", "app/api/dashboard/route.ts", "app/api/observations/route.ts",
    "app/api/observations/[id]/review/route.ts", "app/api/staff-reports/[id]/status/route.ts",
    "app/api/triage/route.ts", "app/api/my-reports/route.ts", "app/api/my-reports/[id]/reply/route.ts",
    "app/api/automated-groups/review/route.ts", "app/api/notifications/read/route.ts",
    "app/api/evidence/[id]/route.ts", "app/api/findings/[id]/route.ts", "app/api/audits/import/route.ts",
    "app/api/baselines/route.ts", "app/report/page.tsx", "app/my-reports/page.tsx",
    "app/api/security/imports/route.ts", "app/api/security/candidates/[id]/review/route.ts",
    "app/api/security/artifacts/[id]/route.ts", "app/api/security/artifacts/retention/route.ts", "app/security/page.tsx",
  ];
  await Promise.all(routeFiles.map((file) => access(new URL(file, root))));
});

test("operator and staff shells expose multi-site human-review workflows", async () => {
  const [page, layout, component, reporter, reports, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"), readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/QualityPlatform.tsx", root), "utf8"), readFile(new URL("app/components/StaffReporter.tsx", root), "utf8"),
    readFile(new URL("app/components/MyReports.tsx", root), "utf8"), readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(page, /requireQualityUser/);
  assert.match(page, /getDashboardData/);
  assert.match(layout, /SiteScout/);
  for (const phrase of ["Control room", "Finding register", "Evidence review", "Runs & baselines", "Audit boundary", "STAFF REPORT QUEUE", "AUTOMATED AUDIT QUEUE", "Request more information", "PILOT MEASUREMENT", "PRIVACY OPERATIONS", "IMMUTABLE HISTORY", "SAFE BY CONSTRUCTION"]) assert.match(component, new RegExp(phrase));
  for (const phrase of ["PLAIN-LANGUAGE EXPLANATION", "Security implications", "Customer impact", "Reputation potential", "AFFECTED / EVIDENCE PAGES"]) assert.match(component, new RegExp(phrase));
  assert.match(component, /data\.sites\.map/);
  assert.match(component, /finding\.siteId === selectedSiteId/);
  for (const phrase of ["Website and environment", "Paste or upload a screenshot", "Crop", "Blur", "Redact", "Prepare report draft", "Submit for human review"]) assert.match(reporter, new RegExp(phrase));
  for (const phrase of ["My Reports", "Notifications", "Respond with more information", "Optional additional screenshot"]) assert.match(reports, new RegExp(phrase));
  assert.match(css, /--magenta:\s*#e62b74/);
  assert.match(css, /site-switch/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(`${page}\n${layout}\n${component}\n${reporter}\n${reports}`, /SkeletonPreview|codex-preview|Your site is taking shape/);
});

test("the public distribution ships no staff or customer screenshot evidence", async () => {
  const files = await filesBelow(new URL("public/evidence/", root));
  assert.equal(files.filter((url) => /\.(png|jpe?g|webp)$/i.test(url.pathname)).length, 0);
});

test("authentication, privacy and deployment boundaries fail closed", async () => {
  const [health, dashboard, observation, upload, review, status, evidence, auth, preview, worker, accessCore, deploymentExample] = await Promise.all([
    readFile(new URL("app/api/health/route.ts", root), "utf8"), readFile(new URL("app/api/dashboard/route.ts", root), "utf8"),
    readFile(new URL("app/api/observations/route.ts", root), "utf8"), readFile(new URL("lib/platform/evidence-upload.ts", root), "utf8"),
    readFile(new URL("app/api/observations/[id]/review/route.ts", root), "utf8"), readFile(new URL("app/api/staff-reports/[id]/status/route.ts", root), "utf8"),
    readFile(new URL("app/api/evidence/[id]/route.ts", root), "utf8"), readFile(new URL("app/auth.ts", root), "utf8"),
    readFile(new URL("lib/platform/management-preview.ts", root), "utf8"), readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL("lib/platform/cloudflare-access-core.mjs", root), "utf8"), readFile(new URL("wrangler.sitescout.example.jsonc", root), "utf8"),
  ]);
  assert.doesNotMatch(health, /requireQuality|getQualityUser/);
  assert.match(health, /schemaVersion === "7"/);
  assert.match(health, /counts\.organizations/);
  assert.match(dashboard, /requireQualityCapability\("view_operator"\)/);
  assert.match(observation, /requireQualityCapability\("submit_report"\)/);
  assert.match(observation, /getTriageCandidates\(target\.siteId\)/);
  assert.match(review, /requireQualityRole\("validator", "administrator"\)/);
  assert.match(review, /site_id = \?/);
  assert.match(status, /requireQualityRole\("validator", "finding_owner", "administrator"\)/);
  assert.match(evidence, /requireQualityRole\("reporter", "validator", "finding_owner", "administrator"\)/);
  for (const role of ["management_viewer", "reporter", "validator", "finding_owner", "security_reviewer", "administrator"]) assert.match(auth, new RegExp(role));
  for (const allowlist of ["QUALITY_MANAGEMENT_VIEWER_EMAILS", "QUALITY_REPORTER_EMAILS", "QUALITY_VALIDATOR_EMAILS", "QUALITY_FINDING_OWNER_EMAILS", "QUALITY_SECURITY_REVIEWER_EMAILS", "QUALITY_ADMIN_EMAILS"]) assert.match(auth, new RegExp(allowlist));
  assert.match(auth, /QUALITY_PUBLIC_DEMO/);
  assert.match(auth, /cloudflare-access/);
  assert.match(auth, /process\.env\.NODE_ENV === "production"/);
  assert.match(preview, /EXPECTED_PREVIEW_OBSERVATIONS = 0/);
  assert.doesNotMatch(preview, /artifacts\/audits/);
  for (const header of ["x-content-type-options", "permissions-policy", "strict-transport-security", "cf-access-jwt-assertion"]) assert.match(worker, new RegExp(header));
  assert.match(worker, /verifyCloudflareAccessToken/);
  assert.match(accessCore, /issuer: teamDomain/);
  assert.match(accessCore, /audience/);
  assert.match(deploymentExample, /sitescout\.example\.com/);
  assert.match(deploymentExample, /QUALITY_AUTH_MODE/);
  assert.match(upload, /hasExpectedImageSignature/);
  assert.match(upload, /stripPngMetadata/);
});

test("multi-site schema and evidence-link rules prevent cross-site leakage", async () => {
  const [schema, data, review, groups] = await Promise.all([
    readFile(new URL("db/bootstrap.ts", root), "utf8"), readFile(new URL("lib/platform/data.ts", root), "utf8"),
    readFile(new URL("app/api/observations/[id]/review/route.ts", root), "utf8"), readFile(new URL("app/api/automated-groups/review/route.ts", root), "utf8"),
  ]);
  for (const table of ["organizations", "sites", "quality_user_roles"]) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(schema, /idx_targets_site_environment/);
  assert.match(schema, /idx_findings_site_display_key/);
  assert.match(data, /o\.finding_id IS NOT NULL AND o\.review_status = 'confirmed'/);
  assert.match(data, /validateAffectedLink/);
  assert.match(data, /url\.protocol !== "https:"/);
  assert.match(review, /findings WHERE id = \? AND site_id = \?/);
  assert.match(groups, /findings WHERE id = \? AND site_id = \?/);
});
