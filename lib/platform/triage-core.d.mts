export type TriageCandidate = { id: string; title: string; category: string; recommendation?: string };
export type TriageInput = { url: string; description: string; title?: string; expected?: string; actual?: string };
export type DuplicateCandidate = { id: string; title: string; category: string; score: number; reason: string };
export type TriageDraft = {
  title: string;
  observed: string;
  expected: string;
  reproductionSteps: string[];
  provisionalSeverity: string;
  hypotheses: string[];
  suggestedFindingId: string | null;
  duplicateCandidates: DuplicateCandidate[];
  method: string;
  externalProcessing: boolean;
  warning: string | null;
};
export function buildLocalTriage(input: TriageInput, candidates: TriageCandidate[]): TriageDraft;
