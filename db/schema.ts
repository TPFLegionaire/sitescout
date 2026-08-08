import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const schemaMeta = sqliteTable("schema_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    productName: text("product_name").notNull().default("SiteScout"),
    brandLabel: text("brand_label").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_organizations_slug").on(table.slug)],
);

export const sites = sqliteTable(
  "sites",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_sites_organization_slug").on(table.organizationId, table.slug),
    index("idx_sites_organization_active").on(table.organizationId, table.active),
  ],
);

export const targets = sqliteTable(
  "targets",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    name: text("name").notNull(),
    environment: text("environment").notNull(),
    baseUrl: text("base_url").notNull(),
    allowedHost: text("allowed_host").notNull(),
    allowedPathPrefix: text("allowed_path_prefix").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_targets_site_environment").on(table.siteId, table.environment),
    index("idx_targets_site_active").on(table.siteId, table.active),
  ],
);

export const auditRuns = sqliteTable(
  "audit_runs",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id").notNull(),
    runType: text("run_type").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    rulesetVersion: text("ruleset_version").notNull(),
    profileVersion: text("profile_version").notNull(),
    browser: text("browser").notNull(),
    viewport: text("viewport").notNull(),
    locale: text("locale").notNull(),
    pageLimit: integer("page_limit").notNull(),
    pagesAttempted: integer("pages_attempted").notNull().default(0),
    pagesCompleted: integer("pages_completed").notNull().default(0),
    comparable: integer("comparable").notNull().default(1),
    comparisonReason: text("comparison_reason"),
    coverageJson: text("coverage_json").notNull(),
    limitationsJson: text("limitations_json").notNull(),
    triggeredBy: text("triggered_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_audit_runs_target_completed").on(table.targetId, table.completedAt),
    index("idx_audit_runs_status").on(table.status),
  ],
);

export const baselines = sqliteTable(
  "baselines",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id").notNull(),
    runId: text("run_id").notNull(),
    version: integer("version").notNull(),
    reason: text("reason").notNull(),
    approvedBy: text("approved_by").notNull(),
    createdAt: text("created_at").notNull(),
    supersededAt: text("superseded_at"),
  },
  (table) => [
    uniqueIndex("idx_baselines_target_version").on(table.targetId, table.version),
    index("idx_baselines_current").on(table.targetId, table.supersededAt),
  ],
);

export const findings = sqliteTable(
  "findings",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    displayKey: text("display_key").notNull(),
    title: text("title").notNull(),
    severity: text("severity").notNull(),
    category: text("category").notNull(),
    recommendation: text("recommendation").notNull(),
    acceptanceCriteria: text("acceptance_criteria").notNull().default(""),
    owner: text("owner"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_findings_site_display_key").on(table.siteId, table.displayKey),
    index("idx_findings_site_severity").on(table.siteId, table.severity),
  ],
);

export const findingStates = sqliteTable(
  "finding_states",
  {
    id: text("id").primaryKey(),
    findingId: text("finding_id").notNull(),
    targetId: text("target_id").notNull(),
    status: text("status").notNull(),
    delta: text("delta").notNull(),
    lastRunId: text("last_run_id").notNull(),
    currentEvidence: text("current_evidence").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_finding_states_pair").on(table.findingId, table.targetId),
    index("idx_finding_states_target_status").on(table.targetId, table.status),
  ],
);

export const observations = sqliteTable(
  "observations",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id").notNull(),
    runId: text("run_id"),
    findingId: text("finding_id"),
    suggestedFindingId: text("suggested_finding_id"),
    sourceChannel: text("source_channel").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    expected: text("expected").notNull().default(""),
    actual: text("actual").notNull().default(""),
    reviewStatus: text("review_status").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_observations_review").on(table.reviewStatus, table.createdAt),
    index("idx_observations_finding").on(table.findingId),
  ],
);

export const evidenceAssets = sqliteTable(
  "evidence_assets",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id").notNull(),
    kind: text("kind").notNull(),
    storageKey: text("storage_key"),
    publicUrl: text("public_url"),
    caption: text("caption").notNull(),
    privacyStatus: text("privacy_status").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_evidence_observation").on(table.observationId)],
);

