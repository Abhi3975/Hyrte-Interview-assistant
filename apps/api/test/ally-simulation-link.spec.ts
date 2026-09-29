import { PracticeService } from '../src/practice/practice.service';

/**
 * "The interview part is not connected to the simulation model at all."
 *
 * Partly right, and the part that was right mattered. Ally did read live
 * simulation evidence and cross-check it — but the ONE line pointing at real
 * observed behaviour said "You may probe deeper into this real behavior when
 * it fits naturally", and nothing about the interview's SHAPE came from the
 * simulation at all. This codebase has now been bitten three times by
 * optional instructions losing to the dozen other directives around them.
 */

function svc(evidence: unknown[], report: unknown = null) {
  const prisma = {
    evidenceObject: { findMany: jest.fn().mockResolvedValue(evidence) },
    hyrteInterviewReport: { findFirst: jest.fn().mockResolvedValue(report) },
  };
  const s = new PracticeService(
    prisma as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  ) as unknown as {
    buildSimulationPlanDirective: (id: string) => Promise<string>;
    getSimulationContext: (id: string) => Promise<string>;
  };
  return s;
}

const ev = (over: Record<string, unknown> = {}) => ({
  type: 'SIMULATION_ACTION',
  confidenceScore: 60,
  behaviorContext: 'PEER',
  status: 'PENDING',
  ...over,
});

describe('the simulation shaping Ally', () => {
  it('says nothing for a candidate who has never run a simulation', async () => {
    // The standalone room must keep working exactly as before for the many
    // candidates with no simulation history.
    expect(await svc([]).buildSimulationPlanDirective('c1')).toBe('');
  });

  it('plans the interview from what the simulation actually recorded', async () => {
    const thin = await svc([ev(), ev()]).buildSimulationPlanDirective('c1');
    expect(thin).toContain('ESTABLISH');
    expect(thin).toMatch(/INTERVIEW SHAPE/);
  });

  it('opens on the conflict when the simulation caught contradictions', async () => {
    const conflicted = Array.from({ length: 20 }, (_, i) =>
      ev({ status: i < 3 ? 'CONTRADICTED' : 'PENDING', behaviorContext: ['PEER', 'MANAGER', 'CONFLICT', 'PRESSURE'][i % 4] }),
    );
    expect(await svc(conflicted).buildSimulationPlanDirective('c1')).toContain('RESOLVE');
  });

  it('raises the bar on a strong, well-covered record', async () => {
    const strong = Array.from({ length: 30 }, (_, i) =>
      ev({ confidenceScore: 85, behaviorContext: ['PEER', 'MANAGER', 'CUSTOMER', 'CONFLICT', 'PRESSURE', 'AMBIGUITY', 'SUCCESS'][i % 7] }),
    );
    expect(await svc(strong).buildSimulationPlanDirective('c1')).toContain('PRESSURE');
  });

  it('reaches the model as instructions, with the reasoning attached', async () => {
    const out = await svc([ev(), ev()]).buildSimulationPlanDirective('c1');
    expect(out).toContain('PERSONALITY:');
    expect(out).toContain('OPENING:');
    // The recruiter-readable justification travels with it.
    expect(out).toMatch(/pieces of evidence|kinds of situation/);
  });
});

describe('observed behaviour is no longer optional to raise', () => {
  const report = {
    recommendation: 'Fit',
    summary: 'Handled the escalation well.',
    strengths: ['Data-driven'],
    developmentAreas: ['Stakeholder comms'],
    evidenceTrail: [{ action: 'Cut the batch size in half', interpretation: 'decisive' }],
    session: { role: 'Product Manager', industry: 'Fintech' },
  };

  it('requires the interviewer to actually ask about a real observed decision', async () => {
    const ctx = await svc([], report).getSimulationContext('c1');
    expect(ctx).toContain('MUST bring this up at least once');
    expect(ctx).not.toMatch(/You may probe deeper into this real behavior when it fits naturally/);
  });

  it('still refuses to treat the simulation as a verdict', async () => {
    const ctx = await svc([], report).getSimulationContext('c1');
    expect(ctx).toMatch(/one data point/i);
  });

  it('stays silent for a candidate with no simulation report', async () => {
    expect(await svc([], null).getSimulationContext('c1')).toBe('');
  });
});
