/**
 * Public distributions intentionally contain no imported customer observations.
 * Deployments may provide their own private data through D1 and R2.
 */
export const EXPECTED_PREVIEW_OBSERVATIONS = 0;

export function getManagementPreviewData() {
  return { observations: [], runs: [] };
}
