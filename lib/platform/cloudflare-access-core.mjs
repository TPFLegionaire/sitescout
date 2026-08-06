import { createRemoteJWKSet, jwtVerify } from "jose";

const remoteKeySets = new Map();

export const CLOUDFLARE_ACCESS_AUTH_MODE = "cloudflare-access";

export class CloudflareAccessTokenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CloudflareAccessTokenError";
    this.code = code;
  }
}

export function isCloudflareAccessMode(value) {
  return String(value ?? "").trim().toLowerCase() === CLOUDFLARE_ACCESS_AUTH_MODE;
}

export function normalizeCloudflareAccessTeamDomain(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate) throw new CloudflareAccessTokenError("Cloudflare Access team domain is missing.", "missing_team_domain");

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new CloudflareAccessTokenError("Cloudflare Access team domain is invalid.", "invalid_team_domain");
  }

  const validHostname = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/i.test(url.hostname);
  if (
    url.protocol !== "https:" ||
    !validHostname ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new CloudflareAccessTokenError("Cloudflare Access team domain is invalid.", "invalid_team_domain");
  }

  return url.origin.toLowerCase();
}

function normalizeAudience(value) {
  const audience = String(value ?? "").trim();
  if (!audience || audience.length > 512 || /\s/.test(audience)) {
    throw new CloudflareAccessTokenError("Cloudflare Access audience is invalid.", "invalid_audience");
  }
  return audience;
}

function remoteKeySet(teamDomain) {
  let keySet = remoteKeySets.get(teamDomain);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    remoteKeySets.set(teamDomain, keySet);
  }
  return keySet;
}

function normalizedEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export async function verifyCloudflareAccessToken(token, options) {
  if (typeof token !== "string" || !token.trim()) {
    throw new CloudflareAccessTokenError("Cloudflare Access token is missing.", "missing_token");
  }

  const teamDomain = normalizeCloudflareAccessTeamDomain(options?.teamDomain);
  const audience = normalizeAudience(options?.audience);
  const { payload } = await jwtVerify(token, options?.jwks ?? remoteKeySet(teamDomain), {
    issuer: teamDomain,
    audience,
    algorithms: ["RS256"],
  });

  const email = normalizedEmail(payload.email);
  if (!email) throw new CloudflareAccessTokenError("Cloudflare Access token has no valid email claim.", "missing_email");

  const subject = typeof payload.sub === "string" && payload.sub.trim() ? payload.sub.trim() : email;
  const fullName = typeof payload.name === "string" && payload.name.trim() && payload.name.length <= 200
    ? payload.name.trim()
    : null;

  return {
    userId: `cloudflare-access:${subject}`,
    email,
    displayName: fullName ?? email,
    fullName,
  };
}
