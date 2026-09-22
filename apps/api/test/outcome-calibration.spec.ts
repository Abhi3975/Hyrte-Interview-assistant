import type { CouncilStance, HiringOutcomeEventType, PerformanceRating } from '@prisma/client';
import {
  MAX_WEIGHT,
  MIN_PER_CLASS,
  MIN_WEIGHT,
  calibrate,
  calibrateConfidence,
  labelOutcome,
  type CalibrationSample,
} from '../src/hyrte/learning/outcome-calibration';
import { CouncilCoreService, type AgentResult } from '../src/council-shared/council-core.service';
import { COUNCIL_AGENTS } from '../src/council-shared/council-agents.config';

/**
 * §9 Learning Engine — "Decision Graph → Hiring Outcome → Model Improvement".
 *
 * The thing worth guarding here is not that the arithmetic runs; it is that
 * the engine stays honest about what it does and does not know. Most of these
 * tests are about it REFUSING to learn.
 */

const ev = (eventType: HiringOutcomeEventType, daysAgo: number, performanceRating?: PerformanceRating) => ({
  eventType,
  performanceRating: performanceRating ?? null,
  occurredAt: new Date(Date.now() - daysAgo * 86_400_000),
});

describe('what actually happened to the candidate', () => {
  it('learns nothing from a rejection — we never got to see whether it was right', () => {
    // The selective-labels problem, stated as a test: scoring a rejection as a
    // correct call would make every agent look good for saying no.
    expect(labelOutcome([ev('REJECTED', 200)])).toBe('UNKNOWN');
    expect(labelOutcome([ev('WITHDREW', 200)])).toBe('UNKNOWN');
    expect(labelOutcome([ev('OFFER_DECLINED', 200)])).toBe('UNKNOWN');
  });

  it('waits for a review rather than counting a fresh hire as a success', () => {
    expect(labelOutcome([ev('HIRED', 20)])).toBe('UNKNOWN');
  });

  it('reads a performance review as the verdict', () => {
    expect(labelOutcome([ev('HIRED', 300), ev('RETENTION_CHECKPOINT', 90, 'HIGH_PERFORMER')])).toBe('SUCCESS');
    expect(labelOutcome([ev('HIRED', 300), ev('RETENTION_CHECKPOINT', 90, 'BELOW_EXPECTATIONS')])).toBe('FAILURE');
  });

  it('counts a hire who meets expectations as a correct hire', () => {
    // The council was asked "should we hire this person", not "will they be
    // exceptional". Treating the middle of the scale as no-signal would throw
    // away most of the evidence that exists.
    expect(labelOutcome([ev('HIRED', 300), ev('RETENTION_CHECKPOINT', 60, 'MEETS_EXPECTATIONS')])).toBe('SUCCESS');
  });

  it('lets a later termination override an earlier good review', () => {
    const events = [ev('HIRED', 400), ev('RETENTION_CHECKPOINT', 300, 'HIGH_PERFORMER'), ev('TERMINATED', 30)];
    expect(labelOutcome(events)).toBe('FAILURE');
  });

  it('does not read a resignation as a failure', () => {
    // People leave for reasons that say nothing about the hiring decision, so
    // a bare resignation falls through to what was actually known before it.
    const withHistory = [ev('HIRED', 400), ev('RETENTION_CHECKPOINT', 200, 'HIGH_PERFORMER'), ev('RESIGNED', 10)];
    expect(labelOutcome(withHistory)).toBe('SUCCESS');
    expect(labelOutcome([ev('HIRED', 400), ev('RESIGNED', 10)])).toBe('UNKNOWN');
  });

  it('treats a promotion as the clearest success there is', () => {
    expect(labelOutcome([ev('HIRED', 500), ev('PROMOTED', 40)])).toBe('SUCCESS');
  });

  it('handles an empty history without throwing', () => {
    expect(labelOutcome([])).toBe('UNKNOWN');
  });
});

const VOTERS = COUNCIL_AGENTS.filter((a) => a.votes).map((a) => a.key);

