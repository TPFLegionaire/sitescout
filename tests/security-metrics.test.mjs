import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSecurityMetrics } from "../lib/platform/security/metrics-core.mjs";

const candidates = [
  { severity: "critical", reviewStatus: "reproducible" },
  { severity: "high", reviewStatus: "false_positive" },
  { severity: "medium", reviewStatus: "false_positive" },
  { severity: "medium", reviewStatus: "duplicate" },
  { severity: "low", reviewStatus: "awaiting_second_check" },
  { severity: "low", reviewStatus: "pending" },
];
const imports = [{ candidateCount: 6 }, { candidateCount: 0 }];
const reviewEvents = [{ minutes: 10 }, { minutes: 20 }, { minutes: 30 }, { minutes: null }];

test("counts candidates by status and severity", () => {
  const metrics = computeSecurityMetrics(candidates, imports, reviewEvents);
  assert.equal(metrics.total, 6);
  assert.equal(metrics.pending, 1);
  assert.equal(metrics.awaitingSecondCheck, 1);
  assert.equal(metrics.byStatus.false_positive, 2);
  assert.equal(metrics.bySeverity.medium, 2);
  assert.equal(metrics.reproducible, 1);
});

test("rates are computed over finalised reviews only", () => {
  const metrics = computeSecurityMetrics(candidates, imports, reviewEvents);
  // finalised = reproducible(1) + false_positive(2) + duplicate(1) = 4 (pending and awaiting excluded)
  assert.equal(metrics.reviewedFinal, 4);
  assert.equal(metrics.rates.false_positive, 0.5);
  assert.equal(metrics.rates.reproducible, 0.25);
  assert.equal(metrics.rates.duplicate, 0.25);
});

test("review-time stats use only timed events and the median is robust", () => {
  const metrics = computeSecurityMetrics(candidates, imports, reviewEvents);
  assert.equal(metrics.reviewTime.totalMinutes, 60);
  assert.equal(metrics.reviewTime.medianPerCandidate, 20);
  assert.equal(metrics.reviewTime.timedCount, 3);
  assert.equal(metrics.reviewTime.perAccepted, 60); // 60 minutes / 1 reproducible
});

test("backlog forecast includes first reviews and outstanding second checks", () => {
  const metrics = computeSecurityMetrics(candidates, imports, reviewEvents);
  assert.equal(metrics.backlog.pending, 2);
  assert.equal(metrics.backlog.projectedMinutes, 40); // 2 outstanding actions x median 20
});

test("empty imports are counted as incomplete coverage", () => {
  const metrics = computeSecurityMetrics(candidates, imports, reviewEvents);
  assert.equal(metrics.importCount, 2);
  assert.equal(metrics.emptyImports, 1);
});

test("degrades safely with no data", () => {
  const metrics = computeSecurityMetrics();
  assert.equal(metrics.total, 0);
  assert.equal(metrics.reviewedFinal, 0);
  assert.equal(metrics.rates.false_positive, 0);
  assert.equal(metrics.reviewTime.medianPerCandidate, null);
  assert.equal(metrics.backlog.projectedMinutes, null);
});
