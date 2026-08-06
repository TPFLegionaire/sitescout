export function compareRuns(baseline, candidate) {
  const comparable = baseline.rulesetVersion === candidate.rulesetVersion && baseline.profileVersion === candidate.profileVersion && baseline.targetId === candidate.targetId;
  if (!comparable) {
    return { comparable: false, reason: "Target, ruleset, or profile version differs; findings are shown without a misleading delta.", new: [], persisting: [], resolved: [] };
  }
  const before = new Map(baseline.findings.map((finding) => [`${finding.ruleId}|${finding.url}`, finding]));
  const after = new Map(candidate.findings.map((finding) => [`${finding.ruleId}|${finding.url}`, finding]));
  return {
    comparable: true,
    reason: null,
    new: [...after].filter(([key]) => !before.has(key)).map(([, finding]) => finding),
    persisting: [...after].filter(([key]) => before.has(key)).map(([, finding]) => finding),
    resolved: [...before].filter(([key]) => !after.has(key)).map(([, finding]) => finding),
  };
}
