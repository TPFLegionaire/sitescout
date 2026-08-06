export type AutomatedObservationInput = { id: string; targetId: string; runId?: string | null; url: string; title: string; description: string };
export type RuleFindingMappings = Record<string, Record<string, string>>;
export type AutomatedGroup = {
  id: string; targetId: string; ruleId: string; urlPattern: string; proposedFindingId: string | null; title: string; severity: string;
  count: number; runCount: number; runIds: string[]; sampleUrls: string[]; observationIds: string[];
};
export function extractRuleId(description: unknown): string;
export function extractSeverity(description: unknown): string;
export function normaliseUrlPattern(value: string): string;
export function proposedFindingForRule(ruleId: string, targetId: string, mappings?: RuleFindingMappings): string | null;
export function automatedGroupId(identity: { targetId: string; ruleId: string; urlPattern: string; proposedFindingId: string | null }): string;
export function buildAutomatedGroups(observations: AutomatedObservationInput[], mappings?: RuleFindingMappings): AutomatedGroup[];
