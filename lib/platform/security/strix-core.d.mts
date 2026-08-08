export type StrixSeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";
export type StrixReviewDecision = "reproducible" | "plausible" | "duplicate" | "false_positive" | "out_of_scope" | "unsafe_evidence";

export type StrixCandidate = {
  externalId: string;
  title: string;
  severity: StrixSeverity;
  cwe: string;
  cvssVector: string;
  endpoint: string;
  method: string;
  summary: string;
  remediation: string;
  fingerprint: string;
};

export type StrixParseResult = {
  format: "sarif" | "strix-json";
  candidates: StrixCandidate[];
  coverage: { format: string; candidateCount: number };
  limitations: string[];
};

export type StrixReviewInput = {
  current: string;
  decision: string;
  severity: string;
  reviewerEmail: string;
  firstReviewerEmail?: string | null;
};
export type StrixReviewResolution = {
  reviewStatus: string;
  awaitingSecondCheck: boolean;
  firstReviewer: string;
  secondCheckBy: string | null;
};

export const STRIX_SOURCE: "strix";
export const SEVERITIES: readonly StrixSeverity[];
export const HIGH_SEVERITIES: readonly StrixSeverity[];
export const REVIEW_DECISIONS: readonly StrixReviewDecision[];
export const MAX_REPORT_BYTES: number;

export class StrixInputError extends Error {
  status: number;
}

export function redactSecrets(value: unknown): string;
export function normalizeSeverity(value: unknown): StrixSeverity;
export function sanitizeCandidate(record: Record<string, unknown>, source?: string): StrixCandidate;
export function parseStrixReport(rawText: string, source?: string): StrixParseResult;
export function resolveReviewDecision(input: StrixReviewInput): StrixReviewResolution;
