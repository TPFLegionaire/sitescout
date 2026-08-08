export function parseApprovedSecurityTargetIds(value: unknown): Set<string>;
export function normalizeRetentionDays(value: unknown, fallback?: number): number;
export function retentionDeadline(now: string | Date, days: unknown): string;
