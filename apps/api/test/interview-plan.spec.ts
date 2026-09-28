import {
  QUIET_WORKER_CONTACTS,
  QUIET_WORKER_DECISIONS,
  STRONG_CONFIDENCE,
  THIN_EVIDENCE,
  planDirective,
  planInterview,
  type SimulationSignals,
} from '../src/hyrte/interview/interview-plan';
import { HyrteInterviewService } from '../src/hyrte/interview/hyrte-interview.service';

/**
 * The simulation plans the interview.
 *
 * Before this, the interview's tone and length came from the difficulty dial
 * the recruiter set BEFORE the candidate had done anything — so two people who
 * behaved completely differently in the same simulation got the same
 * interview. These tests are mostly about the archetypes staying genuinely
 * distinct, and about the thin-record case not turning into a punishment.
 */

const signals = (over: Partial<SimulationSignals> = {}): SimulationSignals => ({
  evidenceCount: 20,
  decisionCount: 6,
  contradictionCount: 0,
  avgConfidence: 55,
  contextsCovered: 4,
  contextsTotal: 8,
  stakeholderContacts: 4,
  tasksSubmitted: 2,
  ...over,
});

describe('choosing the kind of interview from what the simulation saw', () => {
  it('establishes capability when the simulation barely saw them work', () => {
    const plan = planInterview(signals({ evidenceCount: THIN_EVIDENCE - 1, contextsCovered: 1 }));
    expect(plan.archetype).toBe('ESTABLISH');
  });

  it('also establishes when there is plenty of evidence from only one kind of situation', () => {
    // 30 observations all from PRESSURE tells you about one thing, not about a
    // person — volume is not coverage.
    expect(planInterview(signals({ evidenceCount: 30, contextsCovered: 1 })).archetype).toBe('ESTABLISH');
  });

  it('resolves a contradiction before anything else, once the record is real', () => {
    expect(planInterview(signals({ contradictionCount: 1 })).archetype).toBe('RESOLVE');
  });

  it('does not chase a contradiction in a record too thin to have one', () => {
    // A single conflict among four observations is noise; establishing comes first.
    expect(planInterview(signals({ evidenceCount: 4, contextsCovered: 1, contradictionCount: 1 })).archetype).toBe('ESTABLISH');
  });

  it('raises the bar on a strong, consistent record instead of confirming it again', () => {
    const plan = planInterview(signals({ avgConfidence: STRONG_CONFIDENCE + 10, contextsCovered: 7 }));
    expect(plan.archetype).toBe('PRESSURE');
    expect(plan.bossModeRecommended).toBe(true);
  });

  it('never raises the bar on anyone who has not earned it', () => {
    // Boss mode is adversarial. It must be something the record justifies,
    // never something a candidate is assigned by default.
    for (const over of [{}, { evidenceCount: 3 }, { contradictionCount: 2 }, { stakeholderContacts: 0, decisionCount: 5 }]) {
      expect(planInterview(signals(over)).bossModeRecommended).toBe(false);
    }
  });

  it('draws out someone who did the work without talking to anyone', () => {
    const plan = planInterview(
      signals({ stakeholderContacts: QUIET_WORKER_CONTACTS, decisionCount: QUIET_WORKER_DECISIONS, avgConfidence: 55 }),
    );
    expect(plan.archetype).toBe('DRAW_OUT');
  });

  it('falls back to verifying an ordinary record', () => {
    expect(planInterview(signals()).archetype).toBe('VERIFY');
  });

  it('survives an empty simulation without dividing by zero', () => {
    const plan = planInterview(signals({ evidenceCount: 0, decisionCount: 0, avgConfidence: 0, contextsCovered: 0, stakeholderContacts: 0, tasksSubmitted: 0 }));
    expect(plan.archetype).toBe('ESTABLISH');
    expect(Number.isFinite(plan.turnBudget.max)).toBe(true);
  });
});

