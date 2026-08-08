"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { QualityUser } from "@/app/auth";
import type { DashboardData } from "@/lib/platform/data";

type View = "overview" | "findings" | "evidence" | "baselines" | "method";
type Environment = "production" | "staging";
type FindingState = { targetId: string; status: string; delta: string; currentEvidence: string; updatedAt: string };
type FindingGuidance = { explanation: string; security: string; customers: string; reputation: string; caveat: string };
type AffectedLink = {
  targetId: string; environment: Environment; url: string; label: string; source: "recorded-evidence" | "audit-reference";
};
type Finding = {
  id: string; siteId: string; displayKey: string; title: string; severity: string; category: string; recommendation: string; acceptanceCriteria: string; owner: string | null;
  observationCount: number; scopeStatus: "active" | "separate_workstream"; scopeReason: string | null; states: Partial<Record<Environment, FindingState>>;
  guidance: FindingGuidance; affectedLinks: AffectedLink[];
};
type Asset = { id: string; publicUrl: string | null; caption: string; privacyStatus: string };
type ReportMessage = { id: string; authorEmail: string; authorRole: string; messageType: string; body: string; evidenceAssetId: string | null; createdAt: string };
type Observation = {
  id: string; targetId: string; runId: string | null; findingId: string | null; suggestedFindingId: string | null; sourceChannel: string;
  url: string; title: string; description: string; expected: string; actual: string; reviewStatus: string; createdBy: string; createdAt: string; evidence: Asset[];
  workflowStatus?: string; triageMethod?: string | null; assignedTo?: string | null; workflowUpdatedAt?: string | null;
  privacyClassification?: string; legalHold?: number; messages?: ReportMessage[];
};
type AutomatedGroup = { id: string; targetId: string; environment: string; ruleId: string; urlPattern: string; proposedFindingId: string | null; title: string; severity: string; count: number; runCount: number; sampleUrls: string[] };
type Target = { id: string; siteId: string; name: string; environment: Environment; baseUrl: string };
type Site = { id: string; organizationId: string; slug: string; name: string };
type Organization = { id: string; slug: string; name: string; productName: string; brandLabel: string };
type Baseline = { id: string; targetId: string; runId: string; version: number; reason: string; approvedBy: string; createdAt: string; supersededAt: string | null; runCompletedAt: string };
type Run = { id: string; targetId: string; status: string; runType: string; completedAt: string; rulesetVersion: string; profileVersion: string; pagesAttempted: number; pagesCompleted: number; browser: string; triggeredBy: string; coverage: Record<string, number>; limitations: string[] };
type Activity = { id: number; eventType: string; entityId: string; actor: string; createdAt: string };
type PlatformData = {
  generatedAt: string;
  organization: Organization;
  sites: Site[];
  pilot: { name: string; deployment: string; productionDeploymentDeferred: boolean };
  scope: { version: string; excludedFindings: Array<{ id: string; status: string; reason: string }> };
  sourceAudit: { date: string; environment: string; coverage: Record<string, number> };
  sourceWarnings: string[];
  findings: Finding[]; observations: Observation[]; automatedObservations: Observation[]; automatedGroups: AutomatedGroup[]; targets: Target[]; baselines: Baseline[]; runs: Run[]; activity: Activity[];
  summary: { total: number; excluded: number; activeRisk: number; pendingReview: number; pendingAutomated: number; byStatus: Record<string, number>; bySeverity: Record<string, number> };
  queues: { staff: number; automated: number; automatedPreviewLimit: number; automatedGroupCount: number };
  pilotMetrics: { totalReports: number; reviewedReports: number; usefulReports: number; usefulReportRate: number | null; supportingEvidenceReports: number; duplicateSupportRate: number | null; averageValidationHours: number | null; averageClosureHours: number | null; submissionSamples: number; averageSubmissionSeconds: number | null; underTwentySecondsRate: number | null; uniqueReporters: number; returningReporters: number; returningParticipationRate: number | null; knownUsers: number; usersByRole: Record<string, number> };
  privacy: { policyVersion: string; mode: string; standardEvidenceRetentionDays: number; securityEvidenceRetentionDays: number | null; maxEvidenceAssetsPerReport: number; maxEvidenceBytesPerReport: number; privacyAdministrator: string; securityEscalationOwner: string; backup: { frequency: string; retentionDays: number; configured: boolean; restoreTested: boolean; owner: string }; totalAssets: number; eligibleAssets: number; protectedSecurityAssets: number; heldAssets: number; trackedBytes: number; unknownSizeAssets: number; deletionEnabled: boolean };
  features: {
    identity: { mode: string; entraGroupRollout: string };
    assistance: { mode: string; screenshotsSentExternally: boolean; humanApprovalRequired: boolean };
    ticketing: { status: string; reason: string };
  };
};

type ReviewDecision = "confirm" | "link" | "support" | "accept_new" | "needs_info" | "reject";

const nav: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "Control room", icon: "⌁" },
  { id: "findings", label: "Finding register", icon: "◇" },
  { id: "evidence", label: "Evidence review", icon: "▣" },
  { id: "baselines", label: "Runs & baselines", icon: "↗" },
  { id: "method", label: "Audit boundary", icon: "◎" },
];

const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const statusLabels: Record<string, string> = { open: "Open", partial: "Partially fixed", resolved: "Resolved", regressed: "Regressed", not_tested: "Not tested" };

