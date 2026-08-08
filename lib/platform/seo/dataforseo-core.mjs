/**
 * Direct SEO snapshot pilot — pure, provider-shaped logic.
 *
 * Reference implementation for the "Direct SEO snapshot MVP" (revised plan v2,
 * Phase 1). This module is intentionally source-specific (DataForSEO) and holds
 * no secrets, no HALO targets and no network code, so it is unit-testable with
 * `node --test`. The env-reading HTTP wrapper lives in `./dataforseo.ts`.
 *
 * Boundaries enforced here:
 * - only a fixed operation enum crosses into a provider request;
 * - dimensions are validated against small allowlists;
 * - cost is bounded BEFORE any request is dispatched;
 * - an idempotency key makes a repeat request non-billable;
 * - an empty provider response is reported as "no usable data", never health.
 */

export const SEO_SOURCE = "dataforseo";

/** The only SEO operations the pilot will dispatch. Free-form input is refused. */
export const SEO_OPERATIONS = Object.freeze(["domain_overview", "ranked_keywords", "backlink_summary"]);

export const SEO_DEVICES = Object.freeze(["desktop", "mobile"]);

/**
 * Conservative pre-dispatch cost estimates (USD) used only to bound spend
 * before a request is made. These are deliberate over-estimates and MUST be
 * reconciled against the live DataForSEO price list during Phase 1; `cost_actual`
 * records what the provider actually reports.
 */
export const SEO_OPERATION_COST_USD = Object.freeze({
  domain_overview: 0.02,
  ranked_keywords: 0.05,
  backlink_summary: 0.1,
});

/** Safe defaults if HALO has not yet configured caps. Phase 0 must set real values. */
export const DEFAULT_PER_OPERATION_CAP_USD = 1;
export const DEFAULT_MONTHLY_CAP_USD = 25;

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

export function isSeoOperation(value) {
  return typeof value === "string" && SEO_OPERATIONS.includes(value);
}

export function assertSeoOperation(value) {
  if (!isSeoOperation(value)) {
    throw new SeoInputError(`Unsupported SEO operation. Choose one of: ${SEO_OPERATIONS.join(", ")}.`);
  }
  return value;
}

/** Validate and canonicalise the agreed country/language/device profile. */
export function normalizeDimensions(input) {
  const source = input && typeof input === "object" ? input : {};
  const country = String(source.country ?? "").trim().toLowerCase();
  const language = String(source.language ?? "").trim().toLowerCase();
  const deviceRaw = String(source.device ?? "desktop").trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) throw new SeoInputError("Country must be a two-letter ISO code (for example gb).");
  if (!/^[a-z]{2}$/.test(language)) throw new SeoInputError("Language must be a two-letter ISO code (for example en).");
  const device = deviceRaw || "desktop";
  if (!SEO_DEVICES.includes(device)) throw new SeoInputError(`Device must be one of: ${SEO_DEVICES.join(", ")}.`);
  return { country, language, device };
}

/**
 * Derive the domain from an approved target record. The client never supplies a
 * URL: the domain comes only from the registered target's allowed host.
 */
export function resolveTargetDomain(target) {
  const host = String(target?.allowedHost ?? "").trim().toLowerCase();
  if (host) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new SeoInputError("Registered target host is not a usable domain.");
    return host;
  }
  const base = String(target?.baseUrl ?? "").trim();
  if (base) {
    try {
      return new URL(base).hostname.toLowerCase();
    } catch {
      throw new SeoInputError("Registered target base URL is not a usable domain.");
    }
  }
  throw new SeoInputError("Registered target has no host to resolve a domain from.");
}

export function estimateOperationCost(operation) {
  return SEO_OPERATION_COST_USD[operation] ?? Math.max(...Object.values(SEO_OPERATION_COST_USD));
}

/**
 * Fail closed if a single request exceeds the per-operation cap, or if it would
 * push the running monthly total past the monthly cap. Both caps are external to
 * any provider-side control.
 */
export function assertWithinBudget({ estimate, perOperationCapUsd, monthlySpentUsd, monthlyCapUsd }) {
  const perOp = Number.isFinite(perOperationCapUsd) ? perOperationCapUsd : DEFAULT_PER_OPERATION_CAP_USD;
  const monthlyCap = Number.isFinite(monthlyCapUsd) ? monthlyCapUsd : DEFAULT_MONTHLY_CAP_USD;
  const spent = Number.isFinite(monthlySpentUsd) ? monthlySpentUsd : 0;
  if (estimate > perOp) {
    throw new SeoBudgetError(`Estimated cost $${estimate.toFixed(2)} exceeds the per-operation cap $${perOp.toFixed(2)}.`);
  }
  if (spent + estimate > monthlyCap) {
    throw new SeoBudgetError(`This request would exceed the monthly SEO cap $${monthlyCap.toFixed(2)} (already spent $${spent.toFixed(2)}).`);
  }
  return { perOperationCapUsd: perOp, monthlyCapUsd: monthlyCap, monthlySpentUsd: spent };
}

/** Month bucket (YYYY-MM) used to sum spend for the monthly cap. */
export function monthPrefix(isoTimestamp) {
  const value = String(isoTimestamp ?? "");
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "";
}

/**
 * Canonical idempotency input. A repeat of the same target + operation + profile
 * on the same UTC day must not create a second billable request. The caller may
 * override with an explicit client key.
 */
export function idempotencyInput({ targetId, operation, dimensions, day, clientKey }) {
  if (clientKey) return `client:${String(clientKey).trim().slice(0, 200)}`;
  const dims = normalizeDimensions(dimensions);
  return [SEO_SOURCE, targetId, operation, dims.country, dims.language, dims.device, day].join("|");
}

function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Normalise a DataForSEO envelope into flat metrics. The extracted paths follow
 * DataForSEO's documented response shapes but MUST be confirmed against live
 * responses in Phase 1 — hence the defensive guards and the honest empty-result
 * semantics. An absent or empty result is a limitation, not a clean bill of health.
 */
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
  if (!hasUsableData) {
    limitations.push("No usable data returned by the provider for this operation and profile. This is not evidence that the website is healthy.");
  }

  return {
    hasUsableData,
    metrics,
    coverage: { operation, resultReturned: Boolean(result), metricCount: metrics.length },
    limitations,
  };
}

function pushMetric(metrics, metricKey, value, dimension) {
  if (value === null || value === undefined) return;
  metrics.push({ metricKey, dimension, value });
}
