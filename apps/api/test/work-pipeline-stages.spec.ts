import { HyrteWorkTickService } from '../src/hyrte/work/work-tick.service';

/**
 * Refinements doc §5 — Work Pipeline: 7 real lifecycle stages (was 5, missing
 * distinct Waiting/Delegated). This covers the two new transitions:
 * scheduleStart is the single entry point that moves a fresh/resumed item
 * into DELEGATED before the tick1 timer starts, and tick1 only proceeds from
 * DELEGATED (a stale/duplicate call on anything else is a safe no-op).
 */
describe('HyrteWorkTickService — DELEGATED stage transition (refinements doc §5)', () => {
  function buildService(item: Record<string, unknown>) {
    const workItemUpdate = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...item, ...data }));
    const prisma = {
      hyrteWorkItem: {
        findUnique: jest.fn().mockResolvedValue(item),
        update: workItemUpdate,
      },
    };
    const ai = { completeJson: jest.fn() };
    const gateway = { broadcast: jest.fn() };
    const consequences = {};
    const evidence = { createEvidence: jest.fn().mockResolvedValue(undefined) };
    const decisionGraph = { recordDecision: jest.fn().mockResolvedValue(undefined) };

    const service = new HyrteWorkTickService(prisma as any, ai as any, gateway as any, consequences as any, evidence as any, decisionGraph as any);
    return { service, workItemUpdate, gateway };
  }

  async function flush() {
    // scheduleStart's body runs inside a .then() off a mocked (already-
    // resolved) promise chain — flush the microtask queue so it completes
    // before assertions, without needing real/fake timers.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('moves a fresh NEW item to DELEGATED before scheduling the tick1 timer', async () => {
    const item = { id: 'work-item-1', sessionId: 'session-1', stage: 'NEW', ownerStakeholder: { id: 's1', stress: 50, trust: 50 } };
    const { service, workItemUpdate, gateway } = buildService(item);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as any);

    service.scheduleStart('work-item-1');
    await flush();

    expect(workItemUpdate).toHaveBeenCalledWith({ where: { id: 'work-item-1' }, data: { stage: 'DELEGATED' } });
    expect(gateway.broadcast).toHaveBeenCalledWith('session-1', expect.objectContaining({ type: 'task:update' }));
    expect(setTimeoutSpy).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it('resumes a WAITING item (post-clarification) to DELEGATED the same way', async () => {
    const item = { id: 'work-item-1', sessionId: 'session-1', stage: 'WAITING', ownerStakeholder: { id: 's1', stress: 50, trust: 50 } };
    const { service, workItemUpdate } = buildService(item);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as any);

    service.scheduleStart('work-item-1');
    await flush();

    expect(workItemUpdate).toHaveBeenCalledWith({ where: { id: 'work-item-1' }, data: { stage: 'DELEGATED' } });
    setTimeoutSpy.mockRestore();
  });

  it('does NOT touch the stage of an item that is already mid-flight (e.g. IN_PROGRESS) — only schedules the timer', async () => {
    const item = { id: 'work-item-1', sessionId: 'session-1', stage: 'IN_PROGRESS', ownerStakeholder: { id: 's1', stress: 50, trust: 50 } };
    const { service, workItemUpdate } = buildService(item);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as any);

    service.scheduleStart('work-item-1');
    await flush();

    expect(workItemUpdate).not.toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it('tick1 proceeds when the item is DELEGATED (the normal case after scheduleStart)', async () => {
    const item = { id: 'work-item-1', sessionId: 'session-1', stage: 'DELEGATED', title: 'x', ownerStakeholder: { id: 's1', name: 'Avery', department: 'Engineering', stress: 50, trust: 50 } };
    const { service, workItemUpdate } = buildService(item);
    // tick1 also creates an ambient Slack message — stub it out.
    (service as any).prisma.hyrteSlackMessage = { create: jest.fn().mockResolvedValue({ id: 'slack-1' }) };
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as any);

    await (service as any).tick1('work-item-1');

    expect(workItemUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stage: 'IN_PROGRESS' }) }));
    setTimeoutSpy.mockRestore();
  });

  it('tick1 is a safe no-op when the item is NOT DELEGATED (stale/duplicate call)', async () => {
    const item = { id: 'work-item-1', sessionId: 'session-1', stage: 'BLOCKED', title: 'x', ownerStakeholder: { id: 's1', stress: 50, trust: 50 } };
    const { service, workItemUpdate } = buildService(item);

    await (service as any).tick1('work-item-1');

    expect(workItemUpdate).not.toHaveBeenCalled();
  });
});