/** n sessions where `oracle` called it right and `yesMan` always said HIRE. */
function samples(successes: number, failures: number, confidence?: (label: 'SUCCESS' | 'FAILURE') => number): CalibrationSample[] {
  const make = (label: 'SUCCESS' | 'FAILURE', i: number): CalibrationSample => ({
    sessionId: `${label}-${i}`,
    label,
    stances: {
      interviewLead: (label === 'SUCCESS' ? 'HIRE' : 'NO_HIRE') as CouncilStance, // the oracle
      hiringManager: 'HIRE' as CouncilStance, // the yes-man
      functionalExpert: (label === 'SUCCESS' ? 'NO_HIRE' : 'HIRE') as CouncilStance, // backwards
      futureTeammate: (label === 'SUCCESS' ? 'HIRE' : 'LEAN_HIRE') as CouncilStance, // mildly useful
      executiveFounder: 'LEAN_HIRE' as CouncilStance,
    },
    ...(confidence ? { confidencePercent: confidence(label) } : {}),
  });
  return [
    ...Array.from({ length: successes }, (_, i) => make('SUCCESS', i)),
    ...Array.from({ length: failures }, (_, i) => make('FAILURE', i)),
  ];
}

describe('refusing to learn from too little', () => {
  it('will not weight anyone off a handful of outcomes, and says so in plain English', () => {
    const report = calibrate(samples(3, 2), VOTERS);
    expect(report.sufficient).toBe(false);
    expect(report.reason).toMatch(/recorded outcome/i);
    expect(Object.values(report.weights).every((w) => w === 1)).toBe(true);
  });

  it('will not learn from a history where every hire worked out', () => {
    // The trap this exists to avoid: on an all-success history, an agent who
    // says HIRE to everybody scores perfectly.
    const report = calibrate(samples(20, 0), VOTERS);
    expect(report.sufficient).toBe(false);
    expect(report.reason).toMatch(/agreeable/i);
    expect(report.weights.hiringManager).toBe(1);
  });

  it('needs both sides of the line, not just a large sample', () => {
    expect(calibrate(samples(30, MIN_PER_CLASS - 1), VOTERS).sufficient).toBe(false);
    expect(calibrate(samples(30, MIN_PER_CLASS), VOTERS).sufficient).toBe(true);
  });

  it('reports what it has even while refusing to act on it', () => {
    const report = calibrate(samples(4, 1), VOTERS);
    expect(report.totalLabelled).toBe(5);
    expect(report.successes).toBe(4);
    expect(report.failures).toBe(1);
  });
});

describe('who the committee learns to trust', () => {
  const report = calibrate(samples(12, 8), VOTERS);

  it('promotes the member whose stance actually tracked the outcome', () => {
    const oracle = report.agents.find((a) => a.agentKey === 'interviewLead')!;
    expect(oracle.verdict).toBe('PREDICTIVE');
    expect(oracle.weight).toBeGreaterThan(1);
  });

  it('does not reward a member who voted HIRE on everyone', () => {
    // Accurate on a mostly-successful history, and worth nothing: they said
    // the same thing about the hires who failed.
    const yesMan = report.agents.find((a) => a.agentKey === 'hiringManager')!;
    expect(yesMan.separation).toBe(0);
    expect(yesMan.verdict).toBe('NEUTRAL');
    expect(yesMan.weight).toBe(1);
  });

  it('demotes a member who got it backwards, without silencing them', () => {
    const backwards = report.agents.find((a) => a.agentKey === 'functionalExpert')!;
    expect(backwards.verdict).toBe('ANTI_PREDICTIVE');
    expect(backwards.weight).toBeLessThan(1);
    // Never inverted into a negative vote and never zeroed — on this much
    // evidence that would be overfitting, not learning.
    expect(backwards.weight).toBeGreaterThanOrEqual(MIN_WEIGHT);
  });

  it('keeps every weight inside its bounds however lopsided the history', () => {
    for (const a of calibrate(samples(40, 40), VOTERS).agents) {
      expect(a.weight).toBeGreaterThanOrEqual(MIN_WEIGHT);
      expect(a.weight).toBeLessThanOrEqual(MAX_WEIGHT);
    }
  });

  it('moves further on more evidence than on less, for the same observed skill', () => {
    // Shrinkage: an agent who called 5-and-5 right is less proven than one who
    // called 40-and-40 right, even though the separation is identical.
    // Measured on the mildly-useful voter — a perfect oracle's raw adjustment
    // exceeds the clamp at either sample size, so the cap hides the effect.
    const thin = calibrate(samples(5, 5), VOTERS).agents.find((a) => a.agentKey === 'futureTeammate')!;
    const thick = calibrate(samples(40, 40), VOTERS).agents.find((a) => a.agentKey === 'futureTeammate')!;
    expect(thin.separation).toBeCloseTo(thick.separation);
    expect(thin.weight).toBeGreaterThan(1);
    expect(thick.weight).toBeGreaterThan(thin.weight);
  });

  it('caps a member who looks like an oracle, however long the run', () => {
    // The clamp is what stops one member becoming the committee on a streak.
    const oracle = calibrate(samples(40, 40), VOTERS).agents.find((a) => a.agentKey === 'interviewLead')!;
    expect(oracle.weight).toBe(MAX_WEIGHT);
  });

  it('leaves an agent who was not in the room at 1.0 rather than guessing', () => {
    const partial = samples(12, 8).map((s) => ({ ...s, stances: { ...s.stances, executiveFounder: undefined as never } }));
    const out = calibrate(partial, VOTERS).agents.find((a) => a.agentKey === 'executiveFounder')!;
    expect(out.verdict).toBe('INSUFFICIENT');
    expect(out.weight).toBe(1);
  });
});

