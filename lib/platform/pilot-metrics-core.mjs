export function calculatePilotMetrics(reports, users = []) {
  const reviewed = reports.filter((report) => ["confirmed", "rejected"].includes(report.reviewStatus));
  const useful = reports.filter((report) => report.reviewStatus === "confirmed");
  const supporting = reports.filter((report) => report.reviewDecision === "support" || report.reviewDecision === "link");
  const validationHours = reports.filter((report) => report.firstReviewedAt).map((report) => hoursBetween(report.createdAt, report.firstReviewedAt));
  const closureHours = reports.filter((report) => report.workflowStatus === "closed" && report.workflowUpdatedAt).map((report) => hoursBetween(report.createdAt, report.workflowUpdatedAt));
  const submissionSeconds = reports.filter((report) => report.submissionDurationMs !== null && report.submissionDurationMs !== undefined && Number.isFinite(Number(report.submissionDurationMs))).map((report) => Number(report.submissionDurationMs) / 1000);
  const reportsByPerson = new Map();
  for (const report of reports) reportsByPerson.set(String(report.createdBy).toLowerCase(), (reportsByPerson.get(String(report.createdBy).toLowerCase()) ?? 0) + 1);
  const returningReporters = [...reportsByPerson.values()].filter((count) => count > 1).length;
  const usersByRole = { reporter: 0, validator: 0, finding_owner: 0, administrator: 0 };
  for (const user of users) if (Object.hasOwn(usersByRole, user.role)) usersByRole[user.role] += 1;
  return {
    totalReports: reports.length,
    reviewedReports: reviewed.length,
    usefulReports: useful.length,
    usefulReportRate: percent(useful.length, reviewed.length),
    supportingEvidenceReports: supporting.length,
    duplicateSupportRate: percent(supporting.length, reviewed.length),
    averageValidationHours: average(validationHours),
    averageClosureHours: average(closureHours),
    submissionSamples: submissionSeconds.length,
    averageSubmissionSeconds: average(submissionSeconds),
    underTwentySecondsRate: percent(submissionSeconds.filter((seconds) => seconds <= 20).length, submissionSeconds.length),
    uniqueReporters: reportsByPerson.size,
    returningReporters,
    returningParticipationRate: percent(returningReporters, reportsByPerson.size),
    knownUsers: users.length,
    usersByRole,
  };
}

function hoursBetween(start, end) {
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / 3_600_000);
}

function average(values) {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;
}

function percent(part, whole) {
  return whole ? Math.round((part / whole) * 100) : null;
}
