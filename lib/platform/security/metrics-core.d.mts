export type SecurityMetricsCandidate = { severity?: string; reviewStatus?: string };
export type SecurityMetricsImport = { candidateCount?: number };
export type SecurityMetricsReviewEvent = { minutes: number | null };

export type SecurityMetrics = {
  importCount: number;
  emptyImports: number;
  total: number;
  reviewedFinal: number;
  pending: number;
  awaitingSecondCheck: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  rates: Record<string, number>;
  reproducible: number;
  reviewTime: { totalMinutes: number; medianPerCandidate: number | null; perAccepted: number | null; timedCount: number };
  backlog: { pending: number; projectedMinutes: number | null };
};

export const DECISION_STATUSES: readonly string[];

export function computeSecurityMetrics(
  candidates?: SecurityMetricsCandidate[],
  imports?: SecurityMetricsImport[],
  reviewEvents?: SecurityMetricsReviewEvent[],
): SecurityMetrics;
