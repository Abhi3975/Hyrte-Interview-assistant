import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordDecisionInput {
  sessionId: string;
  /** candidateId today; a stakeholderId once agents can act as their own node. */
  actor: string;
  actionType: string;
  payload?: Record<string, unknown>;
  reasoning?: string;
  alternativesConsidered?: string[];
  riskAssessment?: string;
  /** Set at write time when already known; otherwise call `recordOutcome` once it resolves. */
  outcome?: string;
  /** Links this node as a recovery action for an earlier decision (DIG Recovery Score, §3.5). */
  recoveryOfId?: string;
}

/**
 * The DIG's write-path contract (build prompt §3.5, Phase 1): every subsystem
 * that observes a candidate decision — workplace actions today, task
 * execution/ethical-gray-zone/stakeholder-agent decisions in later phases —
 * writes through here, never via a raw `prisma.hyrteDecisionLogEntry.create`
 * call. `HyrteDecisionLogEntry` IS the Decision Graph node table (Phase 1
 * architecture decision: extended in place rather than a new table — see
 * ARCHITECTURE.md §4); this service is the only writer so schema changes to
 * the node shape never require touching every caller.
 *
 * DIG write timing is continuous (resolved 2026-08-01, see ARCHITECTURE.md
 * §3): nodes are recorded live as the candidate acts, not assembled after the
 * fact from a completed session. The five DIG read-side capabilities (Decision
 * DNA, Counterfactual Analysis, Recovery Score, Prediction Engine, Learning
 * Engine) are later-phase consumers of the table this service writes.
 */
@Injectable()
export class DecisionGraphService {
  constructor(private readonly prisma: PrismaService) {}

  async recordDecision(input: RecordDecisionInput) {
    return this.prisma.hyrteDecisionLogEntry.create({
      data: {
        sessionId: input.sessionId,
        actor: input.actor,
        actionType: input.actionType,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        reasoning: input.reasoning,
        alternativesConsidered: input.alternativesConsidered ?? [],
        riskAssessment: input.riskAssessment,
        outcome: input.outcome,
        recoveryOfId: input.recoveryOfId,
      },
    });
  }

  /** Attach a resolved outcome to a decision once its consequence plays out. */
  async recordOutcome(decisionId: string, outcome: string) {
    return this.prisma.hyrteDecisionLogEntry.update({
      where: { id: decisionId },
      data: { outcome },
    });
  }

  /** Full chronological node list for a session — the raw Decision Graph. */
  async getGraph(sessionId: string) {
    return this.prisma.hyrteDecisionLogEntry.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      include: { recoveries: true },
    });
  }

  /** Nodes explicitly marked as a recovery action for an earlier decision. */
  async getRecoveryChain(decisionId: string) {
    return this.prisma.hyrteDecisionLogEntry.findMany({
      where: { recoveryOfId: decisionId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
