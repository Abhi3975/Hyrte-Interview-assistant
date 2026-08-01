import { HyrteStakeholderAgentService } from '../src/hyrte/agents/stakeholder-agent.service';

/**
 * §4.15 Multi-Day Memory / §8 Hardening — "recruiter assessment mode
 * simulations must remain self-contained... build it as a hard mode flag at
 * the session level." The actual guarantee this needs is narrower than a
 * session-level flag: stakeholder memory must NEVER be readable across
 * sessions, for either mode. This test proves that guarantee holds at the
 * query level — `hyrteStakeholderMemory.findMany` is always scoped to the
 * exact sessionId `respond()` was called with, never a different or shared
 * session — using mocked dependencies (this project's convention: pure unit
 * tests, no real DB/network, see jest.config.js).
 */
describe('HyrteStakeholderAgentService memory scoping (Multi-Day Memory security boundary)', () => {
  function buildService(memoryFindMany: jest.Mock) {
    const stakeholder = {
      id: 'stakeholder-1',
      name: 'Alex Chen',
      role: 'Engineering Lead',
      personality: {},
      trust: 50,
      respect: 50,
      cooperation: 50,
      influence: 50,
      stress: 50,
      urgency: 50,
      patience: 50,
      motivation: 50,
      hiddenIntention: null,
    };
    const prisma = {
      hyrteStakeholder: { findUnique: jest.fn().mockResolvedValue(stakeholder) },
      hyrteCompanyState: { findUnique: jest.fn().mockResolvedValue(null) },
      hyrteSession: { findUnique: jest.fn().mockResolvedValue({ candidateId: 'candidate-1', companyName: 'TestCo' }) },
      hyrteStakeholderMemory: { findMany: memoryFindMany, createMany: jest.fn() },
    };
    // completeJson resolves to `{}` so `respond()` short-circuits on the
    // empty-reply check right after — everything relevant for this test
    // (the memory fetch) already happened by then.
    const ai = { completeJson: jest.fn().mockResolvedValue({}) };
    const gateway = { broadcast: jest.fn() };
    const consequences = { applyCompanyStateDelta: jest.fn() };
    const evidence = { createEvidence: jest.fn() };

    return new HyrteStakeholderAgentService(
      prisma as any,
      ai as any,
      gateway as any,
      consequences as any,
      evidence as any,
    );
  }

  it('scopes the memory query to the exact session passed in', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = buildService(findMany);

    await service.respond('session-A', 'stakeholder-1', 'hello', { kind: 'inbox', subject: 'test' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: 'session-A', stakeholderId: 'stakeholder-1' } }),
    );
  });

  it('never leaks one session\'s scope into another session\'s query', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = buildService(findMany);

    await service.respond('session-A', 'stakeholder-1', 'hello', { kind: 'inbox', subject: 'test' });
    await service.respond('session-B', 'stakeholder-1', 'hello again', { kind: 'inbox', subject: 'test' });

    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { sessionId: 'session-A', stakeholderId: 'stakeholder-1' } }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { sessionId: 'session-B', stakeholderId: 'stakeholder-1' } }),
    );
  });
});
