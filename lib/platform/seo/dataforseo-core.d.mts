export type SeoOperation = "domain_overview" | "ranked_keywords" | "backlink_summary";
export type SeoDevice = "all";
export type SeoProfile = { country: string; language: string; device: SeoDevice; locationCode: number };
export type SeoDimensions = { country: string; language: string; device: SeoDevice; locationCode?: number };
export type SeoDimensionsInput = { country?: unknown; language?: unknown; device?: unknown; locationCode?: unknown };
export type SeoTargetRecord = { allowedHost?: string | null; baseUrl?: string | null };
export type SeoMetric = { metricKey: string; dimension: Record<string, unknown>; value: number };
export type SeoNormalizedSnapshot = { hasUsableData: boolean; metrics: SeoMetric[]; coverage: { operation: string; resultReturned: boolean; metricCount: number }; limitations: string[] };

export const SEO_SOURCE: "dataforseo";
export const SEO_OPERATIONS: readonly SeoOperation[];
export const SEO_DEVICES: readonly SeoDevice[];
export const DEFAULT_SEO_PROFILE: Readonly<SeoProfile>;
export const ALLOWED_DATAFORSEO_ORIGINS: readonly string[];
export const SEO_OPERATION_COST_USD: Readonly<Record<SeoOperation, number>>;
export const DEFAULT_PER_OPERATION_CAP_USD: number;
export const DEFAULT_MONTHLY_CAP_USD: number;
export const MAX_SEO_ATTEMPTS: number;
export const SEO_LEASE_MS: number;

export class SeoInputError extends Error { status: number; }
export class SeoBudgetError extends Error { status: number; }
export class SeoProviderError extends Error {
  constructor(message: string, details?: { providerCode?: number | null; providerReference?: string | null; costActual?: number | null; raw?: unknown });
  status: number;
  providerCode: number | null;
  providerReference: string | null;
  costActual: number | null;
  raw: unknown;
}

export function isSeoOperation(value: unknown): value is SeoOperation;
export function assertSeoOperation(value: unknown): SeoOperation;
export function normalizeSeoProfile(input?: SeoDimensionsInput): SeoProfile;
export function normalizeDimensions(input?: SeoDimensionsInput): SeoProfile;
export function effectiveDimensions(operation: SeoOperation, profile?: SeoDimensionsInput): SeoDimensions;
export function resolveTargetDomain(target: SeoTargetRecord): string;
export function buildProviderTask(operation: SeoOperation, domain: string, profile?: SeoDimensionsInput): Record<string, unknown>;
export function resolveDataForSeoBaseUrl(input?: unknown): string;
export function estimateOperationCost(operation: string): number;
export function assertWithinBudget(input: { estimate: number; perOperationCapUsd?: number; monthlySpentUsd?: number; monthlyCapUsd?: number }): { perOperationCapUsd: number; monthlyCapUsd: number; monthlySpentUsd: number };
export function monthPrefix(isoTimestamp: string): string;
export function idempotencyInput(input: { organizationId: string; siteId: string; targetId: string; operation: SeoOperation; dimensions: SeoDimensionsInput; day: string; clientKey?: string | null }): string;
export function validateProviderEnvelope(raw: unknown): { providerReference: string | null; costActual: number | null };
export function validateProviderScope(operation: SeoOperation, raw: unknown, profile?: SeoDimensionsInput): void;
export function normalizeSnapshot(operation: string, raw: unknown, dimension?: Record<string, unknown>): SeoNormalizedSnapshot;
