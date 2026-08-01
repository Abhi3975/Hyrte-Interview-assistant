/**
 * §4.19 Company Culture Simulation (scoring layer) — "the same behavior
 * should be scored differently depending on the selected Company Culture...
 * only the evaluation weighting changes."
 *
 * This is data only, matching the Phase 1 precedent of building the DIG's
 * write-path contract before any read-side capability exists to consume it:
 * there is no scorer anywhere in HYRTE yet (Section 7's shared metrics
 * framework is Phase 7 scope), so wiring these weights into a live score
 * right now would have nothing real to multiply against. Whoever builds
 * Phase 7's scorer reads `getCultureWeights(culture)` instead of inventing a
 * second weighting table.
 *
 * Dimensions match the Behavioral Graph output named in §4.9 (Pressure
 * Response, Decision Consistency, Leadership Signals, Conflict Style,
 * Accountability, Adaptability, Stakeholder Management, Execution Quality),
 * each 0-2 where 1.0 is neutral, >1 means this culture rewards it more, <1
 * means this culture cares about it less. Cultures match the 7 options on
 * the HYRTE setup screen (apps/web/src/app/hyrte/page.tsx `CULTURES`).
 */
export interface CultureWeights {
  pressureResponse: number;
  decisionConsistency: number;
  leadershipSignals: number;
  conflictStyle: number;
  accountability: number;
  adaptability: number;
  stakeholderManagement: number;
  executionQuality: number;
}

const NEUTRAL: CultureWeights = {
  pressureResponse: 1,
  decisionConsistency: 1,
  leadershipSignals: 1,
  conflictStyle: 1,
  accountability: 1,
  adaptability: 1,
  stakeholderManagement: 1,
  executionQuality: 1,
};

const CULTURE_WEIGHTS: Record<string, CultureWeights> = {
  'Customer-obsessed': { ...NEUTRAL, stakeholderManagement: 1.6, conflictStyle: 1.3, executionQuality: 0.9 },
  'Engineering-driven': { ...NEUTRAL, executionQuality: 1.6, decisionConsistency: 1.3, stakeholderManagement: 0.8 },
  'Data-driven': { ...NEUTRAL, decisionConsistency: 1.6, adaptability: 0.8, accountability: 1.2 },
  'Sales-driven': { ...NEUTRAL, pressureResponse: 1.5, adaptability: 1.3, decisionConsistency: 0.8 },
  'Innovation-first': { ...NEUTRAL, adaptability: 1.6, executionQuality: 0.8, leadershipSignals: 1.2 },
  'Cost-conscious': { ...NEUTRAL, accountability: 1.5, executionQuality: 1.2, adaptability: 0.8 },
  'Compliance-first': { ...NEUTRAL, accountability: 1.6, decisionConsistency: 1.4, adaptability: 0.7 },
};

/** Falls back to neutral (all 1.0) for any culture string not in the table above. */
export function getCultureWeights(culture: string): CultureWeights {
  return CULTURE_WEIGHTS[culture] ?? NEUTRAL;
}
