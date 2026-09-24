import { HyrteInterviewService } from '../src/hyrte/interview/hyrte-interview.service';

/**
 * §4.15 Multi-Day Memory — "recruiter assessment mode simulations must
 * remain self-contained... never across candidates or across time." This
 * proves the cross-session continuity query (`getPracticeContinuityContext`,
 * used to open a returning practice candidate's interview with career
 * context) is gated at the `sessionType` check itself — an ASSESSMENT
 * session never even issues the cross-session query, not just "issues it but
 * gets nothing back."
 */
describe('HyrteInterviewService practice-continuity gate (Multi-Day Memory)', () => {
  function buildService(reportFindMany: jest.Mock, sessionType: 'PRACTICE' | 'ASSESSMENT') {
    const session = {
      id: 'session-current',
      candidateId: 'candidate-1',
      companyName: 'TestCo',
      role: 'Product Manager',
      difficulty: 'MEDIUM',
      sessionType,
    };
    const prisma = {
      hyrteSession: {
        findFirst: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue(session),
      },
      hyrteStakeholder: { findMany: jest.fn().mockResolvedValue([]) },
      hyrteCompanyState: { findUnique: jest.fn().mockResolvedValue(null) },
      hyrteInterviewReport: { findMany: reportFindMany },
      // The simulation now plans the interview (interview-plan.ts), so
      // startInterview reads what the simulation observed. An empty record
      // plans an ESTABLISH interview, which is the right shape for a stub.
      evidenceObject: { findMany: jest.fn().mockResolvedValue([]) },
      hyrteWorkItem: { count: jest.fn().mockResolvedValue(0) },
    };
    const ai = { completeJson: jest.fn().mockResolvedValue({ question: 'What led you to that decision?' }) };
    const evidence = {
      getForSession: jest.fn().mockResolvedValue([]),
      getContradictions: jest.fn().mockResolvedValue([]),
    };
    const council = { convene: jest.fn() };
    const reportIntelligence = { compute: jest.fn() };

    // Live committee steering — these specs assert on continuity/callback
    // behaviour, not on the panel, so it is stubbed to a no-op.
    const cortex = {
      ensureStarted: jest.fn().mockResolvedValue(null),
      buildDirectiveBlock: jest.fn(),
      buildAssessmentInstruction: jest.fn().mockReturnValue(''),
      recordTurn: jest.fn().mockResolvedValue(null),
    };
    // Checklist #9 long-term memory — this spec covers same-session
    // continuity, so cross-session history is stubbed empty.
    const memory = {
      getRecurringWeaknesses: jest.fn().mockResolvedValue([]),
      buildCallback: jest.fn().mockReturnValue(null),
      matchWeaknessesToCompetencies: jest.fn().mockReturnValue([]),
    };
    return new HyrteInterviewService(prisma as any, ai as any, evidence as any, council as any, reportIntelligence as any, cortex as any, memory as any);
  }

  it('never queries cross-session history for an ASSESSMENT session', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = buildService(findMany, 'ASSESSMENT');

    await service.startInterview('session-current', 'candidate-1');

    expect(findMany).not.toHaveBeenCalled();
  });

  it('queries cross-session history, scoped to this candidate and excluding the current session, for a PRACTICE session', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = buildService(findMany, 'PRACTICE');

    await service.startInterview('session-current', 'candidate-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          session: { candidateId: 'candidate-1', sessionType: 'PRACTICE', id: { not: 'session-current' } },
        },
      }),
    );
  });
});
