/**
 * "AI interviewer metrics" doc, Step 10 — Live Interview State:
 *
 *   "The interviewer maintains hidden states. Product Judgment: Evidence
 *    Strong. Technical Depth: Evidence Weak. Ownership: Evidence Conflicting…
 *    Questions are selected based on evidence gaps. If Product Judgment is
 *    already proven, stop asking about it. Move deeper elsewhere. This
 *    prevents repetitive 45-minute interviews."
 *
 * That requires knowing WHICH competencies this role is actually being
 * assessed on, before the interview starts. Two sources exist and they are not
 * equally good:
 *
 *  1. A recruiter-provided JD, decomposed into weighted capability
 *     requirements (JobSuccessModel) — the real thing, used whenever present.
 *  2. This module — a deterministic per-role-family fallback, for self-serve
 *     practice sessions where no JD exists.
 *
 * Resolution is by REGEX over real job-title language, the same discipline as
 * `signature-artifacts.ts`, `role-tasks.ts` and `question-variety.ts`: role is
 * free text from a candidate picker or a JD decomposition, never an enum.
 */

export type CompetencyPriority = 'critical' | 'high' | 'medium';

export interface CompetencyDef {
  /** Stable slug — the key the live state is indexed by. */
  key: string;
  label: string;
  priority: CompetencyPriority;
  /** What an answer has to actually contain to count as evidence for this — fed to the assessor. */
  evidenceLooksLike: string;
  /**
   * False for competencies that are evidenced by HOW someone answers rather
   * than by asking about them. You do not ask "tell me about your
   * communication" — you read it off every answer they give. These are still
   * scored and still appear in the report; they are just never chosen as the
   * target of a question.
   *
   * Caught in a live run of the engine: with these treated as probe targets, a
   * PM had nine competencies competing for a 4-10 turn interview, several were
   * never reachable, and overall confidence could not rise above ~17% no
   * matter how well the candidate did.
   */
  probe: boolean;
}

/**
 * Present in every role and assessed continuously from the shape of each
 * answer, never by a dedicated question — see CompetencyDef.probe.
 */
const UNIVERSAL: CompetencyDef[] = [
  {
    key: 'communication',
    label: 'Communication',
    priority: 'medium',
    evidenceLooksLike: 'explains a complex situation clearly and in a structure a listener can follow',
    probe: false,
  },
  {
    key: 'ownership',
    label: 'Ownership & accountability',
    priority: 'high',
    evidenceLooksLike: 'says what THEY personally did and owns a bad outcome without deflecting to the team or circumstances',
    probe: false,
  },
  {
    key: 'problem_solving',
    label: 'Problem solving',
    priority: 'high',
    evidenceLooksLike: 'reasons from evidence to a conclusion, and names what would have changed their mind',
    probe: false,
  },
];

