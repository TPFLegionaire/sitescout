import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("SEO routes use scoped capabilities and reject client-controlled provider profiles", async () => {
  const [route, page, data] = await Promise.all([
    readFile(new URL("app/api/seo/snapshots/route.ts", root), "utf8"),
    readFile(new URL("app/seo/page.tsx", root), "utf8"),
    readFile(new URL("lib/platform/seo/seo-data.ts", root), "utf8"),
  ]);
  assert.match(route, /requireQualityCapability\("capture_seo"\)/);
  assert.match(route, /requireSiteCapability\(user, target\.organizationId, target\.siteId, "capture_seo"\)/);
  assert.match(route, /requireQualityCapability\("view_seo"\)/);
  assert.doesNotMatch(route, /body\.dimensions/);
  assert.match(page, /identitySource === "public-preview"/);
  assert.match(data, /JOIN quality_user_roles/);
  assert.match(data, /organization_id = \? AND site_id = \?/);
});

test("SEO provider dispatch is leased, retry-bounded, cost-reserved and failure-accounted", async () => {
  const [route, data, migration, wrapper] = await Promise.all([
    readFile(new URL("app/api/seo/snapshots/route.ts", root), "utf8"),
    readFile(new URL("lib/platform/seo/seo-data.ts", root), "utf8"),
    readFile(new URL("drizzle/0004_seo_snapshot_pilot.sql", root), "utf8"),
    readFile(new URL("lib/platform/seo/dataforseo.ts", root), "utf8"),
  ]);
  for (const field of ["cost_reserved", "attempt_count", "lease_expires_at", "provider_dispatched_at", "failure_stage", "provider_reference"]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(data, /MAX_SEO_ATTEMPTS/);
  assert.match(data, /lease_expired/);
  assert.match(route, /recordSeoProviderCost/);
  assert.match(data, /failed_persistence/);
  assert.match(wrapper, /redirect: "error"/);
  assert.match(wrapper, /validateProviderEnvelope/);
});
