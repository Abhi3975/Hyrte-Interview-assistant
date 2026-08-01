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
    };
    const ai = { completeJson: jest.fn().mockResolvedValue({ question: 'What led you to that decision?' }) };
    const evidence = {
      getForSession: jest.fn().mockResolvedValue([]),
      getContradictions: jest.fn().mockResolvedValue([]),
    };
    const council = { convene: jest.fn() };
    const reportIntelligence = { compute: jest.fn() };

    return new HyrteInterviewService(prisma as any, ai as any, evidence as any, council as any, reportIntelligence as any);
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
