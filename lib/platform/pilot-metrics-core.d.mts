export type PilotMetricReport = {
  createdBy: string; createdAt: string; reviewStatus: string; reviewDecision?: string | null; firstReviewedAt?: string | null;
  workflowStatus?: string | null; workflowUpdatedAt?: string | null; submissionDurationMs?: number | null;
};
export type PilotMetricUser = { role: string };
export function calculatePilotMetrics(reports: PilotMetricReport[], users?: PilotMetricUser[]): {
  totalReports: number; reviewedReports: number; usefulReports: number; usefulReportRate: number | null; supportingEvidenceReports: number;
  duplicateSupportRate: number | null; averageValidationHours: number | null; averageClosureHours: number | null; submissionSamples: number;
  averageSubmissionSeconds: number | null; underTwentySecondsRate: number | null; uniqueReporters: number; returningReporters: number;
  returningParticipationRate: number | null; knownUsers: number; usersByRole: Record<string, number>;
};
