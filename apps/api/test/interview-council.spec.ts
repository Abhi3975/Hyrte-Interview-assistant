import { InterviewCouncilService } from '../src/practice/council/interview-council.service';
import { COUNCIL_AGENTS } from '../src/council-shared/council-agents.config';
import { CouncilCoreService } from '../src/council-shared/council-core.service';

/**
 * AI interviewer multi-agent panel doc — Ally's Decision Council, ported
 * from HYRTE's proven DecisionCouncilService. Same mocked-dependency
 * convention as the rest of this suite: a plain object standing in for
 * PrismaService/AIService, no real DI container.
 */
describe('InterviewCouncilService.convene (multi-agent panel doc)', () => {
  const VOTERS = COUNCIL_AGENTS.filter((a) => a.votes).map((a) => a.key);

  it('sanity: exactly the 5 documented agents vote, in this order', () => {
    expect(VOTERS).toEqual(['interviewLead', 'hiringManager', 'functionalExpert', 'futureTeammate', 'executiveFounder']);
  });

  function buildService(
    stanceByAgentKey: Record<string, string | undefined>,
    cortexOverrides: { confidencePercent?: number; nextStepRecommendation?: string; predictions?: unknown } = {},
  ) {
    const upsertCalls: unknown[] = [];
    const prisma = {
      interviewCouncilAgentReport: { upsert: jest.fn((args) => { upsertCalls.push(args); return Promise.resolve(undefined); }) },
      interviewCouncilDiscussionEntry: {
        deleteMany: jest.fn().mockResolvedValue(undefined),
        createMany: jest.fn().mockResolvedValue(undefined),
      },
    };
    const ai = {
      completeJson: jest.fn((messages: { role: string; content: string }[]) => {
        // The discussion-synthesis call's system prompt is distinctive; every
        // per-agent call's system prompt names the agent it's playing.
        const systemContent = messages[0]?.content ?? '';
        if (systemContent.includes('simulating a hiring committee')) {
          return Promise.resolve({ entries: [] });
        }
        const agent = COUNCIL_AGENTS.find((a) => systemContent.includes(`"${a.name}"`));
        if (!agent) return Promise.resolve({});
        if (agent.key === 'decisionCortex') {
          return Promise.resolve({
            reasoning: 'synthesis',
            keyPoints: [],
            confidencePercent: cortexOverrides.confidencePercent ?? 70,
            nextStepRecommendation: cortexOverrides.nextStepRecommendation ?? 'proceed',
            predictions: cortexOverrides.predictions ?? [{ dimension: 'Startup', likelihood: 'Strong (78%)', reasoning: 'Showed comfort with ambiguity.' }],
          });
        }
        const stance = stanceByAgentKey[agent.key];
        return Promise.resolve(stance ? { stance, reasoning: 'r', keyPoints: [] } : { reasoning: 'r', keyPoints: [] });
      }),
    };
    const core = new CouncilCoreService(ai as any);
    const service = new InterviewCouncilService(prisma as any, core);
    return { service, prisma, upsertCalls };
  }

  it('all 5 voters HIRE -> STRONG_HIRE', async () => {
    const stances = Object.fromEntries(VOTERS.map((k) => [k, 'HIRE']));
    const { service } = buildService(stances);
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(result.recommendation).toBe('STRONG_HIRE');
  });

  it('all 5 voters NO_HIRE -> STRONG_NO_HIRE', async () => {
    const stances = Object.fromEntries(VOTERS.map((k) => [k, 'NO_HIRE']));
    const { service } = buildService(stances);
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(result.recommendation).toBe('STRONG_NO_HIRE');
  });

  it('a genuine split (mixed leans) lands in the middle of the scale, not an extreme', async () => {
    const stances = { interviewLead: 'HIRE', hiringManager: 'LEAN_HIRE', functionalExpert: 'LEAN_NO_HIRE', futureTeammate: 'LEAN_NO_HIRE', executiveFounder: 'NO_HIRE' };
    const { service } = buildService(stances);
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(['LEAN_HIRE', 'NO_HIRE']).toContain(result.recommendation);
  });

  it('no votes at all (every agent failed) still returns a valid recommendation, never throws', async () => {
    const { service } = buildService({});
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(['STRONG_HIRE', 'HIRE', 'LEAN_HIRE', 'NO_HIRE', 'STRONG_NO_HIRE']).toContain(result.recommendation);
  });

  it("derives confidencePercent and nextStepRecommendation from the Decision Cortex agent's own output", async () => {
    const stances = Object.fromEntries(VOTERS.map((k) => [k, 'HIRE']));
    const { service } = buildService(stances, { confidencePercent: 83, nextStepRecommendation: 'targeted follow-up on ownership' });
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(result.confidencePercent).toBe(83);
    expect(result.nextStepRecommendation).toBe('targeted follow-up on ownership');
  });

  // Prediction Engine parity — Decision Cortex produces the same
  // {dimension, likelihood, reasoning}[] shape HYRTE's dedicated Prediction
  // Engine does, as part of its own single call (see interview-council.service.ts).
  it("derives predictions from the Decision Cortex agent's own output", async () => {
    const stances = Object.fromEntries(VOTERS.map((k) => [k, 'HIRE']));
    const predictions = [
      { dimension: 'Startup (fast-moving, ambiguous)', likelihood: 'Strong (78%)', reasoning: 'Showed comfort proposing a solution with incomplete information.' },
      { dimension: 'Enterprise (structured, process-heavy)', likelihood: 'Moderate (55%)', reasoning: 'No evidence of navigating multi-stakeholder approval processes.' },
    ];
    const { service } = buildService(stances, { predictions });
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(result.predictions).toEqual(predictions);
  });

  it('caps predictions at 6 entries even if the model overproduces', async () => {
    const stances = Object.fromEntries(VOTERS.map((k) => [k, 'HIRE']));
    const predictions = Array.from({ length: 10 }, (_, i) => ({ dimension: `Dimension ${i}`, likelihood: 'Strong (70%)', reasoning: 'r' }));
    const { service } = buildService(stances, { predictions });
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(result.predictions).toHaveLength(6);
  });

  it('drops malformed prediction entries (missing dimension/likelihood) rather than persisting garbage', async () => {
    const stances = Object.fromEntries(VOTERS.map((k) => [k, 'HIRE']));
    const predictions = [
      { dimension: 'Startup', likelihood: 'Strong (78%)', reasoning: 'r' },
      { dimension: '', likelihood: 'Strong (78%)', reasoning: 'r' },
      { dimension: 'Enterprise', reasoning: 'r' },
    ];
    const { service } = buildService(stances, { predictions });
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(result.predictions).toHaveLength(1);
    expect(result.predictions[0].dimension).toBe('Startup');
  });

  it('no predictions from Decision Cortex -> empty array, never throws or returns undefined', async () => {
    const stances = Object.fromEntries(VOTERS.map((k) => [k, 'HIRE']));
    const { service } = buildService(stances, { predictions: [] });
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(result.predictions).toEqual([]);
  });

  it('clamps an out-of-range confidencePercent into 0-100', async () => {
    const stances = Object.fromEntries(VOTERS.map((k) => [k, 'HIRE']));
    const { service } = buildService(stances, { confidencePercent: 150 });
    const result = await service.convene('s1', 'brief', 'transcript');
    expect(result.confidencePercent).toBe(100);
  });

  it('one agent throwing does not take down the whole convene call', async () => {
    const upsertCalls: unknown[] = [];
    const prisma = {
      interviewCouncilAgentReport: { upsert: jest.fn((args) => { upsertCalls.push(args); return Promise.resolve(undefined); }) },
      interviewCouncilDiscussionEntry: { deleteMany: jest.fn().mockResolvedValue(undefined), createMany: jest.fn().mockResolvedValue(undefined) },
    };
    let call = 0;
    const ai = {
      completeJson: jest.fn(() => {
        call++;
        if (call === 1) return Promise.reject(new Error('provider timeout'));
        return Promise.resolve({ stance: 'HIRE', reasoning: 'r', keyPoints: [] });
      }),
    };
    const core = new CouncilCoreService(ai as any);
    const service = new InterviewCouncilService(prisma as any, core);
    await expect(service.convene('s1', 'brief', 'transcript')).resolves.toBeDefined();
    // Every agent (including the one whose call rejected) still gets a persisted row.
    expect(upsertCalls.length).toBe(COUNCIL_AGENTS.length);
  });
});
