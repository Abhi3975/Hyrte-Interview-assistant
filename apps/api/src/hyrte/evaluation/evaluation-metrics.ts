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

/**
 * §8.1's canonical report format groups every metric under two named halves
 * — "Role Competency (50%)" and "Workplace Intelligence (50%)" — rather than
 * a flat list. This was never applied to the shared framework above; add the
 * grouping as a lookup over the existing buckets (no new scoring, no new LLM
 * call) so the report can render the same numbers under the doc's own
 * headings. Role Competency = can-they-do-the-job dimensions; Workplace
 * Intelligence = how-they-operate-with-people-and-pressure dimensions. The
 * "50/50" in the doc is a weighting intent, not a literal equal bucket count.
 */
export const METRIC_BUCKET_GROUP: Record<(typeof METRIC_BUCKETS)[number], 'ROLE_COMPETENCY' | 'WORKPLACE_INTELLIGENCE'> = {
  'Technical/Role Competency': 'ROLE_COMPETENCY',
  Cognitive: 'ROLE_COMPETENCY',
  Communication: 'WORKPLACE_INTELLIGENCE',
  Behavioral: 'WORKPLACE_INTELLIGENCE',
  'Confidence & Delivery': 'WORKPLACE_INTELLIGENCE',
  'Risk Detection': 'WORKPLACE_INTELLIGENCE',
  'Hiring Readiness': 'WORKPLACE_INTELLIGENCE',
  'Recruiter Decision': 'WORKPLACE_INTELLIGENCE',
};

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
