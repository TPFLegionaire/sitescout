export function extractRuleId(description) {
  return String(description ?? "").match(/(?:^|\n)Rule:\s*([^\s]+)/i)?.[1] ?? "unmapped-rule";
}

export function extractSeverity(description) {
  return String(description ?? "").match(/(?:^|\n)Severity:\s*(critical|high|medium|low)/i)?.[1]?.toLowerCase() ?? "undetermined";
}

export function normaliseUrlPattern(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "";
    const parent = segments.at(-2) ?? "";
    if (last && (parent === "products" || parent === "items" || /\d/.test(last) || last.length > 24)) segments[segments.length - 1] = ":item";
    const query = [...new Set([...url.searchParams.keys()])].sort().map((key) => `${encodeURIComponent(key)}=:value`).join("&");
    return `/${segments.join("/")}${query ? `?${query}` : ""}`;
  } catch {
    return "invalid-url";
  }
}

export function proposedFindingForRule(ruleId, targetId, mappings = {}) {
  return mappings?.[targetId]?.[ruleId] ?? null;
}

export function automatedGroupId({ targetId, ruleId, urlPattern, proposedFindingId }) {
  return [targetId, ruleId, urlPattern, proposedFindingId ?? ""].map((value) => encodeURIComponent(value)).join("|");
}

export function buildAutomatedGroups(observations, mappings = {}) {
  const groups = new Map();
  for (const observation of observations) {
    const ruleId = extractRuleId(observation.description);
    const urlPattern = normaliseUrlPattern(observation.url);
    const proposedFindingId = proposedFindingForRule(ruleId, String(observation.targetId), mappings);
    const identity = { targetId: String(observation.targetId), ruleId, urlPattern, proposedFindingId };
    const id = automatedGroupId(identity);
    const current = groups.get(id) ?? {
      id,
      ...identity,
      title: String(observation.title),
      severity: extractSeverity(observation.description),
      count: 0,
      runIds: new Set(),
      sampleUrls: [],
      observationIds: [],
    };
    current.count += 1;
    if (observation.runId) current.runIds.add(String(observation.runId));
    if (current.sampleUrls.length < 3 && !current.sampleUrls.includes(observation.url)) current.sampleUrls.push(String(observation.url));
    current.observationIds.push(String(observation.id));
    groups.set(id, current);
  }
  return [...groups.values()].map((group) => ({ ...group, runCount: group.runIds.size, runIds: [...group.runIds] })).sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId));
}
