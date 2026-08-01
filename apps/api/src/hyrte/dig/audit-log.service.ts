import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * §8 Hardening — "audit logging across all agents." Wraps any AI agent call
 * (Council's 9 agents + discussion, Decision Cortex, Report Intelligence)
 * with timing + success/failure tracking, independent of what the agent
 * concluded. This is also how the "Bias Auditor coverage review" question
 * gets answered: query `HyrteAiAuditLog` for `agentKey: 'council.biasAuditor'`
 * — if `success` is ever false or a session has no such row, that agent
 * silently failed to run for that session.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run<T>(sessionId: string, agentKey: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      await this.record(sessionId, agentKey, true, Date.now() - start);
      return result;
    } catch (e) {
      await this.record(sessionId, agentKey, false, Date.now() - start, errMsg(e));
      throw e;
    }
  }

  private async record(sessionId: string, agentKey: string, success: boolean, durationMs: number, errorMessage?: string) {
    try {
      await this.prisma.hyrteAiAuditLog.create({ data: { sessionId, agentKey, success, durationMs, errorMessage } });
    } catch (e) {
      // Audit logging must never be able to break the feature it's observing.
      this.logger.warn(`Failed to write audit log entry (session ${sessionId}, agent ${agentKey}): ${errMsg(e)}`);
    }
  }

  /** Bias-auditor coverage review — did it run and succeed for this session? */
  async getCoverage(sessionId: string) {
    const entries = await this.prisma.hyrteAiAuditLog.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    const failed = entries.filter((e) => !e.success);
    return {
      totalAgentCalls: entries.length,
      failedAgentCalls: failed.map((e) => ({ agentKey: e.agentKey, errorMessage: e.errorMessage })),
      biasAuditorRan: entries.some((e) => e.agentKey === 'council.biasAuditor' && e.success),
    };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
