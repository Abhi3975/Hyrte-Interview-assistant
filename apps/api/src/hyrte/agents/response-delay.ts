/**
 * Refinements doc §15 — "Waiting Is Part of Work: Every AI stakeholder
 * should have realistic response times based on their role, workload, and
 * priority." Before this, every `HyrteStakeholderAgentService.respond` call
 * site (inbox reply, CC, forward, Slack, signature-artifact reaction) fired
 * immediately — the only "delay" was however long the LLM call itself took
 * (a couple seconds), regardless of who the stakeholder was, how busy they
 * already were, or how urgent the candidate's message was. This computes a
 * real simulated wait — role-based (a Support/CS role answers fast, an
 * Engineer investigates before replying, an Exec is busy and slow), scaled
 * by current open-item workload and the stakeholder's own stress/urgency/
 * motivation, then cut sharply if the incoming message is itself urgent —
 * as a pure function so the arithmetic is unit-testable without the full
 * agent/Prisma DI surface, same discipline as work-tick.service.ts's
 * speedMultiplier and signature-artifacts.ts's role resolution.
 */

export interface ResponseDelayInput {
  role: string;
  /** 0-100, from HyrteStakeholder. */
  stress: number;
  /** 0-100, from HyrteStakeholder — this stakeholder's own baseline urgency trait, distinct from the incoming message's urgency. */
  urgency: number;
  /** 0-100, from HyrteStakeholder. */
  motivation: number;
  /** Count of this stakeholder's own non-DONE work items right now — the real workload signal, same query shape as command-bar.service.ts's reject_conflict check. */
  openWorkItemCount: number;
  /** Whether the specific message/request being replied to is itself urgent. */
  messageUrgent: boolean;
}

const ROLE_BASE_DELAY_MS: { pattern: RegExp; baseMs: number }[] = [
  // Customer-facing/responsive-by-trade roles reply fastest — answering quickly IS the job.
  { pattern: /support|customer success|success manager|account manager/i, baseMs: 20_000 },
  { pattern: /sales|\bsdr\b|\bbdr\b|business development/i, baseMs: 30_000 },
  // Process/approval-heavy roles are the slowest — a real answer needs a real check first.
  { pattern: /finance|accounting|\bfp&a\b|legal|compliance/i, baseMs: 150_000 },
  { pattern: /\bhr\b|human resources|people (partner|ops)|recruiter|talent acquisition/i, baseMs: 100_000 },
  // Busy, context-switching, many competing demands.
  { pattern: /\bceo\b|\bcto\b|\bcfo\b|\bcoo\b|founder|\bvp\b|vice president|director|head of|\bmanager\b/i, baseMs: 120_000 },
  // Investigation-heavy ICs — need to dig in before they can say anything real.
  { pattern: /engineer|developer|\bqa\b|\bsre\b|devops|data scientist|machine learning|\bml\b|data analyst|analytics/i, baseMs: 90_000 },
];
const DEFAULT_BASE_MS = 60_000;

const MIN_DELAY_MS = 10_000;
const MAX_DELAY_MS = 300_000;
const WORKLOAD_MS_PER_OPEN_ITEM = 10_000;
const MAX_WORKLOAD_CONTRIBUTION_MS = 90_000;
const URGENT_MESSAGE_MULTIPLIER = 0.4;

function roleBaseDelayMs(role: string): number {
  const match = ROLE_BASE_DELAY_MS.find((entry) => entry.pattern.test(role));
  return match ? match.baseMs : DEFAULT_BASE_MS;
}

export function computeResponseDelayMs(input: ResponseDelayInput): number {
  const workloadMs = Math.min(MAX_WORKLOAD_CONTRIBUTION_MS, Math.max(0, input.openWorkItemCount) * WORKLOAD_MS_PER_OPEN_ITEM);
  let delay = roleBaseDelayMs(input.role) + workloadMs;

  // High stress slows a reply down; low stress speeds it up — 0-100 maps to a 0.5x-1.5x band.
  delay *= 1 + (input.stress - 50) / 100;

  // A stakeholder who's personally urgent/motivated moves faster regardless of role —
  // 0-100 (averaged) maps to a 1.25x-0.75x band, the inverse direction of stress.
  const personalDrive = (input.urgency + input.motivation) / 2;
  delay *= 1 - (personalDrive - 50) / 200;

  if (input.messageUrgent) delay *= URGENT_MESSAGE_MULTIPLIER;

  return Math.round(Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delay)));
}
