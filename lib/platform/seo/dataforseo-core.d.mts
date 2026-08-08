export type SeoOperation = "domain_overview" | "ranked_keywords" | "backlink_summary";
export type SeoDevice = "desktop" | "mobile";

export type SeoDimensions = { country: string; language: string; device: SeoDevice };
export type SeoDimensionsInput = { country?: unknown; language?: unknown; device?: unknown };

export type SeoTargetRecord = { allowedHost?: string | null; baseUrl?: string | null };

export type SeoMetric = { metricKey: string; dimension: Record<string, unknown>; value: number };
export type SeoNormalizedSnapshot = {
  hasUsableData: boolean;
  metrics: SeoMetric[];
  coverage: { operation: string; resultReturned: boolean; metricCount: number };
  limitations: string[];
};

export type SeoBudgetInput = {
  estimate: number;
  perOperationCapUsd?: number;
  monthlySpentUsd?: number;
  monthlyCapUsd?: number;
};
export type SeoBudgetResolved = { perOperationCapUsd: number; monthlyCapUsd: number; monthlySpentUsd: number };

export type SeoIdempotencyInput = {
  targetId: string;
  operation: string;
  dimensions: SeoDimensionsInput;
  day: string;
  clientKey?: string | null;
};

export const SEO_SOURCE: "dataforseo";
export const SEO_OPERATIONS: readonly SeoOperation[];
export const SEO_DEVICES: readonly SeoDevice[];
export const SEO_OPERATION_COST_USD: Readonly<Record<SeoOperation, number>>;
export const DEFAULT_PER_OPERATION_CAP_USD: number;
export const DEFAULT_MONTHLY_CAP_USD: number;

export class SeoInputError extends Error {
  status: number;
}
export class SeoBudgetError extends Error {
  status: number;
}

export function isSeoOperation(value: unknown): value is SeoOperation;
export function assertSeoOperation(value: unknown): SeoOperation;
export function normalizeDimensions(input: SeoDimensionsInput): SeoDimensions;
export function resolveTargetDomain(target: SeoTargetRecord): string;
export function estimateOperationCost(operation: string): number;
export function assertWithinBudget(input: SeoBudgetInput): SeoBudgetResolved;
export function monthPrefix(isoTimestamp: string): string;
export function idempotencyInput(input: SeoIdempotencyInput): string;
export function normalizeSnapshot(operation: string, raw: unknown, dimension?: Record<string, unknown>): SeoNormalizedSnapshot;
