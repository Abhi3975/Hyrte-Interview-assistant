import { distributeHiddenRisks, sanitizeMissionBrief } from '../src/hyrte/generator/simulation-generator.service';
import type { FixtureStakeholder } from '../src/hyrte/fixtures/hyrte-fixture.types';

function fakeStakeholder(key: string): FixtureStakeholder {
  return { key, name: key, role: 'Role', avatarSeed: key } as FixtureStakeholder;
}

describe('sanitizeMissionBrief (refinements doc §1 — tiered objectives + known risks)', () => {
  it('preserves real tiered objectives when the LLM returns them', () => {
    const brief = sanitizeMissionBrief({
      objective: 'x',
      whyItMatters: 'y',
      currentHealth: 'z',
      successMetrics: ['m'],
      objectives: { primary: ['P1', 'P2'], secondary: ['S1'], stretch: ['ST1'] },
      knownRisks: ['R1', 'R2'],
    });
    expect(brief.objectives.primary).toEqual(['P1', 'P2']);
    expect(brief.objectives.secondary).toEqual(['S1']);
    expect(brief.objectives.stretch).toEqual(['ST1']);
    expect(brief.knownRisks).toEqual(['R1', 'R2']);
  });

  it('never returns an empty tier — falls back to a real value, not an empty array', () => {
    const brief = sanitizeMissionBrief({ objective: 'Ship the thing' });
    expect(brief.objectives.primary.length).toBeGreaterThan(0);
    expect(brief.objectives.secondary.length).toBeGreaterThan(0);
    expect(brief.objectives.stretch.length).toBeGreaterThan(0);
    expect(brief.knownRisks.length).toBeGreaterThan(0);
    // Primary falls back to the single objective line when the LLM omits the richer shape.
    expect(brief.objectives.primary).toEqual(['Ship the thing']);
  });

  it('caps tier sizes (primary/secondary at 2, stretch at 1) even if the LLM overproduces', () => {
    const brief = sanitizeMissionBrief({
      objective: 'x',
      objectives: { primary: ['a', 'b', 'c', 'd'], secondary: ['a', 'b', 'c'], stretch: ['a', 'b'] },
    });
    expect(brief.objectives.primary.length).toBe(2);
    expect(brief.objectives.secondary.length).toBe(2);
    expect(brief.objectives.stretch.length).toBe(1);
  });
});

describe('distributeHiddenRisks (refinements doc §1 — "hidden risks not explicitly revealed")', () => {
  it('folds each hidden risk into a real stakeholder privateKnowledge entry', () => {
    const stakeholders = [fakeStakeholder('a'), fakeStakeholder('b'), fakeStakeholder('c')];
    distributeHiddenRisks(['Risk one', 'Risk two'], stakeholders);
    const allKnowledge = stakeholders.flatMap((s) => s.privateKnowledge ?? []);
    expect(allKnowledge).toContain('Risk one');
    expect(allKnowledge).toContain('Risk two');
  });

  it('never overwrites existing privateKnowledge — appends, does not replace', () => {
    const stakeholders = [{ ...fakeStakeholder('a'), privateKnowledge: ['Already knows this'] }];
    distributeHiddenRisks(['New hidden risk'], stakeholders);
    expect(stakeholders[0].privateKnowledge).toEqual(['Already knows this', 'New hidden risk']);
  });

  it('is a no-op with no risks or no stakeholders — never throws', () => {
    expect(() => distributeHiddenRisks([], [fakeStakeholder('a')])).not.toThrow();
    expect(() => distributeHiddenRisks(['a risk'], [])).not.toThrow();
  });

  it('wraps around when there are more hidden risks than stakeholders', () => {
    const stakeholders = [fakeStakeholder('a')];
    distributeHiddenRisks(['R1', 'R2'], stakeholders);
    expect(stakeholders[0].privateKnowledge).toEqual(['R1', 'R2']);
  });
});
