import { computeResponseDelayMs, ResponseDelayInput } from '../src/hyrte/agents/response-delay';

/** Refinements doc §15 — "Waiting Is Part of Work: realistic response times based on role, workload, and priority." */
function baseInput(overrides: Partial<ResponseDelayInput> = {}): ResponseDelayInput {
  return {
    role: 'Software Engineer',
    stress: 50,
    urgency: 50,
    motivation: 50,
    openWorkItemCount: 0,
    messageUrgent: false,
    ...overrides,
  };
}

describe('computeResponseDelayMs (refinements doc §15)', () => {
  it('gives customer-facing roles a faster base delay than investigation-heavy roles, all else equal', () => {
    const support = computeResponseDelayMs(baseInput({ role: 'Customer Support Specialist' }));
    const engineer = computeResponseDelayMs(baseInput({ role: 'Backend Engineer' }));
    expect(support).toBeLessThan(engineer);
  });

  it('gives process/approval-heavy roles the slowest base delay', () => {
    const finance = computeResponseDelayMs(baseInput({ role: 'Finance Analyst' }));
    const support = computeResponseDelayMs(baseInput({ role: 'Customer Support Specialist' }));
    expect(finance).toBeGreaterThan(support);
  });

  it('unknown/generic roles fall back to a sane default, not a crash or 0', () => {
    const delay = computeResponseDelayMs(baseInput({ role: 'Chief Vibes Officer' }));
    expect(delay).toBeGreaterThan(0);
  });

  it('more open work items means a slower reply — real workload, not just vibes', () => {
    const idle = computeResponseDelayMs(baseInput({ openWorkItemCount: 0 }));
    const busy = computeResponseDelayMs(baseInput({ openWorkItemCount: 5 }));
    expect(busy).toBeGreaterThan(idle);
  });

  it('workload contribution is capped, not unbounded — 20 open items is not 20x worse than 9', () => {
    const busy = computeResponseDelayMs(baseInput({ openWorkItemCount: 9 }));
    const swamped = computeResponseDelayMs(baseInput({ openWorkItemCount: 20 }));
    expect(swamped).toBe(busy);
  });

  it('higher stress slows a reply down; lower stress speeds it up', () => {
    const calm = computeResponseDelayMs(baseInput({ stress: 10 }));
    const stressed = computeResponseDelayMs(baseInput({ stress: 90 }));
    expect(stressed).toBeGreaterThan(calm);
  });

  it('a personally urgent/motivated stakeholder replies faster regardless of role', () => {
    const laidBack = computeResponseDelayMs(baseInput({ urgency: 10, motivation: 10 }));
    const driven = computeResponseDelayMs(baseInput({ urgency: 90, motivation: 90 }));
    expect(driven).toBeLessThan(laidBack);
  });

  it('an urgent incoming message cuts the delay sharply, prioritized over everything else', () => {
    const normal = computeResponseDelayMs(baseInput({ role: 'Finance Analyst', openWorkItemCount: 5 }));
    const urgent = computeResponseDelayMs(baseInput({ role: 'Finance Analyst', openWorkItemCount: 5, messageUrgent: true }));
    expect(urgent).toBeLessThan(normal);
  });

  it('never returns below the floor, even for the fastest/most urgent combination', () => {
    const delay = computeResponseDelayMs(
      baseInput({ role: 'Customer Support Specialist', stress: 0, urgency: 100, motivation: 100, openWorkItemCount: 0, messageUrgent: true }),
    );
    expect(delay).toBeGreaterThanOrEqual(10_000);
  });

  it('never exceeds the ceiling, even for the slowest/busiest/most stressed combination', () => {
    const delay = computeResponseDelayMs(
      baseInput({ role: 'CEO', stress: 100, urgency: 0, motivation: 0, openWorkItemCount: 50, messageUrgent: false }),
    );
    expect(delay).toBeLessThanOrEqual(300_000);
  });
});
