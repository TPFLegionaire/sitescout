import { canQuality, QualityAuthError } from "@/app/auth";
import type { QualityCapability, QualityUser } from "@/app/auth";
import { getD1 } from "@/db";
import { isGlobalQualityAdministrator } from "./site-access-core.mjs";

export function assertPrivateQualityIdentity(user: QualityUser) {
  if (user.identitySource === "public-preview") {
    throw new QualityAuthError("Authenticated staff access is required for this evidence.", 403);
  }
}

export async function requireSiteCapability(
  user: QualityUser,
  organizationId: string,
  siteId: string,
  capability: QualityCapability,
) {
  assertPrivateQualityIdentity(user);
  if (!canQuality(user.role, capability)) throw new QualityAuthError("Your SiteScout role does not permit this action.", 403);
  if (isGlobalQualityAdministrator(user)) return;

  const assignment = await getD1()
    .prepare(
      `SELECT id FROM quality_user_roles
       WHERE LOWER(email) = LOWER(?) AND organization_id = ? AND (site_id = ? OR site_id = '*')
         AND role = ? AND active = 1
       LIMIT 1`,
    )
    .bind(user.email, organizationId, siteId, user.role)
    .first<{ id: string }>();
  if (!assignment) throw new QualityAuthError("You do not have access to this website.", 403);
}
