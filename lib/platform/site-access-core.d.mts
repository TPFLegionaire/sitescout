export type SiteScopeUser = { email: string; role: string; identitySource: string };
export type SiteScopeAssignment = { email: string; organizationId: string; siteId: string; role: string; active: number };

export function isGlobalQualityAdministrator(user: Partial<SiteScopeUser> | null | undefined): boolean;
export function scopeAssignmentAllows(input: {
  user: Partial<SiteScopeUser> | null | undefined;
  assignment: Partial<SiteScopeAssignment> | null | undefined;
  organizationId: string;
  siteId: string;
}): boolean;
