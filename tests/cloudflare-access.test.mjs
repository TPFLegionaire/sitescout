import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  isCloudflareAccessMode,
  normalizeCloudflareAccessTeamDomain,
  verifyCloudflareAccessToken,
} from "../lib/platform/cloudflare-access-core.mjs";

const issuer = "https://sitescout-health.cloudflareaccess.com";
const audience = "sitescout-audience-test";

async function signedAccessToken(overrides = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { kid: "sitescout-test-key", alg: "RS256", use: "sig" });
  const payload = {
    email: "Reporter.One@Example.com",
    name: "Reporter One",
    ...overrides,
  };
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "sitescout-test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("access-user-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, jwks: createLocalJWKSet({ keys: [publicJwk] }) };
}

test("Cloudflare Access mode and team-domain validation are strict", () => {
  assert.equal(isCloudflareAccessMode(" cloudflare-access "), true);
  assert.equal(isCloudflareAccessMode("sites"), false);
  assert.equal(normalizeCloudflareAccessTeamDomain(`${issuer}/`), issuer);
  assert.throws(() => normalizeCloudflareAccessTeamDomain("http://sitescout-health.cloudflareaccess.com"), /invalid/i);
  assert.throws(() => normalizeCloudflareAccessTeamDomain("https://example.com"), /invalid/i);
});

test("a valid Access JWT yields a normalized, attributable identity", async () => {
  const { token, jwks } = await signedAccessToken();
  const identity = await verifyCloudflareAccessToken(token, { teamDomain: issuer, audience, jwks });
  assert.deepEqual(identity, {
    userId: "cloudflare-access:access-user-1",
    email: "reporter.one@example.com",
    displayName: "Reporter One",
    fullName: "Reporter One",
  });
});

test("Access JWT validation rejects the wrong application audience and missing email", async () => {
  const valid = await signedAccessToken();
  await assert.rejects(
    verifyCloudflareAccessToken(valid.token, { teamDomain: issuer, audience: "wrong-audience", jwks: valid.jwks }),
  );

  const missingEmail = await signedAccessToken({ email: undefined });
  await assert.rejects(
    verifyCloudflareAccessToken(missingEmail.token, { teamDomain: issuer, audience, jwks: missingEmail.jwks }),
    /email claim/i,
  );
});
