import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export type QualityIdentitySource = "cloudflare-access" | "local-pilot" | "local-test" | "public-preview";

export type AuthenticatedQualityUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
  identitySource: QualityIdentitySource;
};

export type QualityRole = "management_viewer" | "reporter" | "validator" | "finding_owner" | "security_reviewer" | "administrator";
export type QualityCapability = "submit_report" | "review_reports" | "manage_findings" | "manage_baselines" | "view_operator" | "review_security";
export type QualityUser = AuthenticatedQualityUser & { role: QualityRole; localPilot: boolean };

const roleCapabilities: Record<QualityRole, ReadonlySet<QualityCapability>> = {
  management_viewer: new Set(["view_operator"]),
  reporter: new Set(["submit_report"]),
  validator: new Set(["submit_report", "review_reports", "view_operator"]),
  finding_owner: new Set(["submit_report", "manage_findings", "view_operator"]),
  security_reviewer: new Set(["view_operator", "review_security"]),
  administrator: new Set(["submit_report", "review_reports", "manage_findings", "manage_baselines", "view_operator", "review_security"]),
};

const INTERNAL_ID_HEADER = "x-sitescout-authenticated-user-id";
const INTERNAL_EMAIL_HEADER = "x-sitescout-authenticated-user-email";
const INTERNAL_FULL_NAME_HEADER = "x-sitescout-authenticated-user-full-name";
const INTERNAL_SOURCE_HEADER = "x-sitescout-authenticated-user-source";
const TEST_ID_HEADER = "x-sitescout-test-user-id";
const TEST_EMAIL_HEADER = "x-sitescout-test-user-email";
const TEST_NAME_HEADER = "x-sitescout-test-user-name";

export async function getAuthenticatedQualityUser(): Promise<AuthenticatedQualityUser | null> {
  const requestHeaders = await headers();
  if (isCloudflareAccessDeployment()) {
    const userId = requestHeaders.get(INTERNAL_ID_HEADER);
    const email = requestHeaders.get(INTERNAL_EMAIL_HEADER);
    if (!userId || !email || requestHeaders.get(INTERNAL_SOURCE_HEADER) !== "cloudflare-access") return null;
    const fullName = requestHeaders.get(INTERNAL_FULL_NAME_HEADER)?.trim() || null;
    return { userId, displayName: fullName ?? email, email, fullName, identitySource: "cloudflare-access" };
  }

  if (isLocalTestMode() && process.env.NODE_ENV !== "production") {
    const userId = requestHeaders.get(TEST_ID_HEADER);
    const email = requestHeaders.get(TEST_EMAIL_HEADER);
    if (!userId || !email) return null;
    const fullName = requestHeaders.get(TEST_NAME_HEADER)?.trim() || null;
    return { userId, displayName: fullName ?? email, email, fullName, identitySource: "local-test" };
  }
  return null;
}

export async function getQualityUser(): Promise<QualityUser | null> {
  const authenticated = await getAuthenticatedQualityUser();
  if (authenticated) return configuredQualityUser(authenticated) ?? publicPreviewUser(authenticated);
  return publicPreviewUser(null) ?? localAdministrator();
}

export async function requireQualityUser(returnTo: string): Promise<QualityUser> {
  const user = await getQualityUser();
  if (user) return user;
  redirect(`/access-denied?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`);
}

export async function requireQualityRole(...roles: QualityRole[]): Promise<QualityUser> {
  const user = await getQualityUser();
  if (!user) throw new QualityAuthError("Authentication required", 401);
  if (!roles.includes(user.role)) throw new QualityAuthError("Your SiteScout role does not permit this action.", 403);
  return user;
}

export async function requireQualityCapability(capability: QualityCapability): Promise<QualityUser> {
  const user = await requireQualityRole("management_viewer", "reporter", "validator", "finding_owner", "security_reviewer", "administrator");
  if (!canQuality(user.role, capability)) throw new QualityAuthError("Your SiteScout role does not permit this action.", 403);
  return user;
}

