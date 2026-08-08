/** Pure DataForSEO pilot contracts. No secrets, network access or target URLs. */

export const SEO_SOURCE = "dataforseo";
export const SEO_OPERATIONS = Object.freeze(["domain_overview", "ranked_keywords", "backlink_summary"]);
export const SEO_DEVICES = Object.freeze(["all"]);
export const DEFAULT_SEO_PROFILE = Object.freeze({ country: "gb", language: "en", device: "all", locationCode: 2826 });
export const ALLOWED_DATAFORSEO_ORIGINS = Object.freeze(["https://api.dataforseo.com", "https://sandbox.dataforseo.com"]);

export const SEO_OPERATION_COST_USD = Object.freeze({
  domain_overview: 0.02,
  ranked_keywords: 0.05,
  backlink_summary: 0.1,
});

export const DEFAULT_PER_OPERATION_CAP_USD = 1;
export const DEFAULT_MONTHLY_CAP_USD = 25;
export const MAX_SEO_ATTEMPTS = 2;
export const SEO_LEASE_MS = 2 * 60 * 1000;

export class SeoInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeoInputError";
    this.status = 400;
  }
}

export class SeoBudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeoBudgetError";
    this.status = 409;
  }
}

export class SeoProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SeoProviderError";
    this.status = 502;
    this.providerCode = Number.isInteger(details.providerCode) ? details.providerCode : null;
    this.providerReference = typeof details.providerReference === "string" ? details.providerReference : null;
    this.costActual = readNumber(details.costActual);
    this.raw = details.raw ?? null;
  }
}

export function isSeoOperation(value) {
  return typeof value === "string" && SEO_OPERATIONS.includes(value);
}

export function assertSeoOperation(value) {
  if (!isSeoOperation(value)) throw new SeoInputError(`Unsupported SEO operation. Choose one of: ${SEO_OPERATIONS.join(", ")}.`);
  return value;
}

/** Validate the single, server-controlled pilot profile. */
export function normalizeSeoProfile(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const country = String(source.country ?? DEFAULT_SEO_PROFILE.country).trim().toLowerCase();
  const language = String(source.language ?? DEFAULT_SEO_PROFILE.language).trim().toLowerCase();
  const device = String(source.device ?? DEFAULT_SEO_PROFILE.device).trim().toLowerCase();
  const locationCode = Number(source.locationCode ?? DEFAULT_SEO_PROFILE.locationCode);
  if (!/^[a-z]{2}$/.test(country)) throw new SeoInputError("SEO profile country must be a two-letter ISO code.");
  if (!/^[a-z]{2}$/.test(language)) throw new SeoInputError("SEO profile language must be a two-letter ISO code.");
  if (device !== "all") throw new SeoInputError("These DataForSEO operations do not support a device-specific profile; device must be all.");
  if (!Number.isInteger(locationCode) || locationCode <= 0 || locationCode > 999999) throw new SeoInputError("SEO profile location code must be a positive DataForSEO location code.");
  return { country, language, device: "all", locationCode };
}

/** Backlink summary is global; Labs operations use the fixed country/language profile. */
export function effectiveDimensions(operation, profile = DEFAULT_SEO_PROFILE) {
  const selected = assertSeoOperation(operation);
  if (selected === "backlink_summary") return { country: "global", language: "all", device: "all" };
  return normalizeSeoProfile(profile);
}

/** Backwards-compatible name used by display and test code. */
export function normalizeDimensions(input) {
  return normalizeSeoProfile(input);
}

export function resolveTargetDomain(target) {
  const host = String(target?.allowedHost ?? "").trim().toLowerCase();
  if (host) {
    if (!isDomain(host)) throw new SeoInputError("Registered target host is not a usable domain.");
    return host;
  }
  const base = String(target?.baseUrl ?? "").trim();
  if (base) {
    try {
      const parsed = new URL(base);
      if (parsed.protocol !== "https:" || !isDomain(parsed.hostname)) throw new Error("invalid");
      return parsed.hostname.toLowerCase();
    } catch {
      throw new SeoInputError("Registered target base URL is not a usable HTTPS domain.");
    }
  }
  throw new SeoInputError("Registered target has no host to resolve a domain from.");
}

export function buildProviderTask(operation, domain, profile = DEFAULT_SEO_PROFILE) {
  const selected = assertSeoOperation(operation);
  if (!isDomain(String(domain ?? "").toLowerCase())) throw new SeoInputError("Provider target must be an approved domain.");
  if (selected === "backlink_summary") return { target: String(domain).toLowerCase() };
  const normalized = normalizeSeoProfile(profile);
  return { target: String(domain).toLowerCase(), language_code: normalized.language, location_code: normalized.locationCode };
}

export function resolveDataForSeoBaseUrl(input) {
  const raw = String(input ?? ALLOWED_DATAFORSEO_ORIGINS[0]).trim() || ALLOWED_DATAFORSEO_ORIGINS[0];
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SeoInputError("DataForSEO base URL is invalid.");
  }
  if (
    !ALLOWED_DATAFORSEO_ORIGINS.includes(parsed.origin) ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new SeoInputError("DataForSEO base URL must be an approved API origin with no path, query, credentials or fragment.");
  }
  return parsed.origin;
}

export function estimateOperationCost(operation) {
  return SEO_OPERATION_COST_USD[operation] ?? Math.max(...Object.values(SEO_OPERATION_COST_USD));
}

