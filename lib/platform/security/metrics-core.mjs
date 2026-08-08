/**
 * Strix evaluation metrics — pure aggregation (revised plan section 8.5, 8.7, 9.3).
 *
 * Turns imported candidates, import runs and timed review events into the scorecard
 * that decides whether Strix is worth continuing: detection spread, false-positive
 * and duplicate rates, unsafe-evidence count, review burden and a backlog forecast.
 * No network, no DB — unit-testable with `node --test`.
 */

export const DECISION_STATUSES = Object.freeze(["reproducible", "plausible", "duplicate", "false_positive", "out_of_scope", "unsafe_evidence"]);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param candidates  [{ severity, reviewStatus }]
 * @param imports     [{ candidateCount }]
 * @param reviewEvents [{ minutes: number|null }]  one per recorded review action
 */
export function computeSecurityMetrics(candidates = [], imports = [], reviewEvents = []) {
  const byStatus = {};
  const bySeverity = {};
  for (const candidate of candidates) {
    const status = candidate.reviewStatus || "pending";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const severity = candidate.severity || "unknown";
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
  }

  const total = candidates.length;
  const pending = byStatus.pending ?? 0;
  const awaitingSecondCheck = byStatus.awaiting_second_check ?? 0;
  const reviewedFinal = DECISION_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);

  const rates = {};
  for (const status of DECISION_STATUSES) rates[status] = reviewedFinal ? (byStatus[status] ?? 0) / reviewedFinal : 0;

  const reproducible = byStatus.reproducible ?? 0;

  const minutes = reviewEvents
    .map((event) => event.minutes)
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  const totalMinutes = minutes.reduce((sum, value) => sum + value, 0);
  const medianPerCandidate = median(minutes);
  const perAccepted = reproducible > 0 && totalMinutes > 0 ? totalMinutes / reproducible : null;
  const openReviewActions = pending + awaitingSecondCheck;
  const projectedBacklogMinutes = medianPerCandidate != null ? openReviewActions * medianPerCandidate : null;

  const emptyImports = imports.filter((run) => Number(run.candidateCount ?? 0) === 0).length;

  return {
    importCount: imports.length,
    emptyImports,
    total,
    reviewedFinal,
    pending,
    awaitingSecondCheck,
    byStatus,
    bySeverity,
    rates,
    reproducible,
    reviewTime: { totalMinutes, medianPerCandidate, perAccepted, timedCount: minutes.length },
    backlog: { pending: openReviewActions, projectedMinutes: projectedBacklogMinutes },
  };
}
