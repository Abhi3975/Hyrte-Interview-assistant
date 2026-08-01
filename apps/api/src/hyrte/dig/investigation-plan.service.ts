import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { JobSuccessModelService } from './job-success-model.service';
import { EvidenceGraphService } from './evidence-graph.service';

interface InvestigationPlanResponse {
  areas?: { area: string; currentEvidence: string; need: string; priority: 'high' | 'medium' | 'low' }[];
}

/**
 * §3.4 — a plan, not a question list, consumed by both the simulation (which
 * events fire) and the interviewer (which probes get picked) in later
 * phases. Built from the Job Success Model plus whatever evidence already
 * exists for the session; Phase 1 only generates and stores it — nothing
 * reads it yet.
 */
@Injectable()
export class InvestigationPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly jobSuccessModel: JobSuccessModelService,
    private readonly evidence: EvidenceGraphService,
  ) {}

  async generateForSession(hyrteSessionId: string) {
    const [model, existingEvidence] = await Promise.all([
      this.jobSuccessModel.getForSession(hyrteSessionId),
      this.evidence.getForSession(hyrteSessionId),
    ]);

    const evidenceSummary = existingEvidence.length
      ? existingEvidence.map((e) => `- [${e.type}] ${e.rawText} (confidence ${e.confidenceScore})`).join('\n')
      : '(no evidence collected yet — this is a fresh plan)';

    const result = await this.ai.completeJson<InvestigationPlanResponse>(
      [
        {
          role: 'system',
          content:
            'Generate an Investigation Plan for a hiring-evaluation platform: which capability areas ' +
            'need the strongest validation, given what evidence exists so far. Return ONLY JSON: ' +
            '{"areas": [{"area": string, "currentEvidence": string (one short phrase describing current ' +
            'evidence strength), "need": string (what kind of validation is needed), "priority": ' +
            '"high"|"medium"|"low"}] (4-6 entries, drawn from the capability requirements given)}.',
        },
        {
          role: 'user',
          content:
            `Core outcomes: ${model.coreOutcomes.join(', ')}. Capability requirements: ` +
            `${JSON.stringify(model.capabilityRequirements)}. Existing evidence:\n${evidenceSummary}`,
        },
      ],
      { temperature: 0.5, maxTokens: 700 },
    );

    return this.prisma.investigationPlan.upsert({
      where: { hyrteSessionId },
      create: { hyrteSessionId, areas: (result.areas ?? []) as unknown as Prisma.InputJsonValue },
      update: { areas: (result.areas ?? []) as unknown as Prisma.InputJsonValue },
    });
  }

  async getForSession(hyrteSessionId: string) {
    const plan = await this.prisma.investigationPlan.findUnique({ where: { hyrteSessionId } });
    if (!plan) throw new NotFoundException('Investigation plan not generated yet');
    return plan;
  }
}
