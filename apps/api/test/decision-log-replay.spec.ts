import { HyrteWorkplaceService } from '../src/hyrte/hyrte-workplace.service';
import { HyrteConsequenceService } from '../src/hyrte/consequences/consequence.service';

/**
 * Refinements doc §10 — Decision Log "replay": a decision node should be
 * traceable to the specific company-state deltas and downstream decisions
 * it caused, not just sit in a flat chronological list. Same mocked-
 * dependency convention as the rest of this suite.
 */
describe('listDecisionLog causal enrichment (refinements doc §10)', () => {
  function buildService(entries: any[], stateHistory: any[]) {
    const prisma = {
      hyrteSession: { findFirst: jest.fn().mockResolvedValue({ id: 'session-1' }) },
      hyrteDecisionLogEntry: { findMany: jest.fn().mockResolvedValue(entries) },
      hyrteCompanyStateHistory: { findMany: jest.fn().mockResolvedValue(stateHistory) },
    };
    const gateway = {};
    const agent = {};
    const consequences = {};
    const decisionGraph = {};
    const evidence = {};
    const workTicks = {};
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
    return { service, prisma };
  }

  it('attaches the real company-state deltas a decision caused, via decisionId', async () => {
    const entries = [{ id: 'decision-1', actionType: 'inbox.message_ignored', causedByDecisionId: null }];
    const stateHistory = [
      { decisionId: 'decision-1', delta: { customerSatisfaction: -4 }, reason: 'escalation_hop_1', createdAt: new Date('2026-01-01T09:04:00Z') },
      { decisionId: 'other-decision', delta: { revenue: -1 }, reason: 'chaos_wave', createdAt: new Date() },
    ];
    const { service } = buildService(entries, stateHistory);

    const result = await service.listDecisionLog('session-1', 'candidate-1');

    expect(result[0].stateDeltas).toHaveLength(1);
    expect(result[0].stateDeltas[0]).toEqual({ delta: { customerSatisfaction: -4 }, reason: 'escalation_hop_1', createdAt: new Date('2026-01-01T09:04:00Z') });
  });

  it('attaches downstream decisions caused by this one, via causedByDecisionId', async () => {
    const entries = [
      { id: 'decision-1', actionType: 'task.stage_change', outcome: 'Approved "Launch"', causedByDecisionId: null },
      { id: 'decision-2', actor: 'stakeholder-1', actionType: 'cascade.downstream_impact', outcome: 'Flagged strain', causedByDecisionId: 'decision-1', createdAt: new Date('2026-01-01T10:00:00Z') },
    ];
    const { service } = buildService(entries, []);

    const result = await service.listDecisionLog('session-1', 'candidate-1');

    const root = result.find((e) => e.id === 'decision-1')!;
    expect(root.causedDecisions).toHaveLength(1);
    expect(root.causedDecisions[0]).toEqual({ id: 'decision-2', actionType: 'cascade.downstream_impact', outcome: 'Flagged strain', actor: 'stakeholder-1', createdAt: new Date('2026-01-01T10:00:00Z') });

    const leaf = result.find((e) => e.id === 'decision-2')!;
    expect(leaf.causedDecisions).toEqual([]);
  });

  it('a decision with no caused deltas or decisions gets empty arrays, not undefined', async () => {
    const entries = [{ id: 'decision-1', actionType: 'email.reply', causedByDecisionId: null }];
    const { service } = buildService(entries, []);

    const result = await service.listDecisionLog('session-1', 'candidate-1');

    expect(result[0].stateDeltas).toEqual([]);
    expect(result[0].causedDecisions).toEqual([]);
  });
});

describe('applyCompanyStateDelta ties a delta to the decision that caused it (refinements doc §10)', () => {
  function buildService() {
    const historyCreate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      hyrteCompanyState: { update: jest.fn().mockResolvedValue({ revenue: 55, customerSatisfaction: 40 }) },
      hyrteCompanyStateHistory: { create: historyCreate },
    };
    const ai = {};
    const gateway = { broadcast: jest.fn() };
    const evidence = {};
    const decisionGraph = {};
    const service = new HyrteConsequenceService(prisma as any, ai as any, gateway as any, evidence as any, decisionGraph as any);
    return { service, historyCreate };
  }

  it('writes the decisionId onto the HyrteCompanyStateHistory row when one is passed', async () => {
    const { service, historyCreate } = buildService();

    await service.applyCompanyStateDelta('session-1', { revenue: 5 }, 'task_completion', 'decision-42');

    expect(historyCreate).toHaveBeenCalledWith({
      data: { sessionId: 'session-1', delta: { revenue: 5 }, reason: 'task_completion', decisionId: 'decision-42' },
    });
  });

  it('is a safe no-op for decisionId when none is passed (existing untraceable callers still work)', async () => {
    const { service, historyCreate } = buildService();

    await service.applyCompanyStateDelta('session-1', { revenue: 5 }, 'chaos_wave');

    expect(historyCreate).toHaveBeenCalledWith({
      data: { sessionId: 'session-1', delta: { revenue: 5 }, reason: 'chaos_wave', decisionId: undefined },
    });
  });
});
