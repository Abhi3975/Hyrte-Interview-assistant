import { resolveCompetencies, competenciesFromJobSuccessModel } from '../src/interview-intelligence/competency-model';
import {
  PROVEN_CONFIDENCE,
  MAX_TURNS_PER_COMPETENCY,
  TurnAssessment,
  applyAssessments,
  composeDeliberation,
  hasUnresolvedConflict,
  initLiveState,
  overallConfidence,
  seedFromPriorEvidence,
  selectNextObjective,
} from '../src/interview-intelligence/live-interview-state';

/**
 * Live committee steering (panel doc + metrics doc Step 10). Every case below
 * corresponds to a real bug found by running the engine over simulated
 * interviews before it was wired up — this file is what stops them coming back.
 */

const pm = () => initLiveState(resolveCompetencies('Product Manager'));
const assess = (key: string, strength: TurnAssessment['strength'], note = 'n'): TurnAssessment[] => [{ competencyKey: key, strength, note }];

describe('competency model', () => {
  it('resolves role-specific competencies by free-text title, not an enum', () => {
    expect(resolveCompetencies('Senior Product Manager, Growth').some((c) => c.key === 'product_judgment')).toBe(true);
    expect(resolveCompetencies('Backend Engineer II').some((c) => c.key === 'debugging')).toBe(true);
    expect(resolveCompetencies('Account Executive').some((c) => c.key === 'qualification')).toBe(true);
  });

  it('falls back to universal competencies for an unrecognised role rather than returning nothing', () => {
    const generic = resolveCompetencies('Chief Astronaut Officer');
    expect(generic.length).toBeGreaterThan(0);
    expect(generic.every((c) => typeof c.evidenceLooksLike === 'string' && c.evidenceLooksLike.length > 0)).toBe(true);
  });

  it('marks communication/ownership/problem-solving as implicit — never asked about directly', () => {
    const implicit = resolveCompetencies('Product Manager').filter((c) => !c.probe).map((c) => c.key);
    expect(implicit).toEqual(expect.arrayContaining(['communication', 'ownership', 'problem_solving']));
  });

  it('sorts most-important-first so a critical competency is reachable in a short interview', () => {
    expect(resolveCompetencies('Product Manager')[0].priority).toBe('critical');
  });

  it('prefers a real JD decomposition, but only when it produced enough to be usable', () => {
    const fromJd = competenciesFromJobSuccessModel('Product Manager', [
      { skill: 'Pricing strategy', importance: 'critical' },
      { skill: 'Partner management', importance: 'high' },
      { skill: 'Forecasting', importance: 'medium' },
    ]);
    expect(fromJd.some((c) => c.label === 'Pricing strategy')).toBe(true);

    // One vague requirement is worse than the role table — don't prefer it.
    const thin = competenciesFromJobSuccessModel('Product Manager', [{ skill: 'Be good at product', importance: 'high' }]);
    expect(thin.some((c) => c.key === 'product_judgment')).toBe(true);
  });
});

describe('confidence arithmetic', () => {
  it('does NOT let a single strong answer prove a competency', () => {
    // Regression: an earlier running-blend version let one answer set the
    // value outright, which is the Bias Auditor's "confidence mistaken for
    // competence" failure in miniature.
    const state = applyAssessments(pm(), assess('product_judgment', 'strong'), 'product_judgment');
    const pj = state.competencies.find((c) => c.key === 'product_judgment')!;
    expect(pj.confidence).toBeLessThan(PROVEN_CONFIDENCE);
    expect(pj.confidence).toBeGreaterThan(50);
  });

  it('lets corroboration carry a competency over the proven bar', () => {
    let state = applyAssessments(pm(), assess('product_judgment', 'strong'), 'product_judgment');
    state = applyAssessments(state, assess('product_judgment', 'strong'), 'product_judgment');
    expect(state.competencies.find((c) => c.key === 'product_judgment')!.confidence).toBeGreaterThanOrEqual(PROVEN_CONFIDENCE);
  });

  it('a strong answer followed by a weak one does not stay proven', () => {
    let state = applyAssessments(pm(), assess('product_judgment', 'strong'), 'product_judgment');
    state = applyAssessments(state, assess('product_judgment', 'weak'), 'product_judgment');
    expect(state.competencies.find((c) => c.key === 'product_judgment')!.confidence).toBeLessThan(PROVEN_CONFIDENCE);
  });

  it('a contradiction holds a competency down no matter how much else is said about it', () => {
    let state = applyAssessments(pm(), assess('data_analysis', 'conflicting'), 'data_analysis');
    state = applyAssessments(state, assess('data_analysis', 'medium'), 'data_analysis');
    const c = state.competencies.find((x) => x.key === 'data_analysis')!;
    expect(c.strength).toBe('conflicting');
    expect(c.confidence).toBeLessThanOrEqual(35);
  });

  it('a contradiction is resolvable — the committee must be able to reduce uncertainty', () => {
    // Regression: conflicts latched permanently, contradicting the doc's own
    // "refuses to make decisions until uncertainty is reduced".
    expect(hasUnresolvedConflict(['conflicting'])).toBe(true);
    expect(hasUnresolvedConflict(['conflicting', 'medium'])).toBe(true);
    expect(hasUnresolvedConflict(['conflicting', 'strong'])).toBe(false);
    expect(hasUnresolvedConflict(['strong', 'conflicting'])).toBe(true);
  });

  it('weights overall confidence by priority so a proven medium cannot mask an unproven critical', () => {
    const critical = applyAssessments(pm(), assess('product_judgment', 'strong'), 'product_judgment');
    const medium = applyAssessments(pm(), assess('technical_depth', 'strong'), 'technical_depth');
    expect(overallConfidence(critical)).toBeGreaterThan(overallConfidence(medium));
  });

  it('ignores an assessment naming a competency that is not under investigation', () => {
    const state = applyAssessments(pm(), assess('not_a_real_competency', 'strong'), null);
    expect(state.competencies.every((c) => c.confidence === 0)).toBe(true);
  });
});