export function QualityPlatform({ initialData, user }: { initialData: DashboardData; user: QualityUser }) {
  const [data, setData] = useState(initialData as unknown as PlatformData);
  const [view, setView] = useState<View>("overview");
  const [environment, setEnvironment] = useState<Environment>("production");
  const [selectedSiteId, setSelectedSiteId] = useState(String(initialData.sites[0]?.id ?? ""));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("active");
  const [scopeFilter, setScopeFilter] = useState("active");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewLinks, setReviewLinks] = useState<Record<string, string>>({});
  const [reviewSeverities, setReviewSeverities] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reportAssignments, setReportAssignments] = useState<Record<string, string>>({});
  const [bulkFindingIds, setBulkFindingIds] = useState<Record<string, string>>({});
  const [bulkConfirmations, setBulkConfirmations] = useState<Record<string, boolean>>({});

  const siteTargetIds = useMemo(() => new Set(data.targets.filter((target) => target.siteId === selectedSiteId).map((target) => target.id)), [data.targets, selectedSiteId]);
  const findings = useMemo(() => data.findings.filter((finding) => finding.siteId === selectedSiteId).filter((finding) => {
    const state = finding.states[environment]?.status ?? "not_tested";
    const matchesQuery = `${finding.id} ${finding.title} ${finding.category} ${finding.owner ?? ""}`.toLowerCase().includes(query.toLowerCase());
    const matchesSeverity = severity === "all" || finding.severity === severity;
    const matchesStatus = status === "all" || (status === "active" ? state === "open" || state === "regressed" : state === status);
    const matchesScope = scopeFilter === "all" || finding.scopeStatus === scopeFilter;
    return matchesQuery && matchesSeverity && matchesStatus && matchesScope;
  }), [data.findings, selectedSiteId, environment, query, severity, status, scopeFilter]);

  const selected = data.findings.find((finding) => finding.id === selectedId && finding.siteId === selectedSiteId) ?? null;
  const target = data.targets.find((candidate) => candidate.siteId === selectedSiteId && candidate.environment === environment);
  const pendingStaff = data.observations.filter((observation) => siteTargetIds.has(observation.targetId) && ["pending", "needs_info"].includes(observation.reviewStatus));
  const currentBaselines = data.baselines.filter((baseline) => siteTargetIds.has(baseline.targetId) && !baseline.supersededAt);
  const canReview = user.role === "validator" || user.role === "administrator";
  const canManageFindings = user.role === "finding_owner" || user.role === "administrator";
  const canManageBaselines = user.role === "administrator";

  async function refresh() {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const payload = await response.json() as { ok: boolean; data?: PlatformData; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error ?? "Could not refresh dashboard.");
    setData(payload.data);
  }

  async function action(work: () => Promise<void>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await refresh();
      setNotice({ kind: "ok", text: success });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Action failed." });
    } finally { setBusy(false); }
  }

  async function api(url: string, init: RequestInit) {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status}).`);
    return payload;
  }

  function openFinding(id: string) {
    setSelectedId(id);
    setView("findings");
  }

  function selectSite(siteId: string) {
    setSelectedSiteId(siteId);
    setSelectedId(null);
  }

  async function reviewObservation(observation: Observation, decision: ReviewDecision) {
    const findingId = reviewLinks[observation.id] || observation.suggestedFindingId || observation.findingId;
    const severity = reviewSeverities[observation.id] || "medium";
    const note = reviewNotes[observation.id]?.trim() || (decision === "needs_info" ? "" : "Reviewed in quality control");
    if (decision === "needs_info" && !note) return setNotice({ kind: "error", text: "Explain what additional information the reporter should provide." });
    await action(() => api(`/api/observations/${observation.id}/review`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, findingId, severity, note }),
    }).then(() => undefined), reviewSuccess(decision));
  }

  async function reviewAutomatedGroup(group: AutomatedGroup, decision: "link" | "reject") {
    const findingId = bulkFindingIds[group.id] || group.proposedFindingId;
    if (!bulkConfirmations[group.id]) return setNotice({ kind: "error", text: "Review the examples and confirm the group before applying a bulk decision." });
    if (decision === "link" && !findingId) return setNotice({ kind: "error", text: "Choose a canonical finding for this automated group." });
    await action(() => api("/api/automated-groups/review", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: group.id, decision, findingId, expectedCount: group.count, note: `Human-approved grouped review of ${group.ruleId}` }),
    }).then(() => undefined), `${group.ruleId} group reviewed. The underlying observations remain individually traceable.`);
    setBulkConfirmations((current) => ({ ...current, [group.id]: false }));
  }

  async function updateReportStatus(observation: Observation, status: string) {
    const assignedTo = reportAssignments[observation.id]?.trim() || undefined;
    await action(() => api(`/api/staff-reports/${observation.id}/status`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, assignedTo, note: "Updated in quality control" }),
    }).then(() => undefined), `Staff report moved to ${status.replaceAll("_", " ")}. The reporter was notified.`);
  }

  async function updateFinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !target) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await action(() => api(`/api/findings/${selected.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId: target.id, status: values.status, owner: values.owner, acceptanceCriteria: values.acceptanceCriteria }),
    }).then(() => undefined), `${selected.id} updated for ${environment}.`);
  }

  async function importAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("auditFile");
    if (!(file instanceof File) || !file.size) return setNotice({ kind: "error", text: "Choose an audit JSON file first." });
    await action(async () => {
      await api("/api/audits/import", { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() });
      form.reset();
    }, "Audit imported; its observations are ready for review.");
  }

  async function promoteBaseline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await action(() => api("/api/baselines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }).then(() => undefined), "Baseline promoted without deleting its predecessor.");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><b /></span>
          <span><strong>{data.organization.productName.toUpperCase()}</strong><small>{data.organization.brandLabel}</small></span>
        </div>
        <div className="pilot-chip"><span />{data.pilot.deployment === "public-management-preview" ? "Public preview · read only" : data.pilot.deployment === "private-operational" ? "Private pilot · secure" : "Private pilot · local"}</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.id === "evidence" && pendingStaff.length > 0 ? <em>{pendingStaff.length}</em> : null}</button>)}
        </nav>
        <div className="sidebar-foot">
          <span className="avatar">{initials(user.displayName)}</span>
          <span><strong>{user.displayName}</strong><small>{user.localPilot ? "Local administrator session" : roleLabel(user.role)}</small></span>
          <i className="online" title="Session active" />
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">WEBSITE RELEASE ASSURANCE</p><h1>{nav.find((item) => item.id === view)?.label}</h1></div>
          <div className="top-actions">
            {user.role !== "management_viewer" ? <Link className="target-link report-link" href="/report"><span>Report issue</span><i aria-hidden="true">+</i></Link> : null}
            <Link className="target-link" href="/seo"><span>SEO snapshots</span><i aria-hidden="true">↗</i></Link>
            {user.role === "administrator" || user.role === "security_reviewer" ? <Link className="target-link" href="/security"><span>Security review</span><i aria-hidden="true">↗</i></Link> : null}
            <label className="site-switch"><span className="sr-only">Website</span><select aria-label="Website" value={selectedSiteId} onChange={(event) => selectSite(event.target.value)}>{data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            <div className="environment-switch" aria-label="Environment">
              {(["production", "staging"] as Environment[]).map((name) => <button key={name} className={environment === name ? "active" : ""} onClick={() => setEnvironment(name)}><span />{name}</button>)}
            </div>
            {target ? <a className="target-link" href={target.baseUrl} target="_blank" rel="noreferrer"><span>Open target</span><i aria-hidden="true">↗</i></a> : null}
          </div>
        </header>

        {notice ? <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind === "ok" ? "✓" : "!"}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div> : null}

        <div className="content">
          {view === "overview" ? <Overview data={data} siteId={selectedSiteId} targetId={target?.id} environment={environment} openFinding={openFinding} setView={setView} /> : null}
          {view === "findings" ? (
            <section className="findings-layout">
              <div className="panel register-panel">
                <div className="panel-heading"><div><p className="kicker">CANONICAL REGISTER</p><h2>{findings.length} findings shown</h2></div><button className="primary small" onClick={() => setView("evidence")}>{user.role === "management_viewer" ? "Inspect evidence" : "+ Add evidence"}</button></div>
                <div className="filters">
                  <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, finding, owner…" /></label>
                  <select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Severity"><option value="all">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
                  <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status"><option value="active">Active risk</option><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} aria-label="Audit scope"><option value="active">Active audit</option><option value="separate_workstream">Separate workstream</option><option value="all">All scope</option></select>
                </div>
                <div className="finding-list" role="list">
                  {findings.map((finding) => {
                    const state = finding.states[environment];
                    return <button role="listitem" key={finding.id} className={`finding-row ${selectedId === finding.id ? "selected" : ""}`} onClick={() => setSelectedId(finding.id)}>
                      <span className={`severity-dot ${finding.severity}`} /><span className="finding-id">{finding.id}</span>
                      <span className="finding-copy"><strong>{finding.title}</strong><small>{finding.scopeStatus === "separate_workstream" ? "Separate workstream · " : ""}{finding.category} · {finding.observationCount} evidence record{finding.observationCount === 1 ? "" : "s"}</small></span>
                      <StatusBadge status={state?.status ?? "not_tested"} />
                      <span className="chevron">›</span>
                    </button>;
                  })}
                  {!findings.length ? <div className="empty">No findings match these filters.</div> : null}
                </div>
              </div>
              <aside className="panel detail-panel">
                {selected ? <FindingDetail finding={selected} environment={environment} targetId={target?.id ?? ""} canEdit={canManageFindings} busy={busy} onSubmit={updateFinding} /> : <div className="empty">Select a finding to inspect its evidence.</div>}
              </aside>
            </section>
          ) : null}
          {view === "evidence" ? <EvidenceView data={data} siteId={selectedSiteId} siteTargetIds={siteTargetIds} staffQueue={pendingStaff} reviewLinks={reviewLinks} setReviewLinks={setReviewLinks} reviewSeverities={reviewSeverities} setReviewSeverities={setReviewSeverities} reviewNotes={reviewNotes} setReviewNotes={setReviewNotes} reportAssignments={reportAssignments} setReportAssignments={setReportAssignments} bulkFindingIds={bulkFindingIds} setBulkFindingIds={setBulkFindingIds} bulkConfirmations={bulkConfirmations} setBulkConfirmations={setBulkConfirmations} onReview={reviewObservation} onBulkReview={reviewAutomatedGroup} onStatus={updateReportStatus} busy={busy} user={user} canReview={canReview} /> : null}
          {view === "baselines" ? <BaselinesView data={data} siteTargetIds={siteTargetIds} currentBaselines={currentBaselines} target={target} onImport={importAudit} onPromote={promoteBaseline} busy={busy} canEdit={canManageBaselines} /> : null}
          {view === "method" ? <MethodView data={data} /> : null}
        </div>
      </main>
    </div>
  );
}

