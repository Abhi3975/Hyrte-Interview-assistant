import type { ProctorEvent } from '@prisma/client';
import { buildProctoringContext, PROCTORING_MEASURED_KEYS } from '../src/evaluation/proctoring-signals';
import { RiskEngine } from '../src/proctoring/risk-engine.service';

/**
 * Multi-modal signals — the camera and screen reaching the evaluation that
 * scores a candidate on them.
 *
 * The bug this closes: the 84-parameter framework has always asked the model
 * to score `proctoring_risk`, and `evaluateSession` fetched the interview and
 * the answers and nothing else. A number shown to a recruiter as a proctoring
 * measurement was produced by a model that had never seen a proctoring
 * observation.
 */

const engine = new RiskEngine();

const event = (type: string, secondsAgo: number): ProctorEvent =>
  ({
    id: `e-${type}-${secondsAgo}`,
    sessionId: 's1',
    type: type as ProctorEvent['type'],
    severity: 'MEDIUM' as ProctorEvent['severity'],
    payload: {},
    evidenceUrl: null,
    provider: 'internal',
    occurredAt: new Date(Date.now() - secondsAgo * 1000),
  }) as ProctorEvent;

describe('a session nobody watched', () => {
  const ctx = buildProctoringContext([], null);

  it('is marked unmeasured rather than scored', () => {
    expect(ctx.measured).toBe(false);
    expect(ctx.interpretation).toMatch(/not measured/i);
  });

  it('does not let an absent measurement become a penalty', () => {
    // 100 is "least risky" on this framework's scale. Nothing was observed, so
    // nothing counts against the candidate.
    expect(ctx.proctoringScore).toBe(100);
  });

  it('tells the evaluator it has no evidence, instead of leaving it to infer', () => {
    expect(ctx.observationBlock).toMatch(/no observational evidence/i);
    expect(ctx.observationBlock).toMatch(/do not infer/i);
  });
});

describe('a session that was watched', () => {
  const events = [
    ...Array.from({ length: 4 }, (_, i) => event('MULTIPLE_FACES', 30 + i * 10)),
    ...Array.from({ length: 3 }, (_, i) => event('LOOKING_AWAY', 60 + i * 10)),
  ];
  const ctx = buildProctoringContext(events, engine.compute(events));

  it('reports what was actually seen, with counts', () => {
    expect(ctx.measured).toBe(true);
    expect(ctx.observationBlock).toMatch(/multiple faces ×4/i);
    expect(ctx.observationBlock).toMatch(/looking away ×3/i);
  });

  it('marks the observations as facts, not as the model\'s own inference', () => {
    expect(ctx.observationBlock).toMatch(/observed facts, not inferences/i);
  });

  it('carries the risk engine\'s number, not a number to be invented', () => {
    const risk = engine.compute(events);
    expect(ctx.proctoringScore).toBe(100 - Math.round(risk.riskScore));
    expect(ctx.interpretation).toMatch(/computed from 7 proctoring observations/i);
  });

  it('warns the evaluator off double-counting the score as its own finding', () => {
    expect(ctx.observationBlock).toMatch(/do NOT restate the risk score/i);
  });

  it('warns against reading a lighting blip as dishonesty', () => {
    expect(ctx.observationBlock).toMatch(/lighting/i);
    expect(ctx.observationBlock).toMatch(/not.*evidence of dishonesty/i);
  });
});

describe('the scale conversion', () => {
  it('flips the risk engine\'s direction to the framework\'s', () => {
    // RiskEngine: 100 = worst. The framework: 100 = best. Getting this
    // backwards would invert every proctoring verdict silently.
    const clean = [event('LOOKING_AWAY', 500), event('LOOKING_AWAY', 490)];
    const bad = Array.from({ length: 8 }, (_, i) => event('SECOND_VOICE_DETECTED', 10 + i * 5));

    const cleanCtx = buildProctoringContext(clean, engine.compute(clean));
    const badCtx = buildProctoringContext(bad, engine.compute(bad));
    expect(cleanCtx.proctoringScore).toBeGreaterThan(badCtx.proctoringScore);
  });

  it('stays inside 0-100 whatever the engine produces', () => {
    const extreme = Array.from({ length: 200 }, (_, i) => event('REMOTE_ACCESS_DETECTED', i));
    const ctx = buildProctoringContext(extreme, engine.compute(extreme));
    expect(ctx.proctoringScore).toBeGreaterThanOrEqual(0);
    expect(ctx.proctoringScore).toBeLessThanOrEqual(100);
  });

  it('says when the evidence is too thin to lean on', () => {
    const thin = [event('LOOKING_AWAY', 20), event('LOOKING_AWAY', 25)];
    const ctx = buildProctoringContext(thin, engine.compute(thin));
    expect(ctx.interpretation).toMatch(/weak rather than conclusive|substantial evidence|computed from/i);
  });
});

describe('which parameters stop being guessed', () => {
  it('takes proctoring_risk away from the model entirely', () => {
    expect(PROCTORING_MEASURED_KEYS).toContain('proctoring_risk');
  });

  it('leaves the judgment calls with the model, now that it can see the evidence', () => {
    // coaching_suspicion and ai_assist_signal legitimately combine what was
    // observed with how the candidate answered — those stay scored, but no
    // longer blind.
    expect(PROCTORING_MEASURED_KEYS).not.toContain('coaching_suspicion');
    expect(PROCTORING_MEASURED_KEYS).not.toContain('ai_assist_signal');
  });
});
