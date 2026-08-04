/**
 * §4.12 Layer 10 — never let a stakeholder row reach the candidate with this
 * field. Shared across every service that queries/returns/broadcasts a
 * `HyrteStakeholder` row so there's exactly one place enforcing this, instead
 * of each call site trusting its own copy of the same literal.
 */
export const OMIT_HIDDEN_INTENTION = { hiddenIntention: true } as const;

/**
 * Master Build Prompt Hard Rule #5 — candidate-facing payloads physically
 * exclude trust/emotion numerics, not just hiddenIntention. Use this (never
 * OMIT_HIDDEN_INTENTION alone) on any HyrteStakeholder read or REST/gateway
 * broadcast that reaches the candidate's own browser. Internal engine code
 * (agent prompt construction, other stakeholders' independent reasoning)
 * still reads the full row directly, unscoped.
 */
export const OMIT_CANDIDATE_INTERNALS = {
  hiddenIntention: true,
  privateKnowledge: true,
  trust: true,
  respect: true,
  cooperation: true,
  influence: true,
  stress: true,
  urgency: true,
  patience: true,
  motivation: true,
} as const;

type WithInternals = Record<string, unknown> & { hiddenIntention?: unknown };

/**
 * Runtime equivalent of OMIT_CANDIDATE_INTERNALS for callers that already
 * hold a full stakeholder row in memory (needed server-side, e.g. to compute
 * a trust delta for evidence) and only want the scrubbed copy for the
 * candidate-visible gateway broadcast.
 */
export function toCandidateStakeholder<T extends WithInternals>(stakeholder: T): Omit<T, keyof typeof OMIT_CANDIDATE_INTERNALS> {
  const {
    hiddenIntention: _hi,
    privateKnowledge: _pk,
    trust: _t,
    respect: _r,
    cooperation: _c,
    influence: _i,
    stress: _s,
    urgency: _u,
    patience: _p,
    motivation: _m,
    ...rest
  } = stakeholder as WithInternals;
  return rest as Omit<T, keyof typeof OMIT_CANDIDATE_INTERNALS>;
}