function Overview({ data, siteId, targetId, environment, openFinding, setView }: { data: PlatformData; siteId: string; targetId?: string; environment: Environment; openFinding: (id: string) => void; setView: (view: View) => void }) {
  const siteTargetIds = new Set(data.targets.filter((target) => target.siteId === siteId).map((target) => target.id));
  const scoped = data.findings.filter((finding) => finding.siteId === siteId && finding.scopeStatus === "active");
  const active = scoped.filter((finding) => ["open", "regressed"].includes(finding.states[environment]?.status ?? "not_tested")).sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const resolved = scoped.filter((finding) => finding.states[environment]?.status === "resolved").length;
  const total = scoped.length;
  const confidence = total ? Math.round((resolved / total) * 100) : 0;
  const production = statusCount(scoped, "production");
  const staging = statusCount(scoped, "staging");
  const latestRun = data.runs.find((run) => run.targetId === targetId);
  const pendingStaff = data.observations.filter((observation) => siteTargetIds.has(observation.targetId) && ["pending", "needs_info"].includes(observation.reviewStatus)).length;
  const pendingAutomated = data.automatedObservations.filter((observation) => siteTargetIds.has(observation.targetId)).length;
  return <>
    <section className="hero-grid">
      <div className="risk-hero">
        <div className="signal-lines" aria-hidden="true"><i /><i /><i /></div>
        <p className="kicker light">CURRENT RELEASE SIGNAL · {environment.toUpperCase()}</p>
        <h2>{active.length ? "Evidence says hold." : "No active blockers."}</h2>
        <p>{active.length ? `${active.length} findings remain open or regressed for this website.` : "The current baseline contains no open or regressed findings for this website."}</p>
        <div className="hero-actions"><button className="primary inverted" onClick={() => active[0] ? openFinding(active[0].id) : setView("findings")}>Inspect top risk</button><button className="text-button" onClick={() => setView("baselines")}>View baseline history →</button></div>
        <div className="hero-metric"><strong>{confidence}%</strong><span>of the canonical register is resolved<br />in {environment}</span></div>
      </div>
      <div className="metric-grid">
        <Metric label="Active risk" value={active.length} detail="Open + regressed" tone="risk" />
        <Metric label="Critical / high" value={scoped.filter((f) => ["critical", "high"].includes(f.severity) && ["open", "regressed", "partial"].includes(f.states[environment]?.status ?? "")).length} detail="Needs release attention" tone="warning" />
        <Metric label="Staff review" value={pendingStaff} detail="Named reports · separate queue" tone="review" />
        <Metric label="Automated queue" value={pendingAutomated} detail="Visible machine observations" tone="good" />
      </div>
    </section>

    <section className="overview-grid">
      <div className="panel attention-panel">
        <div className="panel-heading"><div><p className="kicker">RELEASE ATTENTION</p><h2>Highest-impact evidence</h2></div><button className="text-button dark" onClick={() => setView("findings")}>Full register →</button></div>
        <div className="attention-list">
          {active.slice(0, 5).map((finding, index) => <button key={finding.id} onClick={() => openFinding(finding.id)}><span className="rank">0{index + 1}</span><span className="finding-copy"><b>{finding.id}</b><strong>{finding.title}</strong><small>{finding.states[environment]?.currentEvidence}</small></span><SeverityBadge severity={finding.severity} /><span>›</span></button>)}
        </div>
      </div>
      <div className="panel comparison-panel">
        <div className="panel-heading"><div><p className="kicker">ENVIRONMENT DELTA</p><h2>Production vs staging</h2></div></div>
        <EnvironmentBar label="Production" counts={production} total={total} />
        <EnvironmentBar label="Staging baseline" counts={staging} total={total} />
        <div className="legend"><span><i className="resolved" />Resolved</span><span><i className="partial" />Partial</span><span><i className="open" />Open / regressed</span><span><i className="not_tested" />Not tested</span></div>
        <div className="source-note"><span>i</span><p><strong>Evidence boundary</strong>{data.sourceAudit.coverage.statusVerifiedUrls} URLs checked; {data.sourceAudit.coverage.parsedPages} parsed; {data.sourceAudit.coverage.browserScenarios} browser scenarios. Bundled demonstration records are synthetic and use reserved domains.</p></div>
      </div>
    </section>

    <section className="panel coverage-panel">
      <div><p className="kicker">LATEST AUTOMATED RECORD</p><h2>{latestRun ? `${latestRun.pagesCompleted}/${latestRun.pagesAttempted} pages completed` : "No automated run imported"}</h2><p>{latestRun ? `${latestRun.rulesetVersion} · ${latestRun.browser} · completed ${formatDate(latestRun.completedAt)}` : "Generate a bounded run locally, review its limitations, then import it."}</p></div>
      <div className="coverage-stats"><span><b>{data.sourceAudit.coverage.imagesChecked}</b>images</span><span><b>{data.sourceAudit.coverage.languagePages}</b>language pages</span><span><b>{data.sourceAudit.coverage.blogArticlesChecked}</b>articles</span><span><b>{data.sourceAudit.coverage.performancePages}</b>performance pages</span></div>
    </section>
  </>;
}

