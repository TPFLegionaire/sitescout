import assert from "node:assert/strict";
import test from "node:test";
import { isGlobalQualityAdministrator, scopeAssignmentAllows } from "../lib/platform/site-access-core.mjs";

const user = { email: "analyst@example.com", role: "validator", identitySource: "cloudflare-access" };

test("site assignments match email, organisation, site and role exactly", () => {
  const assignment = { email: "ANALYST@example.com", organizationId: "org-a", siteId: "site-a", role: "validator", active: 1 };
  assert.equal(scopeAssignmentAllows({ user, assignment, organizationId: "org-a", siteId: "site-a" }), true);
  assert.equal(scopeAssignmentAllows({ user, assignment, organizationId: "org-b", siteId: "site-a" }), false);
  assert.equal(scopeAssignmentAllows({ user, assignment, organizationId: "org-a", siteId: "site-b" }), false);
  assert.equal(scopeAssignmentAllows({ user, assignment: { ...assignment, role: "administrator" }, organizationId: "org-a", siteId: "site-a" }), false);
  assert.equal(scopeAssignmentAllows({ user, assignment: { ...assignment, active: 0 }, organizationId: "org-a", siteId: "site-a" }), false);
});

test("organisation-wide assignments match any site only in their organisation", () => {
  const assignment = { email: user.email, organizationId: "org-a", siteId: "*", role: user.role, active: 1 };
  assert.equal(scopeAssignmentAllows({ user, assignment, organizationId: "org-a", siteId: "site-b" }), true);
  assert.equal(scopeAssignmentAllows({ user, assignment, organizationId: "org-b", siteId: "site-b" }), false);
});

test("public preview is never a private evidence identity and only administrators are global", () => {
  const assignment = { email: user.email, organizationId: "org-a", siteId: "*", role: user.role, active: 1 };
  assert.equal(scopeAssignmentAllows({ user: { ...user, identitySource: "public-preview" }, assignment, organizationId: "org-a", siteId: "site-a" }), false);
  assert.equal(isGlobalQualityAdministrator({ ...user, role: "administrator" }), true);
  assert.equal(isGlobalQualityAdministrator({ ...user, role: "administrator", identitySource: "public-preview" }), false);
  assert.equal(isGlobalQualityAdministrator(user), false);
});
