import { env } from "cloudflare:workers";
import {
  DEFAULT_MONTHLY_CAP_USD,
  DEFAULT_PER_OPERATION_CAP_USD,
  SeoProviderError,
  buildProviderTask,
  normalizeSeoProfile,
  resolveDataForSeoBaseUrl,
  validateProviderEnvelope,
  validateProviderScope,
} from "./dataforseo-core.mjs";
import type { SeoOperation, SeoProfile } from "./dataforseo-core.mjs";

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

export function configuredSeoProfile(): SeoProfile {
  return normalizeSeoProfile({
    country: env.QUALITY_SEO_COUNTRY,
    language: env.QUALITY_SEO_LANGUAGE,
    device: "all",
    locationCode: env.QUALITY_SEO_LOCATION_CODE,
  });
}

export async function fetchDataForSeoSnapshot(
  operation: SeoOperation,
  domain: string,
  profile: SeoProfile,
  options: { timeoutMs?: number } = {},
) {
  const base = resolveDataForSeoBaseUrl(env.DATAFORSEO_BASE_URL);
  const login = env.DATAFORSEO_LOGIN?.trim() ?? "";
  const password = env.DATAFORSEO_PASSWORD?.trim() ?? "";
  if (!login || !password) throw new SeoProviderError("DataForSEO credentials are not configured.");
  const authorization = `Basic ${btoa(`${login}:${password}`)}`;
  const timeoutMs = options.timeoutMs ?? 20000;
  const task = buildProviderTask(operation, domain, profile);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`SEO request timed out after ${timeoutMs}ms`)), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${base}${OPERATION_ENDPOINTS[operation]}`, {
      method: "POST",
      signal: controller.signal,
      redirect: "error",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify([task]),
    });
  } catch {
    if (controller.signal.aborted) throw new SeoProviderError(`DataForSEO request timed out after ${timeoutMs}ms.`);
    throw new SeoProviderError("DataForSEO could not be reached.", { raw: null });
  } finally {
    clearTimeout(timer);
  }

  const responseText = await response.text();
  if (responseText.length > 5_000_000) throw new SeoProviderError("DataForSEO returned an oversized response.");
  let raw: unknown;
  try {
    raw = JSON.parse(responseText);
  } catch {
    throw new SeoProviderError("DataForSEO returned an invalid JSON response.");
  }
  if (!response.ok) throw new SeoProviderError(`DataForSEO returned HTTP ${response.status}.`, { raw });
  const { providerReference, costActual } = validateProviderEnvelope(raw);
  validateProviderScope(operation, raw, profile);
  return { raw, providerReference, costActual };
}
