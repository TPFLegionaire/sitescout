export function parseApprovedSecurityTargetIds(value) {
  return new Set(
    String(value ?? "")
      .split(/[;,\s]+/)
      .map((entry) => entry.trim())
      .filter((entry) => /^[A-Za-z0-9._:-]{1,100}$/.test(entry)),
  );
}

export function normalizeRetentionDays(value, fallback = 30) {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : fallback;
}

export function retentionDeadline(now, days) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("A valid retention start time is required.");
  date.setUTCDate(date.getUTCDate() + normalizeRetentionDays(days));
  return date.toISOString();
}
