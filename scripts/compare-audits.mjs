import { readFile } from "node:fs/promises";
import path from "node:path";

const [leftPath, rightPath] = process.argv.slice(2);
if (!leftPath || !rightPath) {
  throw new Error("Usage: node scripts/compare-audits.mjs <left.json> <right.json>");
}

const [left, right] = await Promise.all([
  readFile(path.resolve(leftPath), "utf8").then(JSON.parse),
  readFile(path.resolve(rightPath), "utf8").then(JSON.parse),
]);

function urlKey(value) {
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}

function groupCounts(items, key) {
  const counts = new Map();
  for (const item of items) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function summarise(run) {
  const rules = new Map();
  for (const finding of run.findings) {
    const existing = rules.get(finding.ruleId) ?? {
      ruleId: finding.ruleId,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      count: 0,
      samplePaths: [],
    };
    existing.count += 1;
    const affectedPath = urlKey(finding.url);
    if (existing.samplePaths.length < 5 && !existing.samplePaths.includes(affectedPath)) existing.samplePaths.push(affectedPath);
    rules.set(finding.ruleId, existing);
  }

  return {
    runId: run.id,
    targetId: run.targetId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status,
    coverage: run.coverage,
    severityCounts: groupCounts(run.findings, "severity"),
    categoryCounts: groupCounts(run.findings, "category"),
    affectedPages: new Set(run.findings.map((finding) => urlKey(finding.url))).size,
    rules: [...rules.values()].sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId)),
  };
}

function findingKey(finding) {
  return [urlKey(finding.url), finding.ruleId, finding.actual].join("|");
}

const leftPages = new Map(left.pages.map((page) => [urlKey(page.finalUrl ?? page.requestedUrl), page]));
const rightPages = new Map(right.pages.map((page) => [urlKey(page.finalUrl ?? page.requestedUrl), page]));
const commonPaths = [...leftPages.keys()].filter((key) => rightPages.has(key));
const leftFindings = new Map(left.findings.map((finding) => [findingKey(finding), finding]));
const rightFindings = new Map(right.findings.map((finding) => [findingKey(finding), finding]));
const onlyLeft = [...leftFindings.keys()].filter((key) => !rightFindings.has(key));
const onlyRight = [...rightFindings.keys()].filter((key) => !leftFindings.has(key));
const statusMismatches = commonPaths.filter((key) => leftPages.get(key).status !== rightPages.get(key).status);
const bodyHashMatches = commonPaths.filter((key) => leftPages.get(key).bodySha256 === rightPages.get(key).bodySha256).length;
const headerMismatches = commonPaths.filter((key) => JSON.stringify(leftPages.get(key).headers) !== JSON.stringify(rightPages.get(key).headers));

const result = {
  left: summarise(left),
  right: summarise(right),
  comparison: {
    comparableProfile: left.profile === right.profile && left.rulesetVersion === right.rulesetVersion && left.profileVersion === right.profileVersion,
    commonPagePaths: commonPaths.length,
    onlyLeftPagePaths: [...leftPages.keys()].filter((key) => !rightPages.has(key)),
    onlyRightPagePaths: [...rightPages.keys()].filter((key) => !leftPages.has(key)),
    statusMismatches,
    matchingBodyHashes: bodyHashMatches,
    differingBodyHashes: commonPaths.length - bodyHashMatches,
    headerMismatchCount: headerMismatches.length,
    headerMismatchSample: headerMismatches.slice(0, 10),
    commonFindingInstances: [...leftFindings.keys()].filter((key) => rightFindings.has(key)).length,
    onlyLeftFindingInstances: onlyLeft.length,
    onlyRightFindingInstances: onlyRight.length,
    onlyLeftSample: onlyLeft.slice(0, 20),
    onlyRightSample: onlyRight.slice(0, 20),
  },
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
