import { env } from "cloudflare:workers";
import { DEFAULT_MONTHLY_CAP_USD, DEFAULT_PER_OPERATION_CAP_USD } from "./dataforseo-core.mjs";
import type { SeoDimensions, SeoOperation } from "./dataforseo-core.mjs";

const DEFAULT_BASE_URL = "https://api.dataforseo.com";

/**
 * DataForSEO endpoints per pilot operation. The exact request parameters
 * (location codes, device handling) must be confirmed against the live
 * DataForSEO API in Phase 1; this wrapper sends a minimal, honest task body
 * rather than fabricating provider-specific fields.
 */
const OPERATION_ENDPOINTS: Record<SeoOperation, string> = {
  domain_overview: "/v3/dataforseo_labs/google/domain_rank_overview/live",
  ranked_keywords: "/v3/dataforseo_labs/google/ranked_keywords/live",
  backlink_summary: "/v3/backlinks/summary/live",
};

export function seoEnabled() {
  return (env.QUALITY_SEO_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function seoConfigured() {
  return seoEnabled() && Boolean(env.DATAFORSEO_LOGIN?.trim()) && Boolean(env.DATAFORSEO_PASSWORD?.trim());
}

export function perOperationCapUsd() {
  const value = Number(env.QUALITY_SEO_PER_OPERATION_CAP_USD);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PER_OPERATION_CAP_USD;
}

export function monthlyCapUsd() {
  const value = Number(env.QUALITY_SEO_MONTHLY_CAP_USD);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MONTHLY_CAP_USD;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchDataForSeoSnapshot(
  operation: SeoOperation,
  domain: string,
  dimensions: SeoDimensions,
  options: { timeoutMs?: number } = {},
) {
  const base = (env.DATAFORSEO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const login = env.DATAFORSEO_LOGIN?.trim() ?? "";
  const password = env.DATAFORSEO_PASSWORD?.trim() ?? "";
  const authorization = `Basic ${btoa(`${login}:${password}`)}`;
  const timeoutMs = options.timeoutMs ?? 20000;

  // Minimal, provider-shaped task body. Location precision and device targeting
  // are Phase-1 live-integration details and are intentionally not faked here.
  const task: Record<string, unknown> = { target: domain, language_code: dimensions.language };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`SEO request timed out after ${timeoutMs}ms`)), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${base}${OPERATION_ENDPOINTS[operation]}`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify([task]),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw Object.assign(new Error(`DataForSEO returned ${response.status}`), { status: 502 });

  const raw = (await response.json()) as { tasks?: Array<{ id?: unknown }>; cost?: unknown };
  const providerReference = typeof raw.tasks?.[0]?.id === "string" ? raw.tasks[0].id : null;
  const costActual = readNumber(raw.cost);
  return { raw, providerReference, costActual };
}