export const reviewDecisions = sqliteTable(
  "review_decisions",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id").notNull(),
    decision: text("decision").notNull(),
    findingId: text("finding_id"),
    note: text("note").notNull().default(""),
    reviewer: text("reviewer").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_review_decisions_observation").on(table.observationId)],
);

export const qualityUsers = sqliteTable(
  "quality_users",
  {
    email: text("email").primaryKey(),
    userId: text("user_id").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull(),
    identitySource: text("identity_source").notNull().default("named-allowlist"),
    active: integer("active").notNull().default(1),
    lastSeenAt: text("last_seen_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_quality_users_role_active").on(table.role, table.active)],
);

export const qualityUserRoles = sqliteTable(
  "quality_user_roles",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    organizationId: text("organization_id").notNull(),
    siteId: text("site_id").notNull().default("*"),
    role: text("role").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_quality_user_roles_scope").on(table.email, table.organizationId, table.siteId, table.role),
    index("idx_quality_user_roles_email_active").on(table.email, table.active),
    index("idx_quality_user_roles_site_role").on(table.siteId, table.role, table.active),
  ],
);

export const staffReportWorkflow = sqliteTable(
  "staff_report_workflow",
  {
    observationId: text("observation_id").primaryKey(),
    status: text("status").notNull(),
    triageMethod: text("triage_method").notNull(),
    triageJson: text("triage_json").notNull(),
    duplicateFindingId: text("duplicate_finding_id"),
    assignedTo: text("assigned_to"),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_staff_report_status_updated").on(table.status, table.updatedAt),
    index("idx_staff_report_duplicate_finding").on(table.duplicateFindingId),
  ],
);

export const reportMessages = sqliteTable(
  "report_messages",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id").notNull(),
    authorEmail: text("author_email").notNull(),
    authorRole: text("author_role").notNull(),
    messageType: text("message_type").notNull(),
    body: text("body").notNull(),
    evidenceAssetId: text("evidence_asset_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_report_messages_observation_created").on(table.observationId, table.createdAt),
    index("idx_report_messages_author").on(table.authorEmail),
  ],
);

export const reportPrivacy = sqliteTable(
  "report_privacy",
  {
    observationId: text("observation_id").primaryKey(),
    classification: text("classification").notNull().default("standard"),
    legalHold: integer("legal_hold").notNull().default(0),
    policyVersion: text("policy_version").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_report_privacy_classification_hold").on(table.classification, table.legalHold)],
);

export const evidenceControls = sqliteTable(
  "evidence_controls",
  {
    assetId: text("asset_id").primaryKey(),
    observationId: text("observation_id").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    retentionUntil: text("retention_until"),
    legalHold: integer("legal_hold").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_evidence_controls_observation").on(table.observationId),
    index("idx_evidence_controls_retention").on(table.retentionUntil, table.legalHold),
  ],
);

export const pilotEvents = sqliteTable(
  "pilot_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    observationId: text("observation_id"),
    actorEmail: text("actor_email").notNull(),
    durationMs: integer("duration_ms"),
    detailJson: text("detail_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_pilot_events_type_created").on(table.eventType, table.createdAt),
    index("idx_pilot_events_actor").on(table.actorEmail),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientEmail: text("recipient_email").notNull(),
    eventType: text("event_type").notNull(),
    observationId: text("observation_id"),
    findingId: text("finding_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_notifications_recipient_read_created").on(table.recipientEmail, table.readAt, table.createdAt),
    index("idx_notifications_observation").on(table.observationId),
  ],
);

export const activityLog = sqliteTable(
  "activity_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actor: text("actor").notNull(),
    detailJson: text("detail_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_activity_created").on(table.createdAt)],
);