describe('a thin record is information, not a verdict', () => {
  const plan = planInterview(signals({ evidenceCount: 2, contextsCovered: 1 }));

  it('tells the interviewer not to hold the quiet simulation against them', () => {
    expect(plan.tone).toMatch(/not a verdict|not.*a failing/i);
    expect(plan.tone).toMatch(/do not treat|do NOT treat/i);
  });

  it('opens on what they did do, never on what they did not', () => {
    expect(plan.openingStrategy).toMatch(/do not open by observing that they did little/i);
  });

  it('refuses to ask for a citation from an empty record', () => {
    // Caught live: told to open on "the most substantial thing they DID do"
    // against ZERO observations, the model invented one — "I noticed you
    // engaged with the simulation by making decisions in challenging areas",
    // said to a candidate who had done nothing. Asking for a citation from an
    // empty record is asking for a fabrication.
    const empty = planInterview(signals({ evidenceCount: 0, decisionCount: 0, contextsCovered: 0 }));
    expect(empty.openingStrategy).toMatch(/NOTHING in the simulation record/i);
    expect(empty.openingStrategy).toMatch(/do not invent an observation/i);
    expect(empty.openingStrategy).not.toMatch(/most substantial thing they DID do/i);
  });

  it('still cites real work when there is any, however little', () => {
    const sparse = planInterview(signals({ evidenceCount: 2, contextsCovered: 1 }));
    expect(sparse.openingStrategy).toMatch(/most substantial thing they DID do/i);
  });

  it('gives them the longest interview, because it has the most to find out', () => {
    const others = (['RESOLVE', 'PRESSURE', 'VERIFY'] as const).map((_, i) =>
      planInterview(signals([{ contradictionCount: 1 }, { avgConfidence: 85, contextsCovered: 7 }, {}][i])),
    );
    for (const other of others) expect(plan.turnBudget.max).toBeGreaterThan(other.turnBudget.max);
  });
});

describe('the plan as the interview actually receives it', () => {
  it('reaches the model as instructions, not as background', () => {
    const directive = planDirective(planInterview(signals({ contradictionCount: 1 })));
    expect(directive).toContain('PERSONALITY:');
    expect(directive).toContain('OPENING:');
  });

  it('explains itself to the recruiter in plain English, with the real numbers', () => {
    const plan = planInterview(signals({ contradictionCount: 2 }));
    expect(plan.reason).toContain('2 contradictions');
    expect(plan.reason).not.toMatch(/undefined|NaN|\[object/);
  });

  it('gets the singular right, because a report that says "1 contradictions" looks broken', () => {
    expect(planInterview(signals({ contradictionCount: 1 })).reason).toContain('1 contradiction ');
  });

  it('gives every archetype a distinct tone, budget and reason', () => {
    const plans = [
      planInterview(signals({ evidenceCount: 2, contextsCovered: 1 })),
      planInterview(signals({ contradictionCount: 1 })),
      planInterview(signals({ avgConfidence: 85, contextsCovered: 7 })),
      planInterview(signals({ stakeholderContacts: 1, decisionCount: 5 })),
      planInterview(signals()),
    ];
    expect(new Set(plans.map((p) => p.archetype)).size).toBe(5);
    expect(new Set(plans.map((p) => p.tone)).size).toBe(5);
    expect(new Set(plans.map((p) => p.reason)).size).toBe(5);
    for (const p of plans) {
      expect(p.turnBudget.min).toBeLessThan(p.turnBudget.max);
      expect(p.turnBudget.min).toBeGreaterThan(0);
    }
  });
});

describe('a report that is still being written', () => {
  // Caught end-to-end on production: the GET immediately after the final
  // answer returned a real row with recommendation and strengths but no
  // confidence, no predictions and no Decision DNA — because the row is
  // written in three passes and only the last one finishes the job. Thirty
  // seconds later the same GET was complete. A half-written report served as
  // if it were finished reads as a broken feature, not a slow one.
  const service = () => {
    const prisma = {
      hyrteSession: { findFirst: jest.fn() },
      hyrteInterviewReport: { findUnique: jest.fn().mockResolvedValue({ sessionId: 's1', recommendation: 'Fit' }) },
    };
    const svc = new HyrteInterviewService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    return { svc, prisma };
  };

  it('says it is still generating while the pipeline is mid-flight', async () => {
    const { svc, prisma } = service();
    prisma.hyrteSession.findFirst.mockResolvedValue({ id: 's1', candidateId: 'c1', phase: 'INTERVIEW' });
    expect((await svc.getReport('s1', 'c1')).generating).toBe(true);
  });

  it('stops saying so once the Council has finished and the phase is COMPLETED', async () => {
    const { svc, prisma } = service();
    prisma.hyrteSession.findFirst.mockResolvedValue({ id: 's1', candidateId: 'c1', phase: 'COMPLETED' });
    expect((await svc.getReport('s1', 'c1')).generating).toBe(false);
  });

  it('still returns the report itself, not just a status', async () => {
    const { svc, prisma } = service();
    prisma.hyrteSession.findFirst.mockResolvedValue({ id: 's1', candidateId: 'c1', phase: 'COMPLETED' });
    expect((await svc.getReport('s1', 'c1')).recommendation).toBe('Fit');
  });
});
