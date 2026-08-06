import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import seedPayload from "@/data/demo-seed.json";
import auditScope from "@/config/audit-scope.json";
import auditRuleMappings from "@/config/audit-rule-mappings.json";
import { isPublicDemoEnabled, type QualityUser } from "@/app/auth";
import { aiAssistConfigured } from "./triage";
import { buildFindingGuidance } from "./finding-guidance-core.mjs";
import { buildAutomatedGroups } from "./automated-groups-core.mjs";
import { calculatePilotMetrics } from "./pilot-metrics-core.mjs";
import { privacyPreview } from "./privacy";

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

type DataRow = Record<string, unknown>;
type ExcludedFinding = { id: string; status: string; reason: string };
type AffectedLink = { targetId: string; environment: string; url: string; label: string; source: "recorded-evidence" | "audit-reference" };

export async function getDashboardData(user: QualityUser) {
  await ensureDatabase();
  const d1 = getD1();
  const publicViewer = user.role === "management_viewer";
  const restrictForFindingOwner = user.role === "finding_owner";
  const visibilityClause = publicViewer
    ? "AND p.observation_id IS NULL"
    : restrictForFindingOwner
      ? "AND (COALESCE(p.classification, 'standard') <> 'restricted_security' OR LOWER(COALESCE(w.assigned_to, '')) = LOWER(?))"
      : "";
  const linkedVisibilityClause = publicViewer
    ? "AND (o.source_channel <> 'human' OR p.observation_id IS NULL)"
    : restrictForFindingOwner
      ? "AND (o.source_channel <> 'human' OR COALESCE(p.classification, 'standard') <> 'restricted_security' OR LOWER(COALESCE(w.assigned_to, '')) = LOWER(?))"
      : "";
  const staffStatement = d1.prepare(`
    SELECT o.id, o.target_id AS targetId, o.run_id AS runId, o.finding_id AS findingId, o.suggested_finding_id AS suggestedFindingId, o.source_channel AS sourceChannel,
           o.url, o.title, o.description, o.expected, o.actual, o.review_status AS reviewStatus, o.created_by AS createdBy, o.created_at AS createdAt,
           COALESCE(w.status, CASE o.review_status WHEN 'confirmed' THEN 'accepted' WHEN 'rejected' THEN 'rejected' ELSE 'submitted' END) AS workflowStatus,
           w.triage_method AS triageMethod, w.triage_json AS triageJson, w.assigned_to AS assignedTo, w.updated_at AS workflowUpdatedAt,
           COALESCE(p.classification, 'standard') AS privacyClassification, COALESCE(p.legal_hold, 0) AS legalHold
    FROM observations o
    LEFT JOIN staff_report_workflow w ON w.observation_id = o.id
    LEFT JOIN report_privacy p ON p.observation_id = o.id
    WHERE o.source_channel = 'human' ${visibilityClause}
    ORDER BY o.created_at DESC LIMIT 250
  `);
  const countsStatement = d1.prepare(`
    SELECT o.finding_id AS findingId, COUNT(*) AS count
    FROM observations o
    LEFT JOIN report_privacy p ON p.observation_id = o.id
    LEFT JOIN staff_report_workflow w ON w.observation_id = o.id
    WHERE o.finding_id IS NOT NULL AND o.review_status = 'confirmed' ${linkedVisibilityClause}
    GROUP BY o.finding_id
  `);
  const linksStatement = d1.prepare(`
    SELECT o.finding_id AS findingId, o.target_id AS targetId, o.url, o.title, o.source_channel AS sourceChannel, o.created_at AS createdAt
    FROM observations o
    LEFT JOIN report_privacy p ON p.observation_id = o.id
    LEFT JOIN staff_report_workflow w ON w.observation_id = o.id
    WHERE o.finding_id IS NOT NULL AND o.review_status = 'confirmed' ${linkedVisibilityClause}
    ORDER BY o.created_at DESC
  `);
  const queueStatement = d1.prepare(`
    SELECT o.source_channel AS sourceChannel, o.review_status AS reviewStatus, COUNT(*) AS count
    FROM observations o
    LEFT JOIN report_privacy p ON p.observation_id = o.id
    LEFT JOIN staff_report_workflow w ON w.observation_id = o.id
    WHERE o.review_status IN ('pending', 'needs_info') ${linkedVisibilityClause}
    GROUP BY o.source_channel, o.review_status
  `);
  const metricStatement = d1.prepare(`
    SELECT o.created_by AS createdBy, o.created_at AS createdAt, o.review_status AS reviewStatus,
           w.status AS workflowStatus, w.updated_at AS workflowUpdatedAt,
           (SELECT r.decision FROM review_decisions r WHERE r.observation_id = o.id ORDER BY r.created_at ASC LIMIT 1) AS reviewDecision,
           (SELECT r.created_at FROM review_decisions r WHERE r.observation_id = o.id ORDER BY r.created_at ASC LIMIT 1) AS firstReviewedAt,
           (SELECT pe.duration_ms FROM pilot_events pe WHERE pe.observation_id = o.id AND pe.event_type = 'report_submitted' ORDER BY pe.created_at ASC LIMIT 1) AS submissionDurationMs
    FROM observations o
    LEFT JOIN staff_report_workflow w ON w.observation_id = o.id
    LEFT JOIN report_privacy p ON p.observation_id = o.id
    WHERE o.source_channel = 'human' ${visibilityClause}
  `);
  const privacyStatement = d1.prepare(`
    SELECT e.created_at AS createdAt, COALESCE(p.classification, 'standard') AS classification,
           CASE WHEN COALESCE(p.legal_hold, 0) = 1 OR COALESCE(c.legal_hold, 0) = 1 THEN 1 ELSE 0 END AS legalHold,
           c.retention_until AS retentionUntil, c.size_bytes AS sizeBytes
    FROM evidence_assets e
    JOIN observations o ON o.id = e.observation_id
    LEFT JOIN staff_report_workflow w ON w.observation_id = o.id
    LEFT JOIN report_privacy p ON p.observation_id = o.id
    LEFT JOIN evidence_controls c ON c.asset_id = e.id
    WHERE o.source_channel = 'human' ${visibilityClause}
  `);
  const bindVisible = (statement: D1PreparedStatement) => restrictForFindingOwner ? statement.bind(user.email) : statement;
  const publicActivityClause = publicViewer ? "WHERE event_type IN ('demo_seeded', 'audit_imported')" : "";
  const [organizations, sites, targets, states, findings, staffObservations, automatedObservations, evidence, reportMessages, observationCounts, findingLinks, queueCounts, baselines, runs, activity, metricReports, qualityUsers, privacyRows] = await Promise.all([
    d1.prepare(`SELECT id, slug, name, product_name AS productName, brand_label AS brandLabel FROM organizations ORDER BY created_at LIMIT 1`).all<DataRow>(),
    d1.prepare(`SELECT id, organization_id AS organizationId, slug, name FROM sites WHERE active = 1 ORDER BY name`).all<DataRow>(),
    d1.prepare(`SELECT id, site_id AS siteId, name, environment, base_url AS baseUrl, allowed_host AS allowedHost, allowed_path_prefix AS allowedPathPrefix FROM targets WHERE active = 1 ORDER BY site_id, environment`).all<DataRow>(),
    d1.prepare(`SELECT finding_id AS findingId, target_id AS targetId, status, delta, last_run_id AS lastRunId, current_evidence AS currentEvidence, updated_at AS updatedAt FROM finding_states`).all<DataRow>(),
    d1.prepare(`SELECT id, site_id AS siteId, display_key AS displayKey, title, severity, category, recommendation, acceptance_criteria AS acceptanceCriteria, owner, created_at AS createdAt FROM findings ORDER BY site_id, CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, display_key`).all<DataRow>(),
    bindVisible(staffStatement).all<DataRow>(),
    d1.prepare(`
      SELECT id, target_id AS targetId, run_id AS runId, finding_id AS findingId, suggested_finding_id AS suggestedFindingId, source_channel AS sourceChannel,
             url, title, description, expected, actual, review_status AS reviewStatus, created_by AS createdBy, created_at AS createdAt
      FROM observations
      WHERE source_channel = 'automated' AND review_status = 'pending'
      ORDER BY created_at DESC LIMIT 5000
    `).all<DataRow>(),
    d1.prepare(`
      SELECT e.id, e.observation_id AS observationId, e.kind, e.storage_key AS storageKey, e.public_url AS publicUrl, e.caption, e.privacy_status AS privacyStatus, e.created_at AS createdAt
      FROM evidence_assets e JOIN observations o ON o.id = e.observation_id
      WHERE o.source_channel = 'human'
      ORDER BY e.created_at DESC
    `).all<DataRow>(),
    d1.prepare(`SELECT id, observation_id AS observationId, author_email AS authorEmail, author_role AS authorRole, message_type AS messageType, body, evidence_asset_id AS evidenceAssetId, created_at AS createdAt FROM report_messages ORDER BY created_at ASC`).all<DataRow>(),
    bindVisible(countsStatement).all<DataRow>(),
    bindVisible(linksStatement).all<DataRow>(),
    bindVisible(queueStatement).all<DataRow>(),
    d1.prepare(`SELECT b.id, b.target_id AS targetId, b.run_id AS runId, b.version, b.reason, b.approved_by AS approvedBy, b.created_at AS createdAt, b.superseded_at AS supersededAt, r.completed_at AS runCompletedAt FROM baselines b JOIN audit_runs r ON r.id = b.run_id ORDER BY b.target_id, b.version DESC`).all<DataRow>(),
    d1.prepare(`SELECT id, target_id AS targetId, run_type AS runType, status, started_at AS startedAt, completed_at AS completedAt, ruleset_version AS rulesetVersion, profile_version AS profileVersion, browser, viewport, locale, page_limit AS pageLimit, pages_attempted AS pagesAttempted, pages_completed AS pagesCompleted, comparable, comparison_reason AS comparisonReason, coverage_json AS coverageJson, limitations_json AS limitationsJson, triggered_by AS triggeredBy FROM audit_runs ORDER BY completed_at DESC`).all<DataRow>(),
    d1.prepare(`SELECT id, event_type AS eventType, entity_type AS entityType, entity_id AS entityId, actor, detail_json AS detailJson, created_at AS createdAt FROM activity_log ${publicActivityClause} ORDER BY created_at DESC LIMIT 20`).all<DataRow>(),
    bindVisible(metricStatement).all<DataRow>(),
    d1.prepare("SELECT role FROM quality_users WHERE active = 1").all<DataRow>(),
    bindVisible(privacyStatement).all<DataRow>(),
  ]);

  const organization = organizations.results[0] ?? {
    id: "unconfigured",
    slug: "unconfigured",
    name: "Unconfigured organisation",
    productName: "SiteScout",
    brandLabel: "SITESCOUT",
  };
  const siteRows = sites.results;
  const targetRows = targets.results;
  const previewData = { observations: [] as DataRow[], runs: [] as DataRow[] };
  const automatedObservationRows = [...automatedObservations.results, ...previewData.observations];
  const runRows = [...previewData.runs, ...runs.results];
  const targetById = new Map(targetRows.map((target) => [String(target.id), target]));
  const stateRows = states.results;
  const findingRows = findings.results;
  const staffObservationRows = staffObservations.results;
  const evidenceRows = evidence.results;
  const excludedFindings = auditScope.excludedFindings as ExcludedFinding[];
  const excludedById = new Map(excludedFindings.map((finding) => [finding.id, finding]));
  const activeFindingIds = new Set(findingRows.filter((finding) => !excludedById.has(String(finding.id))).map((finding) => String(finding.id)));
  const stateByFinding = new Map<string, Record<string, DataRow>>();
  for (const state of stateRows) {
    const id = String(state.findingId);
    const environment = String(targetById.get(String(state.targetId))?.environment ?? "unknown");
    stateByFinding.set(id, { ...(stateByFinding.get(id) ?? {}), [environment]: state });
  }
  const evidenceByObservation = new Map<string, DataRow[]>();
  for (const asset of evidenceRows) {
    const id = String(asset.observationId);
    evidenceByObservation.set(id, [...(evidenceByObservation.get(id) ?? []), asset]);
  }
  const messagesByObservation = new Map<string, DataRow[]>();
  for (const message of reportMessages.results) {
    const id = String(message.observationId);
    messagesByObservation.set(id, [...(messagesByObservation.get(id) ?? []), message]);
  }
  const countByFinding = new Map(observationCounts.results.map((row) => [String(row.findingId), Number(row.count)]));
  const linksByFinding = new Map<string, AffectedLink[]>();
  for (const row of findingLinks.results) {
    const findingId = String(row.findingId);
    const link = validateAffectedLink({
      targetId: String(row.targetId),
      url: String(row.url),
      label: typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Recorded evidence page",
      source: "recorded-evidence",
    }, targetById);
    if (!link) continue;
    const existing = linksByFinding.get(findingId) ?? [];
    if (existing.filter((candidate) => candidate.targetId === link.targetId).length >= 4 || existing.some((candidate) => candidate.url === link.url)) continue;
    linksByFinding.set(findingId, [...existing, link]);
  }
  const observationsWithEvidence = staffObservationRows.map((observation) => ({
    ...observation,
    triage: safeJson(observation.triageJson),
    evidence: evidenceByObservation.get(String(observation.id)) ?? [],
    messages: messagesByObservation.get(String(observation.id)) ?? [],
  }));
  const enrichedFindings = findingRows.map((finding) => {
    const id = String(finding.id);
    const guidance = buildFindingGuidance({ id, title: String(finding.title), category: String(finding.category), severity: String(finding.severity) });
    const knownLinks = guidance.knownLinks.map((candidate) => validateAffectedLink({ ...candidate, source: "audit-reference" }, targetById)).filter((candidate): candidate is AffectedLink => Boolean(candidate));
    const affectedLinks = mergeAffectedLinks(knownLinks, linksByFinding.get(id) ?? []);
    return {
      ...finding,
      scopeStatus: excludedById.get(id)?.status ?? "active",
      scopeReason: excludedById.get(id)?.reason ?? null,
      states: stateByFinding.get(id) ?? {},
      observationCount: countByFinding.get(id) ?? 0,
      guidance: { explanation: guidance.explanation, security: guidance.security, customers: guidance.customers, reputation: guidance.reputation, caveat: guidance.caveat },
      affectedLinks,
    };
  });
  const activeFindingRows = findingRows.filter((finding) => activeFindingIds.has(String(finding.id)));
  const productionStates = stateRows.filter((state) => targetById.get(String(state.targetId))?.environment === "production" && activeFindingIds.has(String(state.findingId)));
  const byStatus = Object.fromEntries(["open", "partial", "resolved", "regressed", "not_tested"].map((status) => [status, productionStates.filter((state) => state.status === status).length]));
  const bySeverity = Object.fromEntries(["critical", "high", "medium", "low"].map((severity) => [severity, activeFindingRows.filter((finding) => finding.severity === severity).length]));
  const activeRisk = productionStates.filter((state) => state.status === "open" || state.status === "regressed").length;
  const queueCount = (source: string) => queueCounts.results.filter((row) => row.sourceChannel === source).reduce((total, row) => total + Number(row.count), 0);
  const pendingStaff = queueCount("human");
  const pendingAutomated = queueCount("automated") + previewData.observations.length;
  const automatedGroups = buildAutomatedGroups(automatedObservationRows.map((observation) => ({
    id: String(observation.id), targetId: String(observation.targetId), runId: observation.runId ? String(observation.runId) : null,
    url: String(observation.url), title: String(observation.title), description: String(observation.description),
  })), auditRuleMappings.targets).map((group) => ({
    id: group.id, targetId: group.targetId, environment: String(targetById.get(group.targetId)?.environment ?? "unknown"),
    ruleId: group.ruleId, urlPattern: group.urlPattern, proposedFindingId: group.proposedFindingId, title: group.title,
    severity: group.severity, count: group.count, runCount: group.runCount, sampleUrls: group.sampleUrls,
  }));
  const pilotMetrics = calculatePilotMetrics(metricReports.results.map((row) => ({
    createdBy: String(row.createdBy), createdAt: String(row.createdAt), reviewStatus: String(row.reviewStatus),
    reviewDecision: row.reviewDecision ? String(row.reviewDecision) : null, firstReviewedAt: row.firstReviewedAt ? String(row.firstReviewedAt) : null,
    workflowStatus: row.workflowStatus ? String(row.workflowStatus) : null, workflowUpdatedAt: row.workflowUpdatedAt ? String(row.workflowUpdatedAt) : null,
    submissionDurationMs: typeof row.submissionDurationMs === "number" ? row.submissionDurationMs : row.submissionDurationMs === null ? null : Number(row.submissionDurationMs),
  })), qualityUsers.results.map((row) => ({ role: String(row.role) })));
  const privacy = privacyPreview(privacyRows.results.map((row) => ({
    createdAt: String(row.createdAt), classification: row.classification ? String(row.classification) : null,
    legalHold: Number(row.legalHold ?? 0), retentionUntil: row.retentionUntil ? String(row.retentionUntil) : null,
    sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : row.sizeBytes === null ? null : Number(row.sizeBytes),
  })));

  return {
    generatedAt: new Date().toISOString(),
    organization,
    sites: siteRows,
    pilot: {
      name: `${String(organization.name)} website quality operation`,
      deployment: isPublicDemoEnabled() ? "public-management-preview" : user.localPilot ? "local-pilot" : "private-operational",
      productionDeploymentDeferred: user.localPilot,
    },
    scope: { version: auditScope.version, excludedFindings },
    summary: { total: activeFindingRows.length, excluded: excludedById.size, activeRisk, byStatus, bySeverity, pendingReview: pendingStaff, pendingAutomated },
    queues: { staff: pendingStaff, automated: pendingAutomated, automatedPreviewLimit: 50, automatedGroupCount: automatedGroups.length },
    features: {
      identity: { mode: isPublicDemoEnabled() ? "public-read-only-preview" : "named-allowlist", entraGroupRollout: "supported-by-deployment" },
      assistance: { mode: aiAssistConfigured() ? "openai-text-assist" : "local-assist", screenshotsSentExternally: false, humanApprovalRequired: true },
      ticketing: { status: "deferred", reason: "Enable only after the staff pilot workflow is accepted." },
    },
    sourceAudit: seedPayload.sourceAudit,
    sourceWarnings: seedPayload.warnings,
    targets: targetRows,
    findings: enrichedFindings,
    observations: observationsWithEvidence,
    automatedObservations: automatedObservationRows.slice(0, 50).map((observation) => ({ ...observation, evidence: [] })),
    automatedGroups,
    pilotMetrics,
    privacy,
    baselines: baselines.results,
    runs: runRows.map((run) => ({ ...run, coverage: safeJson(run.coverageJson), limitations: safeJson(run.limitationsJson) })),
    activity: activity.results.map((entry) => ({ ...entry, detail: safeJson(entry.detailJson) })),
  };
}

function safeJson(value: unknown) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function validateAffectedLink(candidate: { targetId: string; url: string; label: string; source: AffectedLink["source"] }, targetById: Map<string, DataRow>): AffectedLink | null {
  const target = targetById.get(candidate.targetId);
  if (!target) return null;
  let url: URL;
  try { url = new URL(candidate.url); } catch { return null; }
  const allowedHost = String(target.allowedHost).toLowerCase();
  const prefix = String(target.allowedPathPrefix);
  const specialPath = url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml";
  const pathAllowed = prefix === "/" || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hostname.toLowerCase() !== allowedHost || (!specialPath && !pathAllowed)) return null;
  url.hash = "";
  return { targetId: candidate.targetId, environment: String(target.environment), url: url.href, label: candidate.label.slice(0, 180), source: candidate.source };
}

function mergeAffectedLinks(...groups: AffectedLink[][]) {
  const result: AffectedLink[] = [];
  for (const link of groups.flat()) {
    if (!result.some((candidate) => candidate.targetId === link.targetId && candidate.url === link.url)) result.push(link);
  }
  return result.slice(0, 10);
}
