/**
 * §7 Shared evaluation metrics framework — the taxonomy every subsystem is
 * meant to score against. HYRTE has no voice/STT infra (§5.8 deferred, see
 * ARCHITECTURE.md), so the doc's "AI/voice" bucket (STT accuracy, tone
 * stability, speech pace) is intentionally omitted rather than faked with a
 * meaningless score — 8 of the doc's 9 buckets apply to a text-based
 * interview, the 9th genuinely doesn't yet.
 */
export const METRIC_BUCKETS = [
  'Communication',
  'Technical/Role Competency',
  'Behavioral',
  'Confidence & Delivery',
  'Cognitive',
  'Risk Detection',
  'Hiring Readiness',
  'Recruiter Decision',
] as const;

/** §3.5 Decision DNA — fixed vocabulary from the doc; never invented outside this list. */
export const DECISION_DNA_TRAITS = [
  'fast-but-careless',
  'slow-but-accurate',
  'data-driven',
  'consensus-seeker',
  'risk-taker',
  'risk-aware',
  'customer-obsessed',
  'execution-focused',
  'politically-aware',
  'process-oriented',
] as const;
