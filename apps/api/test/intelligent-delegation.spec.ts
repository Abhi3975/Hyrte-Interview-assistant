import { HyrteCommandBarService } from '../src/hyrte/work/command-bar.service';

/**
 * Refinements doc §6 — Intelligent Delegation: "Later, she may: Complete the
 * task / Ask for clarification / Request additional resources / Delegate
 * part of the work / Miss the deadline / Reject the request if priorities
 * conflict." The reaction itself is an LLM judgment call (same as the
 * pre-existing isOverreach decision) and isn't deterministic to provoke live
 * — this proves the CODE'S handling of each reaction is correct regardless
 * of which one the model returns, same mocked-dependency convention as
 * hyrte-memory-scoping.spec.ts (see jest.config.js).
 */
describe('HyrteCommandBarService reaction branching (refinements doc §6)', () => {
  const session = { id: 'session-1', candidateId: 'candidate-1', role: 'PM', companyName: 'TestCo' };
  const target = { id: 'stakeholder-1', name: 'Avery Johnson', role: 'Engineering Lead', department: 'Engineering', authorityLevel: 80, stress: 60, trust: 50 };

  function buildService(completeJsonResult: Record<string, unknown>) {
    const workItemCreate = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'work-item-1', ...data }));
    const inboxCreate = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'inbox-1', ...data }));
    const prisma = {
      hyrteSession: { findFirst: jest.fn().mockResolvedValue(session) },
      hyrteStakeholder: { findMany: jest.fn().mockResolvedValue([target]) },
      hyrteCompanyState: { findUnique: jest.fn().mockResolvedValue(null) },
      hyrteWorkItem: { findMany: jest.fn().mockResolvedValue([]), create: workItemCreate },
      hyrteInboxMessage: { create: inboxCreate },
    };
    const ai = { completeJson: jest.fn().mockResolvedValue(completeJsonResult) };
    const gateway = { broadcast: jest.fn() };
    const evidence = { createEvidence: jest.fn().mockResolvedValue(undefined) };
    const decisionGraph = { recordDecision: jest.fn().mockResolvedValue(undefined) };
    const workTicks = { scheduleStart: jest.fn() };

    const service = new HyrteCommandBarService(prisma as any, ai as any, gateway as any, evidence as any, decisionGraph as any, workTicks as any);
    return { service, prisma, workItemCreate, inboxCreate, workTicks, gateway };
  }

  it('"accept" (default/omitted reaction): creates a NEW work item and schedules the tick pipeline', async () => {
    const { service, workItemCreate, workTicks } = buildService({
      isOverreach: false,
      targetStakeholderKey: target.id,
      workItemTitle: 'Root-cause analysis',
      reaction: 'accept',
    });

    const result = await service.submit('session-1', 'candidate-1', 'Avery, write up the root-cause analysis.');

    expect(workItemCreate).toHaveBeenCalledTimes(1);
    expect(workItemCreate.mock.calls[0][0].data.stage).toBe('NEW');
    expect(workTicks.scheduleStart).toHaveBeenCalledWith('work-item-1');
    expect(result).toEqual({ overreach: false, message: 'Sent to Avery Johnson.', workItemId: 'work-item-1' });
  });

  it('"ask_clarification": pauses the work item (stage WAITING, no tick scheduled) and links a blocking inbox message', async () => {
    const { service, workItemCreate, inboxCreate, workTicks } = buildService({
      isOverreach: false,
      targetStakeholderKey: target.id,
      workItemTitle: 'Vague ask',
      reaction: 'ask_clarification',
      reactionMessage: 'What format do you want this in?',
    });

    const result = await service.submit('session-1', 'candidate-1', 'Avery, look into the thing.');

    // Refinements doc §5 — WAITING is the real pipeline stage for "paused on
    // someone else's input," not a reuse of NEW.
    expect(workItemCreate.mock.calls[0][0].data.stage).toBe('WAITING');
    expect(workTicks.scheduleStart).not.toHaveBeenCalled();
    expect(inboxCreate).toHaveBeenCalledTimes(1);
    const inboxData = inboxCreate.mock.calls[0][0].data;
    expect(inboxData.fromStakeholderId).toBe(target.id);
    expect(inboxData.blocksWorkItemId).toBe('work-item-1');
    expect(inboxData.body).toBe('What format do you want this in?');
    expect(result.overreach).toBe(false);
    expect(result.workItemId).toBe('work-item-1');
  });

  it('"reject_conflict": creates a BLOCKED work item, posts a pushback inbox message, never links blocksWorkItemId, never schedules a tick', async () => {
    const { service, workItemCreate, inboxCreate, workTicks } = buildService({
      isOverreach: false,
      targetStakeholderKey: target.id,
      workItemTitle: 'Overloaded ask',
      reaction: 'reject_conflict',
      reactionMessage: "I'm slammed this week, can this wait?",
    });

    await service.submit('session-1', 'candidate-1', 'Avery, take on one more thing.');

    expect(workItemCreate.mock.calls[0][0].data.stage).toBe('BLOCKED');
    expect(workTicks.scheduleStart).not.toHaveBeenCalled();
    const inboxData = inboxCreate.mock.calls[0][0].data;
    expect(inboxData.blocksWorkItemId).toBeNull();
    expect(inboxData.body).toBe("I'm slammed this week, can this wait?");
  });

  it('an unrecognized/garbage reaction value falls back to "accept" rather than silently dropping the delegation', async () => {
    const { service, workItemCreate, workTicks } = buildService({
      isOverreach: false,
      targetStakeholderKey: target.id,
      workItemTitle: 'Task',
      reaction: 'not_a_real_value',
    });

    await service.submit('session-1', 'candidate-1', 'Avery, do the task.');

    expect(workItemCreate.mock.calls[0][0].data.stage).toBe('NEW');
    expect(workTicks.scheduleStart).toHaveBeenCalledWith('work-item-1');
  });

  it('overreach still short-circuits before any reaction is considered — no work item, no tick', async () => {
    const { service, workItemCreate, workTicks } = buildService({
      isOverreach: true,
      pushback: 'That is not something you have authority over.',
    });

    const result = await service.submit('session-1', 'candidate-1', 'Fire the whole team.');

    expect(workItemCreate).not.toHaveBeenCalled();
    expect(workTicks.scheduleStart).not.toHaveBeenCalled();
    expect(result.overreach).toBe(true);
  });
});
