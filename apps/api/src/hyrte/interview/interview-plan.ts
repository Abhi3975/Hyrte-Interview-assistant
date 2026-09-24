/**
 * The simulation plans the interview.
 *
 * Until now the interview's SHAPE came from the difficulty dial the recruiter
 * set before the candidate had done anything: `getBaseTone(difficulty)` and
 * `getTurnRange(difficulty)`. Two candidates who behaved completely
 * differently in the same simulation got the same interview, because the only
 * input was a setting chosen in advance.
 *
 * That is backwards. The simulation watched this person work for an hour — it
 * knows whether they produced evidence or drifted, whether they contradicted
 * themselves, whether they did good work without ever explaining it. That is
 * exactly what should decide what kind of interview they get, and it is the
 * thing an experienced interviewer does between reading a work sample and
 * walking into the room.
 *
 * Deterministic, as everything structural in this codebase is. The archetype,
 * the length and the tone are arithmetic over signals; only the wording of
 * individual questions is left to the model. A recruiter can read `reason` and
 * see exactly why this candidate got this interview.
 */

export type InterviewArchetype =
  /** The simulation produced too little to judge. The interview has to do the establishing work. */
  | 'ESTABLISH'
  /** The evidence disagrees with itself. Resolving that is the most valuable hour available. */
  | 'RESOLVE'
  /** Strong and consistent everywhere. Stop confirming and find the edge. */
  | 'PRESSURE'
  /** Did the work, left no reasoning behind it. Get the thinking out. */
  | 'DRAW_OUT'
  /** A normal, solid record. Verify it is real and probe for depth. */
  | 'VERIFY';

export interface SimulationSignals {
  /** Total evidence objects the simulation recorded. */
  evidenceCount: number;
  /** Evidence of type SIMULATION_DECISION — actual calls made, not just activity. */
  decisionCount: number;
  /** Pairs of evidence the graph flagged as contradicting. */
  contradictionCount: number;
  /** Mean confidence across recorded evidence, 0-100. */
  avgConfidence: number;
  /**
   * Distinct behaviour contexts the simulation actually observed them in
   * (PEER / MANAGER / CUSTOMER / CONFLICT / PRESSURE / AMBIGUITY / FAILURE /
   * SUCCESS), out of the eight that exist. "How many different situations did
   * we see this person in" is the honest coverage question — evidence carries
   * a context, not a competency key.
   */
  contextsCovered: number;
  contextsTotal: number;
  /** Distinct stakeholders the candidate actually engaged with. */
  stakeholderContacts: number;
  /** Deliverables submitted for review. */
  tasksSubmitted: number;
}

export interface InterviewPlan {
  archetype: InterviewArchetype;
  /** Recruiter-facing, composed in code: why this candidate is getting this interview. */
  reason: string;
  /** Candidate turns before the interview is wrapped up. */
  turnBudget: { min: number; max: number };
  /** Replaces the difficulty-derived personality line. */
  tone: string;
  /** What the opening question should do. */
  openingStrategy: string;
  /** True only where the record genuinely supports raising the bar. */
  bossModeRecommended: boolean;
}

// ── Thresholds ──────────────────────────────────────────────────────────────
// Deliberately named and gathered, so the shape of the judgment is legible
// rather than buried in a chain of conditionals.

/** Below this much evidence, the simulation has not told us enough to interrogate. */
export const THIN_EVIDENCE = 6;
/** ...or when it only ever saw them in a couple of kinds of situation. */
export const THIN_COVERAGE_RATIO = 0.4;
/** Confidence above this, across most kinds of situation, is a genuinely strong record. */
export const STRONG_CONFIDENCE = 70;
export const STRONG_COVERAGE_RATIO = 0.7;
/** Real decisions made with almost nobody spoken to — work done in silence. */
export const QUIET_WORKER_CONTACTS = 1;
export const QUIET_WORKER_DECISIONS = 3;

const pct = (n: number, d: number) => (d > 0 ? n / d : 0);

/**
 * Decide the interview from what the simulation actually saw.
 *
 * Order matters and encodes priority: not knowing enough beats everything (you
 * cannot resolve a contradiction in a record that barely exists), then
 * resolving conflict, then — only for a genuinely strong record — raising the
 * bar, then drawing out someone who worked silently.
 */
