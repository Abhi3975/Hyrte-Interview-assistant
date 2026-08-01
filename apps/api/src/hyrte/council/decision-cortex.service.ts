import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { AuditLogService } from '../dig/audit-log.service';

interface CortexAnswerResponse {
  answer?: string;
}

/**
 * §6.3.3 — the real-time recruiter Q&A engine. Reads across the three stored
 * layers (individual agent reports, discussion transcript, combined report —
 * the last now including the Prediction Engine output, §6.4 resolved) plus
 * prior Q&A on this session; never re-runs the interview or simulation to
 * answer, per the doc's explicit rule. Text-only for now — the doc's
 * voice-mode requirement is deferred alongside the rest of the Living
 * Interviewer voice layer (§5.8), which doesn't exist yet to reuse (see
 * ARCHITECTURE.md).
 */
@Injectable()
export class DecisionCortexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly auditLog: AuditLogService,
  ) {}

  async ask(sessionId: string, askedBy: string, question: string): Promise<{ answer: string }> {
    const [agentReports, discussion, report, priorQA] = await Promise.all([
      this.prisma.hyrteCouncilAgentReport.findMany({ where: { sessionId }, orderBy: { agentKey: 'asc' } }),
      this.prisma.hyrteCouncilDiscussionEntry.findMany({ where: { sessionId }, orderBy: { ordinal: 'asc' } }),
      this.prisma.hyrteInterviewReport.findUnique({ where: { sessionId } }),
      this.prisma.hyrteCouncilQA.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 10 }),
    ]);
    if (agentReports.length === 0) {
      throw new NotFoundException('Decision Council has not convened for this session yet');
    }

    const agentSummary = agentReports
      .map((r) => `- ${r.agentName}${r.stance ? ` [${r.stance}]` : ''}: ${r.reasoning}`)
      .join('\n');
    const discussionSummary = discussion.length
      ? discussion.map((d) => `- ${d.agentKey}: ${d.statement}`).join('\n')
      : '(no discussion recorded)';
    const predictions = (report?.predictions as unknown as { dimension: string; likelihood: string; reasoning: string }[]) ?? [];
    const predictionsSummary = predictions.length
      ? predictions.map((p) => `- ${p.dimension}: ${p.likelihood} — ${p.reasoning}`).join('\n')
      : '(no Prediction Engine output yet)';
    const reportSummary = report
      ? `Overall recommendation: ${report.recommendation}. Confidence: ${report.confidencePercent ?? 'n/a'}%. ` +
        `Summary: ${report.summary}\n\nPrediction Engine (§3.5 — the source of truth for any "how will they ` +
        `perform in X" question):\n${predictionsSummary}`
      : '(no combined report yet)';
    const priorQAText = priorQA.length
      ? priorQA.map((q) => `Q: ${q.question}\nA: ${q.answer}`).join('\n\n')
      : '(no prior questions)';

    const result = await this.auditLog.run(sessionId, 'cortex.ask', () =>
      this.ai.completeJson<CortexAnswerResponse>(
        [
          {
            role: 'system',
            content:
              'You are Decision Cortex, answering a recruiter\'s question about a completed hiring committee ' +
              'review. You NEVER re-run the interview or simulation to answer — you only reason over the ' +
              'stored committee data below. When possible, cite which specific agent\'s reasoning grounds your ' +
              'answer (e.g. "Hiring Manager flagged strong ownership after the recovery; Devil\'s Advocate ' +
              'challenged this citing the delay; net effect on the recommendation was..."). If the stored data ' +
              'genuinely does not cover what\'s being asked, say so plainly rather than guessing. Tone: calm, ' +
              'analytical, neutral — this is a recruiter-facing analyst voice, not a candidate-facing ' +
              `interviewer. If you reference the overall recommendation, use this EXACT value, verbatim, every ` +
              `time: "${report?.recommendation ?? 'unknown'}" — never substitute a different fit label even if ` +
              'your own reasoning drifts toward one. If asked how the candidate will perform in a specific ' +
              'environment/role-type (startup, enterprise, leadership, high-ambiguity, etc.), answer from the ' +
              'Prediction Engine data below — never estimate a different likelihood than what it already says. ' +
              'Return ONLY JSON: {"answer": string (2-5 sentences)}.',
          },
          {
            role: 'user',
            content:
              `Individual committee reports:\n${agentSummary}\n\nDiscussion:\n${discussionSummary}\n\n` +
              `Combined report:\n${reportSummary}\n\nPrior Q&A this session:\n${priorQAText}\n\n` +
              `Recruiter's question: ${question}`,
          },
        ],
        { temperature: 0.4, maxTokens: 500 },
      ),
    );

    const answer = (result.answer ?? "I don't have enough in the stored committee data to answer that precisely.").trim();

    await this.prisma.hyrteCouncilQA.create({ data: { sessionId, askedBy, question, answer } });

    return { answer };
  }

  async getQAHistory(sessionId: string) {
    return this.prisma.hyrteCouncilQA.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
  }
}