export const seoSnapshotRuns = sqliteTable(
  "seo_snapshot_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    siteId: text("site_id").notNull(),
    targetId: text("target_id").notNull(),
    source: text("source").notNull().default("dataforseo"),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    dimensionsJson: text("dimensions_json").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    costEstimate: real("cost_estimate").notNull().default(0),
    costActual: real("cost_actual"),
    costReserved: real("cost_reserved").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseExpiresAt: text("lease_expires_at"),
    providerDispatchedAt: text("provider_dispatched_at"),
    failureStage: text("failure_stage"),
    providerReference: text("provider_reference"),
    coverageJson: text("coverage_json").notNull(),
    limitationsJson: text("limitations_json").notNull(),
    artifactStorageKey: text("artifact_storage_key"),
    artifactSha256: text("artifact_sha256"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: text("requested_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("idx_seo_snapshot_runs_idempotency").on(table.idempotencyKey),
    index("idx_seo_snapshot_runs_site_requested").on(table.siteId, table.requestedAt),
    index("idx_seo_snapshot_runs_status").on(table.status, table.leaseExpiresAt, table.requestedAt),
  ],
);

export const seoSnapshotMetrics = sqliteTable(
  "seo_snapshot_metrics",
  {
    id: text("id").primaryKey(),
    snapshotRunId: text("snapshot_run_id").notNull(),
    metricKey: text("metric_key").notNull(),
    dimensionJson: text("dimension_json").notNull(),
    valueJson: text("value_json").notNull(),
    capturedAt: text("captured_at").notNull(),
  },
  (table) => [index("idx_seo_snapshot_metrics_run").on(table.snapshotRunId)],
);

export const securityImportRuns = sqliteTable(
  "security_import_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    siteId: text("site_id").notNull(),
    targetId: text("target_id").notNull(),
    source: text("source").notNull().default("strix"),
    sourceVersion: text("source_version"),
    targetLabel: text("target_label").notNull(),
    scanMode: text("scan_mode"),
    imageDigest: text("image_digest"),
    model: text("model"),
    status: text("status").notNull(),
    coverageJson: text("coverage_json").notNull(),
    limitationsJson: text("limitations_json").notNull(),
    artifactStorageKey: text("artifact_storage_key"),
    artifactSha256: text("artifact_sha256").notNull(),
    candidateCount: integer("candidate_count").notNull().default(0),
    importedBy: text("imported_by").notNull(),
    retentionUntil: text("retention_until").notNull(),
    legalHold: integer("legal_hold").notNull().default(0),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_security_import_runs_scope_sha").on(table.organizationId, table.targetId, table.artifactSha256),
    index("idx_security_import_runs_scope_created").on(table.organizationId, table.siteId, table.createdAt),
    index("idx_security_import_runs_retention").on(table.retentionUntil, table.legalHold, table.deletedAt),
  ],
);

export const securityCandidates = sqliteTable(
  "security_candidates",
  {
    id: text("id").primaryKey(),
    importRunId: text("import_run_id").notNull(),
    externalId: text("external_id").notNull().default(""),
    title: text("title").notNull(),
    severity: text("severity").notNull(),
    cwe: text("cwe").notNull().default(""),
    cvssVector: text("cvss_vector").notNull().default(""),
    endpoint: text("endpoint").notNull().default(""),
    method: text("method").notNull().default(""),
    summary: text("summary").notNull().default(""),
    remediation: text("remediation").notNull().default(""),
    fingerprint: text("fingerprint").notNull(),
    sanitizationStatus: text("sanitization_status").notNull().default("clean"),
    sanitizationFlagsJson: text("sanitization_flags_json").notNull().default("[]"),
    reviewStatus: text("review_status").notNull().default("pending"),
    firstReviewer: text("first_reviewer"),
    reviewedBy: text("reviewed_by"),
    secondCheckBy: text("second_check_by"),
    reviewNote: text("review_note"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_security_candidates_run").on(table.importRunId),
    index("idx_security_candidates_fingerprint").on(table.fingerprint),
    index("idx_security_candidates_review").on(table.reviewStatus),
    index("idx_security_candidates_sanitization").on(table.sanitizationStatus),
  ],
);

export const securityCandidateReviews = sqliteTable(
  "security_candidate_reviews",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id").notNull(),
    stage: text("stage").notNull(),
    decision: text("decision").notNull(),
    reviewerEmail: text("reviewer_email").notNull(),
    note: text("note").notNull().default(""),
    reviewMinutes: real("review_minutes"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_security_candidate_reviews_stage").on(table.candidateId, table.stage),
    index("idx_security_candidate_reviews_created").on(table.candidateId, table.createdAt),
  ],
);
