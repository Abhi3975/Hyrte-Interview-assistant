import { CandidateMemoryService } from '../src/interview-intelligence/candidate-memory.service';
import { resolveCompetencies } from '../src/interview-intelligence/competency-model';
import { applyAssessments, applyHistoricalScrutiny, initLiveState, PROVEN_CONFIDENCE } from '../src/interview-intelligence/live-interview-state';

/**
 * Checklist #9 / emotionally-adaptive Layer 3 — "Last time you struggled with
 * structuring answers — try using frameworks here."
 */

function serviceWith(reports: { developmentAreas: string[]; generatedAt: Date }[]) {
  const prisma = { hyrteInterviewReport: { findMany: jest.fn().mockResolvedValue(reports) } };
  return new CandidateMemoryService(prisma as never);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('recurring weaknesses', () => {
  it('counts a weakness that has come back across sessions as a pattern', async () => {
    const svc = serviceWith([
      { developmentAreas: ['Answers lacked a clear structure'], generatedAt: daysAgo(2) },
      { developmentAreas: ['Struggled to structure answers clearly'], generatedAt: daysAgo(9) },
    ]);
    const [top] = await svc.getRecurringWeaknesses('candidate-1');
    expect(top.timesSeen).toBe(2);
  });

  it('merges the same weakness written two different ways', async () => {
    const svc = serviceWith([
      { developmentAreas: ['Answers lacked a clear structure'], generatedAt: daysAgo(1) },
      { developmentAreas: ['Structure of the answers was unclear'], generatedAt: daysAgo(5) },
    ]);
    expect(await svc.getRecurringWeaknesses('candidate-1')).toHaveLength(1);
  });

  it('ranks the most persistent weakness first', async () => {
    const svc = serviceWith([
      { developmentAreas: ['Answers lacked a clear structure', 'Did not quantify business impact'], generatedAt: daysAgo(1) },
      { developmentAreas: ['Answers lacked a clear structure'], generatedAt: daysAgo(5) },
      { developmentAreas: ['Answers lacked a clear structure'], generatedAt: daysAgo(9) },
    ]);
    const ranked = await svc.getRecurringWeaknesses('candidate-1');
    expect(ranked[0].timesSeen).toBe(3);
  });

  it('returns an empty list for a first-time candidate rather than throwing', async () => {
    expect(await serviceWith([]).getRecurringWeaknesses('new-candidate')).toEqual([]);
  });

  it('survives a database failure without breaking the interview', async () => {
    const prisma = { hyrteInterviewReport: { findMany: jest.fn().mockRejectedValue(new Error('db down')) } };
    const svc = new CandidateMemoryService(prisma as never);
    expect(await svc.getRecurringWeaknesses('candidate-1')).toEqual([]);
  });
});

describe('the callback the interviewer says', () => {
  const svc = serviceWith([]);

  it('says nothing about a one-off — a single bad session is not a pattern', () => {
    expect(svc.buildCallback([{ area: 'Answers lacked a clear structure', timesSeen: 1, lastSeenAt: daysAgo(3) }])).toBeNull();
  });

  it('raises a weakness only once it has genuinely recurred', () => {
    const out = svc.buildCallback([{ area: 'Answers lacked a clear structure', timesSeen: 2, lastSeenAt: daysAgo(3) }]);
    expect(out).toContain('Answers lacked a clear structure');
  });

  it('frames it as coaching, never as a charge — the system builds confidence while it evaluates', () => {
    const out = svc.buildCallback([{ area: 'Answers lacked a clear structure', timesSeen: 3, lastSeenAt: daysAgo(1) }])!;
    expect(out).toContain('never as criticism');
    expect(out).toContain('working on');
    expect(out).toContain('do not list it as a failing');
    // The interviewer must not leak the machinery to the candidate.
    expect(out).toContain('never mention reports or scores');
  });

  it('prefers a weakness that bears on what is being probed right now', () => {
    const weaknesses = [
      { area: 'Did not quantify business impact', timesSeen: 3, lastSeenAt: daysAgo(1) },
      { area: 'Stakeholder management was not evidenced', timesSeen: 2, lastSeenAt: daysAgo(4) },
    ];
    const out = svc.buildCallback(weaknesses, 'Stakeholder management')!;
    expect(out).toContain('Stakeholder management');
  });

  it('falls back to the most persistent weakness when nothing matches the current probe', () => {
    const weaknesses = [{ area: 'Did not quantify business impact', timesSeen: 3, lastSeenAt: daysAgo(1) }];
    expect(svc.buildCallback(weaknesses, 'Debugging & diagnosis')).toContain('quantify business impact');
  });
});

describe('what the committee does with the same memory', () => {
  const svc = serviceWith([]);

  it('matches a recurring weakness onto the competency it concerns', () => {
    const competencies = resolveCompetencies('Product Manager');
    const keys = svc.matchWeaknessesToCompetencies(
      [{ area: 'Stakeholder management was repeatedly unevidenced', timesSeen: 2, lastSeenAt: daysAgo(2) }],
      competencies,
    );
    expect(keys).toContain('stakeholder_mgmt');
  });

  it('ignores a one-off rather than holding a competency to a higher bar over one bad day', () => {
    const keys = svc.matchWeaknessesToCompetencies(
      [{ area: 'Stakeholder management was not evidenced', timesSeen: 1, lastSeenAt: daysAgo(2) }],
      resolveCompetencies('Product Manager'),
    );
    expect(keys).toEqual([]);
  });

  it('makes a historically weak competency genuinely harder to prove', () => {
    const base = initLiveState(resolveCompetencies('Product Manager'));
    const scrutinised = applyHistoricalScrutiny(base, ['product_judgment']);

    const assess = [{ competencyKey: 'product_judgment', strength: 'strong' as const, note: 'n' }];
    const normalAfterTwo = applyAssessments(applyAssessments(base, assess, null), assess, null);
    const scrutinisedAfterTwo = applyAssessments(applyAssessments(scrutinised, assess, null), assess, null);

    const normal = normalAfterTwo.competencies.find((c) => c.key === 'product_judgment')!.confidence;
    const held = scrutinisedAfterTwo.competencies.find((c) => c.key === 'product_judgment')!.confidence;
    expect(held).toBeLessThan(normal);
  });

  it('still lets a candidate who has genuinely improved clear the bar', () => {
    let state = applyHistoricalScrutiny(initLiveState(resolveCompetencies('Product Manager')), ['product_judgment']);
    const assess = [{ competencyKey: 'product_judgment', strength: 'strong' as const, note: 'n' }];
    for (let i = 0; i < 3; i++) state = applyAssessments(state, assess, null);
    expect(state.competencies.find((c) => c.key === 'product_judgment')!.confidence).toBeGreaterThanOrEqual(PROVEN_CONFIDENCE);
  });

  it('leaves competencies with no history alone', () => {
    const base = initLiveState(resolveCompetencies('Product Manager'));
    const scrutinised = applyHistoricalScrutiny(base, ['product_judgment']);
    expect(scrutinised.competencies.find((c) => c.key === 'prioritization')!.scrutinised).toBeFalsy();
  });
});
