import type { CouncilStance, HiringOutcomeEventType, PerformanceRating } from '@prisma/client';
import { STANCE_SCORE } from '../../council-shared/council-core.service';

/**
 * §3.5 / §9 Learning Engine — "Decision Graph -> Hiring Outcome -> Model
 * Improvement".
 *
 * The write path for hiring outcomes has existed since the schema phase and
 * nothing ever read it. This is the read side: it asks, over sessions where
 * we eventually found out what happened, which council agents actually
 * predicted it — and turns that into the vote weights `tallyVotes` applies.
 *
 * Deterministic on purpose. The temptation here is to hand a model the
 * history and ask which signals mattered; that produces a confident answer
 * from four data points, which is worse than no answer. Everything below is
 * arithmetic you can check by hand, and it refuses to produce weights at all
 * until there is enough evidence to justify them.
 *
 * TWO LIMITS THAT ARE PROPERTIES OF THE PROBLEM, NOT BUGS — both are
 * reported rather than hidden:
 *
 *  1. SELECTIVE LABELS. We only ever learn what happened to candidates who
 *     were hired. A candidate the council rejected generates no evidence
 *     about whether rejecting them was right, so `labelOutcome` returns
 *     UNKNOWN for them rather than quietly scoring the rejection as correct.
 *     That means this measures "among people we hired, who saw it coming" —
 *     which is genuinely useful and is not the same as accuracy.
 *
 *  2. SMALL SAMPLES. Hiring outcomes arrive months apart. Weights are
 *     shrunk toward 1.0 by sample size and clamped to [0.5, 1.5], so no
 *     amount of early luck lets one agent dominate or silences another.
 */

/** The ground truth, where there is any. */
export type OutcomeLabel = 'SUCCESS' | 'FAILURE' | 'UNKNOWN';

export interface OutcomeEventLike {
  eventType: HiringOutcomeEventType;
  performanceRating?: PerformanceRating | null;
  occurredAt: Date;
}

/**
 * A hire who meets expectations was a correct hire — the question the council
 * answered was "should we hire this person", not "will they be exceptional".
 * Rating it as neither success nor failure would throw away most of the
 * evidence we have.
 */
const RATING_LABEL: Record<PerformanceRating, OutcomeLabel> = {
  HIGH_PERFORMER: 'SUCCESS',
  MEETS_EXPECTATIONS: 'SUCCESS',
  BELOW_EXPECTATIONS: 'FAILURE',
};

/** Below these, `calibrate` returns flat weights and says why. */
export const MIN_LABELLED_SESSIONS = 8;
export const MIN_PER_CLASS = 3;
/** An agent needs its own sample even when the overall set clears the gate. */
export const MIN_AGENT_SAMPLES = 6;
/** Empirical-Bayes shrinkage: at n = this, an agent gets half its measured adjustment. */
export const SHRINKAGE_PRIOR = 10;
/** Stance-score separation -> weight. Separation of 2 (a full stance step apart) earns the cap. */
export const WEIGHT_SENSITIVITY = 0.25;
export const MIN_WEIGHT = 0.5;
export const MAX_WEIGHT = 1.5;
/** Percentage points of stated-vs-actual gap tolerated before the cortex is called mis-calibrated. */
export const CONFIDENCE_TOLERANCE = 10;

/**
 * What actually happened to this candidate, from their outcome event stream.
 *
 * Walks newest-first and takes the first event that carries a real signal, so
 * a termination supersedes an earlier good checkpoint and a resignation with
 * no rating attached falls through to whatever we knew before it — people
 * resign for reasons that say nothing about the hiring decision.
 */
export function labelOutcome(events: OutcomeEventLike[]): OutcomeLabel {
  if (events.length === 0) return 'UNKNOWN';

  // Never hired: we did not get to observe the counterfactual, so this
  // session teaches us nothing. See SELECTIVE LABELS above.
  const wasHired = events.some((e) => e.eventType === 'HIRED');
  if (!wasHired) return 'UNKNOWN';

  const newestFirst = [...events].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  for (const event of newestFirst) {
    if (event.eventType === 'TERMINATED') return 'FAILURE';
    if (event.eventType === 'PROMOTED') return 'SUCCESS';
    if (event.performanceRating) return RATING_LABEL[event.performanceRating];
    // RESIGNED / HIRED with nothing attached: keep looking further back.
  }
  return 'UNKNOWN'; // Hired, still with us, no review yet.
}

export interface CalibrationSample {
  sessionId: string;
  label: 'SUCCESS' | 'FAILURE';
  /** Voting agents' stances on this session, keyed by agentKey. */
  stances: Record<string, CouncilStance>;
  /** Decision Cortex's stated confidence, when the report carried one. */
  confidencePercent?: number | null;
}

export type AgentVerdict = 'PREDICTIVE' | 'NEUTRAL' | 'ANTI_PREDICTIVE' | 'INSUFFICIENT';

export interface AgentCalibration {
  agentKey: string;
  n: number;
  /** Mean stance score (HIRE=2 .. NO_HIRE=-2) on the hires who worked out. */
  successMean: number;
  failureMean: number;
  /** successMean - failureMean. Zero means this agent said the same thing either way. */
  separation: number;
  weight: number;
  verdict: AgentVerdict;
}

export interface ConfidenceBin {
  lowerPercent: number;
  upperPercent: number;
  n: number;
  statedMean: number;
  actualSuccessRate: number;
}

export interface ConfidenceCalibration {
  bins: ConfidenceBin[];
  /** Positive = the cortex claimed more certainty than it earned. */
  overconfidenceGap: number;
  verdict: 'WELL_CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'INSUFFICIENT';
}

