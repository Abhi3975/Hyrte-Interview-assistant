/**
 * Refinements doc §8 — Knowledge Base: "Role-Specific Knowledge Bases" (a PM
 * sees PRDs/roadmaps, an Engineer gets architecture/runbooks, Sales gets
 * CRM/pricing/contracts, Finance gets budgets/forecasts) and "Knowledge as
 * Part of Work" ("An email asks the candidate to review the roadmap before
 * replying... clicking it should open the Knowledge Base → Product
 * Roadmap"). Both are deterministic, code-level mappings — not LLM prompt
 * hopes — same discipline as industry-templates.ts's companyStateBias and
 * signature-artifacts.ts's role→archetype resolver: pure, exported,
 * independently testable functions with no DI surface.
 */

/**
 * Which roles a document CATEGORY is naturally relevant to. An empty array
 * means "relevant to everyone" (meeting notes, general wiki pages) — never
 * used to HIDE a document, only to sort/flag it, since the Hidden Information
 * System (§13) explicitly rewards candidates investigating outside their
 * obvious lane.
 */
const CATEGORY_ROLE_HINTS: Record<string, string[]> = {
  prd: ['Product', 'Engineer', 'Design'],
  roadmap: ['Product', 'Engineer', 'Marketing'],
  wiki: ['Engineer', 'DevOps', 'QA', 'Data'],
  backlog: ['Engineer', 'Product', 'QA'],
  // Deliberately NOT 'Manager' — nearly every role title in this codebase's
  // rosters contains that word (Product Manager, Sales Manager, Engineering
  // Manager…), which would make hr_policy match almost everyone and defeat
  // the point of role differentiation.
  hr_policy: ['HR', 'People', 'Operations'],
  sales_deck: ['Sales', 'Account', 'BDR', 'SDR', 'Marketing'],
  financial_report: ['Finance', 'CEO', 'CFO', 'Operations'],
  customer_history: ['Sales', 'Customer Success', 'Support', 'Account'],
  meeting_notes: [],
  general: [],
};

/** Category → relevant roles, for tagging a doc at generation time. */
export function resolveRelevantRoles(category: string): string[] {
  return CATEGORY_ROLE_HINTS[category.trim().toLowerCase()] ?? [];
}

/**
 * Whether a document (by its tagged relevantRoles) counts as "your area" for
 * a given candidate role. Same fuzzy substring match convention
 * signature-artifacts.ts's resolveSignatureArtifact uses for role strings —
 * roles in this codebase are free-text ("Senior Backend Engineer", "Product
 * Manager II"), never a closed enum, so exact equality would miss almost
 * everything.
 */
export function isDocRelevantToRole(relevantRoles: string[], candidateRole: string): boolean {
  if (relevantRoles.length === 0) return true;
  const role = candidateRole.toLowerCase();
  return relevantRoles.some((hint) => role.includes(hint.toLowerCase()));
}

/** Keyword a message needs to contain for its category's docs to plausibly be "what it's talking about". */
const CATEGORY_KEYWORDS: Record<string, RegExp> = {
  prd: /\bprd\b|requirements? doc|product requirements/i,
  roadmap: /\broadmap\b/i,
  wiki: /\bwiki\b|documentation|runbook/i,
  backlog: /\bbacklog\b|sprint backlog/i,
  hr_policy: /\bpolicy\b|\bpolicies\b|handbook/i,
  sales_deck: /pricing|proposal|sales deck|pitch deck/i,
  financial_report: /financial report|budget|forecast|quarterly (numbers|results)/i,
  customer_history: /customer history|account history|renewal history/i,
  meeting_notes: /meeting notes/i,
};

/**
 * Refinements doc §8/§3 — "Connected Workplace Experience": deterministic
 * doc-to-message linking. Given a message's text, finds the single KB doc it
 * most plausibly refers to, if any — by category keyword first (the
 * generalizable signal: "please review the roadmap" matches ANY roadmap doc
 * that exists this session, even though the message and the doc were
 * generated independently and can't coordinate on an exact title), then by
 * exact title mention as a stronger secondary signal. Not every message
 * matches — most won't, matching the doc's own framing ("if AN email says…"
 * not "every email").
 */
export function findMentionedKnowledgeDoc(
  text: string,
  docs: { id: string; title: string; category: string }[],
): string | undefined {
  if (!text || docs.length === 0) return undefined;
  const lower = text.toLowerCase();

  // Strongest signal: the doc's own title appears verbatim (longest title
  // first, so a specific title wins over a shorter one that happens to be
  // a substring of it).
  const byTitle = [...docs].sort((a, b) => b.title.length - a.title.length).find((d) => d.title.length > 4 && lower.includes(d.title.toLowerCase()));
  if (byTitle) return byTitle.id;

  // Weaker but broader signal: a category keyword appears, and exactly one
  // doc in that category exists this session (if there are 2+, it's
  // genuinely ambiguous which one — better to link nothing than guess wrong).
  for (const [category, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
    if (!pattern.test(text)) continue;
    const inCategory = docs.filter((d) => d.category.toLowerCase() === category);
    if (inCategory.length === 1) return inCategory[0].id;
  }
  return undefined;
}
