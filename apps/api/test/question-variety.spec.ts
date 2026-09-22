import { enforceWarmupVariety, pickAxes, questionSimilarity, resolveAxisPool } from '../src/hyrte/generator/question-variety';

/**
 * Founder feedback (WhatsApp, 9 Sep): "I've noticed some questions are very
 * repeated in pm role, bakio me bhi honge. Kuch bhi repeat nhi hona chahiye."
 *
 * The prompt half of the fix can drift; this guards the deterministic half.
 */

describe('competency axis rotation', () => {
  it('gives consecutive sessions in the same role completely different ground to cover', () => {
    const first = pickAxes('Product Manager', 4, 0);
    const second = pickAxes('Product Manager', 4, 1);
    const third = pickAxes('Product Manager', 4, 2);
    expect(first.filter((a) => second.includes(a))).toHaveLength(0);
    expect(second.filter((a) => third.includes(a))).toHaveLength(0);
  });

  it('returns exactly the number of axes asked for', () => {
    for (const n of [3, 4, 5, 6]) expect(pickAxes('Software Engineer', n, 0)).toHaveLength(n);
  });

  it('wraps around rather than running out, however many sessions a candidate runs', () => {
    const axes = pickAxes('Product Manager', 4, 99);
    expect(axes).toHaveLength(4);
    expect(new Set(axes).size).toBe(4);
  });

  it('resolves a pool for any free-text role, falling back rather than returning nothing', () => {
    expect(resolveAxisPool('Senior Backend Engineer').axes.length).toBeGreaterThan(0);
    expect(resolveAxisPool('Chief Astronaut Officer').axes.length).toBeGreaterThan(0);
  });

  it('has a real backfill question for every axis it can hand out', () => {
    for (const role of ['Product Manager', 'Software Engineer', 'Data Analyst', 'Sales', 'Marketing', 'UX Designer', 'Unknown Role']) {
      const pool = resolveAxisPool(role);
      for (const axis of pool.axes) {
        expect(pool.bank[axis]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe('near-duplicate detection', () => {
  it('catches a reworded repeat that raw word-overlap misses', () => {
    // The exact pair that slipped through at 0.54 on plain Jaccard.
    const a = 'How do you prioritize your roadmap when everything is urgent?';
    const b = 'How do you prioritise the roadmap when everything feels urgent?';
    expect(questionSimilarity(a, b)).toBeGreaterThanOrEqual(0.5);
  });

  it('does not flag two genuinely different questions as duplicates', () => {
    const a = 'How would you validate a new feature idea before building it?';
    const b = 'Sales escalated a security review blocking two enterprise deals — what is your first move?';
    expect(questionSimilarity(a, b)).toBeLessThan(0.5);
  });

  it('is symmetric and safe on empty input', () => {
    const a = 'What would you check first?';
    const b = 'Which metric would you check first?';
    expect(questionSimilarity(a, b)).toBeCloseTo(questionSimilarity(b, a));
    expect(questionSimilarity('', 'anything')).toBe(0);
  });
});

describe('enforcing variety after generation', () => {
  const axes = pickAxes('Product Manager', 4, 1);

  it('drops a question this candidate has already been asked', () => {
    const prior = ['How would you validate a new feature idea before building it?'];
    const generated = [{ id: 'q1', question: 'How would you validate a new feature idea before building it?' }];
    const out = enforceWarmupVariety(generated, 'Product Manager', prior, axes, 4);
    expect(out.map((q) => q.question)).not.toContain(prior[0]);
  });

  it('drops a near-duplicate of a sibling in the same set', () => {
    const generated = [
      { id: 'q1', question: 'Sales escalated a security review that blocks two enterprise deals. What do you do first?' },
      { id: 'q2', question: 'Sales escalated a security review blocking two enterprise deals — what is your first move?' },
    ];
    const out = enforceWarmupVariety(generated, 'Product Manager', [], axes, 4);
    const kept = out.filter((q) => q.question.toLowerCase().includes('security review'));
    expect(kept).toHaveLength(1);
  });

  it('always returns the full count, backfilling from the bank when generation repeats itself', () => {
    const prior = ['How would you validate a new feature idea before building it?'];
    const allDupes = [
      { id: 'q1', question: 'How would you validate a new feature idea before building it?' },
      { id: 'q2', question: 'How would you validate a new feature idea before you build it?' },
    ];
    const out = enforceWarmupVariety(allDupes, 'Product Manager', prior, axes, 4);
    expect(out).toHaveLength(4);
    expect(new Set(out.map((q) => q.question)).size).toBe(4);
  });

  it('never backfills something the candidate has already seen', () => {
    const pool = resolveAxisPool('Product Manager');
    const everythingInThisSessionsAxes = axes.flatMap((a) => pool.bank[a] ?? []);
    const out = enforceWarmupVariety([], 'Product Manager', everythingInThisSessionsAxes, axes, 4);
    for (const q of out) expect(everythingInThisSessionsAxes).not.toContain(q.question);
  });

  it('keeps a genuinely new question rather than discarding the whole set', () => {
    const generated = [
      { id: 'q1', question: 'How would you validate a new feature idea before building it?' },
      { id: 'q2', question: 'Churn moved half a point this month — how do you tell signal from noise?' },
    ];
    const out = enforceWarmupVariety(generated, 'Product Manager', ['How would you validate a new feature idea before building it?'], axes, 4);
    expect(out.map((q) => q.question)).toContain('Churn moved half a point this month — how do you tell signal from noise?');
  });

  it('gives every returned question a unique id', () => {
    const out = enforceWarmupVariety([], 'Software Engineer', [], pickAxes('Software Engineer', 5, 0), 5);
    expect(new Set(out.map((q) => q.id)).size).toBe(out.length);
  });
});