export interface CalibrationReport {
  totalLabelled: number;
  successes: number;
  failures: number;
  /** False until there is enough evidence; weights are all 1.0 until then. */
  sufficient: boolean;
  /** Plain English, shown to the recruiter as-is. Null once sufficient. */
  reason: string | null;
  agents: AgentCalibration[];
  confidence: ConfidenceCalibration | null;
  /** What `tallyVotes` multiplies by. Always populated; all 1.0 when not sufficient. */
  weights: Record<string, number>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The whole learning step. Pure: same samples in, same weights out.
 */
export function calibrate(samples: CalibrationSample[], agentKeys: string[]): CalibrationReport {
  const successes = samples.filter((s) => s.label === 'SUCCESS').length;
  const failures = samples.length - successes;
  const flat = Object.fromEntries(agentKeys.map((k) => [k, 1]));

  const insufficient = (reason: string): CalibrationReport => ({
    totalLabelled: samples.length,
    successes,
    failures,
    sufficient: false,
    reason,
    agents: [],
    confidence: null,
    weights: flat,
  });

  if (samples.length < MIN_LABELLED_SESSIONS) {
    return insufficient(
      `Only ${samples.length} of the hires made through HYRTE have a recorded outcome yet. ` +
        `The committee starts weighting its own members at ${MIN_LABELLED_SESSIONS}.`,
    );
  }
  if (successes < MIN_PER_CLASS || failures < MIN_PER_CLASS) {
    // Everything on one side of the line teaches nothing: an agent that said
    // HIRE every time looks perfect on an all-success history.
    return insufficient(
      `${successes} hires worked out and ${failures} did not. At least ${MIN_PER_CLASS} of each are needed ` +
        `before it is possible to tell a good judge from an agreeable one.`,
    );
  }

  const agents: AgentCalibration[] = agentKeys.map((agentKey) => {
    const scored = samples
      .filter((s) => s.stances[agentKey])
      .map((s) => ({ label: s.label, score: STANCE_SCORE[s.stances[agentKey]] }));
    const successScores = scored.filter((s) => s.label === 'SUCCESS').map((s) => s.score);
    const failureScores = scored.filter((s) => s.label === 'FAILURE').map((s) => s.score);

    if (scored.length < MIN_AGENT_SAMPLES || successScores.length === 0 || failureScores.length === 0) {
      return {
        agentKey,
        n: scored.length,
        successMean: round2(mean(successScores)),
        failureMean: round2(mean(failureScores)),
        separation: 0,
        weight: 1,
        verdict: 'INSUFFICIENT' as const,
      };
    }

    const successMean = mean(successScores);
    const failureMean = mean(failureScores);
    const separation = successMean - failureMean;

    // Shrink toward no-adjustment by sample size, then clamp. An agent is
    // never silenced (0.5 floor) and never becomes the committee (1.5 cap) —
    // this weights a panel, it does not replace one.
    const shrink = scored.length / (scored.length + SHRINKAGE_PRIOR);
    const weight = clamp(1 + separation * WEIGHT_SENSITIVITY * shrink, MIN_WEIGHT, MAX_WEIGHT);

    const verdict: AgentVerdict = separation > 0.5 ? 'PREDICTIVE' : separation < -0.5 ? 'ANTI_PREDICTIVE' : 'NEUTRAL';

    return {
      agentKey,
      n: scored.length,
      successMean: round2(successMean),
      failureMean: round2(failureMean),
      separation: round2(separation),
      weight: round2(weight),
      verdict,
    };
  });

  return {
    totalLabelled: samples.length,
    successes,
    failures,
    sufficient: true,
    reason: null,
    agents,
    confidence: calibrateConfidence(samples),
    weights: Object.fromEntries(agents.map((a) => [a.agentKey, a.weight])),
  };
}

/**
 * Was the Decision Cortex's stated confidence worth anything? Bins sessions by
 * what it claimed and compares that against how often it was actually right.
 */
export function calibrateConfidence(samples: CalibrationSample[]): ConfidenceCalibration {
  const withConfidence = samples.filter((s) => typeof s.confidencePercent === 'number');
  if (withConfidence.length < MIN_LABELLED_SESSIONS) {
    return { bins: [], overconfidenceGap: 0, verdict: 'INSUFFICIENT' };
  }

  const edges = [
    [0, 60],
    [60, 75],
    [75, 90],
    [90, 101],
  ];
  const bins: ConfidenceBin[] = [];
  for (const [lowerPercent, upperPercent] of edges) {
    const inBin = withConfidence.filter(
      (s) => (s.confidencePercent as number) >= lowerPercent && (s.confidencePercent as number) < upperPercent,
    );
    if (inBin.length === 0) continue;
    bins.push({
      lowerPercent,
      upperPercent: Math.min(upperPercent, 100),
      n: inBin.length,
      statedMean: round2(mean(inBin.map((s) => s.confidencePercent as number))),
      actualSuccessRate: round2((inBin.filter((s) => s.label === 'SUCCESS').length / inBin.length) * 100),
    });
  }

  // Weight each bin by how many sessions it holds, so a bin of one does not
  // set the verdict for the whole engine.
  const totalN = bins.reduce((sum, b) => sum + b.n, 0);
  const overconfidenceGap = totalN
    ? round2(bins.reduce((sum, b) => sum + (b.statedMean - b.actualSuccessRate) * b.n, 0) / totalN)
    : 0;

  const verdict =
    Math.abs(overconfidenceGap) <= CONFIDENCE_TOLERANCE
      ? 'WELL_CALIBRATED'
      : overconfidenceGap > 0
        ? 'OVERCONFIDENT'
        : 'UNDERCONFIDENT';

  return { bins, overconfidenceGap, verdict };
}
