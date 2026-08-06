import assert from "node:assert/strict";
import test from "node:test";
import { calculatePilotMetrics } from "../lib/platform/pilot-metrics-core.mjs";

test("pilot metrics use completed human evidence and retain sample sizes", () => {
  const reports = [
    { createdBy: "one@example.test", createdAt: "2026-08-01T10:00:00.000Z", reviewStatus: "confirmed", reviewDecision: "support", firstReviewedAt: "2026-08-01T11:00:00.000Z", workflowStatus: "closed", workflowUpdatedAt: "2026-08-01T14:00:00.000Z", submissionDurationMs: 15000 },
    { createdBy: "one@example.test", createdAt: "2026-08-01T12:00:00.000Z", reviewStatus: "rejected", reviewDecision: "reject", firstReviewedAt: "2026-08-01T14:00:00.000Z", workflowStatus: "rejected", workflowUpdatedAt: "2026-08-01T14:00:00.000Z", submissionDurationMs: 25000 },
    { createdBy: "two@example.test", createdAt: "2026-08-01T13:00:00.000Z", reviewStatus: "pending", workflowStatus: "submitted", submissionDurationMs: null },
  ];
  const metrics = calculatePilotMetrics(reports, [{ role: "reporter" }, { role: "validator" }, { role: "administrator" }]);
  assert.equal(metrics.totalReports, 3);
  assert.equal(metrics.reviewedReports, 2);
  assert.equal(metrics.usefulReportRate, 50);
  assert.equal(metrics.duplicateSupportRate, 50);
  assert.equal(metrics.averageValidationHours, 1.5);
  assert.equal(metrics.averageClosureHours, 4);
  assert.equal(metrics.averageSubmissionSeconds, 20);
  assert.equal(metrics.underTwentySecondsRate, 50);
  assert.equal(metrics.returningParticipationRate, 50);
  assert.deepEqual(metrics.usersByRole, { reporter: 1, validator: 1, finding_owner: 0, administrator: 1 });
});

test("pilot metrics show null rates instead of pretending an empty pilot succeeded", () => {
  const metrics = calculatePilotMetrics([]);
  assert.equal(metrics.usefulReportRate, null);
  assert.equal(metrics.averageSubmissionSeconds, null);
  assert.equal(metrics.underTwentySecondsRate, null);
});
