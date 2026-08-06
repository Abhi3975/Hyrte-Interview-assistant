import {
  EvaluationService,
  PARAMETER_TAXONOMY,
  PARAMETER_GROUPS,
  PARAMETER_COUNT,
  weightsForRole,
  benchmarkForRole,
  levelForScore,
} from '../src/evaluation/evaluation.service';

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
  // normalize() has no dependency on prisma/ai — safe to call directly against a bare instance.
  const service = new EvaluationService({} as never, {} as never) as unknown as {
    normalize: (core: any, params: any, context: { jobRole: string; category: string; difficulty: string }, items: { prompt: string; occurredAt?: string }[]) => any;
  };
  const context = { jobRole: 'Backend Engineer', category: 'ENGINEERING', difficulty: 'MEDIUM' };

  it('clamps out-of-range scores and defaults an invalid recommendation to NO_HIRE', () => {
    const result = service.normalize(
      { overallScore: 250, competencies: { communication: -10 }, strengths: [], weaknesses: [], summary: 'ok', recommendation: 'MAYBE_HIRE' },
      { scores: {} },
      context,
      [],
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
    );
    expect(result.perQuestion).toBeUndefined();
  });
});
