import {
  EvaluationService,
  PARAMETER_TAXONOMY,
  PARAMETER_GROUPS,
  PARAMETER_COUNT,
  weightsForRole,
  benchmarkForRole,
  levelForScore,
} from '../src/evaluation/evaluation.service';
import { buildProctoringContext } from '../src/evaluation/proctoring-signals';

describe('P5 — parameter taxonomy is fixed in code, not invented per call', () => {
  it('has exactly 84 parameters across the 7 documented groups', () => {
    expect(PARAMETER_GROUPS).toEqual(['communication', 'technical', 'behavioral', 'confidence', 'cognitive', 'risk', 'hiring_readiness']);
    expect(PARAMETER_COUNT).toBe(84);
    const total = PARAMETER_GROUPS.reduce((n, g) => n + PARAMETER_TAXONOMY[g].length, 0);
    expect(total).toBe(84);
  });

  it('every parameter key is globally unique (no cross-group collisions)', () => {
    const keys = PARAMETER_GROUPS.flatMap((g) => PARAMETER_TAXONOMY[g].map((p) => p.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every parameter has a non-empty human label', () => {
    for (const group of PARAMETER_GROUPS) {
      for (const p of PARAMETER_TAXONOMY[group]) {
        expect(p.label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('levelForScore (deterministic skill-card bucketing, never trusted from the LLM)', () => {
  it('buckets at the documented boundaries', () => {
    expect(levelForScore(0)).toBe('Weak');
    expect(levelForScore(40)).toBe('Weak');
    expect(levelForScore(41)).toBe('Decent');
    expect(levelForScore(65)).toBe('Decent');
    expect(levelForScore(66)).toBe('Good');
    expect(levelForScore(85)).toBe('Good');
    expect(levelForScore(86)).toBe('Strong');
    expect(levelForScore(100)).toBe('Strong');
  });
});

describe('weightsForRole (deterministic per-role weighting, not LLM-guessed)', () => {
  it('weights sales/behavioral roles toward communication & behavioral', () => {
    const w = weightsForRole('Senior Sales Executive', 'SALES');
    expect(w.communication).toBeGreaterThan(w.technical);
    expect(w.behavioral).toBeGreaterThan(w.technical);
  });

  it('weights engineering roles toward technical & cognitive', () => {
    const w = weightsForRole('Backend Engineer', 'ENGINEERING');
    expect(w.technical).toBeGreaterThan(w.communication);
    expect(w.cognitive).toBeGreaterThan(w.communication);
  });

  it('falls back to equal (1) weighting for an unrecognized role, never a silent zero', () => {
    const w = weightsForRole('Mystery Role', 'OTHER');
    for (const g of PARAMETER_GROUPS) expect(w[g]).toBe(1);
  });
});

describe('benchmarkForRole (deterministic target bar, not fabricated population stats)', () => {
  it('sets a higher bar for senior/staff/lead roles', () => {
    expect(benchmarkForRole('Senior Backend Engineer')).toBe(80);
    expect(benchmarkForRole('Staff Engineer')).toBe(80);
  });
  it('sets a lower bar for junior/intern roles', () => {
    expect(benchmarkForRole('Junior Developer')).toBe(60);
    expect(benchmarkForRole('Intern')).toBe(60);
  });
  it('defaults to a mid-level bar otherwise', () => {
    expect(benchmarkForRole('Backend Engineer')).toBe(70);
  });
});

describe('EvaluationService.normalize (repairs malformed/partial LLM output, never trusts it blindly)', () => {
  // normalize() has no dependency on prisma/ai/riskEngine — safe to call directly against a bare instance.
  const service = new EvaluationService({} as never, {} as never, {} as never) as unknown as {
    normalize: (
      core: any,
      params: any,
      context: { jobRole: string; category: string; difficulty: string },
      items: { prompt: string; occurredAt?: string }[],
      proctoring: ReturnType<typeof buildProctoringContext>,
    ) => any;
  };
  const context = { jobRole: 'Backend Engineer', category: 'ENGINEERING', difficulty: 'MEDIUM' };
  // These cases are about repairing malformed model output, not about
  // proctoring — the no-proctoring context is the honest default.
  const noProctoring = buildProctoringContext([], null);

  it('clamps out-of-range scores and defaults an invalid recommendation to NO_HIRE', () => {
    const result = service.normalize(
      { overallScore: 250, competencies: { communication: -10 }, strengths: [], weaknesses: [], summary: 'ok', recommendation: 'MAYBE_HIRE' },
      { scores: {} },
      context,
      [],
      noProctoring,
    );
    expect(result.overallScore).toBe(100);
    expect(result.competencies.communication).toBe(0);
    expect(result.recommendation).toBe('NO_HIRE');
  });

  it('always produces exactly 84 parameter entries even when the model returns none', () => {
    const result = service.normalize(
      { overallScore: 50, competencies: {}, strengths: [], weaknesses: [], summary: '', recommendation: 'HIRE' },
      { scores: {} },
      context,
      [],
      noProctoring,
    );
    expect(result.parameterScores).toHaveLength(84);
    // every entry still carries a non-empty interpretation, per the "never a bare number" rule
    for (const p of result.parameterScores) expect(p.interpretation.length).toBeGreaterThan(0);
  });

  it('produces all 6 skill cards with a deterministic level, defaulting missing ones to score 0 / Weak', () => {
    const result = service.normalize(
      { overallScore: 50, competencies: {}, strengths: [], weaknesses: [], summary: '', recommendation: 'HIRE', skillCards: [{ key: 'communication', score: 95, instanceNote: 'Clear articulation in Q2.' }] },
      { scores: {} },
      context,
      [],
      noProctoring,
    );
    expect(result.skillCards).toHaveLength(6);
    const comm = result.skillCards.find((c: any) => c.key === 'communication');
    expect(comm.level).toBe('Strong');
    const missing = result.skillCards.find((c: any) => c.key === 'code_quality');
    expect(missing.level).toBe('Weak');
    expect(missing.instanceNote.length).toBeGreaterThan(0);
  });

  it('clamps per-question scores to 0-5 and preserves occurredAt for recording deep links', () => {
    const items = [{ prompt: 'Q1', occurredAt: '2026-01-01T00:00:00.000Z' }, { prompt: 'Q2' }];
    const result = service.normalize(
      { overallScore: 50, competencies: {}, strengths: [], weaknesses: [], summary: '', recommendation: 'HIRE', perQuestion: [{ score: 99, notes: 'n1' }] },
      { scores: {} },
      context,
      items,
      noProctoring,
    );
    expect(result.perQuestion).toHaveLength(2);
    expect(result.perQuestion[0].score).toBe(5);
    expect(result.perQuestion[0].occurredAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.perQuestion[1].score).toBe(0); // missing entry defaults, doesn't throw
    expect(result.perQuestion[1].occurredAt).toBeUndefined();
  });

  it('omits perQuestion entirely for the stateless no-items path (no fake 0/5 rows)', () => {
    const result = service.normalize(
      { overallScore: 50, competencies: {}, strengths: [], weaknesses: [], summary: '', recommendation: 'HIRE' },
      { scores: {} },
      context,
      [],
      noProctoring,
    );
    expect(result.perQuestion).toBeUndefined();
  });
});

describe('risk parameters cannot be scored backwards', () => {
  // Verified live on production before this existed: one response contained
  // "Bluff probability: 90 — appeared genuine and credible" AND "AI-assist /
  // plagiarism signal: 0 — No indication of AI assistance was present". On a
  // 100-is-best scale those mean opposite things, and the recruiter saw a red
  // 0 next to text saying there was nothing wrong. The prompt had asked the
  // model to invert its own intuition for 12 parameters; it complied for nine.
  const riskKeys = PARAMETER_TAXONOMY.risk.map((p) => p.key);
  const service = new EvaluationService({} as never, {} as never, {} as never) as unknown as {
    normalize: (core: any, params: any, context: any, items: any[], proctoring: any) => any;
  };
  const context = { jobRole: 'Backend Engineer', category: 'ENGINEERING', difficulty: 'MEDIUM' };
  const noProctoring = buildProctoringContext([], null);
  const evaluate = (scores: Record<string, unknown>) =>
    service.normalize(
      { overallScore: 50, competencies: {}, strengths: [], weaknesses: [], summary: '', recommendation: 'HIRE' },
      { scores },
      context,
      [],
      noProctoring,
    );

  const find = (result: any, key: string) => result.parameterScores.find((p: any) => p.key === key);

  it('reads "no risk seen" as a good result, not a zero', () => {
    const out = evaluate({ ai_assist_signal: { riskLevel: 'none', interpretation: 'No indication of AI assistance.' } });
    expect(find(out, 'ai_assist_signal').score).toBe(100);
  });

  it('reads a serious risk as a bad one', () => {
    const out = evaluate({ ai_assist_signal: { riskLevel: 'severe', interpretation: 'Answers matched a public source verbatim.' } });
    expect(find(out, 'ai_assist_signal').score).toBeLessThan(20);
  });

  it('orders the levels monotonically, so the scale cannot fold over', () => {
    const levels = ['none', 'low', 'moderate', 'high', 'severe'];
    const scores = levels.map((riskLevel) => find(evaluate({ evasiveness: { riskLevel, interpretation: 'x' } }), 'evasiveness').score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
  });

  it('ignores a score the model volunteered alongside a level', () => {
    // This is the exact failure: a 0 that meant "no risk" on a scale where 0
    // is the worst possible value.
    const out = evaluate({ coaching_suspicion: { score: 0, riskLevel: 'none', interpretation: 'No signs of coaching.' } });
    expect(find(out, 'coaching_suspicion').score).toBe(100);
  });

  it('falls back to the raw score rather than reporting an unanswered risk as clean', () => {
    // A missing or unrecognised level must not silently become "none" — that
    // would turn every non-compliant response into a perfect risk profile.
    expect(find(evaluate({ evasiveness: { score: 40, interpretation: 'x' } }), 'evasiveness').score).toBe(40);
    expect(find(evaluate({ evasiveness: { score: 40, riskLevel: 'banana', interpretation: 'x' } }), 'evasiveness').score).toBe(40);
  });

  it('leaves ordinary parameters scored the way they always were', () => {
    const out = evaluate({ clarity: { score: 82, interpretation: 'Clear throughout.' } });
    expect(find(out, 'clarity').score).toBe(82);
    // ...and a riskLevel on a non-risk parameter is meaningless and ignored.
    expect(find(evaluate({ clarity: { score: 82, riskLevel: 'severe', interpretation: 'x' } }), 'clarity').score).toBe(82);
  });

  it('covers every risk parameter, not just the three that were caught', () => {
    const out = evaluate(Object.fromEntries(riskKeys.map((k) => [k, { riskLevel: 'none', interpretation: 'x' }])));
    for (const key of riskKeys) {
      if (key === 'proctoring_risk') continue; // computed by the risk engine, not scored
      expect(find(out, key).score).toBe(100);
    }
  });
});
