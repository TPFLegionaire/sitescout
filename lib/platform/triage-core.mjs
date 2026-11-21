const stopWords = new Set(["about", "after", "again", "also", "and", "are", "because", "been", "before", "being", "but", "can", "does", "for", "from", "has", "have", "into", "its", "not", "page", "that", "the", "their", "then", "there", "this", "was", "were", "when", "where", "which", "with", "would"]);

/**
 * A report flagged security-sensitive is drafted on this deployment only. External
 * assistance needs an explicit `false`, so a caller that omits the flag fails closed.
 */
export function mayUseExternalAssist(input, assistConfigured) {
  return assistConfigured === true && input?.securitySensitive === false;
}

export function buildLocalTriage(input, candidates) {
  const description = clean(input.description, 4000);
  const suppliedTitle = clean(input.title, 240);
  const title = suppliedTitle || titleFromDescription(description);
  const inputTokens = tokens(`${title} ${description} ${urlWords(input.url)}`);
  const duplicateCandidates = candidates
    .map((candidate) => {
      const candidateTokens = tokens(`${candidate.title} ${candidate.category} ${candidate.recommendation ?? ""}`);
      const overlap = intersectionSize(inputTokens, candidateTokens);
      const coverage = overlap / Math.max(1, Math.min(inputTokens.size, candidateTokens.size));
      const titleBonus = tokenPhraseMatch(title, candidate.title) ? 0.2 : 0;
      const score = Math.min(0.99, coverage + titleBonus);
      return {
        id: candidate.id,
        title: candidate.title,
        category: candidate.category,
        score: Math.round(score * 100),
        reason: overlap ? `${overlap} meaningful term${overlap === 1 ? "" : "s"} overlap` : "No meaningful wording overlap",
      };
    })
    .filter((candidate) => candidate.score >= 18)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 3);

  return {
    title,
    observed: clean(input.actual, 2000) || description,
    expected: clean(input.expected, 2000) || "The page should complete the intended action and present a clear, accurate result.",
    reproductionSteps: [
      `Open ${clean(input.url, 1000)}.`,
      `Repeat the reported action: ${description}`,
      "Compare the visible result with the expected behaviour.",
    ],
    provisionalSeverity: "undetermined",
    hypotheses: [],
    suggestedFindingId: duplicateCandidates[0]?.score >= 45 ? duplicateCandidates[0].id : null,
    duplicateCandidates,
    method: "local-assist",
    externalProcessing: false,
    warning: null,
  };
}

function clean(value, limit) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function titleFromDescription(description) {
  const first = description.split(/[.!?]\s|\n/)[0]?.trim() || "Website issue reported";
  const withoutLead = first.replace(/^(i\s+(noticed|found|saw)|there\s+is|the\s+website)\s+/i, "");
  return `${withoutLead.charAt(0).toUpperCase()}${withoutLead.slice(1)}`.slice(0, 110);
}

function tokens(value) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length > 2 && !stopWords.has(word)));
}

function urlWords(value) {
  try { return new URL(value).pathname.replace(/[\/_-]+/g, " "); } catch { return ""; }
}

function intersectionSize(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function tokenPhraseMatch(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  return intersectionSize(leftTokens, rightTokens) >= Math.min(2, rightTokens.size);
}