function FindingDetail({ finding, environment, targetId, canEdit, busy, onSubmit }: { finding: Finding; environment: Environment; targetId: string; canEdit: boolean; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const state = finding.states[environment];
  const affectedLinks = finding.affectedLinks.filter((link) => link.environment === environment);
  return <div>
    <div className="detail-head"><div><SeverityBadge severity={finding.severity} /><span className="finding-id large">{finding.id}</span></div><StatusBadge status={state?.status ?? "not_tested"} /></div>
    <h2>{finding.title}</h2>
    <p className="detail-meta">{finding.category} · {finding.observationCount} linked evidence record{finding.observationCount === 1 ? "" : "s"}</p>
    {finding.scopeStatus === "separate_workstream" ? <div className="evidence-block"><p className="kicker">SEPARATE WORKSTREAM</p><p>{finding.scopeReason}</p></div> : null}
    <div className="evidence-block"><p className="kicker">CURRENT EVIDENCE</p><p>{state?.currentEvidence ?? "No environment-specific evidence recorded."}</p></div>
    <section className="meaning-panel" aria-labelledby={`meaning-${finding.id}`}>
      <p className="kicker">PLAIN-LANGUAGE EXPLANATION</p>
      <h3 id={`meaning-${finding.id}`}>What this means</h3>
      <p className="meaning-summary">{finding.guidance.explanation}</p>
      <div className="impact-list">
        <article className="impact-item security"><span className="impact-icon" aria-hidden="true">S</span><div><strong>Security implications</strong><p>{finding.guidance.security}</p></div></article>
        <article className="impact-item customers"><span className="impact-icon" aria-hidden="true">C</span><div><strong>Customer impact</strong><p>{finding.guidance.customers}</p></div></article>
        <article className="impact-item reputation"><span className="impact-icon" aria-hidden="true">R</span><div><strong>Reputation potential</strong><p>{finding.guidance.reputation}</p></div></article>
      </div>
      <p className="impact-caveat"><strong>Potential impact, not recorded harm.</strong> {finding.guidance.caveat}</p>
      <div className="affected-pages">
        <p className="kicker">AFFECTED / EVIDENCE PAGES</p>
        {affectedLinks.length ? affectedLinks.map((link) => <a className="affected-page-link" href={link.url} target="_blank" rel="noreferrer" key={`${link.source}-${link.url}`}>
          <span>{link.label}</span><small>{displayAffectedUrl(link.url)}</small><em>{link.source === "recorded-evidence" ? "Confirmed evidence" : "Audit reference"} &#8599;</em>
        </a>) : <p className="no-affected-link">No single affected page is recorded for this environment; the issue may be site-wide or evidence-only.</p>}
      </div>
    </section>
    <div className="detail-section"><p className="kicker">RECOMMENDED ACTION</p><p>{finding.recommendation}</p></div>
    <form className="detail-form" onSubmit={onSubmit} key={`${finding.id}-${environment}`}>
      <input type="hidden" name="targetId" value={targetId} />
      <label>Status<select name="status" defaultValue={state?.status ?? "not_tested"} disabled={!canEdit || busy}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Owner<input name="owner" defaultValue={finding.owner ?? ""} placeholder="Assign owner" disabled={!canEdit || busy} /></label>
      <label>Acceptance criteria<textarea name="acceptanceCriteria" defaultValue={finding.acceptanceCriteria} rows={5} disabled={!canEdit || busy} /></label>
      <button className="primary full" disabled={!canEdit || busy}>{busy ? "Saving…" : "Save canonical state"}</button>
    </form>
    <p className="audit-stamp">Last environment update · {formatDate(state?.updatedAt)}</p>
  </div>;
}

function displayAffectedUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function EvidenceView({ data, siteId, siteTargetIds, staffQueue, reviewLinks, setReviewLinks, reviewSeverities, setReviewSeverities, reviewNotes, setReviewNotes, reportAssignments, setReportAssignments, bulkFindingIds, setBulkFindingIds, bulkConfirmations, setBulkConfirmations, onReview, onBulkReview, onStatus, busy, user, canReview }: {
  data: PlatformData;
  siteId: string;
  siteTargetIds: ReadonlySet<string>;
  staffQueue: Observation[];
  reviewLinks: Record<string, string>;
  setReviewLinks: (value: Record<string, string>) => void;
  reviewSeverities: Record<string, string>;
  setReviewSeverities: (value: Record<string, string>) => void;
  reviewNotes: Record<string, string>;
  setReviewNotes: (value: Record<string, string>) => void;
  reportAssignments: Record<string, string>;
  setReportAssignments: (value: Record<string, string>) => void;
  bulkFindingIds: Record<string, string>;
  setBulkFindingIds: (value: Record<string, string>) => void;
  bulkConfirmations: Record<string, boolean>;
  setBulkConfirmations: (value: Record<string, boolean>) => void;
  onReview: (observation: Observation, decision: ReviewDecision) => void;
  onBulkReview: (group: AutomatedGroup, decision: "link" | "reject") => void;
  onStatus: (observation: Observation, status: string) => void;
  busy: boolean;
  user: QualityUser;
  canReview: boolean;
}) {
  const activeFindings = data.findings.filter((finding) => finding.siteId === siteId && finding.scopeStatus === "active");
  const activeWorkflow = data.observations.filter((observation) => siteTargetIds.has(observation.targetId) && ["accepted", "supporting_evidence", "reproduced", "assigned", "fixed", "retested"].includes(observation.workflowStatus ?? ""));
  const automatedGroups = data.automatedGroups.filter((group) => siteTargetIds.has(group.targetId));
  const automatedCount = automatedGroups.reduce((total, group) => total + group.count, 0);
  const targetById = new Map(data.targets.map((target) => [target.id, target]));
  return <section className="evidence-layout">
    <div className="panel submission-panel staff-entry-card">
      <div className="panel-heading"><div><p className="kicker">SITE SCOUT STAFF REPORTING</p><h2>A dedicated path for people</h2><p>Staff reports remain separate from automated audit observations throughout triage and review.</p></div></div>
      <Link className="primary full staff-entry-link" href="/report">Open fast reporter</Link>
      <Link className="secondary-link" href="/my-reports">Open My Reports and notifications →</Link>
      <div className="queue-separation">
        <article><span>Staff</span><strong>{staffQueue.length}</strong><small>Awaiting human review</small></article>
        <article><span>Automated</span><strong>{automatedCount}</strong><small>Machine observations</small></article>
      </div>
      <div className="feature-boundary"><p><b>Identity</b> {data.features.identity.mode === "public-read-only-preview" ? "Public read-only preview" : "Named staff allowlist"}</p><p><b>Drafting</b> {data.features.assistance.mode === "openai-text-assist" ? "Optional text-only AI" : "Private local assistance"}</p><p><b>Approval</b> Always human</p><p><b>Tickets</b> Deferred until workflow stability</p></div>
    </div>

    <div className="review-column">
      <div className="operations-grid">
        <section className="panel pilot-measurement-panel">
          <div className="panel-heading"><div><p className="kicker">PILOT MEASUREMENT</p><h2>Workflow evidence</h2><p>Rates remain blank until enough human decisions exist.</p></div></div>
          <div className="pilot-metric-grid">
            <span><strong>{data.pilotMetrics.averageSubmissionSeconds === null ? "—" : `${data.pilotMetrics.averageSubmissionSeconds}s`}</strong><small>Average submission</small></span>
            <span><strong>{formatPercent(data.pilotMetrics.underTwentySecondsRate)}</strong><small>Under 20 seconds</small></span>
            <span><strong>{formatPercent(data.pilotMetrics.usefulReportRate)}</strong><small>Useful reports</small></span>
            <span><strong>{formatPercent(data.pilotMetrics.duplicateSupportRate)}</strong><small>Supporting evidence</small></span>
            <span><strong>{data.pilotMetrics.averageValidationHours === null ? "—" : `${data.pilotMetrics.averageValidationHours}h`}</strong><small>Validation time</small></span>
            <span><strong>{formatPercent(data.pilotMetrics.returningParticipationRate)}</strong><small>Returning reporters</small></span>
          </div>
          <p className="metric-sample">{data.pilotMetrics.totalReports} reports · {data.pilotMetrics.submissionSamples} timed submissions · {data.pilotMetrics.knownUsers} known pilot users</p>
        </section>
        <section className="panel privacy-operations-panel">
          <div className="panel-heading"><div><p className="kicker">PRIVACY OPERATIONS</p><h2>Retention dry run</h2><p>No evidence can be deleted while this policy remains in dry-run mode.</p></div><span className="dry-run-chip">DRY RUN</span></div>
          <div className="privacy-stats"><span><b>{data.privacy.totalAssets}</b>private assets</span><span><b>{data.privacy.eligibleAssets}</b>would expire</span><span><b>{data.privacy.protectedSecurityAssets}</b>security-protected</span><span><b>{formatBytes(data.privacy.trackedBytes)}</b>tracked</span></div>
          <p>Proposed standard retention: <b>{data.privacy.standardEvidenceRetentionDays} days</b>. Backup: <b>{data.privacy.backup.configured ? "configured" : "not configured"}</b>. Policy owner: <b>{data.privacy.privacyAdministrator}</b>.</p>
        </section>
      </div>
      <div className="panel review-panel staff-review-panel">
        <div className="panel-heading"><div><p className="kicker">STAFF REPORT QUEUE</p><h2>{staffQueue.length} awaiting human decision</h2><p>Duplicate suggestions are advisory. Validators make and own the canonical decision.</p></div><span className="queue-kind human">Human</span></div>
        {staffQueue.length ? staffQueue.slice(0, 20).map((observation) => {
          const selectedFinding = reviewLinks[observation.id] ?? observation.suggestedFindingId ?? "";
          return <article className="review-card staff-report-card" key={observation.id}>
            <div className="review-card-head"><span className="channel human">Staff report</span>{observation.privacyClassification === "restricted_security" ? <span className="security-restricted-chip">Restricted security</span> : null}<small>{formatDate(observation.createdAt)} · {observation.createdBy}</small></div>
            <h3>{observation.title}</h3><p>{observation.description}</p>
            {observation.evidence[0] ? <>
              {/* Evidence is served through an authenticated runtime route, so framework image optimisation cannot fetch it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl(observation.evidence[0])} alt={observation.evidence[0].caption} />
            </> : null}
            <div className="expected-actual"><p><b>Expected</b>{observation.expected}</p><p><b>Observed</b>{observation.actual}</p></div>
            {observation.messages?.length ? <div className="review-thread"><p className="kicker">REPORT CONVERSATION</p>{observation.messages.map((message) => <article key={message.id}><div><strong>{message.messageType === "information_request" ? "Validator request" : "Reporter response"}</strong><small>{formatDate(message.createdAt)}</small></div><p>{message.body}</p>{message.evidenceAssetId ? <a href={`/api/evidence/${message.evidenceAssetId}`} target="_blank" rel="noreferrer">Open attached evidence &#8599;</a> : null}</article>)}</div> : null}
            <label className="review-field">Possible canonical match<select value={selectedFinding} onChange={(event) => setReviewLinks({ ...reviewLinks, [observation.id]: event.target.value })}><option value="">No match selected</option>{activeFindings.map((finding) => <option key={finding.id} value={finding.id}>{finding.id} · {finding.title}</option>)}</select></label>
            <label className="review-field review-note">Validator note<textarea value={reviewNotes[observation.id] ?? ""} onChange={(event) => setReviewNotes({ ...reviewNotes, [observation.id]: event.target.value })} rows={2} maxLength={2000} placeholder="Required when requesting more information; otherwise retained with the decision." /></label>
            <div className="new-finding-row"><label>New finding severity<select value={reviewSeverities[observation.id] ?? "medium"} onChange={(event) => setReviewSeverities({ ...reviewSeverities, [observation.id]: event.target.value })}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><button disabled={!canReview || busy} onClick={() => onReview(observation, "accept_new")}>Accept as new finding</button></div>
            <div className="review-actions staff-actions"><button disabled={!canReview || busy || !selectedFinding} onClick={() => onReview(observation, "support")}>Link as supporting evidence</button><button className="needs-info" disabled={!canReview || busy || !(reviewNotes[observation.id]?.trim())} onClick={() => onReview(observation, "needs_info")}>Request more information</button><button className="reject" disabled={!canReview || busy} onClick={() => onReview(observation, "reject")}>Do not accept</button></div>
            {!canReview ? <p className="role-note">Visible to {roleLabel(user.role)}; only a Validator or Administrator can make the review decision.</p> : null}
          </article>;
        }) : <div className="empty positive">✓ Staff review queue is clear.</div>}
      </div>

      <div className="panel review-panel workflow-panel">
        <div className="panel-heading"><div><p className="kicker">ACCEPTED STAFF WORK</p><h2>{activeWorkflow.length} moving through correction</h2><p>Assignment, fix, re-test and closure each notify the original reporter.</p></div></div>
        {activeWorkflow.length ? activeWorkflow.slice(0, 20).map((observation) => {
          const status = observation.workflowStatus ?? "accepted";
          const next = nextWorkflowStatus(status);
          const needsAssignee = next === "assigned";
          const assignment = reportAssignments[observation.id] ?? observation.assignedTo ?? "";
          const permitted = next ? canMoveWorkflow(user.role, next) : false;
          return <article className="workflow-row" key={observation.id}><div><span className={`workflow-chip ${status}`}>{workflowLabel(status)}</span><small>{observation.findingId ?? "Canonical link pending"}</small></div><div><strong>{observation.title}</strong><small>Reported by {observation.createdBy}</small></div>{needsAssignee ? <input aria-label={`Assignee for ${observation.title}`} value={assignment} onChange={(event) => setReportAssignments({ ...reportAssignments, [observation.id]: event.target.value })} placeholder="Finding owner email or name" disabled={!permitted} /> : <span className="workflow-owner">{observation.assignedTo || "Unassigned"}</span>}{next ? <button disabled={busy || !permitted || (needsAssignee && !assignment.trim())} title={permitted ? undefined : `This step requires ${next === "fixed" ? "a Finding Owner" : "a Validator"}.`} onClick={() => onStatus(observation, next)}>{workflowAction(next)}</button> : null}</article>;
        }) : <div className="empty">No accepted staff reports are currently in correction.</div>}
      </div>

      <div className="panel review-panel automated-review-panel">
        <div className="panel-heading"><div><p className="kicker">AUTOMATED AUDIT QUEUE</p><h2>{automatedCount} observations in {automatedGroups.length} groups</h2><p>Groups are formed by exact rule, approved URL pattern and proposed canonical finding. Every bulk decision remains human-approved and individually traceable.</p></div><span className="queue-kind automated">Automated</span></div>
        {automatedGroups.length ? automatedGroups.map((group) => {
          const selectedFinding = bulkFindingIds[group.id] ?? group.proposedFindingId ?? "";
          return <article className="automated-group-card" key={group.id}>
            <div className="automated-group-head"><span className={`severity-badge ${group.severity}`}>{group.severity}</span><code>{group.ruleId}</code><strong>{group.count} observations</strong></div>
            <h3>{group.title}</h3><p>{group.environment} · {group.urlPattern} · {group.runCount} audit run{group.runCount === 1 ? "" : "s"}</p>
            <ul>{group.sampleUrls.map((url) => <li key={url}>{url}</li>)}</ul>
            <label className="review-field">Canonical finding<select value={selectedFinding} onChange={(event) => setBulkFindingIds({ ...bulkFindingIds, [group.id]: event.target.value })}><option value="">Select canonical finding</option>{activeFindings.map((finding) => <option key={finding.id} value={finding.id}>{finding.id} · {finding.title}</option>)}</select></label>
            {group.proposedFindingId ? <p className="contract-match">Contract mapping proposes {group.proposedFindingId}; a Validator must still approve it.</p> : <p className="contract-match unmapped">No contract mapping exists. Inspect the examples and choose deliberately.</p>}
            <label className="bulk-confirm"><input type="checkbox" checked={Boolean(bulkConfirmations[group.id])} onChange={(event) => setBulkConfirmations({ ...bulkConfirmations, [group.id]: event.target.checked })} /><span>I reviewed the rule, URL pattern and examples for this group.</span></label>
            <div className="review-actions"><button disabled={!canReview || busy || !bulkConfirmations[group.id] || !selectedFinding} onClick={() => onBulkReview(group, "link")}>Link up to 250</button><button className="reject" disabled={!canReview || busy || !bulkConfirmations[group.id]} onClick={() => onBulkReview(group, "reject")}>Reject up to 250</button></div>
          </article>;
        }) : <div className="empty positive">✓ Automated review queue is clear.</div>}
      </div>

      <div className="panel evidence-gallery">
        <div className="panel-heading"><div><p className="kicker">PRIVATE STAFF EVIDENCE</p><h2>Recent screenshots</h2></div></div>
        <div className="gallery-grid">{data.observations.filter((observation) => siteTargetIds.has(observation.targetId)).flatMap((observation) => observation.evidence.map((asset) => ({ asset, observation }))).slice(0, 8).map(({ asset, observation }) => <a key={asset.id} href={assetUrl(asset)} target="_blank" rel="noreferrer">
          {/* Evidence is served through an authenticated runtime route, so framework image optimisation cannot fetch it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl(asset)} alt={asset.caption} /><span><b>{observation.findingId ?? observation.suggestedFindingId ?? "Unlinked"} · {targetById.get(observation.targetId)?.environment ?? "unknown"}</b>{asset.caption}</span>
        </a>)}</div>
      </div>
    </div>
  </section>;
}

function BaselinesView({ data, siteTargetIds, currentBaselines, target, onImport, onPromote, busy, canEdit }: { data: PlatformData; siteTargetIds: ReadonlySet<string>; currentBaselines: Baseline[]; target?: Target; onImport: (event: FormEvent<HTMLFormElement>) => void; onPromote: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; canEdit: boolean }) {
  const eligibleRuns = data.runs.filter((run) => run.targetId === target?.id && run.status === "complete");
  const siteTargets = data.targets.filter((item) => siteTargetIds.has(item.id));
  const siteBaselines = data.baselines.filter((baseline) => siteTargetIds.has(baseline.targetId));
  const targetById = new Map(siteTargets.map((item) => [item.id, item]));
  return <section className="baseline-layout">
    <div className="panel baseline-panel">
      <div className="panel-heading"><div><p className="kicker">IMMUTABLE HISTORY</p><h2>Current baselines</h2><p>Promotion supersedes the pointer; it never deletes the previous version.</p></div></div>
      <div className="baseline-cards">{siteTargets.map((item) => {
        const baseline = currentBaselines.find((candidate) => candidate.targetId === item.id);
        return <article key={item.id}><span className={`env-tag ${item.environment}`}>{item.environment}</span><strong>Baseline v{baseline?.version ?? "—"}</strong><p>{baseline?.reason ?? "No baseline"}</p><small>{baseline ? `Approved by ${baseline.approvedBy} · ${formatDate(baseline.createdAt)}` : "Not established"}</small></article>;
      })}</div>
      <div className="history-table"><div className="history-head"><span>Environment</span><span>Version</span><span>Run</span><span>Approved</span><span>State</span></div>{siteBaselines.map((baseline) => <div key={baseline.id}><span>{targetById.get(baseline.targetId)?.environment ?? "Unknown"}</span><span>v{baseline.version}</span><span className="mono">{baseline.runId}</span><span>{formatDate(baseline.createdAt)}</span><span>{baseline.supersededAt ? "Historical" : "Current"}</span></div>)}</div>
    </div>
    <div className="baseline-tools">
      <form className="panel tool-card" onSubmit={onImport}><p className="kicker">1 · INGEST</p><h2>Import audit run</h2><p>Validated run JSON is archived to evidence storage; each finding enters review.</p><label className="file-compact"><input type="file" name="auditFile" accept="application/json,.json" required />Choose JSON run</label><button className="primary full" disabled={!canEdit || busy}>Import safely</button></form>
      <form className="panel tool-card" onSubmit={onPromote}><p className="kicker">2 · APPROVE</p><h2>Promote baseline</h2><label>Completed run<select name="runId" required defaultValue=""><option value="">Select run</option>{eligibleRuns.map((run) => <option key={run.id} value={run.id}>{formatDate(run.completedAt)} · {run.id}</option>)}</select></label><input type="hidden" name="targetId" value={target?.id ?? ""} /><label>Reason<textarea name="reason" rows={3} required placeholder="Why this run is accepted as the reference" /></label><button className="primary full" disabled={!canEdit || busy}>Promote version</button></form>
      <div className="panel tool-card activity-card"><p className="kicker">AUDIT TRAIL</p><h2>Recent changes</h2>{data.activity.slice(0, 7).map((entry) => <p key={entry.id}><span>{activityIcon(entry.eventType)}</span><b>{humanEvent(entry.eventType)}</b><small>{entry.actor} · {formatDate(entry.createdAt)}</small></p>)}</div>
    </div>
  </section>;
}

function MethodView({ data }: { data: PlatformData }) {
  return <section className="method-grid">
    <div className="method-hero panel"><p className="kicker light">SAFE BY CONSTRUCTION</p><h2>Observe deeply.<br />Change nothing.</h2><p>The audit worker is intentionally narrower than a general browser agent. Its boundaries are part of the evidence.</p><div className="code-line"><span>$</span> npm run audit:smoke -- --target your-site-staging</div></div>
    <div className="panel boundary-card"><p className="kicker">NETWORK BOUNDARY</p><h2>Exact targets only</h2><ul><li>HTTPS on port 443</li><li>Configured production or staging hostname</li><li>Explicitly approved path prefixes</li><li>Every redirect and DNS result revalidated</li><li>Private, loopback and reserved IP ranges rejected</li></ul></div>
    <div className="panel boundary-card"><p className="kicker">INTERACTION BOUNDARY</p><h2>Read-only behaviour</h2><ul><li>GET and HEAD only</li><li>No credentials or authenticated routes</li><li>No forms, checkout, uploads or state changes</li><li>Two concurrent requests at most</li><li>Explicit page, redirect and timeout caps</li></ul></div>
    <div className="panel boundary-card"><p className="kicker">EVIDENCE CONTRACT</p><h2>Comparable or clearly not</h2><ul><li>Ruleset and profile version recorded</li><li>Coverage and limitations travel with every run</li><li>Deltas withheld when profiles differ</li><li>Raw run archived before review</li><li>Human decisions remain attributable</li></ul></div>
    <div className="panel rule-card"><div><p className="kicker">AUTOMATED RULE PACK</p><h2>What the pilot can assert</h2></div><div className="rule-grid"><span><b>HTTP</b>Status, redirect boundary, content type</span><span><b>SEO</b>Title, description, canonical, language</span><span><b>A11Y</b>H1 structure and image alt presence</span><span><b>Security</b>CSP, HSTS, framing, sniffing, CORS</span><span><b>Scope</b>Every configured site retains its own finding register</span><span><b>Delta</b>New, persisting and resolved defects</span></div></div>
    <div className="panel limitation-card"><p className="kicker">HUMAN REVIEW REMAINS REQUIRED</p><h2>Automation cannot judge business truth</h2><p>Incorrect imagery, misleading language, visual hierarchy, usability and business meaning stay in the staff screenshot workflow. This is a deliberate limit, not a hidden gap.</p><div className="source-summary"><strong>{data.sourceAudit.coverage.browserScenarios}</strong><span>synthetic browser scenarios</span><strong>{data.observations.reduce((count, observation) => count + observation.evidence.length, 0)}</strong><span>private staff screenshots retained</span></div></div>
  </section>;
}

function Metric({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: string }) { return <div className={`metric ${tone}`}><span className="metric-icon" /><p>{label}</p><strong>{value.toString().padStart(2, "0")}</strong><small>{detail}</small></div>; }
function SeverityBadge({ severity }: { severity: string }) { return <span className={`severity-badge ${severity}`}>{severity}</span>; }
function StatusBadge({ status }: { status: string }) { return <span className={`status-badge ${status}`}><i />{statusLabels[status] ?? status}</span>; }
function EnvironmentBar({ label, counts, total }: { label: string; counts: Record<string, number>; total: number }) { const risk = (counts.open ?? 0) + (counts.regressed ?? 0); const denominator = Math.max(total, 1); return <div className="environment-bar"><div><strong>{label}</strong><span>{counts.resolved ?? 0} resolved · {risk} active</span></div><div className="stacked"><i className="resolved" style={{ width: `${((counts.resolved ?? 0) / denominator) * 100}%` }} /><i className="partial" style={{ width: `${((counts.partial ?? 0) / denominator) * 100}%` }} /><i className="open" style={{ width: `${(risk / denominator) * 100}%` }} /><i className="not_tested" style={{ width: `${((counts.not_tested ?? 0) / denominator) * 100}%` }} /></div></div>; }
function statusCount(findings: Finding[], environment: Environment) { return findings.reduce((result, finding) => { const status = finding.states[environment]?.status ?? "not_tested"; result[status] = (result[status] ?? 0) + 1; return result; }, {} as Record<string, number>); }
function formatDate(value?: string | null) { if (!value) return "Not recorded"; return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatPercent(value: number | null) { return value === null ? "—" : `${value}%`; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`; }
function initials(value: string) { return value.split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function assetUrl(asset: Asset) { return asset.publicUrl ?? `/api/evidence/${asset.id}`; }
function roleLabel(role: QualityUser["role"]) { if (role === "management_viewer") return "Management Viewer"; if (role === "security_reviewer") return "Security Reviewer"; return role === "finding_owner" ? "Finding Owner" : `${role[0].toUpperCase()}${role.slice(1)}`; }
function reviewSuccess(decision: ReviewDecision) {
  if (decision === "reject") return "The observation was not accepted and remains in the attributable audit trail.";
  if (decision === "accept_new") return "A new canonical finding was created and the reporter was notified.";
  if (decision === "support" || decision === "link") return "The observation was linked to the canonical finding and the reporter was notified where applicable.";
  if (decision === "needs_info") return "More information was requested from the reporter.";
  return "The review decision was recorded.";
}
function nextWorkflowStatus(status: string) { return ({ reproduced: "assigned", accepted: "assigned", supporting_evidence: "assigned", assigned: "fixed", fixed: "retested", retested: "closed" } as Record<string, string>)[status] ?? null; }
function workflowAction(status: string) { return ({ assigned: "Assign", fixed: "Mark fixed", retested: "Record re-test", closed: "Close report" } as Record<string, string>)[status] ?? `Move to ${status}`; }
function workflowLabel(status: string) { return ({ accepted: "Accepted", supporting_evidence: "Supporting evidence", reproduced: "Reproduced", assigned: "Assigned", fixed: "Fixed · awaiting re-test", retested: "Retested" } as Record<string, string>)[status] ?? status.replaceAll("_", " "); }
function canMoveWorkflow(role: QualityUser["role"], status: string) {
  if (role === "administrator") return true;
  if (status === "assigned") return role === "validator" || role === "finding_owner";
  if (status === "fixed") return role === "finding_owner";
  return role === "validator" && (status === "retested" || status === "closed");
}
function humanEvent(value: string) { return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function activityIcon(value: string) { return value.includes("baseline") ? "↗" : value.includes("review") ? "✓" : value.includes("audit") ? "◎" : "◇"; }
