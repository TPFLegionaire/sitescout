/** Pure helpers for fail-closed organisation/site access checks. */

export function isGlobalQualityAdministrator(user) {
  return Boolean(user && user.role === "administrator" && user.identitySource !== "public-preview");
}

export function scopeAssignmentAllows({ user, assignment, organizationId, siteId }) {
  if (!user || user.identitySource === "public-preview" || !assignment || Number(assignment.active) !== 1) return false;
  const email = String(user.email ?? "").trim().toLowerCase();
  const assignmentEmail = String(assignment.email ?? "").trim().toLowerCase();
  return Boolean(
    email &&
      email === assignmentEmail &&
      String(assignment.organizationId ?? "") === String(organizationId ?? "") &&
      (String(assignment.siteId ?? "") === String(siteId ?? "") || String(assignment.siteId ?? "") === "*") &&
      String(assignment.role ?? "") === String(user.role ?? ""),
  );
}
