import { CompetencyDef, CompetencyPriority } from './competency-model';

/**
 * "Live multi agent Interviewer panel" doc — the committee's actual mechanism:
 *
 *   "The committee never follows a script. It follows uncertainty."
 *   "Decision Cortex: Confidence in stakeholder management is only 41%.
 *    Instead of continuing… the interview changes."
 *
 * plus "AI interviewer metrics" Step 10:
 *
 *   "Questions are selected based on evidence gaps. If Product Judgment is
 *    already proven, stop asking about it. Move deeper elsewhere. This
 *    prevents repetitive 45-minute interviews."
 *
 * ── Why this file has no LLM call in it ───────────────────────────────────
 *
 * The work splits cleanly into a judgment and a decision, and only one of them
 * belongs to a model:
 *
 *   JUDGMENT  "how strongly does this answer evidence stakeholder management?"
 *             — genuinely requires reading the answer. The LLM does this, as
 *               extra constrained fields on the turn-generation call that was
 *               happening anyway (so: no added latency in a live voice
 *               interview, which an extra round trip per turn would ruin).
 *
 *   DECISION  "which competency is now least covered and most important, so
 *             what should the next question target?"
 *             — pure arithmetic over the state. Done here, in code.
 *
 * Leaving the decision to the model would mean the guarantee the doc actually
 * asks for ("if Product Judgment is already proven, STOP asking about it")
 * holds only when the model remembers to apply it. This codebase has an
 * explicit discipline about that — deterministic code for anything that must
 * happen every time, LLM for judgment calls — and repetitive interviews are
 * exactly the failure mode it is meant to prevent.
 */

export type EvidenceStrength = 'none' | 'weak' | 'medium' | 'strong' | 'conflicting';

export interface CompetencyState {
  key: string;
  label: string;
  priority: CompetencyPriority;
  evidenceLooksLike: string;
  /** False = assessed from how they answer, never the target of a question. See CompetencyDef.probe. */
  probe: boolean;
  strength: EvidenceStrength;
  /** 0-100. The doc's own "Confidence in stakeholder management is only 41%". */
  confidence: number;
  /** How many turns have already been spent probing this — stops the interview grinding on one topic. */
  turnsSpent: number;
  /** Short notes from the assessor, newest last — what the evidence actually was. */
  notes: string[];
  /** Every strength this competency has been observed at, in order. Confidence is computed from these, never accumulated in place. */
  observations: EvidenceStrength[];
}

/** One background exchange, in the committee's own voices. The candidate never sees these. */
export interface DeliberationEntry {
  atTurn: number;
  speaker: string;
  message: string;
}

/** What the committee hands the Interview Lead for the next turn. */
export interface CortexDirective {
  atTurn: number;
  targetCompetencyKey: string | null;
  targetLabel: string | null;
  /** The doc's "Next objective: Reduce ambiguity uncertainty." */
  objective: string;
  /** How to go at it — phrased as guidance to the Interview Lead, never as a scripted question. */
  probeAngle: string;
  rationale: string;
  /** True once every competency is sufficiently covered — the committee is telling the Lead it can wrap up. */
  readyToConclude: boolean;
  overallConfidence: number;
}

export interface LiveInterviewState {
  competencies: CompetencyState[];
  directives: CortexDirective[];
  deliberation: DeliberationEntry[];
  turn: number;
}

/** Confidence a strength maps to when it is first observed. Conflicting deliberately scores LOW — a contradiction is less certainty, not more. */
const STRENGTH_CONFIDENCE: Record<EvidenceStrength, number> = {
  none: 0,
  weak: 25,
  medium: 55,
  strong: 85,
  conflicting: 20,
};

/** At or above this, a competency counts as proven and stops being targeted — the doc's "stop asking about it". */
export const PROVEN_CONFIDENCE = 75;

/**
 * Hard cap on consecutive probing of one competency. Without it, a candidate
 * who simply cannot evidence something would be asked about it for the whole
 * interview — the opposite of the "prevents repetitive 45-minute interviews"
 * goal.
 */
export const MAX_TURNS_PER_COMPETENCY = 3;

const PRIORITY_WEIGHT: Record<CompetencyPriority, number> = { critical: 1, high: 0.75, medium: 0.5 };

