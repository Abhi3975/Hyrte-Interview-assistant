import { applyIndustryBias, INDUSTRY_CATEGORIES, industryGroundingNote, resolveIndustryTemplate } from '../src/hyrte/generator/industry-templates';

describe('resolveIndustryTemplate (recruiter doc §2 — real industry templates)', () => {
  it('resolves a vertical label to its parent category template', () => {
    const resolved = resolveIndustryTemplate('FinTech');
    expect(resolved?.categoryId).toBe('technology');
    expect(resolved?.template.primaryMetrics).toContain('technicalDebt');
  });

  it('resolves a bare category id too', () => {
    expect(resolveIndustryTemplate('healthcare')?.categoryId).toBe('healthcare');
  });

  it('is case/whitespace insensitive', () => {
    expect(resolveIndustryTemplate('  banking  ')?.categoryId).toBe('finance');
    expect(resolveIndustryTemplate('BANKING')?.categoryId).toBe('finance');
  });

  it('returns null for unrecognized free text instead of guessing', () => {
    expect(resolveIndustryTemplate('Underwater Basket Weaving')).toBeNull();
  });

  it('every vertical id and label is globally unique (caught two real collisions during dev — Consulting/Technology and EdTech under both Technology and Education)', () => {
    const ids = INDUSTRY_CATEGORIES.flatMap((c) => c.verticals.map((v) => v.id));
    const labels = INDUSTRY_CATEGORIES.flatMap((c) => c.verticals.map((v) => v.label.toLowerCase()));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('every declared vertical actually resolves to a real template', () => {
    for (const category of INDUSTRY_CATEGORIES) {
      for (const vertical of category.verticals) {
        const resolved = resolveIndustryTemplate(vertical.label);
        expect(resolved).not.toBeNull();
        expect(resolved?.categoryId).toBe(category.id);
      }
    }
  });
});

describe('applyIndustryBias — deterministic, not an LLM hope', () => {
  it('nudges the specific keys the industry template declares, clamped 0-100', () => {
    const state = { complianceRisk: 50, riskLevel: 50, revenue: 50 };
    const biased = applyIndustryBias(state, 'Banking');
    expect(biased.complianceRisk).toBe(65); // +15 per the finance template
    expect(biased.riskLevel).toBe(55); // +5
    expect(biased.revenue).toBe(50); // untouched — not in the template's bias map
  });

  it('clamps at 100 rather than overflowing', () => {
    const state = { complianceRisk: 95 };
    const biased = applyIndustryBias(state, 'Hospitals');
    expect(biased.complianceRisk).toBe(100);
  });

  it('is a no-op for unrecognized industry text — never silently corrupts state', () => {
    const state = { revenue: 42 };
    expect(applyIndustryBias(state, 'not a real industry')).toEqual(state);
  });
});

describe('industryGroundingNote', () => {
  it('includes real, concrete vocabulary for a recognized industry', () => {
    expect(industryGroundingNote('SaaS')).toContain('technical debt');
  });

  it('is empty for unrecognized industry text — never fabricates grounding', () => {
    expect(industryGroundingNote('not a real industry')).toBe('');
  });
});
