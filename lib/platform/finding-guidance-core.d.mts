export type FindingGuidanceInput = { id: string; title: string; category: string; severity?: string };
export type FindingGuidanceLink = { targetId: string; environment: string; url: string; label: string };
export type FindingGuidance = {
  explanation: string;
  security: string;
  customers: string;
  reputation: string;
  caveat: string;
  knownLinks: FindingGuidanceLink[];
};
export function buildFindingGuidance(finding: FindingGuidanceInput): FindingGuidance;
