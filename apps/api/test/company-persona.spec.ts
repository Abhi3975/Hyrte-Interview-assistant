import {
  allCompanyPersonas,
  lockedDocTarget,
  personaDirective,
  personaStakeholderDirective,
  resolveCompanyPersona,
} from '../src/hyrte/generator/company-persona';

/**
 * The Company Persona Engine. Before this, `companyType` was one adjective in
 * one prompt and nothing downstream read it — a government agency and a seed
 * startup generated worlds that differed only by whatever flavour the model
 * happened to add that run.
 */

describe('resolving a company type a recruiter actually typed', () => {
  it('reads the five the UI has always offered', () => {
    expect(resolveCompanyPersona('Startup').key).toBe('startup');
    expect(resolveCompanyPersona('SME').key).toBe('sme');
    expect(resolveCompanyPersona('Enterprise').key).toBe('enterprise');
    expect(resolveCompanyPersona('Consulting').key).toBe('consulting');
    expect(resolveCompanyPersona('Government').key).toBe('government');
  });

  it('reads free text, because the API has always accepted any string', () => {
    expect(resolveCompanyPersona('Series B fintech').key).toBe('scaleup');
    expect(resolveCompanyPersona('Big 4 advisory').key).toBe('consulting');
    expect(resolveCompanyPersona('public sector body').key).toBe('government');
    expect(resolveCompanyPersona('pre-seed, 6 people').key).toBe('startup');
    expect(resolveCompanyPersona('a Fortune 500 multinational').key).toBe('enterprise');
    expect(resolveCompanyPersona('university research lab').key).toBe('research');
    expect(resolveCompanyPersona('registered charity').key).toBe('nonprofit');
  });

  it('gives an unrecognised type a workable middle rather than nothing', () => {
    const fallback = resolveCompanyPersona('Intergalactic Trade Guild');
    expect(fallback.key).toBe('generic');
    expect(fallback.worldDirective.length).toBeGreaterThan(50);
    expect(resolveCompanyPersona('').key).toBe('generic');
    expect(resolveCompanyPersona(null).key).toBe('generic');
  });

  it('separates the two extremes on every axis that matters', () => {
    // If a startup and a government agency came out similar, the engine would
    // be decoration.
    const startup = resolveCompanyPersona('Startup');
    const gov = resolveCompanyPersona('Government');
    expect(startup.approvalDepth).toBeLessThan(gov.approvalDepth);
    expect(startup.decisionSpeed).not.toBe(gov.decisionSpeed);
    expect(startup.documentationCulture).not.toBe(gov.documentationCulture);
    expect(startup.ambiguityTolerance).not.toBe(gov.ambiguityTolerance);
  });

  it('gives every persona a real directive rather than a stub', () => {
    for (const persona of allCompanyPersonas()) {
      expect(persona.worldDirective.length).toBeGreaterThan(80);
      expect(persona.label.length).toBeGreaterThan(2);
    }
  });
});

describe('how much of the company is written down', () => {
  const startup = resolveCompanyPersona('Startup'); // tribal
  const gov = resolveCompanyPersona('Government'); // formal

  it('hides more at a company where nothing is written down', () => {
    expect(lockedDocTarget(startup, 8)).toBeGreaterThan(lockedDocTarget(gov, 8));
  });

  it('always leaves enough readable to orient yourself', () => {
    // A knowledge base with nothing open is a puzzle, not a workplace.
    for (const total of [3, 4, 6, 8, 12]) {
      expect(lockedDocTarget(startup, total)).toBeLessThanOrEqual(total - 2);
    }
  });

  it('always leaves something to discover, even in the most documented world', () => {
    for (const total of [3, 6, 8]) {
      expect(lockedDocTarget(gov, total)).toBeGreaterThanOrEqual(1);
    }
  });

  it('does not go negative or absurd on a tiny knowledge base', () => {
    expect(lockedDocTarget(startup, 1)).toBe(1);
    expect(lockedDocTarget(startup, 2)).toBe(1);
  });
});

describe('what reaches the prompts', () => {
  it('tells world generation to build the properties, not mention them', () => {
    const out = personaDirective(resolveCompanyPersona('Enterprise'));
    expect(out).toMatch(/not so they are mentioned/i);
    expect(out).toMatch(/three or more people/i);
    expect(out).toMatch(/weeks/i);
  });

  it('gives a startup stakeholder authority and an enterprise one a sign-off to name', () => {
    expect(personaStakeholderDirective(resolveCompanyPersona('Startup'))).toMatch(/decide things yourself/i);
    const enterprise = personaStakeholderDirective(resolveCompanyPersona('Enterprise'));
    expect(enterprise).toMatch(/cannot commit to anything alone/i);
    expect(enterprise).toMatch(/sign-off|forum|process/i);
  });

  it('makes a political company say the process rather than the objection', () => {
    expect(personaStakeholderDirective(resolveCompanyPersona('Government'))).toMatch(/not said out loud/i);
    expect(personaStakeholderDirective(resolveCompanyPersona('Startup'))).toMatch(/say what you actually think/i);
  });

  it('matches where the answer lives to how the company documents things', () => {
    expect(personaStakeholderDirective(resolveCompanyPersona('Startup'))).toMatch(/not written down|it is not/i);
    expect(personaStakeholderDirective(resolveCompanyPersona('Government'))).toMatch(/point at the document/i);
  });

  it('produces a distinct directive for every persona — no two companies feel the same', () => {
    const directives = allCompanyPersonas().map((p) => personaStakeholderDirective(p));
    expect(new Set(directives).size).toBe(directives.length);
  });
});
