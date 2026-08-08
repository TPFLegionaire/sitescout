import { env } from "cloudflare:workers";
import { QualityAuthError } from "@/app/auth";
import { normalizeRetentionDays, parseApprovedSecurityTargetIds, retentionDeadline } from "./security-config-core.mjs";

export function approvedSecurityTargetIds() {
  return parseApprovedSecurityTargetIds(env.QUALITY_SECURITY_IMPORT_TARGET_IDS ?? process.env.QUALITY_SECURITY_IMPORT_TARGET_IDS);
}

export function assertApprovedSecurityTarget(targetId: string) {
  if (!approvedSecurityTargetIds().has(targetId)) {
    throw new QualityAuthError("This registered target is not approved for disposable Strix evaluation imports.", 403);
  }
}

export function securityArtifactRetentionDays() {
  return normalizeRetentionDays(env.QUALITY_SECURITY_ARTIFACT_RETENTION_DAYS ?? process.env.QUALITY_SECURITY_ARTIFACT_RETENTION_DAYS, 30);
}

export function securityArtifactRetentionUntil(now: string) {
  return retentionDeadline(now, securityArtifactRetentionDays());
}
