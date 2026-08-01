import type { BehaviorContext } from '@prisma/client';

const MANAGER_ROLE_PATTERN = /ceo|cto|cfo|coo|founder|manager|lead|director|head of|vp\b|chief/i;

/**
 * §4.18 Contextual Behavior — cheap heuristic for the peer/manager split from
 * a stakeholder's role title. Not exhaustive (customer/failure/success can't
 * be inferred this way — callers set those explicitly where the situation
 * makes it obvious), but gives every stakeholder interaction a reasonable
 * default without an extra LLM call per message.
 */
export function inferContextFromRole(role: string): BehaviorContext {
  return MANAGER_ROLE_PATTERN.test(role) ? 'MANAGER' : 'PEER';
}
