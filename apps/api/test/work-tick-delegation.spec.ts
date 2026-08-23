import { HyrteWorkTickService } from '../src/hyrte/work/work-tick.service';

/**
 * Refinements doc §6 — Intelligent Delegation: "Miss the deadline" and
 * "Delegate part of the work", both landing inside tick2 (the stage where a
 * stakeholder actually submits the artifact). Same mocked-dependency,
 * private-method-via-bracket-access convention as the rest of this test
 * suite — tick2 is only reachable via setTimeout in real code, so it's
 * invoked directly here rather than faking timers.
 */
describe('HyrteWorkTickService tick2 — late delivery + sub-delegation (refinements doc §6)', () => {
  function baseItem(overrides: Record<string, unknown> = {}) {
    return {
      id: 'work-item-1',
      sessionId: 'session-1',
      title: 'Root-cause analysis',
      type: 'DOCUMENT',
      priority: 'HIGH',
      stage: 'IN_PROGRESS',
      artifacts: [],
      dueAt: new Date(Date.now() + 3_600_000), // 1 hour out — not naturally reachable within a tick
      ownerStakeholder: { id: 'stakeholder-1', name: 'Avery Johnson', role: 'Engineering Lead', stress: 50, trust: 50 },
      session: { candidateId: 'candidate-1', companyName: 'TestCo' },
      ...overrides,
    };
  }

  function buildService(item: ReturnType<typeof baseItem>, completeJsonResult: Record<string, unknown>, opts: { roster?: any[] } = {}) {
    const workItemUpdate = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...item, ...data }));
    const workItemCreate = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'sub-item-1', ...data }));
    const prisma = {
      hyrteWorkItem: {
        findUnique: jest.fn().mockResolvedValue(item),
        update: workItemUpdate,
        create: workItemCreate,
      },
      hyrteCompanyState: { findUnique: jest.fn().mockResolvedValue(null) },
      hyrteStakeholder: { findMany: jest.fn().mockResolvedValue(opts.roster ?? []) },
      hyrteInboxMessage: { create: jest.fn().mockResolvedValue({ id: 'inbox-1' }) },
    };
    const ai = { completeJson: jest.fn().mockResolvedValue(completeJsonResult) };
    const gateway = { broadcast: jest.fn() };
    const consequences = { scheduleReviewIgnoredCheck: jest.fn() };
    const evidence = { createEvidence: jest.fn().mockResolvedValue(undefined) };
    const decisionGraph = { recordDecision: jest.fn().mockResolvedValue(undefined) };

    const service = new HyrteWorkTickService(prisma as any, ai as any, gateway as any, consequences as any, evidence as any, decisionGraph as any);
    return { service, prisma, workItemUpdate, workItemCreate, ai };
  }

  it('flags a submission as late when dueAt has already passed, and tells the LLM so', async () => {
    const item = baseItem({ dueAt: new Date(Date.now() - 60_000) }); // 1 minute in the past
    const { service, workItemUpdate, ai } = buildService(item, { artifactType: 'doc', content: 'Here it is, sorry for the delay.' });

    await (service as any).tick2('work-item-1');

    const systemPrompt = ai.completeJson.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain('landing later than you promised');
    const updateData = workItemUpdate.mock.calls[0][0].data;
    expect(updateData.review.late).toBe(true);
    const lastHistoryNote = updateData.history.at(-1).note as string;
    expect(lastHistoryNote).toContain('after the original deadline had already passed');
  });

  it('flags a submission as late when the stakeholder is meaningfully slower than baseline, even with a future dueAt', async () => {
    // stress 100, trust 0 → speedMultiplier = 1 + 0.5 - 0 = 1.5 (> 1.3 threshold)
    const item = baseItem({ ownerStakeholder: { id: 'stakeholder-1', name: 'Avery Johnson', role: 'Engineering Lead', stress: 100, trust: 0 } });
    const { service, workItemUpdate } = buildService(item, { artifactType: 'doc', content: 'Rough draft, been slammed.' });

    await (service as any).tick2('work-item-1');

    expect(workItemUpdate.mock.calls[0][0].data.review.late).toBe(true);
  });

  it('does NOT flag a submission as late for a calm, trusted stakeholder with time to spare', async () => {
    const item = baseItem({ ownerStakeholder: { id: 'stakeholder-1', name: 'Avery Johnson', role: 'Engineering Lead', stress: 10, trust: 90 } });
    const { service, workItemUpdate, ai } = buildService(item, { artifactType: 'doc', content: 'Done, ahead of schedule.' });

    await (service as any).tick2('work-item-1');

    expect(workItemUpdate.mock.calls[0][0].data.review.late).toBe(false);
    const systemPrompt = ai.completeJson.mock.calls[0][0][0].content as string;
    expect(systemPrompt).not.toContain('landing later than you promised');
  });

  it('sub-delegates when a stretched stakeholder\'s artifact response names a real colleague: creates a linked second work item, notifies the candidate, records a decision', async () => {
    const colleague = { id: 'stakeholder-2', name: 'Sophia Patel', role: 'Data Analyst', department: 'Data' };
    const item = baseItem({ ownerStakeholder: { id: 'stakeholder-1', name: 'Avery Johnson', role: 'Engineering Lead', stress: 80, trust: 50 } });
    const { service, workItemCreate, prisma } = buildService(
      item,
      {
        artifactType: 'doc',
        content: 'Handling the main part myself.',
        subDelegateToKey: colleague.id,
        subDelegateTitle: 'Pull the supporting data',
        subDelegateNote: 'Sophia has the raw numbers already.',
      },
      { roster: [colleague] },
    );

    await (service as any).tick2('work-item-1');

    expect(workItemCreate).toHaveBeenCalledTimes(1);
    const subData = workItemCreate.mock.calls[0][0].data;
    expect(subData.ownerStakeholderId).toBe(colleague.id);
    expect(subData.delegatedFromItemId).toBe('work-item-1');
    expect(subData.title).toBe('Pull the supporting data');
    expect(prisma.hyrteInboxMessage.create).toHaveBeenCalledTimes(1);
  });

  it('never sub-delegates to a name outside the actual roster (hallucinated key is ignored)', async () => {
    const colleague = { id: 'stakeholder-2', name: 'Sophia Patel', role: 'Data Analyst', department: 'Data' };
    const item = baseItem({ ownerStakeholder: { id: 'stakeholder-1', name: 'Avery Johnson', role: 'Engineering Lead', stress: 80, trust: 50 } });
    const { service, workItemCreate } = buildService(
      item,
      { artifactType: 'doc', content: 'Done.', subDelegateToKey: 'not-a-real-stakeholder-id' },
      { roster: [colleague] },
    );

    await (service as any).tick2('work-item-1');

    expect(workItemCreate).not.toHaveBeenCalled();
  });

  it('never offers sub-delegation to a calm, low-stress stakeholder (not stretched enough to warrant it)', async () => {
    const item = baseItem({ ownerStakeholder: { id: 'stakeholder-1', name: 'Avery Johnson', role: 'Engineering Lead', stress: 20, trust: 50 } });
    const { service, ai, prisma } = buildService(item, { artifactType: 'doc', content: 'Done, no issues.' });

    await (service as any).tick2('work-item-1');

    // No roster fetched at all — the eligibility gate short-circuits before the query.
    expect(prisma.hyrteStakeholder.findMany).not.toHaveBeenCalled();
    const systemPrompt = ai.completeJson.mock.calls[0][0][0].content as string;
    expect(systemPrompt).not.toContain('subDelegateToKey');
  });

  it('never offers sub-delegation mid-revision, even for a stretched stakeholder', async () => {
    const item = baseItem({ stage: 'WAITING_REVIEW', ownerStakeholder: { id: 'stakeholder-1', name: 'Avery Johnson', role: 'Engineering Lead', stress: 80, trust: 50 } });
    const { service, ai, prisma } = buildService(item, { artifactType: 'doc', content: 'Revised per feedback.' });

    await (service as any).tick2('work-item-1', 'Please tighten the summary.');

    expect(prisma.hyrteStakeholder.findMany).not.toHaveBeenCalled();
    const systemPrompt = ai.completeJson.mock.calls[0][0][0].content as string;
    expect(systemPrompt).not.toContain('subDelegateToKey');
  });
});
