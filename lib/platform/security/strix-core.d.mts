export type StrixSeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";
export type StrixReviewDecision = "reproducible" | "plausible" | "duplicate" | "false_positive" | "out_of_scope" | "unsafe_evidence";
export type SanitizationStatus = "clean" | "redacted" | "quarantined";
export type StrixCandidate = {
  externalId: string; title: string; severity: StrixSeverity; cwe: string; cvssVector: string;
  endpoint: string; method: string; summary: string; remediation: string; fingerprint: string;
  sanitizationStatus: SanitizationStatus; sanitizationFlags: string[];
};
export type StrixParseResult = {
  format: "sarif" | "strix-json"; candidates: StrixCandidate[];
  coverage: { format: string; candidateCount: number; quarantinedCount: number; redactedCount: number };
  limitations: string[];
};
export type StrixReviewResolution = {
  reviewStatus: string; awaitingSecondCheck: boolean; firstReviewer: string; secondCheckBy: string | null;
  stage: "first" | "second" | "final"; expectedCurrent: string;
};

export const STRIX_SOURCE: "strix";
export const SEVERITIES: readonly StrixSeverity[];
export const HIGH_SEVERITIES: readonly StrixSeverity[];
export const REVIEW_DECISIONS: readonly StrixReviewDecision[];
export const MAX_REPORT_BYTES: number;
export const MAX_CANDIDATES: number;
export const MAX_REPORT_RUNS: number;
export const MAX_JSON_NODES: number;
export const MAX_TOTAL_CANDIDATE_TEXT: number;
export const RESTRICTED_EVIDENCE_PLACEHOLDER: string;

export class StrixInputError extends Error { status: number; }
export class StrixConflictError extends Error { status: number; }

export function redactSecrets(value: unknown): string;
export function detectRestrictedContent(value: unknown): string[];
export function sanitizeReviewNote(value: unknown, limit?: number): string;
export function normalizeSeverity(value: unknown, cvssValue?: unknown): StrixSeverity;
export function sanitizeEndpoint(value: unknown, allowedHost: string, allowedPathPrefix?: string): { value: string; flags: string[] };
export function sanitizeCandidate(record: Record<string, unknown>, options: { source?: string; allowedHost: string; allowedPathPrefix?: string; inputFlags?: string[] }): StrixCandidate;
export function parseStrixReport(rawText: string, options: { source?: string; allowedHost: string; allowedPathPrefix?: string }): StrixParseResult;
export function resolveReviewDecision(input: { current: string; decision: string; severity: string; reviewerEmail: string; firstReviewerEmail?: string | null }): StrixReviewResolution;