describe('what the committee asks next', () => {
  it('never targets an implicit competency — you do not ask someone about their communication', () => {
    let state = pm();
    for (let i = 0; i < 12; i++) {
      const d = selectNextObjective(state);
      if (d.readyToConclude) break;
      const target = state.competencies.find((c) => c.key === d.targetCompetencyKey)!;
      expect(target.probe).toBe(true);
      state = applyAssessments(state, assess(d.targetCompetencyKey!, 'strong'), d.targetCompetencyKey);
    }
  });

  it('stops asking about a competency once it is proven — metrics Step 10', () => {
    let state = pm();
    state = applyAssessments(state, assess('product_judgment', 'strong'), 'product_judgment');
    state = applyAssessments(state, assess('product_judgment', 'strong'), 'product_judgment');
    for (let i = 0; i < 6; i++) {
      const d = selectNextObjective(state);
      expect(d.targetCompetencyKey).not.toBe('product_judgment');
      if (d.readyToConclude) break;
      state = applyAssessments(state, assess(d.targetCompetencyKey!, 'weak'), d.targetCompetencyKey);
    }
  });

  it('gives up on a competency after a bounded number of probes rather than grinding on it', () => {
    let state = pm();
    let targeted = 0;
    for (let i = 0; i < 15; i++) {
      const d = selectNextObjective(state);
      if (d.readyToConclude) break;
      if (d.targetCompetencyKey === 'prioritization') targeted++;
      state = applyAssessments(state, assess(d.targetCompetencyKey!, 'none'), d.targetCompetencyKey);
    }
    expect(targeted).toBeLessThanOrEqual(MAX_TURNS_PER_COMPETENCY);
  });

  it('pulls an unresolved contradiction to the front regardless of its arithmetic score', () => {
    let state = pm();
    // Make everything else look well covered, then introduce one contradiction.
    for (const key of ['product_judgment', 'prioritization', 'execution']) {
      state = applyAssessments(state, assess(key, 'strong'), key);
      state = applyAssessments(state, assess(key, 'strong'), key);
    }
    state = applyAssessments(state, assess('stakeholder_mgmt', 'conflicting'), 'stakeholder_mgmt');
    expect(selectNextObjective(state).targetCompetencyKey).toBe('stakeholder_mgmt');
  });

  it('concludes once no remaining question is worth asking', () => {
    let state = pm();
    for (let i = 0; i < 40; i++) {
      const d = selectNextObjective(state);
      if (d.readyToConclude) {
        expect(d.targetCompetencyKey).toBeNull();
        return;
      }
      state = applyAssessments(state, assess(d.targetCompetencyKey!, 'strong'), d.targetCompetencyKey);
    }
    throw new Error('committee never concluded — readyToConclude is unreachable');
  });

  it('concentrates on critical gaps when almost out of turns', () => {
    const state = pm();
    const scarce = selectNextObjective(state, 1);
    const target = state.competencies.find((c) => c.key === scarce.targetCompetencyKey)!;
    expect(target.priority).toBe('critical');
  });
});

describe('prior evidence and deliberation', () => {
  it('seeds from the investigation plan but never marks anything proven before a word is spoken', () => {
    const seeded = seedFromPriorEvidence(pm(), [{ area: 'Product judgment', currentEvidence: 'Strong — demonstrated in the simulation' }]);
    const pj = seeded.competencies.find((c) => c.key === 'product_judgment')!;
    expect(pj.confidence).toBeGreaterThan(0);
    expect(pj.confidence).toBeLessThan(PROVEN_CONFIDENCE);
  });

  it('writes a deliberation line that reports the real numbers, not a generated paraphrase', () => {
    let state = applyAssessments(pm(), assess('data_analysis', 'conflicting', 'claimed data-driven but decided first'), 'data_analysis');
    const directive = selectNextObjective(state);
    const entries = composeDeliberation(state, directive, assess('data_analysis', 'conflicting', 'claimed data-driven but decided first'));
    expect(entries.some((e) => e.speaker === 'Evidence Auditor' && e.message.includes('claimed data-driven'))).toBe(true);
    expect(entries.some((e) => e.speaker === 'Decision Cortex' && e.message.includes(`${directive.overallConfidence}%`))).toBe(true);
  });
});
