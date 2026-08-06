import type { JWTVerifyGetKey } from "jose";

export const CLOUDFLARE_ACCESS_AUTH_MODE: "cloudflare-access";

export class CloudflareAccessTokenError extends Error {
  code: string;
  constructor(message: string, code: string);
}

export function isCloudflareAccessMode(value: unknown): boolean;
export function normalizeCloudflareAccessTeamDomain(value: unknown): string;
export function verifyCloudflareAccessToken(
  token: unknown,
  options: { teamDomain: unknown; audience: unknown; jwks?: JWTVerifyGetKey },
): Promise<{ userId: string; email: string; displayName: string; fullName: string | null }>;
