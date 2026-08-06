const categoryImpacts = {
  Security: {
    security: "This weakens a security control or discloses technical information. The finding alone does not prove exploitation or a data breach.",
    customers: "The effect may be invisible in normal use, but exploitation or control failure could affect confidence, privacy or service reliability.",
    reputation: "Unresolved public security hygiene can concern customers and partners, particularly during technical due diligence.",
  },
  Accessibility: {
    security: "No direct security compromise is demonstrated by this evidence.",
    customers: "People using assistive technology may be unable to understand, navigate or operate part of the page.",
    reputation: "Accessibility barriers can make the organisation appear exclusionary and may increase compliance or procurement concerns.",
  },
  SEO: {
    security: "No direct security compromise is demonstrated by this evidence.",
    customers: "The main effect is indirect: customers may struggle to find the correct page through search engines or may land on a poor duplicate result.",
    reputation: "Reduced search visibility and untidy search results can make the website look poorly governed and weaken digital credibility.",
  },
  Availability: {
    security: "No confidentiality breach is demonstrated, although poor error handling can reveal implementation detail or increase unnecessary origin load.",
    customers: "Customers may be unable to reach expected information or may encounter a broken or confusing recovery path.",
    reputation: "Repeated failures and unbranded errors can make the service appear unreliable or unfinished.",
  },
  Content: {
    security: "No direct security compromise is demonstrated unless separate technical evidence says otherwise.",
    customers: "Customers may misunderstand the page, follow the wrong path or lose confidence in the information presented.",
    reputation: "Visible inaccuracies or inconsistencies can weaken perceptions of care, expertise and editorial control.",
  },
  Experience: {
    security: "No direct security compromise is demonstrated by this evidence.",
    customers: "The issue adds friction, makes an action harder to complete or obscures the next useful step.",
    reputation: "Persistent usability friction can make the digital experience feel less professional than the organisation behind it.",
  },
};

const titleGuidance = [
  {
    matches: /content security policy|\bcsp\b/i,
    explanation: "The page does not send a Content Security Policy, so the browser has no site-defined restriction on which scripts and other resources may execute or load.",
    security: "This removes an important defence-in-depth control against cross-site scripting and compromised third-party content. It does not prove that an exploitable injection exists.",
    customers: "There is usually no visible effect in normal use; impact emerges if another injection or supply-chain weakness is exploited.",
    reputation: "Missing baseline browser protections can concern security-conscious customers and external assessors.",
  },
  {
    matches: /canonical/i,
    explanation: "The page does not clearly identify its preferred public URL, which can leave search engines to choose between duplicate or near-duplicate addresses.",
    security: "No direct security compromise is demonstrated by this evidence.",
    customers: "Customers may reach a duplicate, outdated or less useful version of the page through search results.",
    reputation: "Untidy indexing and duplicate search results can make the website appear poorly governed.",
  },
  {
    matches: /primary heading|\bh1\b/i,
    explanation: "The page has no clear primary heading that identifies its main purpose and anchors the content structure.",
    security: "No direct security compromise is demonstrated by this evidence.",
    customers: "Screen-reader users and people scanning the page may find it harder to understand where they are and what the page is for.",
    reputation: "Weak content structure can create accessibility and quality concerns during customer or procurement review.",
  },
  {
    matches: /title.*long|long.*title/i,
    explanation: "The page title is long enough to be truncated or become difficult to distinguish in browser tabs and search results.",
    security: "No direct security compromise is demonstrated by this evidence.",
    customers: "Customers may see an incomplete title and have more difficulty identifying the correct result.",
    reputation: "Repeatedly unwieldy titles suggest weak editorial and search-governance controls.",
  },
  {
    matches: /broken link|returns? 404|link rot/i,
    explanation: "A link presented as a valid route leads to a missing destination instead of the intended information.",
    security: "The broken link is not itself evidence of a breach, although an unmanaged abandoned destination can create additional risk in some configurations.",
    customers: "Customers cannot complete the expected journey and may assume that the information or service is unavailable.",
    reputation: "Prominent broken journeys make a website look stale or insufficiently tested.",
  },
  {
    matches: /text alternative|\balt\b/i,
    explanation: "An informative image does not provide a text alternative that communicates its purpose to people who cannot see it.",
    security: "No direct security compromise is demonstrated by this evidence.",
    customers: "Screen-reader users may miss information required to understand or operate the page.",
    reputation: "Visible accessibility gaps can create inclusion, compliance and procurement concerns.",
  },
  {
    matches: /out of date|outdated|obsolete/i,
    explanation: "Published wording no longer matches the current process, destination or service state.",
    security: "No direct security compromise is demonstrated unless the obsolete instruction routes users into an unsafe process.",
    customers: "Customers may follow the wrong instruction, lose time or contact the wrong team.",
    reputation: "Stale operational content can reduce confidence that the organisation maintains its public information.",
  },
  {
    matches: /server version|version disclosure|fingerprint/i,
    explanation: "Public responses reveal implementation or exact version details that are not needed by normal visitors.",
    security: "Fingerprinting can help an attacker narrow technology-specific research, but it is not an exploit or breach on its own.",
    customers: "There is no expected normal-use impact.",
    reputation: "Avoidable version banners are commonly flagged during security reviews as a low-level hygiene issue.",
  },
  {
    matches: /pagination|out-of-range/i,
    explanation: "The website accepts an impossible page number as valid instead of returning a not-found response or redirecting to a valid boundary.",
    security: "This is not evidence of a breach. The security-adjacent concern is resource abuse through an unnecessarily large URL space.",
    customers: "Malformed links can land customers on repeated content or a misleading empty state.",
    reputation: "Unlimited duplicate pages can weaken search quality and signal weak boundary handling.",
  },
];

export function buildFindingGuidance(finding) {
  const category = typeof finding.category === "string" && finding.category.trim() ? finding.category.trim() : "Experience";
  const fallback = categoryImpacts[category] ?? categoryImpacts.Experience;
  const title = sentence(finding.title || "A website control is not behaving as intended");
  const override = titleGuidance.find((candidate) => candidate.matches.test(title));
  return {
    explanation: override?.explanation ?? `This is a ${category.toLowerCase()} issue. In practical terms, ${lowerFirst(title)}`,
    security: override?.security ?? fallback.security,
    customers: override?.customers ?? fallback.customers,
    reputation: override?.reputation ?? fallback.reputation,
    caveat: "These are potential impact scenarios based on the recorded evidence, not proof that exploitation, customer harm or reputational damage has occurred.",
    knownLinks: [],
  };
}

function sentence(value) {
  const clean = String(value).replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function lowerFirst(value) {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}