const ROLE_COMPETENCIES: { pattern: RegExp; competencies: CompetencyDef[] }[] = [
  {
    pattern: /product manager|\bpm\b|product owner/i,
    competencies: [
      { key: 'product_judgment', label: 'Product judgment', priority: 'critical', evidenceLooksLike: 'a real product decision with the trade-off named and the rejected option explained', probe: true },
      { key: 'prioritization', label: 'Prioritization', priority: 'critical', evidenceLooksLike: 'chose between genuinely competing asks and can say what they deliberately did not do', probe: true },
      { key: 'data_analysis', label: 'Data & metrics', priority: 'high', evidenceLooksLike: 'cites a specific metric with a baseline and a target, not a vague "it improved"', probe: true },
      { key: 'stakeholder_mgmt', label: 'Stakeholder management', priority: 'high', evidenceLooksLike: 'handled a real disagreement with a named person or function, and said how it resolved', probe: true },
      { key: 'execution', label: 'Execution', priority: 'high', evidenceLooksLike: 'shipped something and can describe what actually happened after it shipped', probe: true },
      { key: 'technical_depth', label: 'Technical understanding', priority: 'medium', evidenceLooksLike: 'engages credibly with a technical constraint rather than treating engineering as a black box', probe: true },
    ],
  },
  {
    pattern: /software engineer|developer|full[- ]?stack|backend|frontend|\bswe\b/i,
    competencies: [
      { key: 'technical_depth', label: 'Technical depth', priority: 'critical', evidenceLooksLike: 'explains a system or bug at a level of detail only someone who actually built it would have', probe: true },
      { key: 'debugging', label: 'Debugging & diagnosis', priority: 'critical', evidenceLooksLike: 'describes an investigation that followed evidence rather than a lucky guess', probe: true },
      { key: 'design_tradeoffs', label: 'Design trade-offs', priority: 'high', evidenceLooksLike: 'names the alternative they rejected and what the chosen approach costs later', probe: true },
      { key: 'code_quality', label: 'Quality & testing', priority: 'high', evidenceLooksLike: 'has a real view on what to test and when shipping fast is or is not acceptable', probe: true },
      { key: 'collaboration', label: 'Collaboration', priority: 'medium', evidenceLooksLike: 'worked through a real technical disagreement with another engineer', probe: true },
    ],
  },
  {
    pattern: /data (scientist|analyst)|analytics|machine learning|\bml\b/i,
    competencies: [
      { key: 'analytical_rigour', label: 'Analytical rigour', priority: 'critical', evidenceLooksLike: 'states assumptions and the limits of what their analysis can support', probe: true },
      { key: 'framing', label: 'Problem framing', priority: 'critical', evidenceLooksLike: 'turned a vague business question into something actually answerable', probe: true },
      { key: 'causal_reasoning', label: 'Causal reasoning', priority: 'high', evidenceLooksLike: 'distinguishes correlation from cause, unprompted', probe: true },
      { key: 'communication', label: 'Communicating findings', priority: 'high', evidenceLooksLike: 'made a non-technical stakeholder act on an analysis, or handled being disbelieved', probe: true },
      { key: 'data_quality', label: 'Data quality judgment', priority: 'medium', evidenceLooksLike: 'has caught bad data before and says how', probe: true },
    ],
  },
  {
    pattern: /sales|account (executive|manager)|\bsdr\b|\bbdr\b|business development|customer success/i,
    competencies: [
      { key: 'qualification', label: 'Qualification judgment', priority: 'critical', evidenceLooksLike: 'has walked away from a deal, and can say what told them to', probe: true },
      { key: 'discovery', label: 'Discovery', priority: 'critical', evidenceLooksLike: 'gets past surface answers to the real business pain, with a specific example', probe: true },
      { key: 'objection_handling', label: 'Objection handling', priority: 'high', evidenceLooksLike: 'handled a real objection without immediately discounting', probe: true },
      { key: 'forecast_honesty', label: 'Forecast honesty', priority: 'high', evidenceLooksLike: 'has told a manager a committed deal was slipping, before it slipped', probe: true },
      { key: 'relationship_depth', label: 'Relationship building', priority: 'medium', evidenceLooksLike: 'multi-threaded an account or rebuilt trust after getting something wrong', probe: true },
    ],
  },
  {
    pattern: /marketing|growth|brand|content/i,
    competencies: [
      { key: 'positioning', label: 'Positioning & messaging', priority: 'critical', evidenceLooksLike: 'can articulate a claim a competitor could not also make', probe: true },
      { key: 'measurement', label: 'Measurement', priority: 'critical', evidenceLooksLike: 'defined success in numbers before a campaign ran, not after', probe: true },
      { key: 'channel_judgment', label: 'Channel judgment', priority: 'high', evidenceLooksLike: 'killed or scaled a channel for a stated reason', probe: true },
      { key: 'cross_functional', label: 'Working with sales/product', priority: 'high', evidenceLooksLike: 'resolved a real disagreement about lead quality or launch readiness', probe: true },
      { key: 'creative_judgment', label: 'Creative judgment', priority: 'medium', evidenceLooksLike: 'has a view on what makes work good beyond "it performed"', probe: true },
    ],
  },
  {
    pattern: /designer|\bux\b|\bui\b|product design/i,
    competencies: [
      { key: 'design_judgment', label: 'Design judgment', priority: 'critical', evidenceLooksLike: 'reasons from the user problem rather than from taste, and names a rejected alternative', probe: true },
      { key: 'research', label: 'Research & validation', priority: 'critical', evidenceLooksLike: 'changed a design because of something a real user did, not said', probe: true },
      { key: 'scoping', label: 'Scoping under constraint', priority: 'high', evidenceLooksLike: 'cut a design in half and can say how they chose which half', probe: true },
      { key: 'collaboration', label: 'Working with engineering', priority: 'high', evidenceLooksLike: 'handled shipped work not matching the design', probe: true },
      { key: 'accessibility', label: 'Accessibility', priority: 'medium', evidenceLooksLike: 'treats accessibility as a design constraint rather than a checklist at the end', probe: true },
    ],
  },
];

const PRIORITY_RANK: Record<CompetencyPriority, number> = { critical: 0, high: 1, medium: 2 };

/** Deduplicates by key (a role list may already contain a universal one) and sorts most-important-first. */
function merge(roleSpecific: CompetencyDef[]): CompetencyDef[] {
  const byKey = new Map<string, CompetencyDef>();
  for (const c of [...roleSpecific, ...UNIVERSAL]) if (!byKey.has(c.key)) byKey.set(c.key, c);
  return [...byKey.values()].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

export function resolveCompetencies(role: string): CompetencyDef[] {
  const match = ROLE_COMPETENCIES.find((entry) => entry.pattern.test(role));
  return merge(match?.competencies ?? []);
}

/**
 * The preferred source: a recruiter's real JD, already decomposed into
 * weighted capability requirements by the Job Success Model. Falls back to the
 * role-family table above when no JD was provided, or when the decomposition
 * produced nothing usable.
 */
export function competenciesFromJobSuccessModel(
  role: string,
  capabilityRequirements: { skill?: unknown; importance?: unknown }[] | null | undefined,
): CompetencyDef[] {
  const fromJd = (capabilityRequirements ?? [])
    .filter((c): c is { skill: string; importance?: string } => typeof c.skill === 'string' && c.skill.trim().length > 0)
    .map((c) => {
      const importance = String(c.importance ?? '').toLowerCase();
      const priority: CompetencyPriority = importance.includes('critical') ? 'critical' : importance.includes('medium') || importance.includes('low') ? 'medium' : 'high';
      return {
        key: c.skill.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        label: c.skill.trim(),
        priority,
        evidenceLooksLike: `a concrete, first-hand example that genuinely demonstrates ${c.skill.trim().toLowerCase()} — not a description of what good practice looks like`,
      };
    })
    .filter((c) => c.key.length > 0);

  // A JD that decomposed into one vague requirement is worse than the role
  // table; require a real set before preferring it.
  if (fromJd.length < 3) return resolveCompetencies(role);
  // Cap the probed set: a JD can decompose into a dozen requirements, but an
  // interview only has room to genuinely investigate a handful. The universal
  // three are appended by merge() and cost no turns (probe: false).
  return merge([...fromJd.slice(0, 6).map((c) => ({ ...c, probe: true }))]);
}
