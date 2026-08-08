import { test } from "node:test";
import assert from "node:assert/strict";
import { isSecurityArtifactExpired, purgeExpiredSecurityArtifacts } from "../lib/platform/security/security-retention.ts";

test("invalid and elapsed retention timestamps fail closed", () => {
  const now = "2026-08-08T12:00:00.000Z";
  assert.equal(isSecurityArtifactExpired("2026-08-08T11:59:59.000Z", now), true);
  assert.equal(isSecurityArtifactExpired("2026-08-08T12:00:01.000Z", now), false);
  assert.equal(isSecurityArtifactExpired("invalid", now), true);
  assert.throws(() => isSecurityArtifactExpired(now, "invalid"));
});

test("retention cleanup deletes only expired private objects and records attributable events", async () => {
  const rows = [
    { id: "expired", organizationId: "org-a", siteId: "site-a", targetId: "target-a", storageKey: "private/expired", retentionUntil: "2026-08-07T00:00:00.000Z", status: "imported" },
    { id: "future", organizationId: "org-a", siteId: "site-a", targetId: "target-a", storageKey: "private/future", retentionUntil: "2026-08-09T00:00:00.000Z", status: "imported" },
    { id: "invalid", organizationId: "org-b", siteId: "site-b", targetId: "target-b", storageKey: "private/failing", retentionUntil: "invalid", status: "imported" },
  ];
  const updated = new Set();
  const events = [];
  const deletedKeys = [];
  const d1 = fakeD1(rows, updated, events);
  const evidence = {
    async delete(key) {
      if (key === "private/failing") throw new Error("synthetic R2 failure");
      deletedKeys.push(key);
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await purgeExpiredSecurityArtifacts(d1, evidence, { now: "2026-08-08T12:00:00.000Z", actor: "admin@example.test" });
    assert.deepEqual(result, { inspected: 3, expired: 2, deleted: 1, failed: 1 });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(deletedKeys, ["private/expired"]);
  assert.ok(updated.has("expired"));
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, "admin@example.test");
  assert.deepEqual(JSON.parse(events[0].detail), { organizationId: "org-a", siteId: "site-a", targetId: "target-a", reason: "retention_expired" });
  assert.ok(!JSON.stringify(events).includes("private/expired"), "storage keys must not enter the activity log");
});

function fakeD1(rows, updated, events) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async all() { return { results: rows }; },
            async run() {
              if (/UPDATE security_import_runs/.test(sql)) {
                const id = values[1];
                if (/artifact_expiring'/.test(sql) && /deleted_at IS NULL/.test(sql)) {
                  if (updated.has(`claim:${id}`)) return { meta: { changes: 0 } };
                  updated.add(`claim:${id}`);
                  return { meta: { changes: 1 } };
                }
                if (/artifact_expired'/.test(sql)) updated.add(id);
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO activity_log/.test(sql)) {
                events.push({ id: values[0], actor: values[1], detail: values[2], createdAt: values[3] });
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected SQL in fake: ${sql}`);
            },
          };
        },
      };
    },
  };
}
