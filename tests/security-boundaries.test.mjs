import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("security routes are import-only, fixed-source and site-scoped", () => {
  const imports = read("app/api/security/imports/route.ts");
  const review = read("app/api/security/candidates/[id]/review/route.ts");
  const data = read("lib/platform/security/security-data.ts");
  assert.match(imports, /requireQualityCapability\("review_security"\)/);
  assert.match(imports, /assertApprovedSecurityTarget\(targetId\)/);
  assert.match(imports, /requireSiteCapability\(user, target\.organizationId, target\.siteId, "review_security"\)/);
  assert.match(imports, /parseStrixReport\(reportText/);
  assert.match(imports, /VALUES \(\?, \?, \?, \?, 'strix'/);
  assert.match(imports, /security-artifacts\/\$\{target\.organizationId\}\/\$\{target\.siteId\}\/\$\{target\.targetId\}/);
  assert.doesNotMatch(imports, /child_process|spawn\(|exec\(|fetch\(.*strix/i);
  assert.doesNotMatch(`${imports}\n${review}`, /INSERT INTO findings|INSERT INTO observations/i);
  assert.match(review, /t\.site_id = r\.site_id/);
  assert.match(review, /s\.organization_id = r\.organization_id/);
  assert.match(data, /t\.site_id = r\.site_id/);
  assert.match(data, /s\.organization_id = r\.organization_id/);
});

test("raw artifacts remain private, scoped, access-logged and deletable", () => {
  const artifacts = read("app/api/security/artifacts/[id]/route.ts");
  const retention = read("lib/platform/security/security-retention.ts");
  const worker = read("worker/index.ts");
  assert.match(artifacts, /requireQualityCapability\("review_security"\)/);
  assert.match(artifacts, /assertApprovedSecurityTarget\(run\.targetId\)/);
  assert.match(artifacts, /security_artifact_accessed/);
  assert.match(artifacts, /private, no-store/);
  assert.match(artifacts, /x-content-type-options/);
  assert.match(artifacts, /requireQualityRole\("administrator"\)/);
  assert.match(retention, /legal_hold = 0/);
  assert.match(retention, /security_artifact_deleted/);
  assert.match(worker, /scheduled\(/);
  assert.match(worker, /purgeExpiredSecurityArtifacts/);
});

test("review history is append-only and high-impact review uses compare-and-set", () => {
  const route = read("app/api/security/candidates/[id]/review/route.ts");
  const schema = read("drizzle/0005_strix_import_pilot.sql");
  assert.match(route, /INSERT INTO security_candidate_reviews/);
  assert.match(route, /WHERE id = \? AND review_status = \?/);
  assert.match(route, /LOWER\(first_reviewer\) <> LOWER\(\?\)/);
  assert.doesNotMatch(route, /UPDATE security_candidate_reviews|DELETE FROM security_candidate_reviews/);
  assert.match(schema, /UNIQUE INDEX[\s\S]*security_candidate_reviews_stage/);
});

test("the security reviewer has no general operator capability", () => {
  const auth = read("app/auth.ts");
  const home = read("app/page.tsx");
  assert.match(auth, /security_reviewer:\s*new Set\(\["review_security"\]\)/);
  assert.match(home, /user\.role === "security_reviewer"\) redirect\("\/security"\)/);
});
