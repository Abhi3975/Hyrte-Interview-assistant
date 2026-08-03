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
 * matching a JD. `generateForSession` is the original path: HYRTE's own
 * 6-input generator (§4.14) stands in for a JD when no real one exists.
 * `generateFromText` is the second entry point predicted in this comment's
 * earlier version — real, pasted JD + company/industry context text,
 * decomposed the same way, not keyword-matched. Same output shape either
 * way; only the input and `source*` provenance fields differ.
 */
@Injectable()
export class JobSuccessModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  async generateFromText(jobDescriptionText: string, companyContextText: string | undefined, hyrteSessionId?: string) {
    const result = await this.decompose(
      `Job description:\n${jobDescriptionText.trim().slice(0, 6000)}` +
        (companyContextText?.trim() ? `\n\nCompany/industry context:\n${companyContextText.trim().slice(0, 2000)}` : ''),
    );
    const roleGuess = result.role ?? jobDescriptionText.trim().split('\n')[0].slice(0, 120);

    const data = {
      role: roleGuess,
      coreOutcomes: result.coreOutcomes ?? [],
      capabilityRequirements: (result.capabilityRequirements ?? []) as unknown as Prisma.InputJsonValue,
      industryContext: (result.industryContext ?? {}) as Prisma.InputJsonValue,
      companyContext: (result.companyContext ?? {}) as Prisma.InputJsonValue,
      sourceJobDescription: jobDescriptionText,
      sourceCompanyContext: companyContextText ?? null,
    };

    if (hyrteSessionId) {
      return this.prisma.jobSuccessModel.upsert({
        where: { hyrteSessionId },
        create: { hyrteSessionId, ...data },
        update: data,
      });
    }
    return this.prisma.jobSuccessModel.create({ data });
  }

  private async decompose(userContent: string): Promise<JobSuccessModelResponse & { role?: string }> {
    return this.ai.completeJson<JobSuccessModelResponse & { role?: string }>(
      [
        {
          role: 'system',
          content:
            'Decompose this into a Job Success Model for a hiring-evaluation platform — read the actual text, ' +
            'do not keyword-match. Return ONLY JSON: {"role": string (the job title, inferred from the text), ' +
            '"coreOutcomes": string[] (3-5, what this role must actually accomplish), "capabilityRequirements": ' +
            '[{"skill": string, "importance": "critical"|"high"|"medium", "depth": string}] (4-8 entries), ' +
            '"industryContext": {"probeThemes": string[] (3-5 themes specific to this industry)}, ' +
            '"companyContext": {"stage": string, "teamSize": string, "seniorityBar": string, "businessModel": string}}.',
        },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.4, maxTokens: 900 },
    );
  }

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
