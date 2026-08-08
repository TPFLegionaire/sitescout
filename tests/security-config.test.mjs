import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRetentionDays, parseApprovedSecurityTargetIds, retentionDeadline } from "../lib/platform/security/security-config-core.mjs";

test("security target allowlist accepts only explicit bounded identifiers", () => {
  assert.deepEqual(
    [...parseApprovedSecurityTargetIds("target-a, target:b\ntarget.c invalid/path target-a")],
    ["target-a", "target:b", "target.c"],
  );
  assert.equal(parseApprovedSecurityTargetIds("").size, 0);
  assert.equal(parseApprovedSecurityTargetIds("x".repeat(101)).size, 0);
});

test("artifact retention stays inside the one-to-365-day policy range", () => {
  assert.equal(normalizeRetentionDays("1"), 1);
  assert.equal(normalizeRetentionDays("365"), 365);
  assert.equal(normalizeRetentionDays("0", 30), 30);
  assert.equal(normalizeRetentionDays("366", 30), 30);
  assert.equal(normalizeRetentionDays("1.5", 30), 30);
  assert.equal(retentionDeadline("2026-08-08T10:00:00.000Z", 30), "2026-09-07T10:00:00.000Z");
  assert.throws(() => retentionDeadline("not-a-date", 30));
});
