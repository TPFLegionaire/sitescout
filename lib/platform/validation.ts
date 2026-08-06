export const validSeverities = ["critical", "high", "medium", "low"] as const;
export const validStatuses = ["open", "partial", "resolved", "regressed", "not_tested"] as const;

export function requiredText(value: unknown, label: string, maxLength = 4000) {
  if (typeof value !== "string" || !value.trim()) throw new InputError(`${label} is required.`);
  if (value.trim().length > maxLength) throw new InputError(`${label} exceeds ${maxLength} characters.`);
  return value.trim();
}

export function optionalText(value: unknown, maxLength = 4000) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) throw new InputError(`Invalid text value.`);
  return value.trim();
}

export function assertTargetUrl(value: unknown, target: { allowedHost: string; allowedPathPrefix: string }) {
  const raw = requiredText(value, "URL", 2048);
  let url: URL;
  try { url = new URL(raw); } catch { throw new InputError("URL is invalid."); }
  if (url.protocol !== "https:") throw new InputError("Only HTTPS evidence URLs are accepted.");
  if (url.username || url.password || (url.port && url.port !== "443")) throw new InputError("URL credentials and non-standard ports are not accepted.");
  if (url.hostname.toLowerCase() !== target.allowedHost.toLowerCase()) throw new InputError("URL does not belong to the selected environment.");
  if (!pathWithinPrefix(url.pathname, target.allowedPathPrefix)) throw new InputError("URL path is outside the approved target scope.");
  url.hash = "";
  return url.href;
}

export function pathWithinPrefix(pathname: string, prefix: string) {
  if (prefix === "/") return pathname.startsWith("/");
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return pathname === normalized || pathname.startsWith(`${normalized}/`);
}

export class InputError extends Error {
  status = 400;
}

export function apiError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (status >= 500) console.error("Quality platform API error", error);
  return Response.json({ ok: false, error: status >= 500 ? "Unexpected server error." : message }, { status, headers: { "cache-control": "no-store" } });
}
