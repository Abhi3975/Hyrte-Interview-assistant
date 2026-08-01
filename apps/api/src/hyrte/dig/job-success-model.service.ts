import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';

interface JobSuccessModelResponse {
  coreOutcomes?: string[];
  capabilityRequirements?: { skill: string; importance: 'critical' | 'high' | 'medium'; depth: string }[];
  industryContext?: { probeThemes?: string[] };
  companyContext?: { stage?: string; teamSize?: string; seniorityBar?: string; businessModel?: string };
}

/**
 * §3.3 — built by decomposing role/industry/company context, not by keyword
 * matching a JD. HYRTE has no real JD text yet (its own session already
 * captures role/experienceLevel/industry/companyType/difficulty/culture from
 * the 6-input generator, §4.14), so those six inputs stand in for the JD
 * here. When the recruiter-authored `Interview` model gains real JD text,
 * this service gains a second entry point, not a rewrite.
 */
@Injectable()
export class JobSuccessModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  async generateForSession(hyrteSessionId: string) {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id: hyrteSessionId } });
    if (!session) throw new NotFoundException('Session not found');

    const result = await this.ai.completeJson<JobSuccessModelResponse>(
      [
        {
          role: 'system',
          content:
            'Decompose this role into a Job Success Model for a hiring-evaluation platform. Return ONLY JSON: ' +
            '{"coreOutcomes": string[] (3-5, what this role must actually accomplish), ' +
            '"capabilityRequirements": [{"skill": string, "importance": "critical"|"high"|"medium", "depth": string}] ' +
            '(4-8 entries), "industryContext": {"probeThemes": string[] (3-5 themes specific to this industry)}, ' +
            '"companyContext": {"stage": string, "teamSize": string, "seniorityBar": string, "businessModel": string}}.',
        },
        {
          role: 'user',
          content:
            `Role: ${session.experienceLevel} ${session.role}. Industry: ${session.industry}. ` +
            `Company type: ${session.companyType}. Difficulty: ${session.difficulty}. Culture: ${session.culture}.`,
        },
      ],
      { temperature: 0.4, maxTokens: 900 },
    );

    return this.prisma.jobSuccessModel.upsert({
      where: { hyrteSessionId },
      create: {
        hyrteSessionId,
        role: session.role,
        coreOutcomes: result.coreOutcomes ?? [],
        capabilityRequirements: (result.capabilityRequirements ?? []) as unknown as Prisma.InputJsonValue,
        industryContext: (result.industryContext ?? {}) as Prisma.InputJsonValue,
        companyContext: (result.companyContext ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        coreOutcomes: result.coreOutcomes ?? [],
        capabilityRequirements: (result.capabilityRequirements ?? []) as unknown as Prisma.InputJsonValue,
        industryContext: (result.industryContext ?? {}) as Prisma.InputJsonValue,
        companyContext: (result.companyContext ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async getForSession(hyrteSessionId: string) {
    const model = await this.prisma.jobSuccessModel.findUnique({ where: { hyrteSessionId } });
    if (!model) throw new NotFoundException('Job Success Model not generated yet');
    return model;
  }
}
