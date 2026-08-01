/**
 * §4.12 Layer 10 — never let a stakeholder row reach the candidate with this
 * field. Shared across every service that queries/returns/broadcasts a
 * `HyrteStakeholder` row so there's exactly one place enforcing this, instead
 * of each call site trusting its own copy of the same literal.
 */
export const OMIT_HIDDEN_INTENTION = { hiddenIntention: true } as const;
