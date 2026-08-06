import type { QualityUser } from "@/app/auth";
import auditScope from "@/config/audit-scope.json";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { aiAssistConfigured } from "./triage";
import type { TriageCandidate } from "./triage";
import { privacyPolicy } from "./privacy";

type DataRow = Record<string, unknown>;

export type StaffReportingData = {
  targets: Array<{ id: string; siteId: string; name: string; environment: string; baseUrl: string }>;
  assistance: { mode: string; screenshotsSentExternally: boolean; humanApprovalRequired: boolean };
  ticketing: { status: string; reason: string };
  privacy: { mode: string; policyVersion: string; securityReportsRestricted: boolean };
};

export type MyReportsData = {
  reports: Array<{
    id: string;
    targetId: string;
    findingId: string | null;
    url: string;
    title: string;
    description: string;
    workflowStatus: string;
    assignedTo: string | null;
    privacyClassification: string;
    createdAt: string;
    updatedAt: string | null;
    evidence: Array<{ id: string; caption: string; privacyStatus: string }>;
    messages: Array<{ id: string; authorEmail: string; authorRole: string; messageType: string; body: string; evidenceAssetId: string | null; createdAt: string }>;
  }>;
  notifications: Array<{
    id: string;
    eventType: string;
    observationId: string | null;
    findingId: string | null;
    title: string;
    body: string;
    readAt: string | null;
    createdAt: string;
  }>;
  unreadNotifications: number;
};

export async function recordQualityUser(user: QualityUser) {
  await ensureDatabase();
  const now = new Date().toISOString();
  await getD1().prepare(`
    INSERT INTO quality_users (email, user_id, display_name, role, identity_source, active, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id, display_name = excluded.display_name, role = excluded.role, identity_source = excluded.identity_source, active = 1, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
  `).bind(user.email.toLowerCase(), user.userId, user.displayName, user.role, user.identitySource, now, now, now).run();
}

export async function getTriageCandidates(siteId?: string): Promise<TriageCandidate[]> {
  await ensureDatabase();
  const excluded = new Set((auditScope.excludedFindings as Array<{ id: string }>).map((finding) => finding.id));
  const rows = siteId
    ? await getD1().prepare("SELECT id, title, category, recommendation FROM findings WHERE site_id = ? ORDER BY display_key").bind(siteId).all<TriageCandidate>()
    : await getD1().prepare("SELECT id, title, category, recommendation FROM findings ORDER BY site_id, display_key").all<TriageCandidate>();
  return rows.results.filter((finding) => !excluded.has(finding.id));
}

export async function getStaffReportingData(user: QualityUser): Promise<StaffReportingData> {
  await ensureDatabase();
  await recordQualityUser(user);
  const targets = await getD1().prepare("SELECT id, site_id AS siteId, name, environment, base_url AS baseUrl FROM targets WHERE active = 1 ORDER BY site_id, environment").all<DataRow>();
  return {
    targets: targets.results as StaffReportingData["targets"],
    assistance: {
      mode: aiAssistConfigured() ? "openai-text-assist" : "local-assist",
      screenshotsSentExternally: false,
      humanApprovalRequired: true,
    },
    ticketing: { status: "deferred", reason: "Developer-ticket publication remains disabled until the staff pilot workflow is accepted." },
    privacy: { mode: privacyPolicy.mode, policyVersion: privacyPolicy.version, securityReportsRestricted: true },
  };
}

export async function getMyReportsData(user: QualityUser): Promise<MyReportsData> {
  await ensureDatabase();
  await recordQualityUser(user);
  const d1 = getD1();
  const [reports, messages, evidence, notifications] = await Promise.all([
    d1.prepare(`
      SELECT o.id, o.target_id AS targetId, o.finding_id AS findingId, o.url, o.title, o.description, o.expected, o.actual, o.review_status AS reviewStatus, o.created_at AS createdAt,
             COALESCE(w.status, CASE o.review_status WHEN 'confirmed' THEN 'accepted' WHEN 'rejected' THEN 'rejected' ELSE 'submitted' END) AS workflowStatus,
             w.assigned_to AS assignedTo, w.updated_at AS updatedAt, COALESCE(p.classification, 'standard') AS privacyClassification
      FROM observations o
      LEFT JOIN staff_report_workflow w ON w.observation_id = o.id
      LEFT JOIN report_privacy p ON p.observation_id = o.id
      WHERE o.source_channel = 'human' AND LOWER(o.created_by) = LOWER(?)
      ORDER BY o.created_at DESC
      LIMIT 100
    `).bind(user.email).all<DataRow>(),
    d1.prepare(`
      SELECT m.id, m.observation_id AS observationId, m.author_email AS authorEmail, m.author_role AS authorRole,
             m.message_type AS messageType, m.body, m.evidence_asset_id AS evidenceAssetId, m.created_at AS createdAt
      FROM report_messages m
      JOIN observations o ON o.id = m.observation_id
      WHERE o.source_channel = 'human' AND LOWER(o.created_by) = LOWER(?)
      ORDER BY m.created_at ASC
    `).bind(user.email).all<DataRow>(),
    d1.prepare(`
      SELECT e.id, e.observation_id AS observationId, e.caption, e.privacy_status AS privacyStatus
      FROM evidence_assets e
      JOIN observations o ON o.id = e.observation_id
      WHERE o.source_channel = 'human' AND LOWER(o.created_by) = LOWER(?)
      ORDER BY e.created_at DESC
    `).bind(user.email).all<DataRow>(),
    d1.prepare(`
      SELECT id, event_type AS eventType, observation_id AS observationId, finding_id AS findingId, title, body, read_at AS readAt, created_at AS createdAt
      FROM notifications
      WHERE LOWER(recipient_email) = LOWER(?)
      ORDER BY created_at DESC
      LIMIT 100
    `).bind(user.email).all<DataRow>(),
  ]);
  const evidenceByReport = new Map<string, DataRow[]>();
  for (const asset of evidence.results) {
    const observationId = String(asset.observationId);
    evidenceByReport.set(observationId, [...(evidenceByReport.get(observationId) ?? []), asset]);
  }
  const messagesByReport = new Map<string, DataRow[]>();
  for (const message of messages.results) {
    const observationId = String(message.observationId);
    messagesByReport.set(observationId, [...(messagesByReport.get(observationId) ?? []), message]);
  }
  return {
    reports: reports.results.map((report) => ({ ...report, evidence: evidenceByReport.get(String(report.id)) ?? [], messages: messagesByReport.get(String(report.id)) ?? [] })) as MyReportsData["reports"],
    notifications: notifications.results as MyReportsData["notifications"],
    unreadNotifications: notifications.results.filter((notification) => !notification.readAt).length,
  };
}