export function planInterview(signals: SimulationSignals): InterviewPlan {
  const coverage = pct(signals.contextsCovered, signals.contextsTotal);

  if (signals.evidenceCount < THIN_EVIDENCE || coverage < THIN_COVERAGE_RATIO) {
    // An empty record and a thin one need different instructions. Verified
    // live: told to "open on the most substantial thing they DID do, however
    // small" against ZERO observations, the model invented one — it opened
    // with "I noticed you engaged with the simulation by making decisions in
    // challenging areas" to a candidate who had done nothing at all. Asking
    // for a citation from an empty record is asking for a fabrication, and a
    // fabricated observation about a candidate is not a small thing in a
    // hiring interview.
    const nothingObserved = signals.evidenceCount === 0;
    return {
      archetype: 'ESTABLISH',
      reason:
        `The simulation recorded only ${signals.evidenceCount} pieces of evidence across ` +
        `${signals.contextsCovered} of ${signals.contextsTotal} kinds of situation — not enough to judge on. ` +
        `This interview has to establish capability rather than confirm it, so it runs longer and opens broad.`,
      turnBudget: { min: 8, max: 12 },
      tone:
        'PERSONALITY: Professional and genuinely curious. This candidate did not leave much of a trail in the ' +
        'simulation, which is information but not a verdict — plenty of capable people move slowly in an unfamiliar ' +
        'system. Do NOT treat the thin record as a failing or mention how little they did. Your job here is to find ' +
        'out what they can actually do, so ask about real work they have done elsewhere when the simulation gives ' +
        'you nothing to go on.',
      openingStrategy: nothingObserved
        ? 'There is NOTHING in the simulation record to cite — do not claim to have noticed anything they did, and ' +
          'do not invent an observation to open with. Open instead on the role itself: ask about a concrete piece ' +
          'of real work from their own experience that is relevant to it.'
        : 'Open on the most substantial thing they DID do, however small, and use it as a doorway into how they ' +
          'work generally. Do not open by observing that they did little.',
      bossModeRecommended: false,
    };
  }

  if (signals.contradictionCount > 0) {
    return {
      archetype: 'RESOLVE',
      reason:
        `The evidence graph flagged ${signals.contradictionCount} contradiction` +
        `${signals.contradictionCount === 1 ? '' : 's'} between what this candidate said and what they did. ` +
        `Resolving that is the most valuable use of the interview, so it opens there rather than working up to it.`,
      turnBudget: { min: 6, max: 10 },
      tone:
        'PERSONALITY: Precise and neutral. There is a genuine conflict in the record and you are here to understand ' +
        'it, not to catch them out — people contradict themselves for good reasons as often as bad ones. Press for ' +
        'specifics, stay even-handed, and let them explain before you conclude anything.',
      openingStrategy:
        'Open directly on the contradiction. State both sides plainly as things you observed, without accusation, ' +
        'and ask them to walk you through it.',
      bossModeRecommended: false,
    };
  }

  const strongRecord = signals.avgConfidence >= STRONG_CONFIDENCE && coverage >= STRONG_COVERAGE_RATIO;
  if (strongRecord) {
    return {
      archetype: 'PRESSURE',
      reason:
        `Strong, consistent evidence (average confidence ${Math.round(signals.avgConfidence)} across ` +
        `${signals.contextsCovered}/${signals.contextsTotal} kinds of situation) with no contradictions. ` +
        `Confirming it again would waste the hour — this interview looks for the edge of what they can do.`,
      turnBudget: { min: 5, max: 8 },
      tone:
        'PERSONALITY: Senior bar-raiser. This candidate has already demonstrated competence, so do not spend turns ' +
        're-establishing it. Take them past the edge of what the simulation covered: harder trade-offs, second-order ' +
        'consequences, the decision they would find genuinely difficult. Push hard on reasoning, never on the person.',
      openingStrategy:
        'Skip the warm-up entirely. Open on their strongest moment and immediately extend it into a harder version ' +
        'of the same problem.',
      // The only case where the record genuinely supports it — the candidate
      // has earned a harder interview rather than been assigned one.
      bossModeRecommended: true,
    };
  }

  if (signals.stakeholderContacts <= QUIET_WORKER_CONTACTS && signals.decisionCount >= QUIET_WORKER_DECISIONS) {
    return {
      archetype: 'DRAW_OUT',
      reason:
        `This candidate made ${signals.decisionCount} real decisions but spoke to only ` +
        `${signals.stakeholderContacts} stakeholder${signals.stakeholderContacts === 1 ? '' : 's'} — the work is ` +
        `there, the reasoning behind it is not. The interview is weighted toward getting the thinking out loud.`,
      turnBudget: { min: 7, max: 11 },
      tone:
        'PERSONALITY: Warm and patient, with long leashes. This candidate works things out alone and does not ' +
        'narrate, which is a communication signal worth noting but NOT evidence of poor judgment. Give them room, ' +
        'do not fill their silences, and follow up on half-finished thoughts rather than moving on.',
      openingStrategy:
        'Open on a decision they made without consulting anyone, and ask what they were weighing. Be genuinely ' +
        'interested in the reasoning, not in why they did not ask.',
      bossModeRecommended: false,
    };
  }

  return {
    archetype: 'VERIFY',
    reason:
      `A solid, unremarkable record: ${signals.evidenceCount} pieces of evidence across ` +
      `${signals.contextsCovered}/${signals.contextsTotal} kinds of situation, no contradictions. ` +
      `The interview verifies the work is genuinely theirs and probes for depth behind it.`,
    turnBudget: { min: 6, max: 9 },
    tone:
      'PERSONALITY: Professional and precise. Neutral, structured, minimal small talk. Verify that the work in the ' +
      'simulation reflects real understanding rather than a lucky path through it — ask how, not just what.',
    openingStrategy:
      'Open on one specific, interesting thing they did and ask them to explain the thinking behind it.',
    bossModeRecommended: false,
  };
}

/** The block the interview prompt receives, so the plan reaches the model as instructions rather than context. */
export function planDirective(plan: InterviewPlan): string {
  return `${plan.tone}\n\nOPENING: ${plan.openingStrategy}`;
}