describe('whether the cortex\'s stated confidence was worth anything', () => {
  it('catches a cortex that claims more certainty than it earns', () => {
    const overconfident = calibrateConfidence(samples(6, 6, () => 95));
    expect(overconfident.verdict).toBe('OVERCONFIDENT');
    expect(overconfident.overconfidenceGap).toBeGreaterThan(0);
  });

  it('calls it well calibrated when the claim matches reality', () => {
    // Claims ~50% on a set it gets right half the time.
    const honest = calibrateConfidence(samples(6, 6, () => 55));
    expect(honest.verdict).toBe('WELL_CALIBRATED');
  });

  it('says nothing at all rather than guessing from a few reports', () => {
    expect(calibrateConfidence(samples(2, 1, () => 90)).verdict).toBe('INSUFFICIENT');
    expect(calibrateConfidence(samples(12, 8)).verdict).toBe('INSUFFICIENT'); // no confidence recorded
  });
});

describe('how the weights reach the vote', () => {
  const core = new CouncilCoreService(null as never);
  const voters = (stances: CouncilStance[]): AgentResult[] =>
    stances.map((stance, i) => ({ agent: COUNCIL_AGENTS.filter((a) => a.votes)[i], result: { stance } }));

  it('is exactly the old unweighted mean when nothing has been learned yet', () => {
    const results = voters(['HIRE', 'LEAN_HIRE', 'NO_HIRE', 'LEAN_HIRE', 'HIRE']);
    const flat = Object.fromEntries(VOTERS.map((k) => [k, 1]));
    expect(core.tallyVotes(results, flat).avg).toBeCloseTo(core.tallyVotes(results).avg);
  });

  it('lets a proven member pull the committee toward their call', () => {
    const results = voters(['NO_HIRE', 'HIRE', 'HIRE', 'HIRE', 'HIRE']);
    const unweighted = core.tallyVotes(results).avg;
    const trustDissenter = core.tallyVotes(results, { ...Object.fromEntries(VOTERS.map((k) => [k, 1])), interviewLead: 1.5 });
    expect(trustDissenter.avg).toBeLessThan(unweighted);
  });

  it('is a weighted mean, so turning members up cannot inflate the lean past a unanimous vote', () => {
    const unanimous = voters(['HIRE', 'HIRE', 'HIRE', 'HIRE', 'HIRE']);
    const heavy = Object.fromEntries(VOTERS.map((k) => [k, MAX_WEIGHT]));
    expect(core.tallyVotes(unanimous, heavy).avg).toBeCloseTo(2); // HIRE, not 3
  });

  it('still reports the real number of voters, not the weight total', () => {
    const results = voters(['HIRE', 'HIRE', 'NO_HIRE', 'HIRE', 'HIRE']);
    expect(core.tallyVotes(results, Object.fromEntries(VOTERS.map((k) => [k, 1.5]))).voterCount).toBe(5);
  });
});