export function assertWithinBudget({ estimate, perOperationCapUsd, monthlySpentUsd, monthlyCapUsd }) {
  const perOp = Number.isFinite(perOperationCapUsd) ? perOperationCapUsd : DEFAULT_PER_OPERATION_CAP_USD;
  const monthlyCap = Number.isFinite(monthlyCapUsd) ? monthlyCapUsd : DEFAULT_MONTHLY_CAP_USD;
  const spent = Number.isFinite(monthlySpentUsd) ? monthlySpentUsd : 0;
  if (estimate > perOp) throw new SeoBudgetError(`Estimated cost $${estimate.toFixed(2)} exceeds the per-operation cap $${perOp.toFixed(2)}.`);
  if (spent + estimate > monthlyCap) throw new SeoBudgetError(`This request would exceed the monthly SEO cap $${monthlyCap.toFixed(2)} (already committed $${spent.toFixed(2)}).`);
  return { perOperationCapUsd: perOp, monthlyCapUsd: monthlyCap, monthlySpentUsd: spent };
}

export function monthPrefix(isoTimestamp) {
  const value = String(isoTimestamp ?? "");
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "";
}

/** Client keys are only an optional suffix; they can never replace tenant scope. */
export function idempotencyInput({ organizationId, siteId, targetId, operation, dimensions, day, clientKey }) {
  const selected = assertSeoOperation(operation);
  const dims = effectiveDimensions(selected, dimensions);
  const normalizedDay = String(day ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDay)) throw new SeoInputError("Idempotency day must be an ISO date.");
  const scope = [SEO_SOURCE, organizationId, siteId, targetId, selected, dims.country, dims.language, dims.device, dims.locationCode ?? "global", normalizedDay]
    .map((part) => String(part ?? "").trim())
    .join("|");
  const optional = String(clientKey ?? "").trim();
  if (!optional) return scope;
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(optional)) throw new SeoInputError("Idempotency key contains unsupported characters.");
  return `${scope}|client:${optional}`;
}

/** Enforce DataForSEO's application-level success contract, not just HTTP 2xx. */
export function validateProviderEnvelope(raw) {
  const task = Array.isArray(raw?.tasks) ? raw.tasks[0] : null;
  const providerReference = typeof task?.id === "string" ? task.id : null;
  const costActual = readNumber(task?.cost) ?? readNumber(raw?.cost);
  const topCode = Number(raw?.status_code);
  const tasksError = Number(raw?.tasks_error);
  const taskCode = Number(task?.status_code);
  if (!raw || typeof raw !== "object" || topCode !== 20000 || tasksError !== 0 || !task || taskCode !== 20000) {
    const providerCode = Number.isInteger(taskCode) && taskCode !== 0 ? taskCode : Number.isInteger(topCode) ? topCode : null;
    throw new SeoProviderError("DataForSEO did not accept the requested operation.", { providerCode, providerReference, costActual, raw });
  }
  return { providerReference, costActual };
}

export function validateProviderScope(operation, raw, profile = DEFAULT_SEO_PROFILE) {
  const selected = assertSeoOperation(operation);
  if (selected === "backlink_summary") return;
  const expected = normalizeSeoProfile(profile);
  const task = Array.isArray(raw?.tasks) ? raw.tasks[0] : null;
  const data = task?.data;
  const providerReference = typeof task?.id === "string" ? task.id : null;
  const costActual = readNumber(task?.cost) ?? readNumber(raw?.cost);
  if (
    !data ||
    typeof data !== "object" ||
    Number(data.location_code) !== expected.locationCode ||
    String(data.language_code ?? "").toLowerCase() !== expected.language
  ) {
    throw new SeoProviderError("DataForSEO returned a response outside the configured country/language profile.", {
      providerReference,
      costActual,
      raw,
    });
  }
}

export function normalizeSnapshot(operation, raw, dimension = {}) {
  const result = raw?.tasks?.[0]?.result?.[0];
  const metrics = [];
  const limitations = [];

  if (result && typeof result === "object") {
    if (operation === "domain_overview") {
      const organic = result.metrics?.organic ?? {};
      pushMetric(metrics, "organic_keywords", readNumber(organic.count), dimension);
      pushMetric(metrics, "organic_traffic_estimate", readNumber(organic.etv), dimension);
      pushMetric(metrics, "organic_positions_top1", readNumber(organic.pos_1), dimension);
    } else if (operation === "ranked_keywords") {
      pushMetric(metrics, "ranked_keywords_total", readNumber(result.total_count), dimension);
      pushMetric(metrics, "ranked_keywords_returned", Array.isArray(result.items) ? result.items.length : null, dimension);
    } else if (operation === "backlink_summary") {
      pushMetric(metrics, "backlinks", readNumber(result.backlinks), dimension);
      pushMetric(metrics, "referring_domains", readNumber(result.referring_domains), dimension);
      pushMetric(metrics, "backlink_rank", readNumber(result.rank), dimension);
    }
  }

  const hasUsableData = metrics.length > 0;
  if (!hasUsableData) limitations.push("No usable data returned by the provider for this operation and profile. This is not evidence that the website is healthy.");
  return { hasUsableData, metrics, coverage: { operation, resultReturned: Boolean(result), metricCount: metrics.length }, limitations };
}

function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isDomain(value) {
  return /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function pushMetric(metrics, metricKey, value, dimension) {
  if (value === null || value === undefined) return;
  metrics.push({ metricKey, dimension, value });
}