/**
 * Below this, the best remaining question is not worth asking — every gap left
 * is either low priority or already well evidenced, and another probe would be
 * the "repetitive 45-minute interview" the doc warns about.
 *
 * Without a floor, `readyToConclude` was effectively unreachable: a live run
 * with a strong candidate had every competency at 97% and the committee still
 * queued another question, because "proven" is an absolute bar and something
 * always sits fractionally under it.
 */
const MIN_USEFUL_GAIN = 15;

export function initLiveState(competencies: CompetencyDef[]): LiveInterviewState {
  return {
    competencies: competencies.map((c) => ({
      key: c.key,
      label: c.label,
      priority: c.priority,
      evidenceLooksLike: c.evidenceLooksLike,
      probe: c.probe,
      strength: 'none',
      confidence: 0,
      turnsSpent: 0,
      notes: [],
      observations: [],
    })),
    directives: [],
    deliberation: [],
    turn: 0,
  };
}

/**
 * Seeds confidence from evidence that already exists before a word is spoken —
 * the Investigation Plan's own "current evidence" read, and anything the
 * simulation already proved. An interview should not re-ask what the candidate
 * has already demonstrated by doing.
 */
export function seedFromPriorEvidence(state: LiveInterviewState, priorAreas: { area: string; currentEvidence?: string; priority?: string }[]): LiveInterviewState {
  const competencies = state.competencies.map((c) => {
    const match = priorAreas.find((a) => normalize(a.area) === normalize(c.label) || normalize(a.area).includes(normalize(c.key)) || normalize(c.label).includes(normalize(a.area)));
    if (!match) return c;
    const evidence = (match.currentEvidence ?? '').toLowerCase();
    // Deliberately conservative: prior evidence raises the floor but never
    // marks something proven on its own. The interview still has to confirm
    // it — the doc's whole premise is claimed vs. observed vs. explained.
    const strength: EvidenceStrength = evidence.includes('strong') ? 'medium' : evidence.includes('weak') || evidence.includes('none') ? 'none' : evidence.includes('conflict') || evidence.includes('contradict') ? 'conflicting' : 'weak';
    return {
      ...c,
      strength,
      confidence: Math.min(STRENGTH_CONFIDENCE[strength], 55),
      // Deliberately NOT pushed into `observations`: prior evidence sets a
      // starting read, but only what happens in the interview itself counts
      // toward corroboration.
      notes: match.currentEvidence ? [`Before the interview: ${match.currentEvidence}`] : [],
    };
  });
  return { ...state, competencies };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** What the LLM returns about the answer just given — a judgment, tightly constrained. */
export interface TurnAssessment {
  competencyKey: string;
  strength: EvidenceStrength;
  note: string;
}

/**
 * A single observation, however good it sounds, cannot prove a competency —
 * that is the Bias Auditor's "could confidence be mistaken for competence?"
 * failure mode, and one articulate answer is exactly what triggers it. So a
 * lone observation is capped below the proven bar and the interview asks once
 * more.
 */
const SINGLE_OBSERVATION_CAP = 70;
/** Consistent repeat evidence is what genuinely raises certainty. */
const CORROBORATION_BONUS_PER_EXTRA = 12;
const MAX_CORROBORATION_BONUS = 20;
/** An unresolved contradiction holds a competency below the bar no matter how much else is said about it. */
const CONFLICT_CEILING = 35;

/**
 * Confidence is recomputed from the full observation history every turn rather
 * than accumulated in place.
 *
 * The earlier version blended each new observation 60% of the way toward the
 * running value, which looked reasonable and was not: a live run showed a
 * candidate whose very first answer was assessed `strong` topping out at 51%,
 * then being re-asked the same competency and ending the interview at 35%.
 * Nothing could reach the proven bar inside a realistic turn budget, so the
 * committee never stopped probing anything.
 */
function computeConfidence(observations: EvidenceStrength[]): number {
  if (observations.length === 0) return 0;
  // A contradiction holds the competency down only while it is UNRESOLVED.
  // The committee's whole premise is that it "refuses to make decisions until
  // uncertainty is reduced" — which means reducing it has to be possible. A
  // later `strong` observation is the candidate credibly accounting for the
  // inconsistency; the conflicting observation stays in the mean (it really
  // happened) but stops capping.
  if (hasUnresolvedConflict(observations)) return Math.min(CONFLICT_CEILING, Math.round(mean(observations)));
  const base = mean(observations);
  const bonus = Math.min(MAX_CORROBORATION_BONUS, (observations.length - 1) * CORROBORATION_BONUS_PER_EXTRA);
  const raw = base + bonus;
  return Math.round(observations.length === 1 ? Math.min(raw, SINGLE_OBSERVATION_CAP) : Math.min(raw, 100));
}

export function hasUnresolvedConflict(observations: EvidenceStrength[]): boolean {
  const lastConflict = observations.lastIndexOf('conflicting');
  if (lastConflict === -1) return false;
  return !observations.slice(lastConflict + 1).includes('strong');
}

function mean(observations: EvidenceStrength[]): number {
  return observations.reduce((sum, o) => sum + STRENGTH_CONFIDENCE[o], 0) / observations.length;
}

/** Folds one turn's assessments into the state. */
export function applyAssessments(state: LiveInterviewState, assessments: TurnAssessment[], targetedKey: string | null): LiveInterviewState {
  const byKey = new Map(assessments.map((a) => [a.competencyKey, a] as const));
  const competencies = state.competencies.map((c) => {
    const assessed = byKey.get(c.key);
    const turnsSpent = c.turnsSpent + (targetedKey === c.key ? 1 : 0);
    if (!assessed) return { ...c, turnsSpent };

    const observations = [...c.observations, assessed.strength];
    const confidence = computeConfidence(observations);
    return {
      ...c,
      // A contradiction latches until a later observation resolves it — the
      // Evidence Auditor treats a conflicting claim as something to settle,
      // not something to average away.
      strength: hasUnresolvedConflict(observations) ? 'conflicting' : strengthFor(confidence),
      confidence,
      turnsSpent,
      observations: observations.slice(-8),
      notes: [...c.notes, assessed.note].slice(-6),
    };
  });
  return { ...state, competencies, turn: state.turn + 1 };
}

function strengthFor(confidence: number): EvidenceStrength {
  if (confidence >= PROVEN_CONFIDENCE) return 'strong';
  if (confidence >= 45) return 'medium';
  if (confidence > 0) return 'weak';
  return 'none';
}

/** Overall decision confidence — priority-weighted mean, so a proven "medium" competency cannot mask an unproven critical one. */
export function overallConfidence(state: LiveInterviewState): number {
  if (state.competencies.length === 0) return 0;
  const totalWeight = state.competencies.reduce((sum, c) => sum + PRIORITY_WEIGHT[c.priority], 0);
  const weighted = state.competencies.reduce((sum, c) => sum + c.confidence * PRIORITY_WEIGHT[c.priority], 0);
  return Math.round(weighted / (totalWeight || 1));
}

/**
 * The Decision Cortex's actual choice: which competency the next question
 * should reduce uncertainty on.
 *
 * Ranked by how much is still to gain (priority weight × remaining
 * uncertainty), with two deterministic exclusions:
 *   - anything already proven (≥ PROVEN_CONFIDENCE) — "stop asking about it"
 *   - anything already probed MAX_TURNS_PER_COMPETENCY times without landing
 * A conflicting competency is pulled to the front regardless of score: an
 * unresolved contradiction is the single most valuable thing left to settle.
 */
export function selectNextObjective(state: LiveInterviewState, turnsRemaining?: number): CortexDirective {
  const eligible = state.competencies.filter((c) => c.probe && c.confidence < PROVEN_CONFIDENCE && c.turnsSpent < MAX_TURNS_PER_COMPETENCY);
  const confidence = overallConfidence(state);

  // Budget awareness. An interview has a real turn ceiling (4-10 depending on
  // difficulty), and there are usually more competencies than turns — so with
  // little time left the committee stops opening new ground it cannot finish
  // and concentrates on the highest-priority gap. Without this the Lead would
  // keep starting fresh topics right up to the final question.
  const scarce = typeof turnsRemaining === 'number' && turnsRemaining <= 1;
  const pool0 = scarce ? eligible.filter((c) => c.priority === 'critical' || c.strength === 'conflicting') : eligible;
  const workingSet = pool0.length > 0 ? pool0 : eligible;

  if (workingSet.length === 0) {
    return {
      atTurn: state.turn,
      targetCompetencyKey: null,
      targetLabel: null,
      objective: 'Coverage is sufficient — move toward closing.',
      probeAngle: 'Everything the panel needed is evidenced. Wrap up naturally rather than finding more to ask.',
      rationale: state.competencies.filter((c) => c.probe).every((c) => c.confidence >= PROVEN_CONFIDENCE)
        ? 'Every competency is above the confidence bar.'
        : 'Remaining gaps have already been probed as far as is useful without labouring them.',
      readyToConclude: true,
      overallConfidence: confidence,
    };
  }

  const conflicting = workingSet.filter((c) => c.strength === 'conflicting');
  const pool = conflicting.length > 0 ? conflicting : workingSet;
  const target = pool.reduce((best, c) => (gain(c) > gain(best) ? c : best));

  // An unresolved contradiction is always worth one more question, however
  // small its arithmetic gain — it is the single thing the Evidence Auditor
  // will not let the committee conclude around.
  if (target.strength !== 'conflicting' && gain(target) < MIN_USEFUL_GAIN) {
    return {
      atTurn: state.turn,
      targetCompetencyKey: null,
      targetLabel: null,
      objective: 'Coverage is sufficient — move toward closing.',
      probeAngle: 'There is nothing left that another question would meaningfully settle. Wrap up naturally.',
      rationale: `Best remaining gap (${target.label}, ${target.confidence}%) is no longer worth a question.`,
      readyToConclude: true,
      overallConfidence: confidence,
    };
  }

  return {
    atTurn: state.turn,
    targetCompetencyKey: target.key,
    targetLabel: target.label,
    objective:
      target.strength === 'conflicting'
        ? `Resolve the contradiction around ${target.label.toLowerCase()}.`
        : `Reduce uncertainty on ${target.label.toLowerCase()} (currently ${target.confidence}% confident).`,
    probeAngle:
      target.strength === 'conflicting'
        ? `Something they have said or done does not line up. Put the specific inconsistency to them directly but without hostility, and listen for whether they engage with it or deflect. ${lastNote(target)}`
        : target.turnsSpent === 0
          ? `Nothing yet evidences this. Ask for a specific first-hand example — what good evidence looks like here is: ${target.evidenceLooksLike}.`
          : `The earlier answer was too general to count. Go narrower and concrete — ask what they personally did, with specifics. ${lastNote(target)}`,
    rationale: `${target.label} is ${target.priority} priority and sits at ${target.confidence}% confidence after ${target.turnsSpent} turn(s) of probing.`,
    readyToConclude: false,
    overallConfidence: confidence,
  };
}

function gain(c: CompetencyState): number {
  return PRIORITY_WEIGHT[c.priority] * (100 - c.confidence);
}

function lastNote(c: CompetencyState): string {
  const note = c.notes[c.notes.length - 1];
  return note ? `What we have so far: ${note}` : '';
}

/**
 * The background exchange the panel doc describes — Hiring Manager, Decision
 * Cortex, Devil's Advocate and the Evidence Auditor talking among themselves
 * while the candidate talks to the Lead.
 *
 * Composed deterministically from the real state rather than generated. That
 * is deliberate: this transcript is shown to a recruiter as the committee's
 * actual reasoning, so every line has to be a true statement about the numbers
 * that really drove the next question. A generated version would read better
 * and mean less.
 */
export function composeDeliberation(state: LiveInterviewState, directive: CortexDirective, lastAssessments: TurnAssessment[]): DeliberationEntry[] {
  const entries: DeliberationEntry[] = [];
  const at = state.turn;

  for (const a of lastAssessments) {
    const c = state.competencies.find((x) => x.key === a.competencyKey);
    if (!c) continue;
    if (a.strength === 'conflicting') {
      entries.push({ atTurn: at, speaker: 'Evidence Auditor', message: `Contradiction on ${c.label.toLowerCase()}: ${a.note}. Marking this unverified until it is resolved.` });
    } else if (a.strength === 'strong') {
      entries.push({ atTurn: at, speaker: 'Hiring Manager', message: `That is real evidence for ${c.label.toLowerCase()} — ${a.note}` });
    } else if (a.strength === 'weak') {
      entries.push({ atTurn: at, speaker: "Devil's Advocate", message: `I would not count that for ${c.label.toLowerCase()} yet — ${a.note}` });
    }
  }

  entries.push({
    atTurn: at,
    speaker: 'Decision Cortex',
    message: directive.readyToConclude
      ? `Overall confidence ${directive.overallConfidence}%. Coverage is sufficient — no further probing needed.`
      : `Overall confidence ${directive.overallConfidence}%. Highest remaining uncertainty: ${directive.targetLabel}. ${directive.rationale}`,
  });

  if (!directive.readyToConclude) {
    entries.push({ atTurn: at, speaker: 'Interview Lead', message: `Understood — next objective: ${directive.objective}` });
  }
  return entries;
}
