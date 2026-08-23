import { HyrteWorkplaceService } from '../src/hyrte/hyrte-workplace.service';

/**
 * Refinements doc §6 — Intelligent Delegation: replying to a stakeholder's
 * "ask for clarification" message must resume the paused work item (calls
 * HyrteWorkTickService.scheduleStart) exactly once, and only for the message
 * that actually blocks it. Same mocked-dependency convention as the rest of
 * this suite.
 */
describe('HyrteWorkplaceService.replyInbox resumes a clarification-paused delegation (refinements doc §6)', () => {
  function buildService(message: Record<string, unknown>, pausedItem: Record<string, unknown> | null) {
    const workItemUpdate = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'work-item-1', ...data }));
    const prisma = {
      hyrteSession: { findFirst: jest.fn().mockResolvedValue({ id: 'session-1' }) },
      hyrteInboxMessage: {
        findFirst: jest.fn().mockResolvedValue(message),
        update: jest.fn().mockResolvedValue(undefined),
      },
      hyrteDecisionLogEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      hyrteWorkItem: {
        findUnique: jest.fn().mockResolvedValue(pausedItem),
        update: workItemUpdate,
      },
      hyrteStakeholder: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const gateway = { broadcast: jest.fn() };
    const agent = { respond: jest.fn().mockResolvedValue(undefined), reactIndependently: jest.fn().mockResolvedValue(undefined) };
    const consequences = {};
    const decisionGraph = { recordDecision: jest.fn().mockResolvedValue({ id: 'decision-1' }) };
    const evidence = { createEvidence: jest.fn().mockResolvedValue(undefined) };
    const workTicks = { scheduleStart: jest.fn() };
    const commandBar = {};
    const meetings = {};

    const service = new HyrteWorkplaceService(
      prisma as any,
      gateway as any,
      agent as any,
      consequences as any,
      decisionGraph as any,
      evidence as any,
      workTicks as any,
      commandBar as any,
      meetings as any,
    );
    return { service, workItemUpdate, workTicks, prisma };
  }

  it('resumes the paused work item when replying to the message that blocks it', async () => {
    const message = { id: 'inbox-1', sessionId: 'session-1', subject: 'Quick question', fromStakeholderId: 'stakeholder-1', blocksWorkItemId: 'work-item-1', ethicalDilemma: false, escalatesMessageId: null, fromStakeholder: { role: 'Engineering Lead' } };
    // Refinements doc §5 — a clarification-paused item now sits at WAITING, not NEW.
    const pausedItem = { id: 'work-item-1', stage: 'WAITING', history: [] };
    const { service, workItemUpdate, workTicks } = buildService(message, pausedItem);

    await service.replyInbox('session-1', 'inbox-1', { body: 'It should cover the last 7 days.' } as any, 'candidate-1');

    expect(workItemUpdate).toHaveBeenCalledTimes(1);
    expect(workTicks.scheduleStart).toHaveBeenCalledWith('work-item-1');
  });

  it('does nothing extra when replying to an ordinary message (no blocksWorkItemId)', async () => {
    const message = { id: 'inbox-2', sessionId: 'session-1', subject: 'FYI', fromStakeholderId: 'stakeholder-1', blocksWorkItemId: null, ethicalDilemma: false, escalatesMessageId: null, fromStakeholder: { role: 'Engineering Lead' } };
    const { service, workItemUpdate, workTicks, prisma } = buildService(message, null);

    await service.replyInbox('session-1', 'inbox-2', { body: 'Thanks!' } as any, 'candidate-1');

    expect(prisma.hyrteWorkItem.findUnique).not.toHaveBeenCalled();
    expect(workItemUpdate).not.toHaveBeenCalled();
    expect(workTicks.scheduleStart).not.toHaveBeenCalled();
  });

  it('does not resume a work item that has already moved past WAITING (e.g. resumed by an earlier reply, or independently progressed)', async () => {
    const message = { id: 'inbox-1', sessionId: 'session-1', subject: 'Quick question', fromStakeholderId: 'stakeholder-1', blocksWorkItemId: 'work-item-1', ethicalDilemma: false, escalatesMessageId: null, fromStakeholder: { role: 'Engineering Lead' } };
    const pausedItem = { id: 'work-item-1', stage: 'IN_PROGRESS', history: [] };
    const { service, workItemUpdate, workTicks } = buildService(message, pausedItem);

    await service.replyInbox('session-1', 'inbox-1', { body: 'Following up again.' } as any, 'candidate-1');

    expect(workItemUpdate).not.toHaveBeenCalled();
    expect(workTicks.scheduleStart).not.toHaveBeenCalled();
  });
});
