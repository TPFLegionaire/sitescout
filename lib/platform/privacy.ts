import privacyPolicyConfig from "@/config/privacy-policy.json";

export type ReportClassification = "standard" | "restricted_security";

export const privacyPolicy = privacyPolicyConfig;

export function reportClassification(value: unknown): ReportClassification {
  return value === "true" || value === true || value === "restricted_security" ? "restricted_security" : "standard";
}

export function evidenceRetentionUntil(classification: ReportClassification, createdAt: string) {
  const days = classification === "restricted_security" ? privacyPolicy.securityEvidenceRetentionDays : privacyPolicy.standardEvidenceRetentionDays;
  if (days === null) return null;
  const date = new Date(createdAt);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function privacyPreview(rows: Array<{ createdAt: string; classification?: string | null; legalHold?: number | null; retentionUntil?: string | null; sizeBytes?: number | null }>) {
  const now = Date.now();
  let eligibleAssets = 0;
  let protectedSecurityAssets = 0;
  let heldAssets = 0;
  let trackedBytes = 0;
  let unknownSizeAssets = 0;
  for (const row of rows) {
    const classification = row.classification === "restricted_security" ? "restricted_security" : "standard";
    if (row.legalHold) heldAssets += 1;
    if (classification === "restricted_security") protectedSecurityAssets += 1;
    if (typeof row.sizeBytes === "number") trackedBytes += row.sizeBytes; else unknownSizeAssets += 1;
    const retentionUntil = row.retentionUntil ?? evidenceRetentionUntil(classification, row.createdAt);
    if (classification === "standard" && !row.legalHold && retentionUntil && Date.parse(retentionUntil) <= now) eligibleAssets += 1;
  }
  return {
    policyVersion: privacyPolicy.version,
    mode: privacyPolicy.mode,
    standardEvidenceRetentionDays: privacyPolicy.standardEvidenceRetentionDays,
    securityEvidenceRetentionDays: privacyPolicy.securityEvidenceRetentionDays,
    maxEvidenceAssetsPerReport: privacyPolicy.maxEvidenceAssetsPerReport,
    maxEvidenceBytesPerReport: privacyPolicy.maxEvidenceBytesPerReport,
    privacyAdministrator: privacyPolicy.privacyAdministrator,
    securityEscalationOwner: privacyPolicy.securityEscalationOwner,
    backup: privacyPolicy.backup,
    totalAssets: rows.length,
    eligibleAssets,
    protectedSecurityAssets,
    heldAssets,
    trackedBytes,
    unknownSizeAssets,
    deletionEnabled: false,
  };
}
