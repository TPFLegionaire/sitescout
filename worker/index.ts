/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { isCloudflareAccessMode, verifyCloudflareAccessToken } from "../lib/platform/cloudflare-access-core.mjs";
import { contentSecurityPolicy, isCrossOriginWrite } from "../lib/platform/request-guard-core.mjs";
import { purgeExpiredSecurityArtifacts } from "../lib/platform/security/security-retention";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  EVIDENCE: R2Bucket;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  QUALITY_AUTH_MODE?: string;
  QUALITY_CF_ACCESS_TEAM_DOMAIN?: string;
  QUALITY_CF_ACCESS_AUD?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const INTERNAL_ID_HEADER = "x-sitescout-authenticated-user-id";
const INTERNAL_EMAIL_HEADER = "x-sitescout-authenticated-user-email";
const INTERNAL_FULL_NAME_HEADER = "x-sitescout-authenticated-user-full-name";
const INTERNAL_SOURCE_HEADER = "x-sitescout-authenticated-user-source";
// Report-only until the policy has been observed clean on the deployment.
const CSP_HEADER = "content-security-policy-report-only";

function secureResponse(response: Response, url: URL, policy: string) {
  const headers = new Headers(response.headers);
  headers.set(CSP_HEADER, policy);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  if (url.protocol === "https:") headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function authenticationFailure(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

async function requestWithVerifiedIdentity(request: Request, env: Env): Promise<Request | Response> {
  const requestHeaders = new Headers(request.headers);
  for (const header of [INTERNAL_ID_HEADER, INTERNAL_EMAIL_HEADER, INTERNAL_FULL_NAME_HEADER, INTERNAL_SOURCE_HEADER]) {
    requestHeaders.delete(header);
  }

  if (!isCloudflareAccessMode(env.QUALITY_AUTH_MODE)) {
    return new Request(request, { headers: requestHeaders });
  }

  if (!env.QUALITY_CF_ACCESS_TEAM_DOMAIN?.trim() || !env.QUALITY_CF_ACCESS_AUD?.trim()) {
    console.error("SiteScout Cloudflare Access configuration is incomplete.");
    return authenticationFailure(503, "SiteScout authentication is not configured.");
  }

  const token = requestHeaders.get("cf-access-jwt-assertion");
  if (!token) return authenticationFailure(401, "Authentication required.");

  try {
    const identity = await verifyCloudflareAccessToken(token, {
      teamDomain: env.QUALITY_CF_ACCESS_TEAM_DOMAIN,
      audience: env.QUALITY_CF_ACCESS_AUD,
    });
    requestHeaders.set(INTERNAL_ID_HEADER, identity.userId);
    requestHeaders.set(INTERNAL_EMAIL_HEADER, identity.email);
    requestHeaders.set(INTERNAL_SOURCE_HEADER, "cloudflare-access");
    if (identity.fullName) requestHeaders.set(INTERNAL_FULL_NAME_HEADER, identity.fullName);
    return new Request(request, { headers: requestHeaders });
  } catch (error) {
    console.error("SiteScout rejected an invalid Cloudflare Access token.", error instanceof Error ? error.message : "Unknown error");
    return authenticationFailure(403, "Authentication could not be verified.");
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // React and Vite evaluate strings on a development server only; any other build stays strict.
    const policy = contentSecurityPolicy(crypto.randomUUID().replace(/-/g, ""), { allowEval: process.env.NODE_ENV === "development" });
    if (isCrossOriginWrite({ method: request.method, url: request.url, origin: request.headers.get("origin"), secFetchSite: request.headers.get("sec-fetch-site") })) {
      console.warn("SiteScout rejected a cross-origin write.", request.method, url.pathname);
      return secureResponse(Response.json({ ok: false, error: "Cross-origin request rejected." }, { status: 403, headers: { "cache-control": "no-store" } }), url, policy);
    }

    // vinext stamps its inline scripts with the nonce it finds in these request headers.
    const policyHeaders = new Headers(request.headers);
    policyHeaders.delete("content-security-policy");
    policyHeaders.set(CSP_HEADER, policy);
    const authenticatedRequest = await requestWithVerifiedIdentity(new Request(request, { headers: policyHeaders }), env);
    if (authenticatedRequest instanceof Response) return secureResponse(authenticatedRequest, url, policy);

    if (url.pathname === "/_vinext/image") {
      if (!env.IMAGES) return secureResponse(new Response("Image transformation is unavailable.", { status: 404 }), url, policy);
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(authenticatedRequest, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, authenticatedRequest.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES!.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return secureResponse(response, url, policy);
    }

    const response = await handler.fetch(authenticatedRequest, env, ctx);
    return secureResponse(response, url, policy);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      purgeExpiredSecurityArtifacts(env.DB, env.EVIDENCE, { actor: "system:security-retention", limit: 250 }).then((result) => {
        console.log("SiteScout security artifact retention completed", result);
      }),
    );
  },
};

export default worker;
