import type { CompanyStateKey } from '../consequences/consequence.service';
import { COMPANY_STATE_KEYS } from '../consequences/consequence.service';

/**
 * §4.13 Hidden Information System / §4.12 Layer 2 (independent worldview) —
 * scoped implementation. Every stakeholder previously received the identical
 * full 16-variable company state, so no agent's knowledge was actually
 * distinct from any other's (ARCHITECTURE.md flagged this explicitly). This
 * gives each stakeholder a role-scoped subset instead — a real information
 * boundary, not the full doc vision of per-session distributed secrets
 * (that needs generator-level redesign, tracked separately), but genuine:
 * an Engineering stakeholder now can't see revenue, a Sales stakeholder
 * can't see technical debt, etc.
 *
 * True executives are the deliberate exception — a CEO/CFO/COO/founder
 * plausibly does have cross-company visibility in a real org, so they keep
 * the full state rather than being artificially blinded.
 */
const EXECUTIVE_PATTERN = /\b(ceo|cto|cfo|coo|founder|president)\b/i;

const DOMAIN_KEYS: { pattern: RegExp; keys: CompanyStateKey[] }[] = [
  {
    pattern: /engineer|technical|developer|\bdev\b|\bqa\b|architect|infra/i,
    keys: ['engineeringCapacity', 'technicalDebt', 'productQuality', 'operationalRisk'],
  },
  {
    pattern: /sales|account executive|business development|\bbd\b/i,
    keys: ['revenue', 'growth', 'marketReputation', 'deadlinePressure'],
  },
  {
    pattern: /customer|support|success/i,
    keys: ['customerSatisfaction', 'marketReputation', 'complianceRisk'],
  },
  {
    pattern: /marketing/i,
    keys: ['marketReputation', 'growth', 'customerSatisfaction'],
  },
  {
    pattern: /financ|budget|accounting/i,
    keys: ['budget', 'cashRunway', 'complianceRisk'],
  },
  {
    pattern: /\bhr\b|people|talent|recruit/i,
    keys: ['teamMorale', 'burnout', 'hiringCapacity'],
  },
  {
    pattern: /product\b|data analyst|analytics/i,
    keys: ['productQuality', 'customerSatisfaction', 'growth'],
  },
];

/** A narrow, universally-plausible default for roles that match no domain keyword above. */
const DEFAULT_KEYS: CompanyStateKey[] = ['customerSatisfaction', 'teamMorale', 'deadlinePressure', 'riskLevel'];

export function getVisibleStateKeys(role: string): CompanyStateKey[] {
  if (EXECUTIVE_PATTERN.test(role)) return [...COMPANY_STATE_KEYS];
  const matched = new Set<CompanyStateKey>();
  for (const { pattern, keys } of DOMAIN_KEYS) {
    if (pattern.test(role)) keys.forEach((k) => matched.add(k));
  }
  return matched.size > 0 ? [...matched] : DEFAULT_KEYS;
}