export async function requireQualityOwner(): Promise<QualityUser> {
  return requireQualityRole("administrator");
}

export function canQuality(role: QualityRole, capability: QualityCapability) {
  return roleCapabilities[role].has(capability);
}

export function qualityRoleLabel(role: QualityRole) {
  if (role === "management_viewer") return "Management viewer";
  if (role === "security_reviewer") return "Security reviewer";
  return role === "finding_owner" ? "Finding owner" : `${role[0].toUpperCase()}${role.slice(1)}`;
}

export function isPublicDemoEnabled() {
  return (env.QUALITY_PUBLIC_DEMO ?? process.env.QUALITY_PUBLIC_DEMO)?.trim().toLowerCase() === "true";
}

export function isCloudflareAccessDeployment() {
  return authMode() === "cloudflare-access";
}

export function qualitySignOutPath() {
  return isCloudflareAccessDeployment() ? "/cdn-cgi/access/logout" : "/";
}

function configuredQualityUser(authenticated: AuthenticatedQualityUser): QualityUser | null {
  const role = configuredRole(authenticated.email);
  return role ? { ...authenticated, role, localPilot: false } : null;
}

function publicPreviewUser(authenticated: AuthenticatedQualityUser | null): QualityUser | null {
  if (!isPublicDemoEnabled()) return null;
  if (authenticated) return { ...authenticated, role: "management_viewer", localPilot: false };
  return {
    userId: "public-management-preview",
    displayName: "Management preview",
    email: "preview@sitescout.invalid",
    fullName: "Management preview",
    identitySource: "public-preview",
    role: "management_viewer",
    localPilot: false,
  };
}

function localAdministrator(): QualityUser | null {
  if (process.env.NODE_ENV === "production" || isLocalTestMode()) return null;
  return {
    userId: "local-pilot",
    displayName: "Local pilot",
    email: "local@sitescout.invalid",
    fullName: "Local pilot",
    identitySource: "local-pilot",
    role: "administrator",
    localPilot: true,
  };
}

function configuredRole(email: string): QualityRole | null {
  const normalized = email.trim().toLowerCase();
  const legacyOwner = configuredEmails(env.QUALITY_OWNER_EMAIL ?? process.env.QUALITY_OWNER_EMAIL);
  const administrators = configuredEmails(env.QUALITY_ADMIN_EMAILS ?? process.env.QUALITY_ADMIN_EMAILS);
  const validators = configuredEmails(env.QUALITY_VALIDATOR_EMAILS ?? process.env.QUALITY_VALIDATOR_EMAILS);
  const findingOwners = configuredEmails(env.QUALITY_FINDING_OWNER_EMAILS ?? process.env.QUALITY_FINDING_OWNER_EMAILS);
  const securityReviewers = configuredEmails(env.QUALITY_SECURITY_REVIEWER_EMAILS ?? process.env.QUALITY_SECURITY_REVIEWER_EMAILS);
  const reporters = configuredEmails(env.QUALITY_REPORTER_EMAILS ?? process.env.QUALITY_REPORTER_EMAILS);
  const managementViewers = configuredEmails(env.QUALITY_MANAGEMENT_VIEWER_EMAILS ?? process.env.QUALITY_MANAGEMENT_VIEWER_EMAILS);
  if (legacyOwner.has(normalized) || administrators.has(normalized)) return "administrator";
  if (validators.has(normalized)) return "validator";
  if (findingOwners.has(normalized)) return "finding_owner";
  if (securityReviewers.has(normalized)) return "security_reviewer";
  if (reporters.has(normalized)) return "reporter";
  if (managementViewers.has(normalized)) return "management_viewer";
  return null;
}

function configuredEmails(value: string | undefined) {
  return new Set((value ?? "").split(/[;,\s]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

function authMode() {
  return (env.QUALITY_AUTH_MODE ?? process.env.QUALITY_AUTH_MODE)?.trim().toLowerCase() ?? "";
}

function isLocalTestMode() {
  return authMode() === "local-test";
}

function safeRelativeReturnPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

export class QualityAuthError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
